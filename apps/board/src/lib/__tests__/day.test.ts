import { describe, expect, it } from 'vitest'
import { isOnDay, previousBusinessDay, startOfDay } from '../day'

/** Construye una fecha local sin ambigüedad de huso. */
const local = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h)

describe('previousBusinessDay', () => {
  it('desde un martes retrocede al lunes', () => {
    // 2026-09-15 es martes.
    expect(previousBusinessDay(local(2026, 9, 15)).getDate()).toBe(14)
  })

  it('desde un lunes retrocede al viernes, no al domingo', () => {
    // 2026-09-14 lunes -> 2026-09-11 viernes.
    const result = previousBusinessDay(local(2026, 9, 14))
    expect(result.getDate()).toBe(11)
    expect(result.getDay()).toBe(5)
  })

  it('desde un domingo retrocede al viernes', () => {
    // 2026-09-13 domingo -> 2026-09-11 viernes.
    const result = previousBusinessDay(local(2026, 9, 13))
    expect(result.getDate()).toBe(11)
    expect(result.getDay()).toBe(5)
  })

  it('desde un sábado retrocede al viernes', () => {
    // 2026-09-12 sábado -> 2026-09-11 viernes.
    const result = previousBusinessDay(local(2026, 9, 12))
    expect(result.getDate()).toBe(11)
    expect(result.getDay()).toBe(5)
  })

  it('cruza el cambio de mes', () => {
    // 2026-09-01 martes -> 2026-08-31 lunes.
    const result = previousBusinessDay(local(2026, 9, 1))
    expect(result.getMonth()).toBe(7) // agosto
    expect(result.getDate()).toBe(31)
  })

  it('cruza el cambio de año', () => {
    // 2026-01-01 jueves -> 2025-12-31 miércoles.
    const result = previousBusinessDay(local(2026, 1, 1))
    expect(result.getFullYear()).toBe(2025)
    expect(result.getMonth()).toBe(11)
    expect(result.getDate()).toBe(31)
  })

  it('devuelve medianoche, no la hora de partida', () => {
    const result = previousBusinessDay(local(2026, 9, 15, 17))
    expect(result.getHours()).toBe(0)
    expect(result.getMinutes()).toBe(0)
  })

  it('no muta la fecha recibida', () => {
    const original = local(2026, 9, 15)
    const copy = new Date(original)
    previousBusinessDay(original)
    expect(original.getTime()).toBe(copy.getTime())
  })
})

describe('isOnDay', () => {
  it('reconoce una marca dentro del día', () => {
    const day = startOfDay(local(2026, 9, 15))
    // Mediodía local del mismo día, expresado en ISO local.
    expect(isOnDay(local(2026, 9, 15, 9).toISOString(), day)).toBe(true)
  })

  it('descarta el día siguiente', () => {
    const day = startOfDay(local(2026, 9, 15))
    expect(isOnDay(local(2026, 9, 16, 9).toISOString(), day)).toBe(false)
  })

  it('descarta el día anterior', () => {
    const day = startOfDay(local(2026, 9, 15))
    expect(isOnDay(local(2026, 9, 14, 23).toISOString(), day)).toBe(false)
  })

  it('agrupa por jornada local y no por fecha UTC', () => {
    // Las 23:00 locales del 15 pueden ser el 16 en UTC. Si se agrupara por la
    // fecha del string ISO, ese commit saldría del día equivocado.
    const day = startOfDay(local(2026, 9, 15))
    const lateEvening = local(2026, 9, 15, 23)
    expect(isOnDay(lateEvening.toISOString(), day)).toBe(true)
  })

  it('una marca ilegible no pertenece a ningún día', () => {
    const day = startOfDay(local(2026, 9, 15))
    expect(isOnDay('no es una fecha', day)).toBe(false)
    expect(isOnDay('', day)).toBe(false)
  })
})
