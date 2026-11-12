import { execFileSync } from 'child_process'
import type { WorkSession } from './work-store'
import { isNativeAgentKind, listAgentCommands } from './agents'

type Connection = { session: string; socketPath?: string }

export function herdrConnection(session?: string): Connection {
  return {
    session: session || process.env.HERDR_SESSION || 'default',
    socketPath: session ? undefined : process.env.HERDR_SOCKET_PATH,
  }
}

export function herdrCommand(connection: Connection, args: string[]): any {
  const env = { ...process.env }
  delete env.HERDR_SOCKET_PATH
  delete env.HERDR_SESSION
  if (connection.socketPath) env.HERDR_SOCKET_PATH = connection.socketPath
  const prefix = connection.socketPath ? [] : ['--session', connection.session]
  let output: string
  try {
    output = execFileSync(process.env.HERDR_BIN_PATH || 'herdr', [...prefix, ...args], {
      env, encoding: 'utf8', timeout: 45000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error: any) {
    if (error.code === 'ENOENT') throw new Error('Herdr no está en el PATH. Instálalo y abre una sesión, o usa --no-herdr para trabajar solo con Git.')
    let detail = String(error.stderr || error.message).trim()
    try {
      const response = JSON.parse(detail)
      const failure = new Error(response.error?.message || detail) as Error & { code?: string }
      failure.code = response.error?.code
      throw failure
    } catch (parsed: any) {
      if (parsed.code) throw parsed
    }
    throw new Error(`Herdr: ${detail}`)
  }
  const response = JSON.parse(output)
  if (response.error) {
    const error = new Error(response.error.message) as Error & { code?: string }
    error.code = response.error.code
    throw error
  }
  if (!response.result) throw new Error('Respuesta de Herdr sin result; revisa la versión del CLI y del servidor.')
  return response.result
}

export function openHerdrWorkspace(work: WorkSession, connection: Connection): NonNullable<WorkSession['herdr']> {
  const result = herdrCommand(connection, [
    'workspace', 'create', '--cwd', work.worktreePath, '--label', work.taskId, '--focus',
    '--env', `BRAIN_WORK_CONTEXT=${work.contextFile}`,
  ])
  const workspaceId = result.workspace?.workspace_id
  const paneId = result.root_pane?.pane_id
  if (typeof workspaceId !== 'string' || typeof paneId !== 'string') {
    throw new Error('Herdr no devolvió workspace_id y pane_id. El worktree se conserva; revisa herdr workspace list.')
  }
  return { ...connection, workspaceId, paneId }
}

export function focusHerdrWorkspace(work: WorkSession): boolean {
  if (!work.herdr) return false
  try {
    const result = herdrCommand(work.herdr, ['workspace', 'get', work.herdr.workspaceId])
    // IDs can be reused after server state has been lost. Never focus/close another checkout.
    if (result.workspace?.cwd !== work.worktreePath) {
      throw new Error('El espacio de Herdr ya no corresponde al worktree registrado. Revisa la sesión de Herdr antes de continuar.')
    }
    herdrCommand(work.herdr, ['workspace', 'focus', work.herdr.workspaceId])
    return true
  } catch (error: any) {
    if (error.code === 'workspace_not_found') return false
    throw error
  }
}

// Require shells only: even an idle agent has a live conversation/process.
export function assertHerdrWorkspaceCanClose(work: WorkSession): boolean {
  if (!work.herdr) return false
  let workspace: any
  try { workspace = herdrCommand(work.herdr, ['workspace', 'get', work.herdr.workspaceId]).workspace } catch (error: any) {
    if (error.code === 'workspace_not_found') return false
    throw error
  }
  if (workspace?.cwd !== work.worktreePath) throw new Error('El espacio de Herdr pertenece a otra carpeta; se conserva el worktree.')
  const result = herdrCommand(work.herdr, ['pane', 'list', '--workspace', work.herdr.workspaceId])
  if (!Array.isArray(result.panes)) throw new Error('No se pudieron verificar los paneles de Herdr; se conserva el worktree.')
  for (const pane of result.panes) {
    const info = herdrCommand(work.herdr, ['pane', 'process-info', pane.pane_id]).process_info
    if (pane.agent || !info || !Number.isInteger(info.shell_pid) || !Array.isArray(info.foreground_processes) ||
        info.foreground_processes.length === 0 || info.foreground_processes.some((p: any) => p.pid !== info.shell_pid)) {
      throw new Error(`El panel ${pane.pane_id} tiene un agente/proceso activo o no se pudo verificar. Sal del agente y detén los procesos antes de cerrar.`)
    }
  }
  return true
}

// Kinds sin integración nativa en Herdr (ej. OpenCode) no se intentan en silencio: se informa el
// comando configurado en BRAIN_AGENT_COMMANDS para correrlo a mano en el pane ya abierto.
function assertNativeOrExplainFallback(kind: string, context: string): void {
  if (isNativeAgentKind(kind)) return
  const command = listAgentCommands()[kind]
  throw new Error(`Herdr no tiene integración nativa para "${kind}". Corré esto a mano en el pane ya abierto:\n  ${command}\nContexto: ${context}`)
}

export function startWorkAgent(work: WorkSession, kind: string): void {
  if (!work.herdr) throw new Error('--agent requiere Herdr.')
  assertNativeOrExplainFallback(kind, work.contextFile)
  const agents = herdrCommand(work.herdr, ['agent', 'list']).agents
  if (!Array.isArray(agents)) throw new Error('No se pudo consultar la lista de agentes de Herdr.')
  // Reopening a task must never submit its prompt twice or replace an agent.
  if (agents.some((agent: any) => agent.pane_id === work.herdr!.paneId)) return
  herdrCommand(work.herdr, ['agent', 'start', `brain-${work.id.slice(0, 12)}`, '--kind', kind, '--pane', work.herdr.paneId])
  herdrCommand(work.herdr, ['agent', 'prompt', work.herdr.paneId,
    `Lee el contexto de la tarea en ${JSON.stringify(work.contextFile)}. Confirma la tarea, la rama y los pendientes; espera instrucciones antes de implementar. Usa brain note/todo/learn para registrar avances en este worktree.`])
}

// Workspace de refinamiento: previo a elegir repo/worktree, nunca se persiste como WorkSession.
export function openRefinementWorkspace(
  taskId: string, contextFile: string, cwd: string, connection: Connection,
): Connection & { workspaceId: string; paneId: string } {
  const result = herdrCommand(connection, [
    'workspace', 'create', '--cwd', cwd, '--label', `${taskId}-refine`, '--focus',
    '--env', `BRAIN_WORK_CONTEXT=${contextFile}`,
  ])
  const workspaceId = result.workspace?.workspace_id
  const paneId = result.root_pane?.pane_id
  if (typeof workspaceId !== 'string' || typeof paneId !== 'string') {
    throw new Error('Herdr no devolvió workspace_id y pane_id para el workspace de refinamiento.')
  }
  return { ...connection, workspaceId, paneId }
}

export function startRefinementAgent(
  workspace: Connection & { workspaceId: string; paneId: string }, kind: string, taskId: string, contextFile: string,
): void {
  assertNativeOrExplainFallback(kind, contextFile)
  herdrCommand(workspace, ['agent', 'start', `brain-refine-${taskId.toLowerCase()}`, '--kind', kind, '--pane', workspace.paneId])
  herdrCommand(workspace, ['agent', 'prompt', workspace.paneId,
    `Lee el contexto de refinamiento en ${JSON.stringify(contextFile)}. Si tenés la skill /task-refinement (Claude Code), ejecutala con ese contexto; si no, seguí el checklist del propio archivo. Presentá el plan y esperá aprobación antes de pedir la creación de worktrees. Una vez aprobado, indicá con qué repos correr "brain work ${taskId} --repo <alias>".`])
}
