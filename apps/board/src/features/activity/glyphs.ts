import type { Activity } from '../../lib/types'

/** Glifo por tipo de actividad. Un solo lugar, usado por la tarjeta y por "Sin issue". */
export const KIND_GLYPH: Record<Activity['kind'], string> = {
  merge_request: '⇄',
  branch: '⌥',
  commit: '●',
}

/** Color de estado de un MR, alineado con los tokens del menubar. */
export function mrStateClass(state?: string): string {
  switch (state) {
    case 'merged':
      return 'mr-merged'
    case 'closed':
      return 'mr-closed'
    default:
      return 'mr-open'
  }
}
