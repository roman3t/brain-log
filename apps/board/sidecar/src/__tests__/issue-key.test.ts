import { describe, expect, it } from 'vitest'
import { correlate, extractAllIssueKeys, extractIssueKey, issuePattern } from '../issue-key'

/**
 * Casos que el diseño exige cubrir: clave en rama, en título de MR, en mensaje
 * de commit, y el caso sin clave. El caso sin clave es el importante: debe dar
 * null y nunca inventarse una correlación.
 */
describe('extractIssueKey', () => {
  it('encuentra la clave en el nombre de la rama', () => {
    expect(extractIssueKey(['feature/ABC-123-algo'])).toBe('ABC-123')
  })

  it('encuentra la clave en el título de un MR', () => {
    expect(extractIssueKey([undefined, 'GCD-1149: arregla el seeker'])).toBe('GCD-1149')
  })

  it('encuentra la clave en el mensaje de un commit', () => {
    expect(extractIssueKey(['fix(GCD-1160): índice compuesto en Mongo'])).toBe('GCD-1160')
  })

  it('devuelve null cuando ninguna fuente tiene clave reconocible', () => {
    expect(extractIssueKey(['hotfix/urgente', 'arregla el bug', 'wip'])).toBeNull()
  })

  it('respeta el orden: gana la primera fuente que tenga clave', () => {
    // La rama es más fiable que el cuerpo del MR, así que se pasa primero.
    expect(extractIssueKey(['feature/GCD-100-x', 'relacionado con GCD-999'])).toBe('GCD-100')
  })

  it('ignora entradas vacías, nulas o indefinidas sin romperse', () => {
    expect(extractIssueKey([undefined, null, '', 'GCD-7'])).toBe('GCD-7')
    expect(extractIssueKey([undefined, null, ''])).toBeNull()
  })

  it('normaliza a mayúsculas', () => {
    // El patrón por defecto sólo acepta mayúsculas, pero un patrón configurado
    // podría aceptar minúsculas; la salida debe quedar normalizada igual.
    expect(extractIssueKey(['gcd-42'], /\b([A-Za-z]+-\d+)\b/)).toBe('GCD-42')
  })

  it('no confunde un número suelto ni una fecha con una clave', () => {
    expect(extractIssueKey(['release 2026-09-15'])).toBeNull()
    expect(extractIssueKey(['bump a 1.2.3'])).toBeNull()
  })

  it('acepta un patrón configurado por entorno (extractIssueKey)', () => {
    const original = process.env.BOARD_ISSUE_KEY_PATTERN
    process.env.BOARD_ISSUE_KEY_PATTERN = '\\b(PROJ_\\d+)\\b'
    try {
      expect(extractIssueKey(['rama/PROJ_77-algo'], issuePattern())).toBe('PROJ_77')
      // Con el patrón custom, el formato por defecto ya no correlaciona.
      expect(extractIssueKey(['feature/ABC-123'], issuePattern())).toBeNull()
    } finally {
      if (original === undefined) delete process.env.BOARD_ISSUE_KEY_PATTERN
      else process.env.BOARD_ISSUE_KEY_PATTERN = original
    }
  })
})

describe('extractAllIssueKeys', () => {
  it('devuelve todas las claves distintas en orden de aparición', () => {
    expect(extractAllIssueKeys('deploy to qa: GCD-1149, GCD-1152')).toEqual(['GCD-1149', 'GCD-1152'])
  })

  it('deduplica repeticiones', () => {
    expect(extractAllIssueKeys('GCD-1 y otra vez GCD-1')).toEqual(['GCD-1'])
  })

  it('devuelve vacío cuando no hay claves', () => {
    expect(extractAllIssueKeys('sin claves aquí')).toEqual([])
    expect(extractAllIssueKeys(undefined)).toEqual([])
  })
})

describe('correlate', () => {
  it('la rama gana sobre el texto y reporta el desacuerdo', () => {
    // Caso real: MR en la rama GCD-1378 cuyo título dice GCD-1387. Ambos
    // tickets existen, así que no es una errata evidente: hay que decirlo.
    expect(correlate('GCD-1378', ['feat(GCD-1387): create workorder'])).toEqual({
      issueKey: 'GCD-1378',
      conflicts: ['GCD-1387'],
    })
  })

  it('no reporta conflicto cuando rama y texto coinciden', () => {
    expect(correlate('GCD-1378', ['feat(GCD-1378): algo'])).toEqual({
      issueKey: 'GCD-1378',
      conflicts: [],
    })
  })

  it('un MR de despliegue con varios tickets no genera conflicto', () => {
    // La rama no aporta clave, así que gana la primera del título y el resto
    // no son contradicciones sino una lista legítima.
    expect(correlate('deploy-qa', ['deploy to qa: GCD-1149, GCD-1152'])).toEqual({
      issueKey: 'GCD-1149',
      conflicts: [],
    })
  })

  it('sin clave en ninguna fuente devuelve null y sin conflictos', () => {
    expect(correlate('hotfix/urgente', ['arreglo rápido'])).toEqual({
      issueKey: null,
      conflicts: [],
    })
  })

  it('cae al texto cuando la rama no tiene clave', () => {
    expect(correlate('dev', ['fix(GCD-9): algo'])).toEqual({
      issueKey: 'GCD-9',
      conflicts: [],
    })
  })
})
