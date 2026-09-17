import type { Activity, Task, VaultTodo } from '../../lib/types'
import { KIND_GLYPH, mrStateClass } from '../activity/glyphs'
import { TodoItem } from '../todos/TodoItem'

/** Mismos glifos que el menubar, para que la prioridad se lea igual en ambas superficies. */
const PRIORITY_GLYPH: Record<string, string> = {
  Highest: '⬆',
  High: '↑',
  Medium: '→',
  Low: '↓',
  Lowest: '⬇',
}

interface Props {
  issue: Task
  todos: VaultTodo[]
  activity: Activity[]
  /** La fuente de actividad falló: no se puede afirmar que no haya actividad. */
  activityUnavailable: boolean
  onToggleTodo: (todo: VaultTodo, done: boolean) => void
  pendingTodos: Set<string>
}

export function IssueCard({
  issue,
  todos,
  activity,
  activityUnavailable,
  onToggleTodo,
  pendingTodos,
}: Props) {
  return (
    <article className="card">
      <div className="card-head">
        <span className="card-key">{issue.key}</span>
        {issue.priority && (
          <span className="card-priority" title={issue.priority}>
            {PRIORITY_GLYPH[issue.priority] ?? '·'}
          </span>
        )}
      </div>

      {/* React escapa el título; no se interpola HTML como en el menubar. */}
      <p className="card-title">{issue.title}</p>

      {activity.length > 0 && (
        <ul className="card-activity">
          {activity.map(item => (
            <li
              className="card-activity-item"
              key={`${item.kind}:${item.url || item.title}`}
              title={`${item.repo} · ${item.kind}`}
            >
              <span className={`act-glyph ${item.kind === 'merge_request' ? mrStateClass(item.state) : ''}`}>
                {KIND_GLYPH[item.kind]}
              </span>
              <span className="act-title">{item.title}</span>
              {/* La rama dice una cosa y el texto otra. Se avisa en vez de
                  resolverlo en silencio: puede ser una errata o trabajo que
                  toca dos tickets, y sólo quien lo escribió lo sabe. */}
              {item.conflicts.length > 0 && (
                <span
                  className="act-conflict"
                  title={`La rama apunta a ${item.issueKey}, pero el texto menciona ${item.conflicts.join(', ')}`}
                >
                  ⚠ {item.conflicts.join(', ')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {todos.length > 0 && (
        <ul className="card-todos">
          {todos.map(todo => (
            <TodoItem
              key={`${todo.file}:${todo.line}`}
              todo={todo}
              onToggle={onToggleTodo}
              pending={pendingTodos.has(`${todo.file}:${todo.line}`)}
            />
          ))}
        </ul>
      )}

      <div className="card-foot">
        {/* Distinción deliberada: "no hay actividad" sólo se afirma cuando la
            fuente respondió. Si GitLab falló, se dice que no se sabe. */}
        {activity.length === 0 && (
          <span className="card-noactivity">
            {activityUnavailable ? 'actividad no disponible' : 'sin actividad'}
          </span>
        )}
      </div>
    </article>
  )
}
