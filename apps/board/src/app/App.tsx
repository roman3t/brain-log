import { useCallback, useEffect, useMemo, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { ipc } from '../lib/ipc'
import type { Activity, Board, SourceError, VaultTodo } from '../lib/types'
import { BoardView } from '../features/board/BoardView'
import { SyncBar } from '../features/board/SyncBar'
import { Unmatched } from '../features/todos/Unmatched'
import { Settings } from '../features/settings/Settings'

/**
 * Estado de una fuente en la vista.
 *
 * `lastSyncedAt` viene de la caché, no del reloj del frontend: así la
 * antigüedad sobrevive a cerrar la app, que es justo lo que hace falta para
 * abrir sin conexión y saber de cuándo son los datos.
 *
 * `data` se conserva aunque la sincronización falle: la vista debe seguir
 * navegable mostrando el último estado bueno, no vaciarse ante el primer error.
 */
export interface SourceState<T> {
  data: T | null
  lastSyncedAt: number | null
  error: SourceError | null
  syncing: boolean
}

function initial<T>(): SourceState<T> {
  return { data: null, lastSyncedAt: null, error: null, syncing: false }
}

export function App() {
  const [jira, setJira] = useState<SourceState<Board>>(initial)
  const [vault, setVault] = useState<SourceState<VaultTodo[]>>(initial)
  const [git, setGit] = useState<SourceState<Activity[]>>(initial)
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** Aviso transitorio, p. ej. cuando se detecta una edición externa. */
  const [notice, setNotice] = useState<string | null>(null)
  /** Todos con una escritura en vuelo, por `archivo:línea`. */
  const [pending, setPending] = useState<Set<string>>(new Set())

  /**
   * Pinta desde la caché. No toca la red, así que la ventana tiene contenido
   * antes incluso de que exista el proceso del sidecar.
   */
  const loadFromCache = useCallback(async () => {
    const [board, activity] = await Promise.all([ipc.getBoard(), ipc.getActivity()])

    if (board.ok) {
      setJira(p => ({ ...p, data: board.data.board, lastSyncedAt: board.data.sync.lastSyncedAt }))
    }
    if (activity.ok) {
      setGit(p => ({
        ...p,
        data: activity.data.activity,
        lastSyncedAt: activity.data.sync.lastSyncedAt,
      }))
    }
  }, [])

  /** Va a la red y actualiza la caché. Cada fuente se asienta por separado. */
  const sync = useCallback(async () => {
    setJira(p => ({ ...p, syncing: true }))
    setVault(p => ({ ...p, syncing: true }))
    setGit(p => ({ ...p, syncing: true }))

    void ipc.syncJira().then(r =>
      setJira(p =>
        r.ok
          ? { data: r.data.board, lastSyncedAt: r.data.sync.lastSyncedAt, error: null, syncing: false }
          : // Se preservan `data` y `lastSyncedAt`: un fallo no envejece ni
            // borra lo que ya estaba en caché.
            { ...p, error: r.error, syncing: false },
      ),
    )

    void ipc.syncGitlab().then(r =>
      setGit(p =>
        r.ok
          ? { data: r.data.activity, lastSyncedAt: r.data.sync.lastSyncedAt, error: null, syncing: false }
          : { ...p, error: r.error, syncing: false },
      ),
    )

    // El vault no se cachea: se relee del disco, que siempre está al día.
    void ipc.getTodos().then(r =>
      setVault(p =>
        r.ok
          ? { data: r.data.todos, lastSyncedAt: Date.now(), error: null, syncing: false }
          : { ...p, error: r.error, syncing: false },
      ),
    )
  }, [])

  /** Relee sólo los todos. Barato: es leer archivos, no ir a la red. */
  const reloadTodos = useCallback(async () => {
    const result = await ipc.getTodos()
    setVault(p =>
      result.ok
        ? { data: result.data.todos, lastSyncedAt: Date.now(), error: null, syncing: false }
        : { ...p, error: result.error, syncing: false },
    )
  }, [])

  /**
   * Cambia una casilla en el vault.
   *
   * No se actualiza el estado local por adelantado: la verdad está en el
   * archivo, y si la escritura se rechaza por divergencia la casilla no debe
   * haberse movido nunca en pantalla.
   */
  const toggleTodo = useCallback(
    async (todo: VaultTodo, done: boolean) => {
      const id = `${todo.file}:${todo.line}`
      setPending(p => new Set(p).add(id))

      const result = await ipc.toggleTodo(todo, done)

      setPending(p => {
        const next = new Set(p)
        next.delete(id)
        return next
      })

      if (!result.ok) {
        // La divergencia no es un fallo de la app: alguien más editó el
        // archivo. Se avisa y se recarga para que decida sobre lo que hay.
        setNotice(
          result.error.kind === 'diverged'
            ? `${todo.file} cambió por fuera; no se sobrescribió nada. Se recargó el vault.`
            : `No se pudo actualizar el todo: ${result.error.message}`,
        )
        await reloadTodos()
        return
      }
      await reloadTodos()
    },
    [reloadTodos],
  )

  useEffect(() => {
    // Primero la caché (instantánea), después la red. Nunca al revés.
    void loadFromCache().then(sync)
  }, [loadFromCache, sync])

  useEffect(() => {
    // El vault cambia por fuera (Obsidian, `git pull`, el CLI). Rust observa el
    // directorio y avisa; aquí sólo se recarga.
    const unlisten = listen('vault-changed', () => void reloadTodos())
    return () => {
      void unlisten.then(off => off())
    }
  }, [reloadTodos])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 8000)
    return () => clearTimeout(timer)
  }, [notice])

  /** Todos abiertos indexados por clave de issue, para colgarlos de cada tarjeta. */
  const todosByIssue = useMemo(() => {
    const map = new Map<string, VaultTodo[]>()
    for (const todo of vault.data ?? []) {
      if (!todo.issueKey || todo.done) continue
      const list = map.get(todo.issueKey)
      if (list) list.push(todo)
      else map.set(todo.issueKey, [todo])
    }
    return map
  }, [vault.data])

  /** Actividad indexada por clave de issue. */
  const activityByIssue = useMemo(() => {
    const map = new Map<string, Activity[]>()
    for (const item of git.data ?? []) {
      if (!item.issueKey) continue
      const list = map.get(item.issueKey)
      if (list) list.push(item)
      else map.set(item.issueKey, [item])
    }
    return map
  }, [git.data])

  /**
   * Lo que no pudo correlacionarse. Se muestra aparte, nunca se descarta ni se
   * asigna a un issue por inferencia.
   */
  const looseTodos = useMemo(
    () => (vault.data ?? []).filter(t => !t.issueKey && !t.done),
    [vault.data],
  )
  const looseActivity = useMemo(() => (git.data ?? []).filter(a => !a.issueKey), [git.data])

  return (
    <div className="app">
      <SyncBar
        sources={[
          { name: 'Jira', state: jira, count: jira.data?.total ?? 0, unit: 'tickets' },
          { name: 'Vault', state: vault, count: vault.data?.length ?? 0, unit: 'todos' },
          { name: 'GitLab', state: git, count: git.data?.length ?? 0, unit: 'actividad' },
        ]}
        onSync={() => void sync()}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <BoardView
        board={jira.data}
        syncing={jira.syncing}
        hasError={jira.error !== null}
        todosByIssue={todosByIssue}
        activityByIssue={activityByIssue}
        activityUnavailable={git.error !== null}
        onToggleTodo={toggleTodo}
        pendingTodos={pending}
      />
      <Unmatched
        todos={looseTodos}
        activity={looseActivity}
        vaultError={vault.error}
        gitError={git.error}
        onToggleTodo={toggleTodo}
        pendingTodos={pending}
      />

      {notice && (
        <div className="notice" role="status">
          <span>{notice}</span>
          <button className="btn" onClick={() => setNotice(null)}>
            Entendido
          </button>
        </div>
      )}
      {settingsOpen && (
        <Settings
          onClose={() => setSettingsOpen(false)}
          // Tras cambiar credenciales el sidecar se relanzó: hay que releer.
          onCredentialsChanged={() => void sync()}
        />
      )}
    </div>
  )
}
