/**
 * Envoltorios tipados de los comandos de Tauri.
 *
 * Esta es la única frontera por la que el webview obtiene datos. No hay fetch
 * a Jira ni a GitLab desde aquí: el frontend no conoce URLs, esquemas de
 * autenticación ni la forma de respuesta de ningún proveedor.
 */
import { invoke } from '@tauri-apps/api/core'
import type {
  Activity,
  Board,
  CredentialStatus,
  Result,
  SourceError,
  SyncState,
  VaultTodo,
} from './types'

/**
 * Los comandos de Rust rechazan con un SourceError ya serializado. Cualquier
 * otra cosa (un panic, un fallo del puente) se normaliza para que el frontend
 * nunca tenga que inspeccionar un error de forma desconocida.
 */
function normalizeError(err: unknown): SourceError {
  if (
    typeof err === 'object' &&
    err !== null &&
    'kind' in err &&
    'message' in err &&
    typeof (err as SourceError).message === 'string'
  ) {
    return err as SourceError
  }
  return { kind: 'unknown', message: typeof err === 'string' ? err : 'fallo inesperado del puente' }
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<Result<T>> {
  try {
    return { ok: true, data: await invoke<T>(cmd, args) }
  } catch (err) {
    return { ok: false, error: normalizeError(err) }
  }
}

export const ipc = {
  // --- lecturas de caché: instantáneas, no tocan la red -------------------

  /** Tablero desde la caché local, con la frescura de la fuente. */
  getBoard: () => call<{ board: Board; sync: SyncState }>('get_board'),

  /** Actividad desde la caché local, con su frescura. */
  getActivity: () => call<{ activity: Activity[]; sync: SyncState }>('get_activity'),

  /**
   * Todos del vault. No se cachean: el vault es la fuente de verdad y puede
   * cambiar por fuera, así que siempre se lee del disco.
   */
  getTodos: () => call<{ todos: VaultTodo[] }>('get_todos'),

  /**
   * Marca o desmarca una casilla en el vault.
   * Falla con kind `diverged` si el archivo cambió desde que se leyó.
   */
  toggleTodo: (todo: VaultTodo, done: boolean) =>
    call<{ done: boolean; fileHash: string }>('toggle_todo', {
      file: todo.file,
      line: todo.line,
      text: todo.text,
      done,
      fileHash: todo.fileHash,
    }),

  // --- sincronizaciones: sí tocan la red ----------------------------------

  /** Trae issues de Jira, los persiste y devuelve el tablero actualizado. */
  syncJira: () => call<{ board: Board; sync: SyncState }>('sync_jira'),

  /** Trae actividad de GitLab, la persiste y la devuelve. */
  syncGitlab: () => call<{ activity: Activity[]; sync: SyncState }>('sync_gitlab'),

  /** Vacía la caché. Es reconstruible: una sincronización completa la restaura. */
  resetCache: () => call<null>('reset_cache'),

  /** Sonda de vida del sidecar. Útil para distinguir "sin red" de "sin sidecar". */
  health: () => call<{ ok: boolean; pid: number }>('health'),

  /** Procedencia + identidad de cuenta. Nunca devuelve el token. */
  credentialStatus: () => call<CredentialStatus[]>('credential_status'),

  /** Guarda el token en el keychain y relanza el sidecar para que lo tome. */
  setCredential: (source: string, token: string) => call<null>('set_credential', { source, token }),

  clearCredential: (source: string) => call<null>('clear_credential', { source }),

  /**
   * Comprueba contra el proveedor que la credencial sirve de verdad.
   * Devuelve la identidad de la cuenta, nunca el token.
   */
  verifyCredential: (source: string) => call<{ account: string }>('verify_credential', { source }),

  /**
   * Abre la página de creación de token de una fuente.
   * Se pasa el id de la fuente, no una URL: el destino lo decide Rust.
   */
  openTokenPage: (source: string) => call<null>('open_token_page', { source }),
}
