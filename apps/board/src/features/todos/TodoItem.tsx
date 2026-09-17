import type { VaultTodo } from '../../lib/types'

interface Props {
  todo: VaultTodo
  /** Se muestra la procedencia sólo fuera de la tarjeta de un issue. */
  showSource?: boolean
  onToggle: (todo: VaultTodo, done: boolean) => void
  /** Hay una escritura en curso para este todo. */
  pending?: boolean
}

/**
 * Una casilla del vault.
 *
 * Es un `button` y no un `input[type=checkbox]` porque el estado real vive en
 * un archivo Markdown: no se marca sola al hacer clic, se marca cuando la
 * escritura en disco ha ido bien. Un checkbox nativo daría la impresión
 * contraria al cambiar antes de que el archivo lo confirme.
 */
export function TodoItem({ todo, showSource, onToggle, pending }: Props) {
  return (
    <li className={`todo-item ${pending ? 'todo-pending' : ''}`}>
      <button
        className="todo-box"
        onClick={() => onToggle(todo, !todo.done)}
        disabled={pending}
        aria-pressed={todo.done}
        title={`${todo.file}:${todo.line}`}
      >
        {todo.done ? '☑' : '☐'}
      </button>
      <span className={`todo-text ${todo.done ? 'todo-done' : ''}`}>{todo.text}</span>
      {showSource && (
        <span className="loose-src" title={`${todo.file}:${todo.line}`}>
          {todo.file}
        </span>
      )}
    </li>
  )
}
