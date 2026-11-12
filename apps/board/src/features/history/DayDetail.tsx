import { useMemo } from 'react'
import { fullDayLabel } from '../../lib/day'
import { ipc } from '../../lib/ipc'
import type { ActivityEvent, HistoryTask } from '../../lib/types'

interface Props {
  date: Date
  events: ActivityEvent[]
  /** Tickets que se cerraron ese día. */
  resolved: HistoryTask[]
  tasksByKey: Map<string, HistoryTask>
  onClose: () => void
}

/** Nombre de la acción de GitLab. Una acción desconocida se muestra tal cual. */
const ACTION_LABEL: Record<string, string> = {
  'pushed to': 'Push',
  'pushed new': 'Rama nueva',
  opened: 'Abrió MR',
  accepted: 'Merge',
  approved: 'Aprobó',
  closed: 'Cerró',
  'commented on': 'Comentó',
  created: 'Creó',
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })

interface Group {
  key: string | null
  events: ActivityEvent[]
}

/** Por ticket, en el orden del día; lo que no se pudo correlacionar va al final. */
function groupByIssue(events: ActivityEvent[]): Group[] {
  const groups = new Map<string | null, ActivityEvent[]>()
  for (const event of events) {
    const list = groups.get(event.issueKey)
    if (list) list.push(event)
    else groups.set(event.issueKey, [event])
  }
  const all = [...groups].map(([key, list]) => ({ key, events: list }))
  return [...all.filter(g => g.key !== null), ...all.filter(g => g.key === null)]
}

export function DayDetail({ date, events, resolved, tasksByKey, onClose }: Props) {
  const groups = useMemo(() => groupByIssue(events), [events])
  const withEvents = new Set(groups.map(g => g.key))
  const onlyResolved = resolved.filter(task => !withEvents.has(task.key))
  const resolvedKeys = new Set(resolved.map(task => task.key))

  return (
    <section className="history-section day-detail">
      <div className="history-head">
        <span className="history-title">{fullDayLabel(date)}</span>
        <span className="label">
          {events.length} eventos · {resolved.length} cerrados
        </span>
        <button className="btn history-head-end" onClick={onClose}>
          Cerrar
        </button>
      </div>

      {events.length === 0 && resolved.length === 0 && (
        <p className="history-empty">Sin actividad ese día.</p>
      )}

      {groups.map(group => {
        const task = group.key ? tasksByKey.get(group.key) : undefined
        return (
          <div className="day-group" key={group.key ?? 'sin-ticket'}>
            <div className="day-group-head">
              {group.key ? <span className="card-key">{group.key}</span> : <span className="label">Sin ticket</span>}
              {task && <span className="day-group-title">{task.title}</span>}
              {group.key && resolvedKeys.has(group.key) && <span className="stage stage-done">cerrado</span>}
              {task && !resolvedKeys.has(task.key) && (
                <span className={`stage ${task.category === 'done' ? 'stage-done' : ''}`}>{task.status}</span>
              )}
            </div>
            <ul className="day-events">
              {group.events.map(event => (
                <li className="day-event" key={event.id} title={event.repo}>
                  <span className="day-event-time">{timeOf(event.at)}</span>
                  <span className="day-event-action">{ACTION_LABEL[event.action] ?? event.action}</span>
                  {event.url ? (
                    <button className="link day-event-title" onClick={() => void ipc.openLink(event.url)}>
                      {event.title}
                    </button>
                  ) : (
                    <span className="day-event-title">{event.title}</span>
                  )}
                  {/* En una rama nueva GitLab cuenta toda su historia, no lo que se subió. */}
                  {event.action === 'pushed to' && event.commits > 1 && (
                    <span className="label">{event.commits} commits</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )
      })}

      {onlyResolved.map(task => (
        <div className="day-group" key={task.key}>
          <div className="day-group-head">
            <span className="card-key">{task.key}</span>
            <span className="day-group-title">{task.title}</span>
            <span className="stage stage-done">cerrado</span>
          </div>
        </div>
      ))}
    </section>
  )
}
