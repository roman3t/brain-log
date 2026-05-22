import { JiraProvider } from './jira'
import type { PMProvider } from './types'

export function getPMProvider(override?: string): PMProvider {
  const name = override || process.env.PM_DEFAULT || 'jira'
  switch (name.toLowerCase()) {
    case 'jira': return new JiraProvider()
    case 'asana': throw new Error('Asana provider aún no implementado')
    case 'linear': throw new Error('Linear provider aún no implementado')
    default: throw new Error(`Provider PM desconocido: "${name}". Opciones: jira`)
  }
}

export * from './types'
export { JiraProvider }
