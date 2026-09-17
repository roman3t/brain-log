import { useState } from 'react'
import type { Activity, SourceError, VaultTodo } from '../../lib/types'
import { KIND_GLYPH } from '../activity/glyphs'
import { TodoItem } from './TodoItem'

interface Props {
  todos: VaultTodo[]
  activity: Activity[]
  vaultError: SourceError | null
  gitError: SourceError | null
  onToggleTodo: (todo: VaultTodo, done: boolean) => void
  pendingTodos: Set<string>
}

/**
 * Todos y actividad que no pudieron correlacionarse con ningún issue.
 *
 * Se muestran en su propia sección en vez de descartarse o de asignarse a un
 * issue por inferencia. Siguen siendo plenamente funcionales.
 */
export function Unmatched({
  todos,
  activity,
  vaultError,
  gitError,
  onToggleTodo,
  pendingTodos,
}: Props) {
  const [open, setOpen] = useState(true)

  const total = todos.length + activity.length
  const errors = [
    vaultError && { source: 'vault', error: vaultError },
    gitError && { source: 'GitLab', error: gitError },
  ].filter(Boolean) as Array<{ source: string; error: SourceError }>

  if (total === 0 && errors.length === 0) return null

  return (
    <footer className="loose">
      <button className="loose-head" onClick={() => setOpen(o => !o)}>
        <span className="label">Sin issue · {total}</span>
        <span className="loose-head-right">
          {/* Un error por fuente, sin bloquear lo que sí cargó. */}
          {errors.map(({ source, error }) => (
            <span className="sync-error" key={source} title={error.message}>
              <span className="dot dot-red" />
              No se pudo leer {source}
            </span>
          ))}
          <span className="loose-chevron">{open ? '▾' : '▸'}</span>
        </span>
      </button>

      {open && total > 0 && (
        <ul className="loose-list">
          {activity.map(item => (
            <li className="loose-item" key={`${item.kind}:${item.repo}:${item.url || item.title}`}>
              <span className="loose-box" title={item.kind}>
                {KIND_GLYPH[item.kind]}
              </span>
              <span className="loose-text">{item.title}</span>
              <span className="loose-src" title={item.repo}>
                {item.repo}
              </span>
            </li>
          ))}
          {/* La procedencia se muestra: estos todos viven en archivos que el
              usuario edita a mano en Obsidian. */}
          {todos.map(todo => (
            <TodoItem
              key={`${todo.file}:${todo.line}`}
              todo={todo}
              showSource
              onToggle={onToggleTodo}
              pending={pendingTodos.has(`${todo.file}:${todo.line}`)}
            />
          ))}
        </ul>
      )}
    </footer>
  )
}
