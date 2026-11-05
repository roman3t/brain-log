import { useCallback, useRef, useState } from 'react'
import type { SourceState } from '../../app/App'
import { ipc } from '../../lib/ipc'
import type { ActivityEvent, HistoryTask, SyncState } from '../../lib/types'

const empty = <T,>(): SourceState<T> => ({ data: null, lastSyncedAt: null, error: null, syncing: false })

/**
 * Lo que ya está en caché cuenta como dato aunque aún no haya sincronizado.
 * Si nunca se sincronizó, `null` distingue "no se sabe" de "no hay nada".
 */
function fromCache<T>(items: T[], sync: SyncState): SourceState<T[]> {
  return {
    data: sync.lastSyncedAt === null && items.length === 0 ? null : items,
    lastSyncedAt: sync.lastSyncedAt,
    error: null,
    syncing: false,
  }
}

/**
 * Datos del historial. Mismas reglas que el resto del board: se pinta primero
 * desde la caché, cada fuente se asienta por su cuenta, y un fallo conserva lo
 * último que se sabía.
 */
export function useHistory() {
  const [tasks, setTasks] = useState<SourceState<HistoryTask[]>>(empty)
  const [events, setEvents] = useState<SourceState<ActivityEvent[]>>(empty)
  // La primera carga de eventos tarda: el botón de sincronizar puede volver a
  // pulsarse mientras tanto, y dos recorridos a la vez sólo gastarían cuota.
  const inFlight = useRef({ tasks: false, events: false })

  const load = useCallback(async () => {
    const result = await ipc.getHistory()
    if (!result.ok) return
    setTasks(fromCache(result.data.tasks, result.data.tasksSync))
    setEvents(fromCache(result.data.events, result.data.eventsSync))
  }, [])

  const sync = useCallback(() => {
    if (!inFlight.current.tasks) {
      inFlight.current.tasks = true
      setTasks(p => ({ ...p, syncing: true }))
      void ipc.syncHistoryTasks().then(r => {
        inFlight.current.tasks = false
        setTasks(p =>
          r.ok
            ? { data: r.data.tasks, lastSyncedAt: r.data.sync.lastSyncedAt, error: null, syncing: false }
            : { ...p, error: r.error, syncing: false },
        )
      })
    }
    if (!inFlight.current.events) {
      inFlight.current.events = true
      setEvents(p => ({ ...p, syncing: true }))
      void ipc.syncHistoryEvents().then(r => {
        inFlight.current.events = false
        setEvents(p =>
          r.ok
            ? { data: r.data.events, lastSyncedAt: r.data.sync.lastSyncedAt, error: null, syncing: false }
            : { ...p, error: r.error, syncing: false },
        )
      })
    }
  }, [])

  return { tasks, events, load, sync }
}
