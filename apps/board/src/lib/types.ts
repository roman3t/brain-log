/**
 * Espejo de los tipos que cruzan el puente Rust <-> webview.
 *
 * Estos tipos deben corresponder uno a uno con lo que el sidecar serializa
 * (PMTask / PMBoard de @brain-log/shared) y con los structs de Rust. Cualquier
 * divergencia es un bug, no una conveniencia.
 */

/** Tarea normalizada, agnóstica del proveedor. Espejo de PMTask. */
export interface Task {
  id: string
  key: string
  title: string
  status: string
  priority: string
  assignee?: string
  provider: string
  url: string
  numericId?: string
}

/** Tablero agrupado por columna. Espejo de PMBoard. */
export interface Board {
  columns: string[]
  counts: Record<string, number>
  grouped: Record<string, Task[]>
  total: number
}

/**
 * Actividad de código. Espejo de Activity en el sidecar.
 */
export interface Activity {
  kind: 'merge_request' | 'branch' | 'commit'
  title: string
  repo: string
  url: string
  /** Sólo para MRs: opened / merged / closed. */
  state?: string
  /** null significa "no correlacionado". Se muestra como tal. */
  issueKey: string | null
  /** Claves mencionadas que contradicen a `issueKey`. Vacío si no hay duda. */
  conflicts: string[]
  updatedAt: string
}

/**
 * Todo leído del vault Markdown. `file` y `line` identifican la línea exacta
 * de origen, que es lo que permitirá escribir de vuelta sin tocar el resto del
 * archivo. Espejo de VaultTodo en el sidecar.
 */
export interface VaultTodo {
  text: string
  done: boolean
  file: string
  line: number
  /** null significa "no correlacionado", y se muestra como tal. */
  issueKey: string | null
  /**
   * Hash del archivo al leerlo. Se devuelve al escribir para detectar que
   * alguien lo modificó entretanto.
   */
  fileHash: string
}

/**
 * Clase de error de una fuente. El frontend decide qué mostrar según el tipo,
 * así que es un union cerrado y no un string libre.
 */
export type ErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'offline'
  | 'not_found'
  /** El archivo cambió en disco entre la lectura y la escritura. */
  | 'diverged'
  | 'unknown'

export interface SourceError {
  kind: ErrorKind
  message: string
}

/**
 * Resultado de una llamada al backend. Se modela como union discriminada para
 * que el frontend no pueda leer `data` sin haber comprobado `ok` primero.
 */
export type Result<T> = { ok: true; data: T } | { ok: false; error: SourceError }

/**
 * De dónde sale la credencial en uso.
 * - `keychain`: guardada desde este panel. Sólo la ve el board.
 * - `env`: viene de ~/.brain-log/.env. La comparten el CLI y el cron.
 * - `none`: no hay credencial.
 */
export type CredentialOrigin = 'keychain' | 'env' | 'none'

/**
 * Frescura persistida de una fuente, tal como la guarda la caché.
 *
 * Viene del backend y no del reloj del frontend: así la antigüedad sobrevive
 * a cerrar la app, que es justo lo que hace falta para abrir sin conexión y
 * saber de cuándo son los datos.
 */
export interface SyncState {
  source: string
  /** Epoch en ms de la última sincronización exitosa, o null si nunca hubo. */
  lastSyncedAt: number | null
  /** Último error registrado. No borra `lastSyncedAt`: los datos siguen ahí. */
  lastError: string | null
}

/** Identidad de una integración. Nunca incluye el token, sólo su procedencia. */
export interface CredentialStatus {
  source: 'jira' | 'gitlab'
  configured: boolean
  origin: CredentialOrigin
  account?: string
}
