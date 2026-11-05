import { useMemo, useState } from 'react'
import type { SourceState } from '../../app/App'
import { buildCalendar, groupByDay } from '../../lib/calendar'
import { startOfDay } from '../../lib/day'
import type { ActivityEvent, HistoryTask } from '../../lib/types'
import { describe } from '../board/SyncBar'
import { DayDetail } from './DayDetail'
import { Heatmap } from './Heatmap'
import { TaskList } from './TaskList'

interface Props {
  tasks: SourceState<HistoryTask[]>
  events: SourceState<ActivityEvent[]>
  /** Columnas del tablero, para ordenar las etapas igual que allí. */
  columns: string[]
}

/** Fecha local a partir de `2026-11-04`. `new Date(texto)` la leería como UTC. */
function parseDayKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/**
 * Tres situaciones que se ven igual si no se distinguen: cargando, falló sin
 * datos, o de verdad no hay nada. Sólo la última permite afirmar que está vacío.
 */
function SourceNote({ state, name, loading }: { state: SourceState<unknown>; name: string; loading: string }) {
  if (state.error) {
    return (
      <p className="history-note history-note-error" title={state.error.message}>
        <span className="dot dot-red" />
        {describe(state.error, name)}
        {state.data ? '. Se muestra lo último que se sincronizó.' : '.'}
      </p>
    )
  }
  if (state.syncing && state.data === null) return <p className="history-note">{loading}</p>
  return null
}

export function HistoryView({ tasks, events, columns }: Props) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const today = useMemo(() => startOfDay(new Date()), [])

  const taskList = tasks.data ?? []
  const eventList = events.data ?? []

  const eventsByDay = useMemo(() => groupByDay(eventList, event => event.at), [eventList])
  const resolvedByDay = useMemo(() => groupByDay(taskList, task => task.resolvedAt), [taskList])
  const tasksByKey = useMemo(() => new Map(taskList.map(task => [task.key, task])), [taskList])

  const eventCounts = useMemo(
    () => new Map([...eventsByDay].map(([day, list]) => [day, list.length])),
    [eventsByDay],
  )
  const resolvedCounts = useMemo(
    () => new Map([...resolvedByDay].map(([day, list]) => [day, list.length])),
    [resolvedByDay],
  )

  const doneCount = useMemo(() => taskList.filter(task => task.category === 'done').length, [taskList])

  /**
   * La caché guarda unos días más de los que caben en el mapa. Las cifras cuentan
   * sólo lo que se ve, para que coincidan con él.
   */
  const shownDays = useMemo(() => {
    const first = buildCalendar(today).weeks[0][0].key
    return [...eventsByDay].filter(([day]) => day >= first)
  }, [eventsByDay, today])
  const shownEvents = useMemo(() => shownDays.reduce((sum, [, list]) => sum + list.length, 0), [shownDays])

  return (
    <main className="history">
      <div className="history-inner">
        <div className="history-stats">
          <div className="stat">
            <b>{tasks.data ? doneCount : '—'}</b>
            <span>tickets hechos</span>
          </div>
          <div className="stat">
            <b>{tasks.data ? taskList.length - doneCount : '—'}</b>
            <span>tickets abiertos</span>
          </div>
          <div className="stat">
            <b>{events.data ? shownDays.length : '—'}</b>
            <span>días con actividad, último año</span>
          </div>
          <div className="stat">
            <b>{events.data ? shownEvents.toLocaleString('es') : '—'}</b>
            <span>eventos en GitLab, último año</span>
          </div>
        </div>

        <section className="history-section">
          <div className="history-head">
            <span className="history-title">Actividad por día</span>
            {events.syncing && events.data !== null && <span className="dot dot-pulse" title="Sincronizando" />}
          </div>
          <SourceNote state={events} name="GitLab" loading="Trayendo un año de actividad de GitLab…" />
          <Heatmap
            today={today}
            counts={eventCounts}
            resolved={resolvedCounts}
            selected={selectedDay}
            onSelect={setSelectedDay}
          />
        </section>

        {selectedDay && (
          <DayDetail
            date={parseDayKey(selectedDay)}
            events={eventsByDay.get(selectedDay) ?? []}
            resolved={resolvedByDay.get(selectedDay) ?? []}
            tasksByKey={tasksByKey}
            onClose={() => setSelectedDay(null)}
          />
        )}

        <section className="history-section">
          <div className="history-head">
            <span className="history-title">Dónde está cada ticket</span>
            {tasks.syncing && tasks.data !== null && <span className="dot dot-pulse" title="Sincronizando" />}
          </div>
          <SourceNote state={tasks} name="Jira" loading="Trayendo tus tickets de Jira…" />
          {tasks.data && <TaskList tasks={taskList} columns={columns} />}
        </section>
      </div>
    </main>
  )
}
