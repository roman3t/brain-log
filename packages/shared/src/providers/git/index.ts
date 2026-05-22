import { GitLabProvider } from './gitlab'
import type { GitProvider } from './types'

export function getGitProvider(override?: string): GitProvider {
  const name = override || process.env.GIT_DEFAULT || 'gitlab'
  switch (name.toLowerCase()) {
    case 'gitlab': return new GitLabProvider()
    case 'github': throw new Error('GitHub provider aún no implementado')
    default: throw new Error(`Provider Git desconocido: "${name}". Opciones: gitlab`)
  }
}

export * from './types'
export { GitLabProvider }
