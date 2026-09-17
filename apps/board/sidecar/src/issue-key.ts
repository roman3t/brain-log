/**
 * Extracción de la clave de issue.
 *
 * Un solo lugar para el patrón: el monorepo ya tiene la regex de URL de MR
 * duplicada en cuatro sitios y no conviene sumar una quinta copia de nada.
 *
 * La correlación es una heurística declarada, no una garantía. Cuando ninguna
 * fuente de texto contiene una clave reconocible el resultado es `null`, que
 * significa "no correlacionado" y se muestra como tal. Nunca se infiere la
 * relación por cercanía temporal, por autor ni por ningún otro criterio.
 */

/**
 * Patrón configurable, como pide el diseño: distintos proyectos usan prefijos
 * distintos. Por defecto acepta cualquier `ABC-123` en mayúsculas, siguiendo
 * la convención que ya usa la extensión (`[A-Z]+-\d+`).
 */
export function issuePattern(): RegExp {
  const raw = process.env.BOARD_ISSUE_KEY_PATTERN || '\\b([A-Z][A-Z0-9]+-\\d+)\\b'
  return new RegExp(raw)
}

/**
 * Devuelve la primera clave encontrada entre los textos dados, en el orden en
 * que se pasan. El orden importa: quien llama debe pasar primero la fuente más
 * fiable (p. ej. el nombre de la rama antes que el cuerpo de un MR).
 *
 * Los `undefined` se ignoran, para poder pasar campos opcionales sin filtrar.
 */
export function extractIssueKey(
  texts: Array<string | undefined | null>,
  pattern: RegExp = issuePattern(),
): string | null {
  for (const text of texts) {
    if (!text) continue
    const match = text.match(pattern)
    // El grupo 1 es la clave si el patrón lo define; si no, el match completo.
    if (match) return (match[1] ?? match[0]).toUpperCase()
  }
  return null
}

/** Todas las claves distintas de un texto, en orden de aparición. */
export function extractAllIssueKeys(
  text: string | undefined | null,
  pattern: RegExp = issuePattern(),
): string[] {
  if (!text) return []
  // El patrón viene sin /g para poder usarlo con .match() simple en otros
  // sitios, así que aquí se recompila con la bandera global.
  const global = new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`)
  const found = new Set<string>()
  for (const match of text.matchAll(global)) {
    found.add((match[1] ?? match[0]).toUpperCase())
  }
  return [...found]
}

/**
 * Correlación con detección de desacuerdo.
 *
 * `primary` es la fuente más fiable (el nombre de la rama: lo crea quien
 * trabaja, a partir del ticket). `secondary` son textos escritos a mano
 * (título, descripción), donde caben erratas y referencias cruzadas.
 *
 * Si la rama tiene clave y los textos secundarios mencionan otras que no la
 * incluyen, se devuelven como `conflicts` en vez de descartarlas en silencio.
 * Un MR de despliegue que lista varios tickets no genera conflicto: ahí la
 * rama no aporta clave y simplemente gana la primera del título.
 */
export function correlate(
  primary: string | undefined | null,
  secondary: Array<string | undefined | null>,
  pattern: RegExp = issuePattern(),
): { issueKey: string | null; conflicts: string[] } {
  const fromPrimary = extractIssueKey([primary], pattern)
  const fromSecondary = secondary.flatMap(text => extractAllIssueKeys(text, pattern))

  if (!fromPrimary) {
    return { issueKey: fromSecondary[0] ?? null, conflicts: [] }
  }
  return {
    issueKey: fromPrimary,
    conflicts: fromSecondary.filter(key => key !== fromPrimary),
  }
}
