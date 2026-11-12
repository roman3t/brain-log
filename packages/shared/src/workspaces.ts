import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { randomUUID } from 'crypto'
import {
  type WorkSession, readWorkSessions, writeWorkSessions, withWorkLock,
  workStoreDir, normalizeWorkTask, isWithin,
} from './work-store'
import {
  herdrConnection, herdrCommand, openHerdrWorkspace, focusHerdrWorkspace,
  assertHerdrWorkspaceCanClose, startWorkAgent, openRefinementWorkspace, startRefinementAgent,
} from './herdr'
import { assertKnownAgentKind } from './agents'

function git(cwd: string, args: string[]): string {
  const env = { ...process.env }
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE']) delete env[key]
  return execFileSync('git', ['-C', cwd, ...args], {
    env, encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

export function getWorkRepository(cwd: string): { repoPath: string; commonDir: string } {
  if (git(cwd, ['rev-parse', '--is-bare-repository']) === 'true') throw new Error('Usa un repositorio con checkout, no un repositorio bare.')
  const commonDir = fs.realpathSync(git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']))
  const repoPath = fs.realpathSync(listGitWorktrees(cwd)[0].path)
  return { repoPath, commonDir }
}

export function listGitWorktrees(repo: string): { path: string; branch?: string; locked: boolean }[] {
  return git(repo, ['worktree', 'list', '--porcelain', '-z']).split('\0\0').filter(Boolean).map(block => {
    const fields = block.split('\0')
    return {
      path: fields.find(f => f.startsWith('worktree '))!.slice(9),
      branch: fields.find(f => f.startsWith('branch '))?.slice(7),
      locked: fields.some(f => f === 'locked' || f.startsWith('locked ')),
    }
  })
}

// Sugerencia de lectura, nunca una asignación: muchas ramas reales no tienen ticket (p. ej. "estandar/shippings_cross").
function suggestTaskId(branch?: string): string | undefined {
  const match = branch?.match(/[A-Za-z][A-Za-z0-9_]*-\d+/)
  return match ? match[0].toUpperCase() : undefined
}

export interface DiscoveredWorktree {
  path: string
  branch?: string
  locked: boolean
  registered?: WorkSession
  suggestedTaskId?: string
}

// Solo lectura: no crea, registra ni modifica nada. Cruza `git worktree list` con el registro de Brain.
export function discoverWorktrees(repoPath: string): DiscoveredWorktree[] {
  const { commonDir } = getWorkRepository(repoPath)
  const sessions = readWorkSessions()
  return listGitWorktrees(repoPath).map(entry => {
    let resolvedPath = entry.path
    try { resolvedPath = fs.realpathSync(entry.path) } catch { /* carpeta ya no existe en disco */ }
    const branch = entry.branch?.replace(/^refs\/heads\//, '')
    const registered = sessions.find(s => !s.closedAt && s.commonDir === commonDir && s.worktreePath === resolvedPath)
    return {
      path: resolvedPath, branch, locked: entry.locked, registered,
      suggestedTaskId: registered ? undefined : suggestTaskId(branch),
    }
  })
}

// Convención `<repo>-<descriptor>`, hermano del repo — misma forma que los worktrees manuales.
// Pura: no crea directorios ni toca Git; el llamador decide si va a crear o reutilizar.
export function resolveWorktreeLocation(repoPath: string, taskId: string, descriptor?: string): string {
  const suffix = (descriptor || taskId).toLowerCase()
  const requestedParent = process.env.BRAIN_WORKTREES_DIR
    ? path.resolve(process.env.BRAIN_WORKTREES_DIR) : path.dirname(repoPath)
  let parent = requestedParent
  try { parent = fs.realpathSync(requestedParent) } catch { /* se crea más adelante si hace falta */ }
  return path.join(parent, `${path.basename(repoPath)}-${suffix}`)
}

function assertWorktreeNotAlreadyRegistered(sessions: WorkSession[], worktreePath: string): void {
  const duplicate = sessions.find(s => !s.closedAt && s.worktreePath === worktreePath)
  if (duplicate) throw new Error(`Esta carpeta ya está registrada como ${duplicate.taskId}. No se registra dos veces.`)
}

function assertValidDescriptor(descriptor?: string): void {
  if (descriptor && (descriptor.includes('/') || descriptor.includes('\\') || descriptor.includes('..'))) {
    throw new Error('Descriptor inválido: no puede contener "/", "\\" ni "..".')
  }
}

function resolveBase(repo: string, requested?: string): string {
  const candidates = requested ? [requested] : ['refs/remotes/origin/HEAD', 'refs/heads/main', 'refs/heads/master']
  for (const ref of candidates) {
    if (ref.startsWith('-') || /[\r\n\0]/.test(ref)) throw new Error('La rama destino no es válida.')
    try {
      const full = git(repo, ['rev-parse', '--symbolic-full-name', '--verify', '--end-of-options', ref])
      if (!/^refs\/(heads|remotes)\//.test(full)) continue
      git(repo, ['rev-parse', '--verify', '--end-of-options', `${full}^{commit}`])
      return full
    } catch {}
  }
  throw new Error('No se pudo resolver la rama destino. Indícala con --base origin/dev (o --base main).')
}

function assertRegisteredWorktree(work: WorkSession): void {
  const repository = getWorkRepository(work.repoPath)
  if (repository.commonDir !== work.commonDir) throw new Error('El repositorio ya no corresponde al registro; no se modifica el worktree.')
  const entry = listGitWorktrees(work.repoPath).find(w => w.path === work.worktreePath)
  if (!entry || entry.path === work.repoPath || fs.realpathSync(entry.path) !== work.worktreePath ||
      getWorkRepository(entry.path).commonDir !== work.commonDir || entry.branch !== `refs/heads/${work.branch}`) {
    throw new Error('El worktree falta o su ruta/rama cambió. Se conserva el registro para revisar manualmente.')
  }
  if (entry.locked) throw new Error('El worktree está bloqueado en Git; no se modifica.')
}

export interface OpenWorkOptions {
  repo?: string
  repoAlias?: string
  base?: string
  branch?: string
  descriptor?: string
  context: string
  title?: string
  url?: string
  contextText?: string
  herdr?: boolean
  session?: string
  agent?: string
}

// Construye la sesión y escribe su snapshot (BRAIN_WORK_CONTEXT). No toca Git ni Herdr.
function buildWorkSession(
  repository: { repoPath: string; commonDir: string }, taskId: string, worktreePath: string,
  branch: string, base: string, options: OpenWorkOptions, extraLines: string[] = [],
): WorkSession {
  const id = randomUUID()
  const work: WorkSession = {
    ...repository, id, taskId, title: options.title || taskId, url: options.url || '',
    worktreePath, branch, base, context: options.context, repoAlias: options.repoAlias,
    contextFile: path.join(workStoreDir(), 'work', `${id}.md`), createdAt: new Date().toISOString(),
  }
  fs.mkdirSync(path.dirname(work.contextFile), { recursive: true })
  fs.writeFileSync(work.contextFile, [
    `# ${taskId} — ${work.title}`, '', `Repositorio: ${work.repoPath}`, `Worktree: ${work.worktreePath}`,
    `Rama: ${branch}`, `Destino: ${base}`, `Contexto del vault: ${work.context || '(raíz)'}`,
    work.url, '', options.contextText || '', '',
    ...extraLines,
    'Las capturas ejecutadas desde este worktree se vinculan a esta tarea.',
    'Registra decisiones y pendientes con brain note/todo/learn. No cambies la tarea global para trabajar aquí.',
    'Si tu agente tiene Headroom disponible, puede usarlo para comprimir contexto grande; no es necesario ni la fuente de verdad.',
  ].join('\n'), { mode: 0o600 })
  return work
}

// Abre/retoma el workspace de Herdr y, si corresponde, el agente. Comparte el mismo manejo de
// errores entre crear, retomar e importar: un fallo nunca pierde el worktree ya registrado.
function attachHerdr(work: WorkSession, options: Pick<OpenWorkOptions, 'herdr' | 'session' | 'agent'>, sessions: WorkSession[], taskId: string): void {
  if (options.herdr === false) return
  try {
    if (!focusHerdrWorkspace(work)) {
      work.herdr = openHerdrWorkspace(work, work.herdr || herdrConnection(options.session))
      writeWorkSessions(sessions)
    }
    if (options.agent) startWorkAgent(work, options.agent)
  } catch (error: any) {
    throw new Error(`${error.message}\nEl worktree se conserva en ${work.worktreePath}. Retoma con brain work ${taskId} --repo ${JSON.stringify(work.repoPath)}.`)
  }
}

export function openWork(task: string, options: OpenWorkOptions): WorkSession {
  const taskId = normalizeWorkTask(task)
  if (options.agent) assertKnownAgentKind(options.agent)
  if (options.agent && options.herdr === false) throw new Error('--agent requiere Herdr.')
  return withWorkLock(() => {
    const repository = getWorkRepository(path.resolve(options.repo || process.cwd()))
    const sessions = readWorkSessions()
    let work = sessions.find(s => !s.closedAt && s.commonDir === repository.commonDir && s.taskId === taskId)
    if (work) {
      assertRegisteredWorktree(work)
      if ((options.branch && options.branch !== work.branch) ||
          (options.base && resolveBase(work.repoPath, options.base) !== work.base)) {
        throw new Error('La tarea ya tiene un worktree con otra rama/destino. Retómalo sin cambiar --branch ni --base.')
      }
      if (options.session && work.herdr && options.session !== work.herdr.session) {
        throw new Error(`El espacio ya está asociado a la sesión Herdr ${work.herdr.session}.`)
      }
    } else {
      assertValidDescriptor(options.descriptor)
      const base = resolveBase(repository.repoPath, options.base)
      const branch = options.branch || `brain/${taskId.toLowerCase()}`
      if (branch.startsWith('-') || /[\r\n\0]/.test(branch)) throw new Error('Nombre de rama inválido.')
      git(repository.repoPath, ['check-ref-format', '--branch', branch])

      const worktreePath = resolveWorktreeLocation(repository.repoPath, taskId, options.descriptor)
      if (isWithin(repository.repoPath, worktreePath)) {
        throw new Error('La ubicación del worktree no puede estar dentro del repositorio principal.')
      }

      let resolvedPath: string | undefined
      try { resolvedPath = fs.realpathSync(worktreePath) } catch { /* no existe todavía */ }
      const existingEntry = resolvedPath
        ? listGitWorktrees(repository.repoPath).find(w => {
          try { return fs.realpathSync(w.path) === resolvedPath } catch { return false }
        })
        : undefined

      if (existingEntry) {
        // La carpeta convencional ya es un worktree de Git real: se reutiliza, nunca se crea de nuevo.
        if (existingEntry.path === repository.repoPath) {
          throw new Error('La ubicación calculada coincide con el checkout principal; no se reutiliza como worktree de tarea.')
        }
        if (existingEntry.locked) throw new Error('El worktree está bloqueado en Git; no se reutiliza.')
        if (!existingEntry.branch) throw new Error('El worktree existente está en detached HEAD; revisa una rama antes de reutilizarlo.')
        const existingBranchName = existingEntry.branch.replace(/^refs\/heads\//, '')
        if (options.branch && options.branch !== existingBranchName) {
          throw new Error(`Ya existe un worktree en ${worktreePath} con otra rama (${existingBranchName}). Usa --branch ${existingBranchName} o --descriptor para otra ubicación.`)
        }
        assertWorktreeNotAlreadyRegistered(sessions, resolvedPath!)
        work = buildWorkSession(repository, taskId, resolvedPath!, existingBranchName, base, options, [
          'Worktree detectado en la ubicación convencional y reutilizado; brain-log no ejecutó git worktree add.', '',
        ])
      } else {
        if (fs.existsSync(worktreePath)) {
          throw new Error(`La carpeta ${worktreePath} ya existe y no es un worktree de este repositorio. No se modifica.`)
        }
        work = buildWorkSession(repository, taskId, worktreePath, branch, base, options)
        fs.mkdirSync(path.dirname(worktreePath), { recursive: true })
        const existingBranch = git(repository.repoPath, ['for-each-ref', '--format=%(refname)', `refs/heads/${branch}`])
          .split('\n').includes(`refs/heads/${branch}`)
        git(repository.repoPath, existingBranch
          ? ['worktree', 'add', '--', worktreePath, branch]
          : ['worktree', 'add', '-b', branch, '--', worktreePath, base])
        work.worktreePath = fs.realpathSync(worktreePath)
      }
      sessions.push(work)
      // Save before calling Herdr: a failure must leave a resumable checkout.
      writeWorkSessions(sessions)
    }

    attachHerdr(work, options, sessions, taskId)
    return work
  })
}

export interface ImportWorkOptions extends OpenWorkOptions {
  worktree: string
}

// Registra un worktree Git ya existente sin ejecutar `git worktree add`/`checkout` ni crear ramas.
export function importWork(task: string, options: ImportWorkOptions): WorkSession {
  const taskId = normalizeWorkTask(task)
  if (options.agent) assertKnownAgentKind(options.agent)
  if (options.agent && options.herdr === false) throw new Error('--agent requiere Herdr.')
  return withWorkLock(() => {
    const repository = getWorkRepository(path.resolve(options.repo || process.cwd()))
    const sessions = readWorkSessions()
    const existingForTask = sessions.find(s => !s.closedAt && s.commonDir === repository.commonDir && s.taskId === taskId)
    if (existingForTask) {
      throw new Error(`${taskId} ya tiene un worktree abierto en ${existingForTask.worktreePath}. Usa "brain work ${taskId}" para retomarlo, no import.`)
    }

    let worktreePath: string
    try { worktreePath = fs.realpathSync(path.resolve(options.worktree)) } catch {
      throw new Error(`${options.worktree} no existe.`)
    }
    const entry = listGitWorktrees(repository.repoPath).find(w => {
      try { return fs.realpathSync(w.path) === worktreePath } catch { return false }
    })
    if (!entry) throw new Error(`${options.worktree} no es un worktree de este repositorio (ver "brain work discover").`)
    if (entry.path === repository.repoPath) throw new Error('No se puede importar el checkout principal del repo como worktree de una tarea.')
    if (entry.locked) throw new Error('El worktree está bloqueado en Git; no se importa.')
    if (!entry.branch) throw new Error('El worktree está en detached HEAD; crea o revisa una rama antes de importarlo.')
    const branch = entry.branch.replace(/^refs\/heads\//, '')

    assertWorktreeNotAlreadyRegistered(sessions, worktreePath)

    const base = resolveBase(repository.repoPath, options.base)
    const work = buildWorkSession(repository, taskId, worktreePath, branch, base, options, [
      'Worktree importado desde una carpeta ya existente; brain-log no ejecutó git worktree add ni checkout.', '',
    ])
    sessions.push(work)
    writeWorkSessions(sessions)

    attachHerdr(work, options, sessions, taskId)
    return work
  })
}

function writeRefinementContext(taskId: string, title: string, contextText: string): string {
  const file = path.join(workStoreDir(), 'refine', `${randomUUID()}.md`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, [
    `# ${taskId} — ${title}`, '',
    'Contexto de refinamiento: todavía no hay worktree ni repositorio asignado a esta tarea.',
    'Si tenés la skill /task-refinement (Claude Code), ejecutala con este archivo como contexto.',
    'Si no, seguí este checklist:', '',
    '1. Entendé la entrada (ticket + notas de abajo).',
    '2. Investigá antecedentes en los repos candidatos.',
    '3. Aclará con el usuario los requisitos que falten.',
    '4. Puntuá el trabajo y recomendá una estrategia.',
    '5. Entregá un plan por repositorio con criterios de aceptación verificables.',
    '', `Una vez aprobado el plan, correr "brain work ${taskId} --repo <alias>" por cada repo afectado.`,
    '', contextText || '',
  ].join('\n'), { mode: 0o600 })
  return file
}

export interface RefinementSpaceOptions {
  agent?: string
  session?: string
  herdr?: boolean
  cwd?: string
}

export interface RefinementSpace {
  contextFile: string
  herdr?: { session: string; workspaceId: string; paneId: string }
}

// Previo a elegir repo: no crea worktree, no registra nada en workspaces.json.
export function openRefinementSpace(taskId: string, title: string, contextText: string, options: RefinementSpaceOptions = {}): RefinementSpace {
  if (options.agent) assertKnownAgentKind(options.agent)
  const contextFile = writeRefinementContext(taskId, title, contextText)
  if (options.herdr === false) return { contextFile }
  const connection = herdrConnection(options.session)
  const workspace = openRefinementWorkspace(taskId, contextFile, options.cwd || process.cwd(), connection)
  if (options.agent) startRefinementAgent(workspace, options.agent, taskId, contextFile)
  return { contextFile, herdr: { session: workspace.session, workspaceId: workspace.workspaceId, paneId: workspace.paneId } }
}

export function selectWork(task: string, repo?: string): WorkSession {
  const taskId = normalizeWorkTask(task)
  let candidates = readWorkSessions().filter(s => !s.closedAt && s.taskId === taskId)
  if (repo) {
    const { commonDir } = getWorkRepository(path.resolve(repo))
    candidates = candidates.filter(s => s.commonDir === commonDir)
  } else if (candidates.length > 1) {
    try {
      const { commonDir } = getWorkRepository(process.cwd())
      const local = candidates.filter(s => s.commonDir === commonDir)
      if (local.length) candidates = local
    } catch {}
  }
  if (!candidates.length) throw new Error(`No hay un worktree abierto para ${taskId}.`)
  if (candidates.length > 1) throw new Error(`${taskId} tiene worktrees en varios repositorios. Especifica --repo.`)
  return candidates[0]
}

function assertWorkCanClose(work: WorkSession, cwd: string): void {
  assertRegisteredWorktree(work)
  if (isWithin(work.worktreePath, fs.realpathSync(cwd))) {
    throw new Error('Ejecuta el cierre desde fuera del worktree que quieres eliminar.')
  }
  // Git normally discards ignored files (including .env) on removal. Preserve them too.
  if (git(work.worktreePath, ['status', '--porcelain', '--untracked-files=all', '--ignored'])) {
    throw new Error('El worktree contiene cambios o archivos sin seguimiento/ignorados. Guárdalos o retíralos antes de cerrar; no se ha eliminado nada.')
  }
  // Intent-to-add, ignored submodule dirt and other Git-specific cases are also
  // guarded by the final non-forced git worktree remove.
  const ahead = git(work.worktreePath, ['rev-list', '--count', `${work.base}..HEAD`])
  if (ahead !== '0') {
    const patches = git(work.worktreePath, ['cherry', work.base, 'HEAD'])
    if (!patches || patches.split('\n').some(line => !line.startsWith('- '))) {
      // A squash has different commit IDs/individual patches. A clean virtual
      // merge that adds nothing to the target also proves its changes are there.
      // merge-tree writes Git objects only; it never touches either checkout.
      let integrated = false
      try {
        const mergedTree = git(work.worktreePath, ['merge-tree', '--write-tree', work.base, 'HEAD']).split('\n')[0]
        integrated = mergedTree === git(work.worktreePath, ['rev-parse', `${work.base}^{tree}`])
      } catch { /* Conflicts or older Git: preserve the checkout. */ }
      if (!integrated) throw new Error(`Hay commits sin integrar en ${work.base}. Actualiza la rama destino (git fetch si es remota) y verifica el merge antes de cerrar.`)
    }
  }
}

export function closeWork(task: string, options: { repo?: string; cwd?: string; check?: boolean } = {}): WorkSession {
  return withWorkLock(() => {
    const work = selectWork(task, options.repo)
    const cwd = options.cwd || process.cwd()
    assertWorkCanClose(work, cwd)
    const hasWorkspace = assertHerdrWorkspaceCanClose(work)
    if (options.check) return work
    if (hasWorkspace) herdrCommand(work.herdr!, ['workspace', 'close', work.herdr!.workspaceId])
    // Check again after closing terminals, then let Git arbitrate removal. Never --force.
    assertWorkCanClose(work, cwd)
    git(work.repoPath, ['worktree', 'remove', '--', work.worktreePath])
    const sessions = readWorkSessions()
    const entry = sessions.find(s => s.id === work.id)!
    entry.closedAt = new Date().toISOString()
    writeWorkSessions(sessions)
    return entry
  })
}

export { readWorkSessions, getWorkSession, getWorkSessionsForTask } from './work-store'
export type { WorkSession } from './work-store'
