import { describe, expect, it } from 'vitest'
import { buildCalendar, dayKey, dayKeyOf, groupByDay, levelFor } from '../calendar'

describe('dayKey', () => {
  it('rellena mes y día', () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('dayKeyOf', () => {
  it('usa el día local, no el de UTC', () => {
    const late = new Date(2026, 10, 4, 23, 30)
    expect(dayKeyOf(late.toISOString())).toBe('2026-11-04')
  })

  it('devuelve null sin fecha o con una ilegible', () => {
    expect(dayKeyOf(null)).toBeNull()
    expect(dayKeyOf('')).toBeNull()
    expect(dayKeyOf('ayer')).toBeNull()
  })
})

describe('groupByDay', () => {
  it('agrupa por día y deja fuera lo que no tiene fecha', () => {
    const at = (h: number) => new Date(2026, 10, 4, h).toISOString()
    const groups = groupByDay([{ at: at(9) }, { at: at(18) }, { at: null }], item => item.at)
    expect(groups.get('2026-11-04')).toHaveLength(2)
    expect(groups.size).toBe(1)
  })
})

describe('levelFor', () => {
  it('aplica los cortes fijos', () => {
    expect([0, 1, 9, 10, 19, 20, 39, 40, 500].map(levelFor)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4])
  })
})

describe('buildCalendar', () => {
  // Miércoles.
  const today = new Date(2026, 10, 4)
  const { weeks, months } = buildCalendar(today)

  it('cada semana empieza en domingo', () => {
    expect(weeks.every(week => week[0].date.getDay() === 0)).toBe(true)
  })

  it('termina hoy, con la última semana incompleta', () => {
    const last = weeks[weeks.length - 1]
    expect(last[last.length - 1].key).toBe('2026-11-04')
    expect(last).toHaveLength(4)
    expect(weeks.slice(0, -1).every(week => week.length === 7)).toBe(true)
  })

  it('cubre al menos un año', () => {
    const days = weeks.flat()
    expect(days.length).toBeGreaterThanOrEqual(365)
    expect(new Set(days.map(day => day.key)).size).toBe(days.length)
  })

  it('no repite ni desordena los meses', () => {
    const positions = months.map(month => month.week)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(new Set(positions).size).toBe(positions.length)
  })

  it('no encima el primer mes con el siguiente', () => {
    expect(months[1].week - months[0].week).toBeGreaterThanOrEqual(3)
  })
})
