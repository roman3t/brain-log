#!/usr/bin/env node
import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync } from 'child_process'
import inquirer from 'inquirer'

function notify(title: string, message: string, subtitle?: string) {
  try {
    const clean = (s: string) => s.replace(/"/g, '').replace(/'/g, '')
    const sub = subtitle ? `, subtitle:"${clean(subtitle)}"` : ''
    execSync(`osascript -e 'display notification "${clean(message)}" with title "${clean(title)}"${sub}'`)
  } catch {}
}
import {
  validateConfig,
  validateAnthropicConfig,
  saveCapture,
  saveRecap,
  getCapturesForToday,
  getCapturesForDate,
  getNotesProvider,
  generateRecap,
  getJiraIssue,
  getJiraIssueDetail,
  getJiraDeployments,
  getJiraPullRequests,
  transitionJiraIssue,
  searchJiraIssues,
  getJiraCurrentUser,
  assignJiraIssue,
  getJiraTransitions,
  wasMovedBackward,
  getActiveTask,
  getActiveTasks,
  addActiveTask,
  removeActiveTask,
  clearAllActiveTasks,
  setActiveTask,
  clearActiveTask,
  pinTask,
  unpinTask,
  getPinnedTasks,
  addWatchedMR,
  removeWatchedMR,
  getWatchedMRs,
  upsertTrackedTask,
  getTrackedTasks,
  setupTasksDatabase,
  appendToTrackedTask,
  getPMProvider,
  getGitProvider,
} from '@brain-log/shared'

const program = new Command()

program
  .name('brain')
  .description('Tu second brain personal — captura, procesa, recuerda')
  .version('1.0.0')

// ── Capture helper ──────────────────────────────────────────────
async function capture(type: 'note' | 'todo' | 'vibe' | 'learn', text: string, taskOverride?: string) {
  validateConfig()
  const taskId = taskOverride || getActiveTask()?.id
  await saveCapture({ type, raw: text, source: 'cli', taskId })
  return taskId
}

// ── brain note "texto" [--task GCD-XXX] ────────────────────────
program
  .command('note <text>')
  .description('Guarda una nota rápida')
  .option('-t, --task <id>', 'Vincula a una tarea específica')
  .action(async (text: string, opts: { task?: string }) => {
    const spinner = ora('Guardando nota...').start()
    try {
      const taskId = await capture('note', text, opts.task)
      spinner.succeed(chalk.green('Nota guardada') + (taskId ? chalk.dim(` [${taskId}]`) : ''))
    } catch (e: any) { spinner.fail(chalk.red(e.message)); process.exit(1) }
  })

// ── brain todo "texto" [--task GCD-XXX] ────────────────────────
program
  .command('todo <text>')
  .description('Agrega un to-do')
  .option('-t, --task <id>', 'Vincula a una tarea específica')
  .action(async (text: string, opts: { task?: string }) => {
    const spinner = ora('Guardando to-do...').start()
    try {
      const taskId = await capture('todo', text, opts.task)
      spinner.succeed(chalk.green('To-do guardado') + (taskId ? chalk.dim(` [${taskId}]`) : ''))
    } catch (e: any) { spinner.fail(chalk.red(e.message)); process.exit(1) }
  })

// ── brain vibe "prompt o descripción" [--task GCD-XXX] ─────────
program
  .command('vibe <text>')
  .description('Guarda un prompt o resultado de vibecoding')
  .option('-t, --task <id>', 'Vincula a una tarea específica')
  .action(async (text: string, opts: { task?: string }) => {
    const spinner = ora('Guardando vibe...').start()
    try {
      const taskId = await capture('vibe', text, opts.task)
      spinner.succeed(chalk.green('Vibe guardado') + (taskId ? chalk.dim(` [${taskId}]`) : ''))
    } catch (e: any) { spinner.fail(chalk.red(e.message)); process.exit(1) }
  })

// ── brain learn "texto" [--task GCD-XXX] ───────────────────────
program
  .command('learn <text>')
  .description('Documenta algo que aprendiste')
  .option('-t, --task <id>', 'Vincula a una tarea específica')
  .action(async (text: string, opts: { task?: string }) => {
    const spinner = ora('Guardando aprendizaje...').start()
    try {
      const taskId = await capture('learn', text, opts.task)
      spinner.succeed(chalk.green('Aprendizaje guardado') + (taskId ? chalk.dim(` [${taskId}]`) : ''))
    } catch (e: any) { spinner.fail(chalk.red(e.message)); process.exit(1) }
  })

// ── brain task [issueKey] [text...] ────────────────────────────
program
  .command('task [issueKey] [text...]')
  .description('Activa una tarea o gestiona las tareas activas')
  .option('-c, --clear', 'Limpia la primera tarea activa (o la especificada)')
  .option('--clear-all', 'Limpia todas las tareas activas')
  .option('--active', 'Lista todas las tareas activas')
  .option('-s, --show', 'Muestra los detalles completos del ticket')
  .option('--status', 'Muestra PRs, deploys y estado del ticket')
  .option('--pin', 'Congela el ticket — deploy-check no lo moverá automáticamente')
  .option('--unpin', 'Descongela el ticket')
  .option('-a, --add', 'Agrega o actualiza el ticket en tu tabla de Notion')
  .option('-l, --log <text>', 'Agrega una nota de contexto a la página de la tarea en Notion')
  .option('--sync', 'Sincroniza el estado de todas las tareas desde Jira')
  .option('--setup <pageId>', 'Crea la base de datos Tasks en Notion (requiere ID de página)')
  .action(async (issueKey: string | undefined, textParts: string[], opts: { clear?: boolean; clearAll?: boolean; active?: boolean; show?: boolean; status?: boolean; pin?: boolean; unpin?: boolean; add?: boolean; log?: string; sync?: boolean; setup?: string }) => {

    // ── --active: lista todas las tareas activas ────────────────
    if (opts.active) {
      const tasks = getActiveTasks()
      if (tasks.length === 0) {
        console.log(chalk.yellow('No hay tareas activas.'))
      } else {
        console.log(chalk.bold(`\n${tasks.length} tarea(s) activa(s):\n`))
        tasks.forEach((t, i) => {
          const badge = i === 0 ? chalk.green('● principal') : chalk.dim('○')
          console.log(`  ${badge}  ${chalk.cyan(t.id)} — ${t.title}`)
          console.log(chalk.dim(`         ${t.url}`))
        })
        console.log()
      }
      return
    }

    // ── --clear-all ─────────────────────────────────────────────
    if (opts.clearAll) {
      clearAllActiveTasks()
      console.log(chalk.yellow('Todas las tareas activas limpiadas.'))
      return
    }

    if (opts.setup) {
      const spinner = ora('Creando base de datos Tasks en Notion...').start()
      try {
        const dbId = await setupTasksDatabase(opts.setup)
        const envPath = path.join(os.homedir(), '.brain-log', '.env')
        const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : ''
        if (envContent.includes('NOTION_TASKS_DB=')) {
          fs.writeFileSync(envPath, envContent.replace(/NOTION_TASKS_DB=.*/, `NOTION_TASKS_DB=${dbId}`))
        } else {
          fs.appendFileSync(envPath, `\nNOTION_TASKS_DB=${dbId}\n`)
        }
        spinner.succeed(chalk.green('Base de datos Tasks creada'))
        console.log(chalk.dim(`   ID: ${dbId}`))
        console.log(chalk.yellow('\n  Agrega también esto a tu .env del proyecto:'))
        console.log(chalk.cyan(`   NOTION_TASKS_DB=${dbId}\n`))
      } catch (e: any) {
        spinner.fail(chalk.red(e.message))
        process.exit(1)
      }
      return
    }

    if (opts.log) {
      const key = issueKey || getActiveTask()?.id
      if (!key) {
        console.log(chalk.red('Especifica un issue key o activa una tarea primero'))
        process.exit(1)
      }
      const spinner = ora(`Agregando nota a ${key}...`).start()
      try {
        const pageId = await appendToTrackedTask(key, opts.log)
        if (!pageId) {
          spinner.fail(chalk.red(`${key} no está en tu tabla de Notion. Agrégala primero con --add`))
          process.exit(1)
        }
        spinner.succeed(chalk.green(`Nota agregada a ${chalk.cyan(key)} en Notion`))
      } catch (e: any) {
        spinner.fail(chalk.red(e.message))
        process.exit(1)
      }
      return
    }

    if (opts.sync) {
      const spinner = ora('Obteniendo tareas desde Notion...').start()
      try {
        const tasks = await getTrackedTasks()
        if (tasks.length === 0) {
          spinner.warn(chalk.yellow('No hay tareas en la tabla. Usa brain task GCD-1234 --add primero.'))
          return
        }
        spinner.text = `Sincronizando ${tasks.length} tareas con Jira...`
        let updated = 0
        for (const t of tasks) {
          try {
            const issue = await getJiraIssueDetail(t.taskId)
            await upsertTrackedTask(issue)
            if (issue.status !== t.status) {
              console.log(chalk.cyan(`  ${t.taskId}`) + chalk.dim(` ${t.status} → `) + chalk.green(issue.status))
              updated++
            }
          } catch {
            console.log(chalk.dim(`  ${t.taskId} — no se pudo sincronizar`))
          }
        }
        spinner.succeed(chalk.green(`Sync completo — ${updated} cambios de estado`))
      } catch (e: any) {
        spinner.fail(chalk.red(e.message))
        process.exit(1)
      }
      return
    }
    if (opts.status) {
      const key = issueKey || getActiveTask()?.id
      if (!key) {
        console.log(chalk.red('Especifica un issue key o activa una tarea primero'))
        process.exit(1)
      }
      const spinner = ora(`Cargando status de ${key}...`).start()
      try {
        const issue = await getJiraIssue(key)
        const [deployments, prs] = await Promise.all([
          getJiraDeployments(issue.numericId),
          getJiraPullRequests(issue.numericId),
        ])
        spinner.stop()

        console.log()
        console.log(chalk.bold(`${chalk.cyan(issue.id)} · ${issue.title}`))
        console.log(chalk.dim(`Estado: `) + chalk.yellow(issue.status))
        console.log(chalk.dim(issue.url))

        if (prs.length > 0) {
          console.log(chalk.bold('\nPull Requests'))
          prs.forEach(pr => {
            const icon = pr.status === 'MERGED' ? chalk.green('✓') : pr.status === 'OPEN' ? chalk.yellow('⏳') : chalk.red('✗')
            const branch = chalk.dim(`${pr.sourceBranch} → ${pr.targetBranch}`)
            const status = pr.status === 'MERGED' ? chalk.green('MERGED') : pr.status === 'OPEN' ? chalk.yellow('OPEN') : chalk.red(pr.status)
            console.log(`  ${icon} ${pr.title}`)
            console.log(`     ${branch}  [${status}]  ${chalk.dim(pr.lastUpdated)}`)
          })
        } else {
          console.log(chalk.dim('\nPull Requests: ninguno encontrado'))
        }

        if (deployments.length > 0) {
          console.log(chalk.bold('\nDeploys'))
          deployments.forEach(d => {
            const icon = d.state === 'successful' ? chalk.green('✓') : d.state === 'in_progress' ? chalk.yellow('⏳') : chalk.red('✗')
            const state = d.state === 'successful' ? chalk.green(d.state) : d.state === 'in_progress' ? chalk.yellow(d.state) : chalk.red(d.state)
            console.log(`  ${icon} ${chalk.cyan(d.environment.padEnd(12))} ${state}  ${chalk.dim(d.lastUpdated.split('T')[0] || '')}`)
          })
        } else {
          console.log(chalk.dim('\nDeploys: ninguno registrado'))
        }

        console.log()
      } catch (e: any) {
        spinner.fail(chalk.red(e.message))
        process.exit(1)
      }
      return
    }

    if (opts.show && issueKey) {
      const spinner = ora(`Cargando ${issueKey}...`).start()
      try {
        const issue = await getJiraIssueDetail(issueKey)
        spinner.stop()
        console.log()
        console.log(chalk.bold(`${chalk.cyan(issue.id)} — ${issue.title}`))
        console.log(chalk.dim(`${issue.type} · ${issue.status} · Prioridad: ${issue.priority} · Asignado: ${issue.assignee}`))
        console.log(chalk.dim(issue.url))
        if (issue.description) {
          console.log(chalk.bold('\nDescripción:'))
          console.log(issue.description)
        }
        if (issue.comments.length > 0) {
          console.log(chalk.bold(`\nComentarios (${issue.comments.length}):`))
          issue.comments.slice(-5).forEach(c => {
            console.log(chalk.cyan(`  ${c.author}`) + chalk.dim(` · ${c.created}`))
            console.log(`  ${c.body.replace(/\n/g, '\n  ')}`)
          })
        }
        console.log()
      } catch (e: any) {
        spinner.fail(chalk.red(e.message))
        process.exit(1)
      }
      return
    }

    if (opts.pin || opts.unpin) {
      const key = issueKey || getActiveTask()?.id
      if (!key) {
        console.log(chalk.red('Especifica un issue key o activa una tarea primero'))
        process.exit(1)
      }
      if (opts.pin) {
        pinTask(key)
        console.log(chalk.yellow(`⏸  ${key} congelado — deploy-check no lo moverá automáticamente`))
      } else {
        unpinTask(key)
        console.log(chalk.green(`▶  ${key} descongelado — deploy-check lo moverá normalmente`))
      }
      return
    }

    if (opts.clear) {
      if (issueKey) {
        removeActiveTask(issueKey.toUpperCase())
        console.log(chalk.green(`✔ ${issueKey.toUpperCase()} removida de tareas activas`))
      } else {
        clearActiveTask()
        console.log(chalk.green('✔ Tarea activa eliminada'))
      }
      return
    }

    if (!issueKey) {
      const tasks = getActiveTasks()
      if (tasks.length > 1) {
        console.log(chalk.bold(`\n${tasks.length} tareas activas:\n`))
        tasks.forEach((t, i) => {
          const badge = i === 0 ? chalk.green('● principal') : chalk.dim('○')
          console.log(`  ${badge}  ${chalk.cyan(t.id)} — ${t.title}`)
        })
        console.log()
        console.log(chalk.dim('  brain task --active   → ver todas'))
        console.log(chalk.dim('  brain task GCD-XXX --clear   → remover una'))
        console.log()
        return
      }
      const task = tasks[0]
      if (task) {
        console.log(chalk.bold(`\n🎯 Tarea activa: ${chalk.cyan(task.id)} — ${task.title}`))
        if (task.url) console.log(chalk.dim(`   ${task.url}`))
        console.log()
      } else {
        console.log(chalk.yellow('No hay tarea activa. Usa: brain task GCD-1234'))
      }
      return
    }

    const text = textParts.join(' ').trim()

    if (text) {
      // Guardar captura vinculada a la tarea
      const spinner = ora('Guardando nota...').start()
      try {
        validateConfig()
        await saveCapture({ type: 'note', raw: text, source: 'cli', taskId: issueKey })
        spinner.succeed(chalk.green('Nota guardada') + chalk.dim(` [${issueKey}]`))
      } catch (e: any) {
        spinner.fail(chalk.red(e.message))
        process.exit(1)
      }
    } else {
      // Activar tarea (y --add si se especifica)
      const useDetail = opts.add
      const spinner = ora(`Buscando ${issueKey} en Jira...`).start()
      try {
        const issue = useDetail
          ? await getJiraIssueDetail(issueKey)
          : await getJiraIssue(issueKey)
        addActiveTask({ id: issue.id, title: issue.title, url: issue.url, setAt: new Date().toISOString(), provider: 'jira' })

        let savedToNotion = false
        if (opts.add || process.env.NOTION_TASKS_DB) {
          if (!process.env.NOTION_TASKS_DB) {
            spinner.warn(chalk.yellow(`Tarea activa: ${chalk.cyan(issue.id)} — ${issue.title}`))
            console.log(chalk.red('\n  NOTION_TASKS_DB no configurado. Crea la tabla primero:'))
            console.log(chalk.dim('  brain task --setup <notion-page-id>\n'))
            return
          }
          spinner.text = 'Guardando en tabla de Notion...'
          const detail = useDetail ? issue as any : await getJiraIssueDetail(issueKey)
          await upsertTrackedTask(detail)
          savedToNotion = true
        }

        spinner.succeed(chalk.green(`Tarea activa: ${chalk.cyan(issue.id)} — ${issue.title}`))
        if (issue.url) console.log(chalk.dim(`   ${issue.url}`))
        if (savedToNotion) console.log(chalk.dim('   ✓ Guardado en tabla de Notion'))
        console.log(chalk.dim('   Todas las capturas siguientes se etiquetarán con esta tarea'))
      } catch (e: any) {
        if (e.message?.includes('no encontró')) {
          spinner.fail(chalk.red(e.message))
          process.exit(1)
        }
        addActiveTask({ id: issueKey, title: issueKey, url: '', setAt: new Date().toISOString(), provider: 'jira' })
        spinner.warn(chalk.yellow(`Tarea activa: ${issueKey}`) + chalk.dim(' (Jira no configurado, usando solo el ID)'))
      }
    }
  })

// ── brain jira ──────────────────────────────────────────────────
program
  .command('jira')
  .description('Comandos de Jira')
  .option('--board', 'Muestra el tablero del sprint activo')
  .option('--todo', 'Tickets en TO DO — selecciona para asignarte y mover')
  .option('--all', 'Incluye tickets de todo el equipo (no solo los tuyos)')
  .action(async (opts: { board?: boolean; todo?: boolean; all?: boolean }) => {
    if (opts.todo) {
      const spinner = ora('Cargando tickets TO DO...').start()
      try {
        const issues = await searchJiraIssues('project = GCD AND sprint in openSprints() AND status = "TO DO" ORDER BY priority DESC')
        spinner.stop()

        if (issues.length === 0) {
          console.log(chalk.yellow('\nNo hay tickets en TO DO\n'))
          return
        }

        const PRIO: Record<string, string> = { Highest: '⬆ ', High: '↑ ', Medium: '→ ', Low: '↓ ', Lowest: '⬇ ' }

        const { selectedKey } = await inquirer.prompt([{
          type: 'list',
          name: 'selectedKey',
          message: 'Selecciona un ticket:',
          pageSize: 15,
          choices: issues.map(i => ({
            name: `${PRIO[i.priority] || '  '}${chalk.cyan(i.key)}  ${i.title}${i.assignee ? chalk.dim(` — ${i.assignee}`) : ''}`,
            value: i.key,
          })),
        }])

        const issue = issues.find(i => i.key === selectedKey)!
        const [transitions, detail] = await Promise.all([
          getJiraTransitions(selectedKey),
          getJiraIssueDetail(selectedKey),
        ])

        let action: string
        while (true) {
          const { chosen } = await inquirer.prompt([{
            type: 'list',
            name: 'chosen',
            message: `${chalk.cyan(selectedKey)} — ¿Qué quieres hacer?`,
            choices: [
              { name: 'Asignarme + mover a DOING + activar tarea', value: 'full' },
              { name: 'Solo asignarme', value: 'assign' },
              { name: 'Mover a columna...', value: 'move' },
              { name: 'Solo activar tarea', value: 'activate' },
              new inquirer.Separator(),
              { name: `Ver detalles del ticket`, value: 'detail' },
              { name: 'Cancelar', value: 'cancel' },
            ],
          }])

          if (chosen !== 'detail') { action = chosen; break }

          console.log()
          console.log(chalk.bold(`${chalk.cyan(detail.id)} — ${detail.title}`))
          console.log(chalk.dim(`${detail.type} · ${chalk.yellow(detail.status)} · Prioridad: ${detail.priority} · Asignado: ${detail.assignee}`))
          console.log(chalk.dim(detail.url))
          if (detail.description) {
            console.log(chalk.bold('\nDescripción:'))
            console.log(detail.description.split('\n').slice(0, 10).join('\n'))
          }
          if (detail.comments.length > 0) {
            console.log(chalk.bold(`\nÚltimos comentarios (${detail.comments.length}):`))
            detail.comments.slice(-3).forEach(c => {
              console.log(chalk.cyan(`  ${c.author}`) + chalk.dim(` · ${c.created}`))
              console.log(`  ${c.body.split('\n')[0]}`)
            })
          }
          console.log()
        }

        if (action === 'cancel') return

        const spinner2 = ora('Aplicando...').start()
        const user = await getJiraCurrentUser()

        if (action === 'full' || action === 'assign') {
          await assignJiraIssue(selectedKey, user.accountId)
        }

        if (action === 'full') {
          const doing = transitions.find(t => t.name.toLowerCase().includes('doing') || t.name.toLowerCase().includes('in progress') || t.name.toLowerCase().includes('en progreso'))
          if (doing) await transitionJiraIssue(selectedKey, doing.name)
          addActiveTask({ id: issue.key, title: issue.title, url: issue.url, setAt: new Date().toISOString(), provider: 'jira' })
        }

        if (action === 'move') {
          spinner2.stop()
          const { transitionName } = await inquirer.prompt([{
            type: 'list',
            name: 'transitionName',
            message: 'Mover a:',
            choices: transitions.map(t => ({ name: t.name, value: t.name })),
          }])
          spinner2.start('Aplicando...')
          await transitionJiraIssue(selectedKey, transitionName)
        }

        if (action === 'activate') {
          addActiveTask({ id: issue.key, title: issue.title, url: issue.url, setAt: new Date().toISOString(), provider: 'jira' })
        }

        spinner2.succeed(chalk.green(`${selectedKey} actualizado`))
        if (action === 'full' || action === 'activate') {
          console.log(chalk.dim(`   Tarea activa: ${issue.key} — ${issue.title}`))
        }
      } catch (e: any) {
        spinner.fail(chalk.red(e.message))
        process.exit(1)
      }
      return
    }

    if (!opts.board) {
      console.log(chalk.yellow('Usa brain jira --board o brain jira --todo'))
      return
    }

    const COLUMNS = ['TO DO', 'DOING', 'TESTING DEV', 'TESTING QA', 'TESTING PROD', 'DEPLOY TO PROD', 'HOLD']
    const PRIORITY_ICON: Record<string, string> = {
      Highest: '⬆', High: '↑', Medium: '→', Low: '↓', Lowest: '⬇',
    }
    const PRIORITY_COLOR: Record<string, chalk.Chalk> = {
      Highest: chalk.red, High: chalk.red, Medium: chalk.yellow, Low: chalk.dim, Lowest: chalk.dim,
    }

    const spinner = ora('Cargando tablero...').start()
    try {
      const assigneeFilter = opts.all ? '' : ' AND assignee = currentUser()'
      const jql = `project = GCD AND sprint in openSprints()${assigneeFilter} AND status != Done ORDER BY status ASC, priority DESC`
      const issues = await searchJiraIssues(jql)

      spinner.stop()

      const grouped: Record<string, typeof issues> = {}
      for (const col of COLUMNS) grouped[col] = []
      for (const issue of issues) {
        const col = COLUMNS.find(c => c === issue.status) || issue.status
        if (!grouped[col]) grouped[col] = []
        grouped[col].push(issue)
      }

      const activeTask = getActiveTask()
      const termWidth = process.stdout.columns || 100
      const colWidth = Math.max(28, Math.floor(termWidth / 3) - 2)
      const cols = COLUMNS.filter(c => (grouped[c]?.length || 0) > 0)

      console.log()
      console.log(chalk.bold.cyan('  GCD Sprint Board') + chalk.dim(opts.all ? '  (todo el equipo)' : '  (mis tickets)'))
      console.log(chalk.dim('  ' + '─'.repeat(termWidth - 4)))
      console.log()

      for (let i = 0; i < cols.length; i += 3) {
        const rowCols = cols.slice(i, i + 3)

        // Header row
        const headers = rowCols.map(col => {
          const count = grouped[col].length
          const header = chalk.bold(col) + chalk.dim(` (${count})`)
          return header.padEnd(colWidth + 10)
        })
        console.log('  ' + headers.join(chalk.dim(' │ ')))
        console.log('  ' + rowCols.map(() => chalk.dim('─'.repeat(colWidth))).join(chalk.dim('─┼─')))

        // Issue rows
        const maxRows = Math.max(...rowCols.map(c => grouped[c].length))
        for (let r = 0; r < maxRows; r++) {
          const cells = rowCols.map(col => {
            const issue = grouped[col][r]
            if (!issue) return ' '.repeat(colWidth)

            const isActive = issue.key === activeTask?.id
            const prioIcon = PRIORITY_ICON[issue.priority] || ' '
            const prioColor = PRIORITY_COLOR[issue.priority] || chalk.white
            const keyStr = isActive ? chalk.cyan.bold(issue.key) : chalk.cyan(issue.key)
            const titleMaxLen = colWidth - issue.key.length - 4
            const title = issue.title.length > titleMaxLen
              ? issue.title.slice(0, titleMaxLen - 1) + '…'
              : issue.title
            return `${prioColor(prioIcon)} ${keyStr} ${chalk.white(title)}`
          })
          console.log('  ' + cells.join(chalk.dim(' │ ')))

          // Labels row
          const labelCells = rowCols.map(col => {
            const issue = grouped[col][r]
            if (!issue || issue.labels.length === 0) return ' '.repeat(colWidth)
            const labelsStr = issue.labels.slice(0, 3).map(l => chalk.dim(`[${l}]`)).join(' ')
            return '   ' + labelsStr
          })
          const hasLabels = rowCols.some((col, ci) => grouped[col][r]?.labels?.length > 0)
          if (hasLabels) console.log('  ' + labelCells.join(chalk.dim(' │ ')))
        }

        console.log()
      }

      const total = issues.length
      console.log(chalk.dim(`  ${total} ticket${total !== 1 ? 's' : ''} en el sprint`))
      console.log()
    } catch (e: any) {
      spinner.fail(chalk.red(e.message))
      process.exit(1)
    }
  })

// ── brain deploy-check ──────────────────────────────────────────
program
  .command('deploy-check')
  .description('Verifica PRs mergeados y transiciona la tarea activa según reglas branch:Transición')
  .option('-r, --rule <branch:Transition>', 'Regla branch:Transición (repetible)', (v: string, acc: string[]) => [...acc, v], [] as string[])
  .action(async (opts: { rule: string[] }) => {
    const rawRules = opts.rule.length > 0
      ? opts.rule
      : (process.env.JIRA_DEPLOY_RULES || 'dev:Testing Dev,qa:Testing QA').split(',')

    const rules = rawRules.map(r => {
      const [branch, ...rest] = r.trim().split(':')
      return { branch: branch.trim(), transition: rest.join(':').trim() }
    }).filter(r => r.branch && r.transition)

    if (rules.length === 0) return

    const jql = `project = GCD AND sprint in openSprints() AND assignee = currentUser() AND status != "Done" ORDER BY updated DESC`

    const PIPELINE = ['TO DO', 'DOING', 'TESTING DEV', 'TESTING QA', 'TESTING PROD', 'DEPLOY TO PROD', 'Done']
    const pipelineIdx = (status: string) =>
      PIPELINE.findIndex(s => s.toLowerCase() === status.toLowerCase())

    try {
      const issues = await searchJiraIssues(jql)
      const pinned = new Set(getPinnedTasks())
      const ts = new Date().toISOString()

      for (const issue of issues) {
        if (pinned.has(issue.key)) continue

        try {
          const { backward, movedAt } = await wasMovedBackward(issue.key, PIPELINE)
          const notifiedPath = path.join(os.homedir(), '.brain-log', '.notified')
          const notified: Record<string, string> = fs.existsSync(notifiedPath)
            ? JSON.parse(fs.readFileSync(notifiedPath, 'utf-8'))
            : {}
          const backKey = `${issue.key}_back`

          const currentIdx = pipelineIdx(issue.status)
          const prs = await getJiraPullRequests(issue.numericId)

          if (backward && movedAt) {
            // Si hay un PR mergeado DESPUÉS de que lo regresaron → fix publicado, proceder
            const fixAfterRegression = prs.some(
              p => p.status === 'MERGED' && p.lastUpdated && p.lastUpdated > movedAt,
            )

            if (!fixAfterRegression) {
              if (!notified[backKey]) {
                notify('brain-log ⚠️', `${issue.key} fue regresado a ${issue.status}`, issue.title.slice(0, 50))
                console.log(`[${ts}] ${issue.key} regresado a ${issue.status} — esperando fix`)
                notified[backKey] = ts
                fs.writeFileSync(notifiedPath, JSON.stringify(notified, null, 2))
              }
              continue
            }

            // Fix encontrado — limpiar flag y continuar normalmente
            console.log(`[${ts}] ${issue.key} fix detectado post-regresión (${movedAt}) — procesando`)
            if (notified[backKey]) {
              delete notified[backKey]
              fs.writeFileSync(notifiedPath, JSON.stringify(notified, null, 2))
            }
          } else if (notified[backKey]) {
            // Ya no está regresado — limpiar flag
            delete notified[backKey]
            fs.writeFileSync(notifiedPath, JSON.stringify(notified, null, 2))
          }

          const applicable = rules
            .map(rule => ({ rule, targetIdx: pipelineIdx(rule.transition) }))
            .filter(({ targetIdx }) => targetIdx > currentIdx)
            .filter(({ rule, targetIdx: tIdx }) =>
              prs.some(p =>
                p.status === 'MERGED' &&
                p.targetBranch === rule.branch &&
                // Si fue regresado, solo contar PRs mergeados después de la regresión
                (!backward || !movedAt || p.lastUpdated > movedAt),
              ),
            )

          if (applicable.length === 0) continue

          applicable.sort((a, b) => b.targetIdx - a.targetIdx)
          const { rule } = applicable[0]
          const applied = await transitionJiraIssue(issue.key, rule.transition)
          console.log(`[${ts}] ${issue.key} → ${applied} (PR mergeado a ${rule.branch})`)
          notify('brain-log', `${issue.key} → ${applied}`, issue.title.slice(0, 50))
        } catch (e: any) {
          console.error(`[${ts}] ${issue.key} error: ${e.message}`)
          notify('brain-log ❌', `Error en ${issue.key}`, e.message.slice(0, 80))
        }
      }
    } catch (e: any) {
      console.error(`[${new Date().toISOString()}] deploy-check error: ${e.message}`)
      process.exit(1)
    }
  })

// ── brain today ─────────────────────────────────────────────────
program
  .command('today')
  .description('Ve tus capturas de hoy')
  .action(async () => {
    try {
      validateConfig()

      const activeTask = getActiveTask()
      if (activeTask) {
        console.log(chalk.bold(`\n🎯 Tarea activa: ${chalk.cyan(activeTask.id)} — ${activeTask.title}`))
      }

      const captures = await getCapturesForToday()

      if (captures.length === 0) {
        console.log(chalk.yellow('\nNo hay capturas hoy todavía.'))
        return
      }

      console.log(chalk.bold(`\n📋 Capturas de hoy (${captures.length}):\n`))
      captures.forEach((c) => {
        const icon = { note: '📝', todo: '☑️', vibe: '⚡', learn: '🧠' }[c.type] || '•'
        const color = { note: chalk.white, todo: chalk.cyan, vibe: chalk.magenta, learn: chalk.green }[c.type] || chalk.white
        const taskTag = c.taskId ? chalk.dim(` [${c.taskId}]`) : ''
        console.log(`${icon} ${color(`[${c.type}]`)}${taskTag} ${c.raw}`)
      })
      console.log()
    } catch (e: any) {
      console.error(chalk.red(e.message))
      process.exit(1)
    }
  })

// ── brain recap ─────────────────────────────────────────────────
program
  .command('recap')
  .description('Genera el recap del día con Claude y lo guarda en Notion')
  .action(async () => {
    try {
      validateConfig()
      validateAnthropicConfig()

      const spinner = ora('Leyendo tus capturas de hoy...').start()
      const captures = await getCapturesForToday()

      if (captures.length === 0) {
        spinner.warn(chalk.yellow('No hay capturas hoy. Agrega algunas primero.'))
        return
      }

      spinner.text = `Procesando ${captures.length} capturas con Claude...`
      const recap = await generateRecap(captures)

      spinner.text = 'Guardando recap en Notion...'
      const today = new Date().toISOString().split('T')[0]
      await saveRecap({ date: today, ...recap })

      spinner.succeed(chalk.green('Recap del día guardado en Notion'))
      console.log(chalk.bold('\n🌙 Tu día:\n'))
      console.log(chalk.cyan('Lo que hiciste:'), recap.whatIDid)
      console.log(chalk.green('Lo que aprendiste:'), recap.whatILearned)
      console.log(chalk.yellow('Mañana:'), recap.tomorrow)
      console.log()
    } catch (e: any) {
      console.error(chalk.red(e.message))
      process.exit(1)
    }
  })

// ── brain mr-watch <url> ────────────────────────────────────────
program
  .command('mr-watch <url>')
  .description('Monitorea un MR de GitLab por URL — notifica cuando el pipeline pasa y cuando se mergea')
  .action(async (url: string) => {
    const gitlabUrl = process.env.GITLAB_URL || ''
    const gitlabToken = process.env.GITLAB_TOKEN || ''

    if (!gitlabUrl || !gitlabToken) {
      console.error('[mr-watch] Faltan GITLAB_URL o GITLAB_TOKEN en ~/.brain-log/.env')
      process.exit(1)
    }

    const mrIidMatch = url.match(/\/merge_requests\/(\d+)/)
    const projectMatch = url.match(/gitlab[^/]+\/(.+?)\/-\/merge_requests/)
    if (!mrIidMatch || !projectMatch) {
      console.error('[mr-watch] URL inválida. Esperado: https://gitlab.com/grupo/proyecto/-/merge_requests/123')
      process.exit(1)
    }

    const mrIid = mrIidMatch[1]
    const projectPath = encodeURIComponent(projectMatch[1])

    // Registrar URL para polling automático cada 5 min
    addWatchedMR(url)
    console.log(`Monitoreando MR!${mrIid} (${projectMatch[1]}) — recibirás notificaciones automáticas`)

    // Verificar estado actual inmediatamente
    const statesPath = path.join(os.homedir(), '.brain-log', '.mr-states.json')
    const stateKey = `watched_MR_${projectMatch[1].replace(/\//g, '_')}_${mrIid}`
    const states: Record<string, { pipeline: string; mrState: string }> = fs.existsSync(statesPath)
      ? JSON.parse(fs.readFileSync(statesPath, 'utf-8'))
      : {}
    const ts = new Date().toISOString()

    try {
      const mrRes = await fetch(
        `${gitlabUrl}/api/v4/projects/${projectPath}/merge_requests/${mrIid}`,
        { headers: { 'PRIVATE-TOKEN': gitlabToken } },
      )
      if (!mrRes.ok) {
        console.error(`[mr-watch] GitLab error ${mrRes.status}: ${await mrRes.text()}`)
        process.exit(1)
      }
      const mr = await mrRes.json() as any
      const mrState: string = mr.state || ''
      const pipelineStatus: string = mr.head_pipeline?.status || ''
      const label = mr.references?.full || `MR!${mrIid}`

      console.log(`[${ts}] ${label} pipeline=${pipelineStatus || 'ninguno'} state=${mrState}`)
      states[stateKey] = { pipeline: pipelineStatus, mrState }
      fs.writeFileSync(statesPath, JSON.stringify(states, null, 2))
    } catch (e: any) {
      console.error(`[${ts}] mr-watch error: ${e.message}`)
      process.exit(1)
    }
  })

// ── brain mr-check ─────────────────────────────────────────────
program
  .command('mr-check')
  .description('Monitorea pipelines y merges de GitLab para las tareas activas del sprint')
  .option('--debug', 'Muestra PRs encontradas sin filtrar')
  .action(async (opts: { debug?: boolean }) => {
    const gitlabUrl = process.env.GITLAB_URL || ''
    const gitlabToken = process.env.GITLAB_TOKEN || ''

    if (!gitlabUrl || !gitlabToken) {
      console.error('[mr-check] Faltan GITLAB_URL o GITLAB_TOKEN en ~/.brain-log/.env')
      process.exit(1)
    }

    const statesPath = path.join(os.homedir(), '.brain-log', '.mr-states.json')
    const states: Record<string, { pipeline: string; mrState: string }> = fs.existsSync(statesPath)
      ? JSON.parse(fs.readFileSync(statesPath, 'utf-8'))
      : {}

    const jql = `project = GCD AND sprint in openSprints() AND assignee = currentUser() AND status != "Done" ORDER BY updated DESC`
    const ts = new Date().toISOString()

    let changed = false

    try {
      const issues = await searchJiraIssues(jql)

      for (const issue of issues) {
        let prs: { url: string; status: string }[] = []
        try {
          prs = await getJiraPullRequests(issue.numericId)
        } catch { continue }

        if (opts.debug) {
          console.log(`\n[${issue.key}] ${prs.length} PR(s):`)
          prs.forEach(p => console.log(`  status=${p.status} url=${p.url}`))
        }

        const openPRs = prs.filter(p => p.status !== 'MERGED' && p.status !== 'DECLINED' && p.url)

        for (const pr of openPRs) {
          // Extraer project path y MR IID de la URL de GitLab
          // URL format: https://gitlab.example.com/group/project/-/merge_requests/123
          const match = pr.url.match(/\/merge_requests\/(\d+)$/)
          const projectMatch = pr.url.match(/gitlab[^/]+\/(.+?)\/-\/merge_requests/)
          if (!match || !projectMatch) continue

          const mrIid = match[1]
          const projectPath = encodeURIComponent(projectMatch[1])
          const stateKey = `${issue.key}_MR_${mrIid}`
          const prev = states[stateKey] || { pipeline: '', mrState: '' }

          try {
            const mrRes = await fetch(
              `${gitlabUrl}/api/v4/projects/${projectPath}/merge_requests/${mrIid}`,
              { headers: { 'PRIVATE-TOKEN': gitlabToken } },
            )
            if (!mrRes.ok) continue
            const mr = await mrRes.json() as any

            const mrState: string = mr.state || ''
            const pipelineStatus: string = mr.head_pipeline?.status || ''

            // Notificar cuando pipeline pasa de running/pending → success
            if (
              pipelineStatus === 'success' &&
              prev.pipeline !== 'success' &&
              mrState === 'opened'
            ) {
              notify('brain-log ✅', `Pipeline de ${issue.key} pasó`, mr.title?.slice(0, 60))
              console.log(`[${ts}] ${issue.key} MR#${mrIid} pipeline → success`)
            }

            // Notificar cuando pipeline falla
            if (
              pipelineStatus === 'failed' &&
              prev.pipeline !== 'failed'
            ) {
              notify('brain-log ❌', `Pipeline de ${issue.key} falló`, mr.title?.slice(0, 60))
              console.log(`[${ts}] ${issue.key} MR#${mrIid} pipeline → failed`)
            }

            // Notificar cuando el MR es mergeado
            if (mrState === 'merged' && prev.mrState !== 'merged') {
              notify('brain-log 🎉', `${issue.key} mergeado a ${mr.target_branch}`, mr.title?.slice(0, 60))
              console.log(`[${ts}] ${issue.key} MR#${mrIid} → merged`)
            }

            states[stateKey] = { pipeline: pipelineStatus, mrState }
            changed = true
          } catch (e: any) {
            console.error(`[${ts}] ${issue.key} MR#${mrIid} error: ${e.message}`)
          }
        }

        // Limpiar MRs mergeados del estado después de notificar
        const mergedKeys = Object.keys(states).filter(
          k => k.startsWith(`${issue.key}_MR_`) && states[k].mrState === 'merged',
        )
        for (const k of mergedKeys) {
          delete states[k]
          changed = true
        }
      }
    } catch (e: any) {
      console.error(`[${ts}] mr-check error: ${e.message}`)
    }

    // ── Watched MRs registrados manualmente con mr-watch ──────────
    const watchedUrls = getWatchedMRs()
    for (const url of watchedUrls) {
      const mrIidMatch = url.match(/\/merge_requests\/(\d+)/)
      const projectMatch = url.match(/gitlab[^/]+\/(.+?)\/-\/merge_requests/)
      if (!mrIidMatch || !projectMatch) continue

      const mrIid = mrIidMatch[1]
      const projectPath = encodeURIComponent(projectMatch[1])
      const stateKey = `watched_MR_${projectMatch[1].replace(/\//g, '_')}_${mrIid}`
      const prev = states[stateKey] || { pipeline: '', mrState: '' }

      try {
        const mrRes = await fetch(
          `${gitlabUrl}/api/v4/projects/${projectPath}/merge_requests/${mrIid}`,
          { headers: { 'PRIVATE-TOKEN': gitlabToken } },
        )
        if (!mrRes.ok) continue
        const mr = await mrRes.json() as any

        const mrState: string = mr.state || ''
        const pipelineStatus: string = mr.head_pipeline?.status || ''
        const label = mr.references?.full || `MR!${mrIid}`

        if (pipelineStatus === 'success' && prev.pipeline !== 'success' && mrState === 'opened') {
          notify('brain-log ✅', `Pipeline pasó — listo para mergear`, mr.title?.slice(0, 60))
          console.log(`[${ts}] ${label} pipeline → success`)
        }
        if (pipelineStatus === 'failed' && prev.pipeline !== 'failed') {
          notify('brain-log ❌', `Pipeline falló`, mr.title?.slice(0, 60))
          console.log(`[${ts}] ${label} pipeline → failed`)
        }
        if (mrState === 'merged' && prev.mrState !== 'merged') {
          notify('brain-log 🎉', `MR mergeado a ${mr.target_branch}`, mr.title?.slice(0, 60))
          console.log(`[${ts}] ${label} → merged`)
          removeWatchedMR(url)
          delete states[stateKey]
        } else {
          states[stateKey] = { pipeline: pipelineStatus, mrState }
        }
        changed = true
      } catch (e: any) {
        console.error(`[${ts}] watched MR#${mrIid} error: ${e.message}`)
      }
    }

    if (changed) {
      fs.writeFileSync(statesPath, JSON.stringify(states, null, 2))
    }
  })

// ── brain pm ────────────────────────────────────────────────────
// Alias del provider PM activo — equivalente a `brain jira` pero provider-agnóstico
program
  .command('pm')
  .description('Comandos del PM provider activo (jira por defecto)')
  .option('--board', 'Tablero del sprint activo')
  .option('--board-all', 'Tablero completo (todo el equipo)')
  .option('--todo', 'Seleccionar ticket de TO DO para trabajar')
  .option('--provider <name>', 'Fuerza un provider específico (jira, asana, linear)')
  .action(async (opts: { board?: boolean; boardAll?: boolean; todo?: boolean; provider?: string }) => {
    try {
      const pm = getPMProvider(opts.provider)
      const COLUMNS = ['TO DO', 'DOING', 'TESTING DEV', 'TESTING QA', 'TESTING PROD', 'DEPLOY TO PROD', 'HOLD']

      if (opts.board || opts.boardAll) {
        const spinner = ora(`Cargando board desde ${pm.name}...`).start()
        try {
          const board = await pm.getBoard(COLUMNS)
          spinner.stop()
          console.log(chalk.bold(`\nSprint — ${pm.name.toUpperCase()} (${board.total} tickets)\n`))
          for (const col of board.columns) {
            const count = board.counts[col] || 0
            if (!count) continue
            console.log(chalk.bold(`  ${col}`) + chalk.dim(` (${count})`))
            for (const t of board.grouped[col] || []) {
              const prio = { Highest: '⬆', High: '↑', Medium: '→', Low: '↓', Lowest: '⬇' }[t.priority] || ' '
              console.log(`    ${prio} ${chalk.cyan(t.key)} ${t.title.slice(0, 60)}`)
            }
          }
          console.log()
        } catch (e: any) { spinner.fail(chalk.red(e.message)); process.exit(1) }
        return
      }

      if (opts.todo) {
        // Redirigir al comando jira --todo existente (reutiliza la lógica)
        process.argv = ['node', 'brain', 'jira', '--todo', ...(opts.provider ? ['--provider', opts.provider] : [])]
        program.parse()
        return
      }

      console.log(chalk.dim(`Provider activo: ${pm.name} (PM_DEFAULT=${process.env.PM_DEFAULT || 'jira'})`))
      console.log(chalk.dim('  --board    → tablero del sprint'))
      console.log(chalk.dim('  --todo     → picker interactivo'))
    } catch (e: any) {
      console.error(chalk.red(e.message))
      process.exit(1)
    }
  })

// ── brain sync ──────────────────────────────────────────────────
program
  .command('sync')
  .description('Sincroniza captures del vault markdown a Notion / git')
  .option('--git', 'Fuerza git add + commit + push del vault')
  .option('--notion', 'Fuerza sync a Notion')
  .option('--date <date>', 'Fecha específica YYYY-MM-DD (default: hoy)')
  .option('--status', 'Muestra qué días tienen .md en el vault')
  .action(async (opts: { git?: boolean; notion?: boolean; date?: string; status?: boolean }) => {
    if (opts.status) {
      const vaultPath = process.env.MARKDOWN_VAULT_PATH
      if (!vaultPath) { console.error(chalk.red('MARKDOWN_VAULT_PATH no configurado')); process.exit(1) }
      const journalsDir = path.join(vaultPath, 'journals')
      try {
        const files = (await fs.promises.readdir(journalsDir)).filter(f => f.endsWith('.md')).sort().reverse()
        console.log(chalk.bold(`\n${files.length} journal(s) en el vault:\n`))
        files.slice(0, 20).forEach(f => console.log(chalk.dim(`  ${f}`)))
        if (files.length > 20) console.log(chalk.dim(`  ... y ${files.length - 20} más`))
        console.log()
      } catch { console.log(chalk.yellow('No hay journals en el vault aún.')) }
      return
    }

    if (opts.git) {
      const vaultPath = process.env.MARKDOWN_VAULT_PATH
      if (!vaultPath) { console.error(chalk.red('MARKDOWN_VAULT_PATH no configurado')); process.exit(1) }
      const spinner = ora('Sincronizando vault con git...').start()
      try {
        const { gitSync } = await import('@brain-log/shared') as any
        await gitSync(vaultPath)
        spinner.succeed(chalk.green('Vault sincronizado con git'))
      } catch (e: any) {
        if (e.message?.includes('nothing to commit')) {
          spinner.succeed(chalk.dim('Sin cambios para commitear'))
        } else {
          spinner.fail(chalk.red(e.message))
          process.exit(1)
        }
      }
      return
    }

    const date = opts.date || new Date().toISOString().split('T')[0]
    const spinner = ora(`Sincronizando captures de ${date} a Notion...`).start()
    try {
      const captures = await getCapturesForDate(date)
      if (captures.length === 0) { spinner.warn(chalk.yellow(`No hay captures para ${date}`)); return }

      const { saveNotionCapture } = await import('@brain-log/shared') as any
      let synced = 0
      for (const c of captures) {
        await saveNotionCapture({ type: c.type, raw: c.raw, source: c.source, processed: c.processed, date: c.date, task: c.taskId })
        synced++
      }
      spinner.succeed(chalk.green(`${synced} capture(s) sincronizado(s) a Notion`))
    } catch (e: any) {
      spinner.fail(chalk.red(e.message))
      process.exit(1)
    }
  })

program.parse()
