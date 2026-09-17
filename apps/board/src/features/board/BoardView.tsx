import type { Activity, Board, VaultTodo } from '../../lib/types'
import { IssueCard } from './IssueCard'

interface Props {
  board: Board | null
  syncing: boolean
  hasError: boolean
  todosByIssue: Map<string, VaultTodo[]>
  activityByIssue: Map<string, Activity[]>
  activityUnavailable: boolean
  onToggleTodo: (todo: VaultTodo, done: boolean) => void
  pendingTodos: Set<string>
}

export function BoardView({
  board,
  syncing,
  hasError,
  todosByIssue,
  activityByIssue,
  activityUnavailable,
  onToggleTodo,
  pendingTodos,
}: Props) {
  // Primer arranque sin caché: no hay nada que pintar todavía.
  if (!board) {
    return (
      <main className="board board-empty">
        <p className="empty-text">
          {syncing
            ? 'Cargando tablero…'
            : hasError
              ? 'No hay datos en caché para mostrar. Revisa la conexión y vuelve a sincronizar.'
              : 'Sin datos.'}
        </p>
      </main>
    )
  }

  return (
    <main className="board">
      {board.columns.map(column => {
        const issues = board.grouped[column] ?? []
        return (
          <section className="column" key={column}>
            <div className="column-head">
              <span className="label">{column}</span>
              <span className="column-count">{issues.length}</span>
            </div>
            <div className="column-body">
              {issues.length === 0 ? (
                <p className="column-empty">vacío</p>
              ) : (
                issues.map(issue => (
                  <IssueCard
                    key={issue.key}
                    issue={issue}
                    todos={todosByIssue.get(issue.key) ?? []}
                    activity={activityByIssue.get(issue.key) ?? []}
                    activityUnavailable={activityUnavailable}
                    onToggleTodo={onToggleTodo}
                    pendingTodos={pendingTodos}
                  />
                ))
              )}
            </div>
          </section>
        )
      })}
    </main>
  )
}
