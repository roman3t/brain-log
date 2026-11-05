/**
 * Cálculos del mapa de actividad. Todo en hora local, igual que `day.ts`: una
 * contribución de las 11 de la noche cuenta para ese día, aunque en UTC ya sea
 * el siguiente.
 */

/** Clave de un día local: `2026-11-04`. */
export function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Clave del día local de una marca ISO, o null si no se puede leer. */
export function dayKeyOf(iso: string | null | undefined): string | null {
  if (!iso) return null
  const when = new Date(iso)
  return Number.isNaN(when.getTime()) ? null : dayKey(when)
}

/** Agrupa por día local. Lo que no tiene una fecha legible queda fuera. */
export function groupByDay<T>(items: T[], dateOf: (item: T) => string | null | undefined): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = dayKeyOf(dateOf(item))
    if (!key) continue
    const list = groups.get(key)
    if (list) list.push(item)
    else groups.set(key, [item])
  }
  return groups
}

/** Intensidad de 0 a 4. Con cortes fijos, un día de mucho trabajo no aplana al resto del año. */
export function levelFor(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0
  if (count < 10) return 1
  if (count < 20) return 2
  if (count < 40) return 3
  return 4
}

export interface CalendarDay {
  key: string
  date: Date
}

export interface Calendar {
  /** Columnas de domingo a sábado. La última termina hoy y puede venir incompleta. */
  weeks: CalendarDay[][]
  /** Dónde poner el nombre de cada mes, por índice de semana. */
  months: Array<{ label: string; week: number }>
}

/** Con menos semanas que esto, la etiqueta del mes no cabe antes de la siguiente. */
const MIN_WEEKS_FOR_LABEL = 3

/**
 * Un año hasta `today`, en semanas completas. Los días se construyen a partir de
 * año, mes y día en vez de sumar milisegundos, que fallaría al cambiar de horario.
 */
export function buildCalendar(today: Date): Calendar {
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const first = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 364)
  first.setDate(first.getDate() - first.getDay())

  const weeks: CalendarDay[][] = []
  for (let offset = 0; ; offset++) {
    const date = new Date(first.getFullYear(), first.getMonth(), first.getDate() + offset)
    if (date > end) break
    if (offset % 7 === 0) weeks.push([])
    weeks[weeks.length - 1].push({ key: dayKey(date), date })
  }

  const months: Calendar['months'] = []
  weeks.forEach((week, index) => {
    const month = week[0].date.getMonth()
    if (index > 0 && weeks[index - 1][0].date.getMonth() === month) return
    months.push({ label: week[0].date.toLocaleDateString('es', { month: 'short' }), week: index })
  })
  // El primer mes suele asomar sólo unos días y se encimaría con el siguiente.
  if (months.length > 1 && months[1].week - months[0].week < MIN_WEEKS_FOR_LABEL) months.shift()

  return { weeks, months }
}
