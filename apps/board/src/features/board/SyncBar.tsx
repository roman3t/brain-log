import type { SourceState } from '../../app/App'
import type { SourceError } from '../../lib/types'
import { timeAgo } from '../../lib/time'

interface SourceSlot {
  name: string
  // El estado es genérico en el dato; aquí sólo importa su frescura.
  state: SourceState<unknown>
  count: number
  unit: string
}

interface Props {
  sources: SourceSlot[]
  onSync: () => void
  onOpenSettings: () => void
}

/** Mensaje por tipo de error. El texto crudo del proveedor va en el `title`. */
function describe(error: SourceError, source: string): string {
  switch (error.kind) {
    case 'auth':
      return `${source} rechazó las credenciales`
    case 'rate_limit':
      return `${source} aplicó límite de tasa`
    case 'offline':
      return `Sin conexión con ${source}`
    case 'not_found':
      return `Falta configuración de ${source}`
    default:
      return `Error de ${source}`
  }
}

export function SyncBar({ sources, onSync, onOpenSettings }: Props) {
  const anySyncing = sources.some(s => s.state.syncing)

  return (
    <header className="syncbar">
      <div className="syncbar-left">
        <span className="brand">brain-log</span>
        {sources.map(s => (
          <span className="label" key={s.name}>
            {s.count} {s.unit}
          </span>
        ))}
      </div>

      <div className="syncbar-right">
        {/* Un error por fuente, identificada por nombre. No bloquea a las demás. */}
        {sources
          .filter(s => s.state.error)
          .map(s => (
            // Un error de credenciales se arregla en Conexiones, así que el
            // aviso es el propio atajo para llegar ahí.
            <button
              className="sync-error sync-error-btn"
              key={s.name}
              title={s.state.error!.message}
              onClick={s.state.error!.kind === 'auth' ? onOpenSettings : undefined}
            >
              <span className="dot dot-red" />
              {describe(s.state.error!, s.name)}
            </button>
          ))}

        {/* Frescura por fuente: cada una puede estar en un momento distinto. */}
        {sources.map(s => (
          <span className="label sync-age" key={s.name}>
            {s.name}{' '}
            {s.state.syncing
              ? '…'
              : s.state.lastSyncedAt
                ? `hace ${timeAgo(s.state.lastSyncedAt)}`
                : '—'}
          </span>
        ))}

        <button className="btn" onClick={onSync} disabled={anySyncing}>
          {anySyncing ? <span className="dot dot-pulse" /> : null}
          Sincronizar
        </button>

        <button className="btn" onClick={onOpenSettings} title="Conexiones">
          Conexiones
        </button>
      </div>
    </header>
  )
}
