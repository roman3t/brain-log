import { useEffect, useMemo, useRef } from 'react'
import { buildCalendar, levelFor } from '../../lib/calendar'
import { fullDayLabel } from '../../lib/day'

interface Props {
  today: Date
  /** Eventos por día local. */
  counts: Map<string, number>
  /** Tickets resueltos por día local. */
  resolved: Map<string, number>
  selected: string | null
  onSelect: (day: string | null) => void
}

/** Tamaño de una celda más su separación. Debe coincidir con `.heatmap-grid`. */
const CELL_STEP = 14

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

function describeDay(date: Date, events: number, resolved: number): string {
  const parts = [plural(events, 'evento', 'eventos')]
  if (resolved > 0) parts.push(plural(resolved, 'ticket cerrado', 'tickets cerrados'))
  return `${fullDayLabel(date)}: ${parts.join(', ')}`
}

export function Heatmap({ today, counts, resolved, selected, onSelect }: Props) {
  const { weeks, months } = useMemo(() => buildCalendar(today), [today])
  const scroller = useRef<HTMLDivElement>(null)

  // Si la ventana es angosta, lo que debe verse primero es lo reciente.
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [])

  return (
    <div>
      <div className="heatmap" ref={scroller}>
        <div className="heatmap-months" style={{ width: weeks.length * CELL_STEP }}>
          {months.map(month => (
            <span key={month.week} style={{ left: month.week * CELL_STEP }}>
              {month.label}
            </span>
          ))}
        </div>
        <div className="heatmap-body">
          <div className="heatmap-days" aria-hidden="true">
            <span />
            <span>L</span>
            <span />
            <span>X</span>
            <span />
            <span>V</span>
            <span />
          </div>
          <div className="heatmap-grid">
            {weeks.map(week =>
              week.map(day => {
                const count = counts.get(day.key) ?? 0
                const text = describeDay(day.date, count, resolved.get(day.key) ?? 0)
                return (
                  <button
                    key={day.key}
                    className={`heat heat-${levelFor(count)} ${selected === day.key ? 'heat-on' : ''}`}
                    title={text}
                    aria-label={text}
                    aria-pressed={selected === day.key}
                    onClick={() => onSelect(selected === day.key ? null : day.key)}
                  />
                )
              }),
            )}
          </div>
        </div>
      </div>
      <div className="heatmap-legend">
        <span>Menos</span>
        {[0, 1, 2, 3, 4].map(level => (
          <span key={level} className={`heat heat-${level}`} />
        ))}
        <span>Más</span>
      </div>
    </div>
  )
}
