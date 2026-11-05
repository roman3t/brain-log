import { useMemo, useState } from 'react'
import { ipc } from '../../lib/ipc'
import { timeAgo } from '../../lib/time'
import type { HistoryTask } from '../../lib/types'

interface Props {
  tasks: HistoryTask[]
  columns: string[]
}

/** Etapa elegida: todos los abiertos, o un estado concreto de Jira. */
const OPEN = 'open'

/** Un ticket abierto sin moverse tanto tiempo probablemente se quedó olvidado. */
const STALE_DAYS = 30

function isStale(task: HistoryTask, now: number): boolean {
  if (task.category === 'done') return false
  const updated = new Date(task.updatedAt).getTime()
  return !Number.isNaN(updated) && now - updated > STALE_DAYS * 86_400_000
}

/** Etapas en el orden del tablero; las que no están ahí, antes de las terminadas. */
function orderStages(tasks: HistoryTask[], columns: string[]) {
  const counts = new Map<string, { count: number; done: boolean }>()
  for (const task of tasks) {
    const entry = counts.get(task.status)
    if (entry) entry.count++
    else counts.set(task.status, { count: 1, done: task.category === 'done' })
  }
  const rank = (status: string, done: boolean) => {
    if (done) return columns.length + 1
    const index = columns.indexOf(status)
    return index === -1 ? columns.length : index
  }
  return [...counts]
    .map(([status, { count, done }]) => ({ status, count, rank: rank(status, done) }))
    .sort((a, b) => a.rank - b.rank || a.status.localeCompare(b.status))
}

export function TaskList({ tasks, columns }: Props) {
  const [stage, setStage] = useState<string>(OPEN)
  const [query, setQuery] = useState('')

  const stages = useMemo(() => orderStages(tasks, columns), [tasks, columns])
  const openCount = useMemo(() => tasks.filter(task => task.category !== 'done').length, [tasks])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return tasks.filter(task => {
      // Al buscar se mira todo: lo que se busca suele ser justo lo ya terminado.
      if (needle) return `${task.key} ${task.title}`.toLowerCase().includes(needle)
      return stage === OPEN ? task.category !== 'done' : task.status === stage
    })
  }, [tasks, stage, query])

  const now = Date.now()

  return (
    <>
      <div className="stages">
        <button
          className={`stage-btn ${stage === OPEN && !query ? 'stage-btn-on' : ''}`}
          onClick={() => {
            setStage(OPEN)
            setQuery('')
          }}
        >
          Abiertos <b>{openCount}</b>
        </button>
        {stages.map(item => (
          <button
            key={item.status}
            className={`stage-btn ${stage === item.status && !query ? 'stage-btn-on' : ''}`}
            onClick={() => {
              setStage(item.status)
              setQuery('')
            }}
          >
            {item.status} <b>{item.count}</b>
          </button>
        ))}
        <input
          className="settings-input task-search"
          type="search"
          placeholder="Buscar en todos los tickets"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      {visible.length === 0 ? (
        <p className="history-empty">{query ? 'Ningún ticket coincide.' : 'Sin tickets en esta etapa.'}</p>
      ) : (
        <ul className="task-list">
          {visible.map(task => {
            const stale = isStale(task, now)
            const updated = new Date(task.updatedAt).getTime()
            return (
              <li className="task-row" key={task.key}>
                <button className="link card-key task-key" onClick={() => void ipc.openLink(task.url)}>
                  {task.key}
                </button>
                <span className="task-title" title={task.assignee ? `${task.title} · ${task.assignee}` : task.title}>
                  {task.title}
                </span>
                <span className={`stage ${task.category === 'done' ? 'stage-done' : ''}`}>{task.status}</span>
                <span
                  className={`task-age ${stale ? 'task-age-stale' : ''}`}
                  title={stale ? `Sin movimiento en Jira hace más de ${STALE_DAYS} días` : 'Última actualización en Jira'}
                >
                  {Number.isNaN(updated) ? '—' : timeAgo(updated)}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
