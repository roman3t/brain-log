/**
 * Días hábiles y rangos de un día.
 *
 * Todo se calcula en hora local, no en UTC: "lo que hice ayer" se refiere a la
 * jornada del usuario. Las marcas de tiempo llegan en ISO con zona (GitLab las
 * da en UTC), y `new Date(iso)` las convierte al huso local, que es justo lo que
 * hace falta para agrupar por jornada.
 */

/** Medianoche local del día que contiene `date`. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/**
 * Día hábil anterior a `from`.
 *
 * Se salta el fin de semana: un lunes retrocede al viernes, no al domingo.
 * No contempla festivos — eso exigiría un calendario por país y el requisito
 * sólo habla de día hábil.
 */
export function previousBusinessDay(from: Date): Date {
  const day = startOfDay(from)
  do {
    day.setDate(day.getDate() - 1)
  } while (day.getDay() === 0 || day.getDay() === 6)
  return day
}

/** ¿`iso` cae dentro del día local `day`? */
export function isOnDay(iso: string, day: Date): boolean {
  const when = new Date(iso)
  if (Number.isNaN(when.getTime())) return false
  return (
    when.getFullYear() === day.getFullYear() &&
    when.getMonth() === day.getMonth() &&
    when.getDate() === day.getDate()
  )
}

/** Etiqueta corta para la UI: `mié 16 sep`. */
export function dayLabel(day: Date): string {
  return day.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' })
}
