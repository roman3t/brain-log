import { useCallback, useEffect, useState } from 'react'
import { ipc } from '../../lib/ipc'
import type { CredentialOrigin, CredentialStatus, SourceError } from '../../lib/types'

/** Estado de comprobación de una credencial contra su proveedor. */
type Check =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'ok'; account: string }
  | { phase: 'failed'; error: SourceError }

interface SourceMeta {
  id: 'jira' | 'gitlab'
  label: string
  help: string
  scopes: string
}

const SOURCES: SourceMeta[] = [
  {
    id: 'gitlab',
    label: 'GitLab',
    help: 'Personal access token. Úsalo sólo de lectura: el board no escribe en GitLab.',
    scopes: 'read_api',
  },
  {
    id: 'jira',
    label: 'Jira',
    help: 'API token de Atlassian, asociado a tu email de Jira.',
    scopes: 'hereda tus permisos de usuario',
  },
]

/**
 * Etiqueta de procedencia. Decir sólo "configurado" sería ambiguo: no
 * distinguiría un token que sólo conoce el board de uno que también usa el
 * cron, y esa diferencia decide si rotarlo aquí basta o no.
 */
const ORIGIN_BADGE: Record<CredentialOrigin, { text: string; className: string; hint: string }> = {
  keychain: {
    text: 'keychain',
    className: 'ok',
    hint: 'Guardado en el keychain desde este panel. Sólo lo usa el board; el CLI y el cron siguen leyendo ~/.brain-log/.env.',
  },
  env: {
    text: 'desde .env',
    className: 'env',
    hint: 'Viene de ~/.brain-log/.env. Lo comparten el board, el CLI y el cron de deploy-check.',
  },
  none: {
    text: 'sin configurar',
    className: 'off',
    hint: 'No hay credencial ni en el keychain ni en ~/.brain-log/.env.',
  },
}

interface Props {
  onClose: () => void
  /** Se llama tras guardar, para que el board vuelva a sincronizar. */
  onCredentialsChanged: () => void
}

export function Settings({ onClose, onCredentialsChanged }: Props) {
  const [status, setStatus] = useState<CredentialStatus[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [checks, setChecks] = useState<Record<string, Check>>({})
  const [saving, setSaving] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const result = await ipc.credentialStatus()
    if (result.ok) setStatus(result.data)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const verify = useCallback(async (id: string) => {
    setChecks(c => ({ ...c, [id]: { phase: 'checking' } }))
    const result = await ipc.verifyCredential(id)
    setChecks(c => ({
      ...c,
      [id]: result.ok
        ? { phase: 'ok', account: result.data.account }
        : { phase: 'failed', error: result.error },
    }))
  }, [])

  const save = useCallback(
    async (id: string) => {
      const token = (drafts[id] ?? '').trim()
      if (!token) return
      setSaving(id)
      const result = await ipc.setCredential(id, token)
      setSaving(null)
      if (!result.ok) {
        setChecks(c => ({ ...c, [id]: { phase: 'failed', error: result.error } }))
        return
      }
      // El token ya está en el keychain; se borra del estado de React para que
      // no siga vivo en memoria del webview más de lo necesario.
      setDrafts(d => ({ ...d, [id]: '' }))
      await refresh()
      await verify(id)
      onCredentialsChanged()
    },
    [drafts, refresh, verify, onCredentialsChanged],
  )

  const clear = useCallback(
    async (id: string) => {
      await ipc.clearCredential(id)
      setChecks(c => ({ ...c, [id]: { phase: 'idle' } }))
      await refresh()
      onCredentialsChanged()
    },
    [refresh, onCredentialsChanged],
  )

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings" onClick={e => e.stopPropagation()}>
        <header className="settings-head">
          <span className="brand">Conexiones</span>
          <button className="btn" onClick={onClose}>
            Cerrar
          </button>
        </header>

        <p className="settings-note">
          Los tokens se guardan en el keychain de macOS. No se escriben en la base local
          ni en archivos de configuración, y nunca vuelven al frontend.
        </p>

        {SOURCES.map(source => {
          const current = status.find(s => s.source === source.id)
          const check = checks[source.id] ?? { phase: 'idle' }
          const badge = ORIGIN_BADGE[current?.origin ?? 'none']

          return (
            <section className="settings-source" key={source.id}>
              <div className="settings-source-head">
                <span className="settings-source-name">{source.label}</span>
                <span className={`settings-badge ${badge.className}`} title={badge.hint}>
                  {badge.text}
                </span>
              </div>

              <p className="settings-help">
                {source.help}{' '}
                <button
                  className="settings-link"
                  onClick={() => void ipc.openTokenPage(source.id)}
                >
                  Crear token ↗
                </button>
              </p>
              <p className="settings-help settings-scopes">Alcance: {source.scopes}</p>

              <div className="settings-row">
                <input
                  className="settings-input"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={current?.configured ? 'reemplazar token…' : 'pegar token…'}
                  value={drafts[source.id] ?? ''}
                  onChange={e => setDrafts(d => ({ ...d, [source.id]: e.target.value }))}
                  onKeyDown={e => {
                    if (e.key === 'Enter') void save(source.id)
                  }}
                />
                <button
                  className="btn"
                  disabled={!((drafts[source.id] ?? '').trim()) || saving === source.id}
                  onClick={() => void save(source.id)}
                >
                  {saving === source.id ? 'Guardando…' : 'Guardar'}
                </button>
                <button
                  className="btn"
                  disabled={check.phase === 'checking'}
                  onClick={() => void verify(source.id)}
                >
                  {check.phase === 'checking' ? 'Probando…' : 'Probar'}
                </button>
                {current?.configured && (
                  <button className="btn" onClick={() => void clear(source.id)}>
                    Borrar
                  </button>
                )}
              </div>

              {/* "Configurado" no es lo mismo que "funciona": un token caducado
                  está presente y falla. Por eso el resultado de probar se
                  muestra aparte del badge. */}
              {check.phase === 'ok' && (
                <p className="settings-check ok">
                  <span className="dot dot-green" /> Funciona · {check.account}
                </p>
              )}
              {check.phase === 'failed' && (
                <p className="settings-check failed" title={check.error.message}>
                  <span className="dot dot-red" />
                  {check.error.kind === 'auth'
                    ? 'Token inválido o caducado'
                    : check.error.kind === 'offline'
                      ? 'Sin conexión con el proveedor'
                      : check.error.message}
                </p>
              )}

              {/* Trampa fácil de pisar: rotar el token sólo aquí deja al cron
                  de deploy-check con el viejo, y falla en silencio. */}
              {current?.origin === 'keychain' && (
                <p className="settings-warn">
                  Este token sólo lo usa el board. El CLI y el cron de
                  <code> deploy-check </code> siguen leyendo{' '}
                  <code>~/.brain-log/.env</code>; si lo rotas, actualízalo también ahí.
                </p>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
