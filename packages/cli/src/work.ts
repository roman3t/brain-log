import fs from 'fs'
import path from 'path'
import type { Command } from 'commander'
import chalk from 'chalk'
import {
  openWork, closeWork, readWorkSessions, getWorkRepository, getContext,
  getActiveTasks, getPMProvider, config, MarkdownProvider, resolveRepoAlias, listRepoAliases,
  discoverWorktrees, importWork, getWorkSessionsForTask, openRefinementSpace,
} from '@brain-log/shared'

function printWorkList(all = false): void {
  const sessions = readWorkSessions().filter(s => all || !s.closedAt)
  if (!sessions.length) { console.log('No hay worktrees registrados.'); return }
  const byTask = new Map<string, typeof sessions>()
  for (const work of sessions) byTask.set(work.taskId, [...(byTask.get(work.taskId) || []), work])
  for (const group of byTask.values()) {
    const multiRepo = group.length > 1
    if (multiRepo) console.log(`${chalk.cyan(group[0].taskId)} · ${group[0].title} · ${group.length} repos`)
    for (const work of group) {
      const state = work.closedAt ? 'cerrado' : fs.existsSync(work.worktreePath) ? 'abierto' : 'falta carpeta'
      const indent = multiRepo ? '  ' : ''
      if (multiRepo) console.log(`${indent}${chalk.dim(work.repoAlias || path.basename(work.repoPath))} · ${state}`)
      else console.log(`${chalk.cyan(work.taskId)} · ${work.title} · ${state}`)
      console.log(`${indent}  ${work.worktreePath}\n${indent}  ${work.branch} → ${work.base}`)
      if (work.herdr) console.log(`${indent}  Herdr: ${work.herdr.session} / ${work.herdr.workspaceId}`)
    }
  }
}

function readTaskNotes(taskId: string, context: string): string {
  if (!config.markdown.vaultPath) return ''
  const relative = config.markdown.contexts[context] || ''
  const root = path.join(config.markdown.vaultPath, relative, 'task-jira')
  for (const file of [path.join(root, `${taskId}.md`), path.join(root, 'done', `${taskId}.md`)]) {
    try { return `## Notas y checklist del vault\n\n${fs.readFileSync(file, 'utf8')}` } catch (error: any) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  return ''
}

export function registerWorkCommands(program: Command): void {
  const command = program.command('work [task]')
    .description('Crea o retoma un worktree y un espacio Herdr por tarea')
    .option('--repo <path>', 'Repositorio (por defecto: directorio actual)')
    .option('--base <ref>', 'Rama destino usada al crear y verificar el cierre, ej. origin/dev')
    .option('--branch <name>', 'Rama existente o nueva (por defecto: brain/<ticket>)')
    .option('--descriptor <slug>', 'Sufijo de la carpeta del worktree (por defecto: el ticket en minúsculas)')
    .option('--context <alias>', 'Contexto del vault fijado para este worktree')
    .option('--personal <title>', 'Tarea personal sin consultar Jira')
    .option('--no-herdr', 'Crea o retoma solo el worktree de Git')
    .option('--session <name>', 'Sesión local de Herdr')
    .option('--agent <kind>', 'Inicia claude o codex y le entrega el contexto')
    .option('--refine', 'Fuerza el modo refinamiento aunque el ticket se vea completo')
    .option('--skip-refine', 'Salta el modo refinamiento aunque el ticket se vea corto/incompleto')
    .action(async (task: string | undefined, opts: {
      repo?: string; base?: string; branch?: string; descriptor?: string; context?: string; personal?: string
      herdr: boolean; session?: string; agent?: string; refine?: boolean; skipRefine?: boolean
    }) => {
      try {
        if (!task) { printWorkList(); return }
        const taskId = task.toUpperCase()
        if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(taskId)) throw new Error('Usa un ID como GCD-1134 o VAN-01.')

        // Puerta de refinamiento: sin --repo explícito y sin sesión previa, no se asume el cwd como
        // repo (evita crear un worktree del meta-repo si --repo se omite desde un contenedor como gglobal).
        if (!opts.repo && !opts.personal && !opts.skipRefine && getWorkSessionsForTask(taskId).length === 0) {
          const context = opts.context ?? (getContext() || config.markdown.defaultContext)
          if (context && !config.markdown.contexts[context]) throw new Error(`Contexto del vault desconocido: ${context}. Revisa VAULT_CONTEXTS.`)
          let title = taskId
          let url = ''
          let description = ''
          if (config.jira.host && config.jira.email && config.jira.token) {
            try {
              const issue = await getPMProvider().getTaskDetail(taskId)
              title = issue.title
              url = issue.url
              description = issue.description || ''
            } catch { /* sin Jira o ticket no encontrado: la heurística sigue solo con notas del vault */ }
          }
          const vaultNotes = readTaskNotes(taskId, context)
          const needsRefinement = opts.refine || (description.trim().length < 40 && !vaultNotes)
          if (needsRefinement) {
            const contextText = [description && `## Ticket\n\n${url}\n\n${description}`, vaultNotes].filter(Boolean).join('\n\n')
            const space = openRefinementSpace(taskId, title, contextText, { agent: opts.agent, session: opts.session, herdr: opts.herdr })
            console.log(chalk.yellow(`⚠ ${taskId} parece necesitar refinamiento antes de crear un worktree.`))
            console.log(`  Contexto: ${space.contextFile}`)
            console.log(chalk.dim('  Usa --repo <alias> para saltar este paso si ya sabés qué repos tocar, o --skip-refine para forzarlo.'))
            if (space.herdr) console.log(`  Herdr: ${space.herdr.session} / ${space.herdr.workspaceId}`)
            return
          }
        }

        const repoArg = opts.repo ? resolveRepoAlias(opts.repo) : opts.repo
        const repoAlias = opts.repo && listRepoAliases()[opts.repo] ? opts.repo : undefined
        const repository = getWorkRepository(path.resolve(repoArg || process.cwd()))
        const existing = readWorkSessions().find(s => !s.closedAt && s.taskId === taskId && s.commonDir === repository.commonDir)
        const context = existing?.context ?? opts.context ?? (getContext() || config.markdown.defaultContext)
        if (opts.context !== undefined && existing && opts.context !== existing.context) {
          throw new Error(`Este worktree ya tiene el contexto ${existing.context || '(raíz)'}.`)
        }
        if (context && !config.markdown.contexts[context]) throw new Error(`Contexto del vault desconocido: ${context}. Revisa VAULT_CONTEXTS.`)
        const active = getActiveTasks().find(t => t.id === taskId)
        let title = existing?.title || opts.personal || active?.title
        let url = existing?.url || active?.url || ''
        let status = 'DOING'
        let priority = '-'
        const details: string[] = []
        if (!existing && !opts.personal && active?.provider !== 'personal') {
          if (!config.jira.host || !config.jira.email || !config.jira.token) {
            if (!active) throw new Error('Configura Jira o usa --personal "título" para una tarea personal.')
          } else {
            const issue = await getPMProvider().getTaskDetail(taskId)
            title = issue.title
            url = issue.url
            status = issue.status
            priority = issue.priority
            details.push(`## Ticket\n\nEstado: ${issue.status}\n\n${issue.description}`)
            if (issue.comments.length) details.push('## Comentarios recientes\n\n' + issue.comments.slice(-5)
              .map(c => `### ${c.author} · ${c.created}\n\n${c.body}`).join('\n\n'))
          }
        }
        if (!existing) details.push(readTaskNotes(taskId, context))
        const work = openWork(taskId, {
          ...opts, repo: repoArg, repoAlias, context, title, url, contextText: details.filter(Boolean).join('\n\n'),
        })
        if (config.notes.default === 'markdown' && config.markdown.vaultPath) {
          try {
            await new MarkdownProvider(work.context).saveTaskPage({
              id: work.taskId, title: work.title, url: work.url, status, priority, activatedAt: work.createdAt,
            })
          } catch (error: any) {
            throw new Error(`El worktree está disponible en ${work.worktreePath}, pero no se pudo preparar el checklist: ${error.message}`)
          }
        }
        console.log(chalk.green(`✔ ${work.taskId} — ${work.title}`))
        console.log(`  Worktree: ${work.worktreePath}\n  Rama: ${work.branch}\n  Destino: ${work.base}`)
        console.log(`  Contexto del agente: ${work.contextFile}`)
        if (opts.herdr && work.herdr) console.log(`  Herdr: ${work.herdr.session} / ${work.herdr.workspaceId}`)
        const quoted = `'${work.worktreePath.replace(/'/g, `'"'"'`)}'`
        console.log(`\n  cd ${quoted}`)
      } catch (error: any) {
        console.error(chalk.red(error.message))
        process.exitCode = 1
      }
    })

  command.command('list')
    .description('Lista tareas, ramas, carpetas y espacios Herdr')
    .option('--all', 'Incluye el historial de worktrees cerrados')
    .action((opts: { all?: boolean }) => {
      try { printWorkList(opts.all) } catch (error: any) { console.error(chalk.red(error.message)); process.exitCode = 1 }
    })

  command.command('discover')
    .description('Lista los worktrees Git del repo (registrados y no) sin crear ni registrar nada')
    .option('--repo <path>', 'Repositorio o alias de BRAIN_REPOS (por defecto: directorio actual)')
    .action((opts: { repo?: string }) => {
      try {
        const repoArg = opts.repo ? resolveRepoAlias(opts.repo) : opts.repo
        const { repoPath } = getWorkRepository(path.resolve(repoArg || process.cwd()))
        const found = discoverWorktrees(repoPath)
        if (!found.length) { console.log('No hay worktrees en este repositorio.'); return }
        for (const w of found) {
          const state = w.registered
            ? chalk.green(`registrado · ${w.registered.taskId}`)
            : w.suggestedTaskId
              ? chalk.yellow(`sin registrar · ¿${w.suggestedTaskId}? (sugerencia, no asignado)`)
              : chalk.dim('sin registrar · sin ticket sugerido')
          console.log(`${chalk.cyan(w.path)}`)
          console.log(`  ${w.branch || '(detached)'} · ${state}${w.locked ? chalk.red(' · locked') : ''}`)
        }
      } catch (error: any) { console.error(chalk.red(error.message)); process.exitCode = 1 }
    })

  command.command('import <task>')
    .description('Registra un worktree Git ya existente sin crear uno nuevo ni tocar ramas')
    .requiredOption('--worktree <path>', 'Ruta del worktree ya existente a registrar')
    .option('--repo <path>', 'Repositorio o alias de BRAIN_REPOS (por defecto: directorio actual)')
    .option('--base <ref>', 'Rama destino usada para verificar el cierre, ej. origin/dev')
    .option('--context <alias>', 'Contexto del vault fijado para este worktree')
    .option('--no-herdr', 'Solo registra el worktree, sin abrir Herdr')
    .option('--session <name>', 'Sesión local de Herdr')
    .option('--agent <kind>', 'Inicia claude o codex y le entrega el contexto')
    .action((task: string, opts: {
      worktree: string; repo?: string; base?: string; context?: string
      herdr: boolean; session?: string; agent?: string
    }) => {
      try {
        const taskId = task.toUpperCase()
        if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(taskId)) throw new Error('Usa un ID como GCD-1134 o VAN-01.')
        const repoArg = opts.repo ? resolveRepoAlias(opts.repo) : opts.repo
        const repoAlias = opts.repo && listRepoAliases()[opts.repo] ? opts.repo : undefined
        const context = opts.context ?? (getContext() || config.markdown.defaultContext)
        if (context && !config.markdown.contexts[context]) throw new Error(`Contexto del vault desconocido: ${context}. Revisa VAULT_CONTEXTS.`)
        const work = importWork(taskId, { ...opts, repo: repoArg, repoAlias, context })
        console.log(chalk.green(`✔ ${work.taskId} — worktree importado`))
        console.log(`  Worktree: ${work.worktreePath}\n  Rama: ${work.branch}\n  Destino: ${work.base}`)
        console.log(`  Contexto del agente: ${work.contextFile}`)
        if (opts.herdr && work.herdr) console.log(`  Herdr: ${work.herdr.session} / ${work.herdr.workspaceId}`)
      } catch (error: any) { console.error(chalk.red(error.message)); process.exitCode = 1 }
    })

  command.command('close <task>')
    .description('Elimina el worktree si está limpio, integrado y sin procesos activos en Herdr; conserva la rama')
    .option('--repo <path>', 'Selecciona el repositorio si la tarea tiene varios worktrees')
    .option('--check', 'Verifica el cierre sin cerrar Herdr ni eliminar el worktree')
    .action((task: string, opts: { repo?: string; check?: boolean }) => {
      try {
        const work = closeWork(task, { ...opts, repo: opts.repo ? resolveRepoAlias(opts.repo) : opts.repo })
        console.log(chalk.green(opts.check
          ? `✔ ${work.taskId}: se puede cerrar sin eliminar cambios.`
          : `✔ ${work.taskId}: worktree eliminado. Rama ${work.branch}, notas y contexto conservados.`))
      } catch (error: any) { console.error(chalk.red(error.message)); process.exitCode = 1 }
    })
}
