import { dayLabel } from '../../lib/day'

/** Qué jornada de actividad se está mirando. */
export type DaySelection = 'all' | 'today' | 'previous'

interface Props {
  value: DaySelection
  onChange: (value: DaySelection) => void
  /** Día hábil anterior, ya calculado por quien llama. */
  previousDay: Date
  /** Cuántos elementos de actividad quedan tras filtrar. */
  shown: number
  /** Cuántos hay en total, para dejar claro qué se está ocultando. */
  total: number
}

/**
 * Selector de jornada para la actividad de código.
 *
 * El día actual y el día hábil anterior están cada uno a un clic, sin
 * desplegables ni rangos que rellenar: son las dos preguntas que se hacen a
 * diario. "Todo" sigue disponible para no esconder el resto.
 */
export function DayFilter({ value, onChange, previousDay, shown, total }: Props) {
  const options: Array<{ id: DaySelection; label: string; title: string }> = [
    { id: 'all', label: 'Todo', title: 'Toda la actividad reciente' },
    { id: 'today', label: 'Hoy', title: 'Sólo la actividad de hoy' },
    {
      id: 'previous',
      label: dayLabel(previousDay),
      title: 'Día hábil anterior (se salta el fin de semana)',
    },
  ]

  return (
    <div className="dayfilter">
      <span className="label">Actividad</span>

      <div className="segmented">
        {options.map(option => (
          <button
            key={option.id}
            className={`segment ${value === option.id ? 'segment-on' : ''}`}
            onClick={() => onChange(option.id)}
            title={option.title}
            aria-pressed={value === option.id}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* Al filtrar se dice cuánto queda fuera: un conteo menor sin explicación
          se lee como "no hay actividad" en vez de "hay, pero de otro día". */}
      <span className="label dayfilter-count">
        {value === 'all' ? `${total}` : `${shown} de ${total}`}
      </span>
    </div>
  )
}
