import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertKnownAgentKind, isNativeAgentKind, listAgentCommands } from '../agents'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('agentes genéricos (BRAIN_AGENT_COMMANDS)', () => {
  it('claude y codex son nativos aunque no haya BRAIN_AGENT_COMMANDS configurado', () => {
    expect(isNativeAgentKind('claude')).toBe(true)
    expect(isNativeAgentKind('codex')).toBe(true)
    expect(isNativeAgentKind('opencode')).toBe(false)
    expect(() => assertKnownAgentKind('claude')).not.toThrow()
    expect(() => assertKnownAgentKind('codex')).not.toThrow()
  })

  it('un kind configurado en BRAIN_AGENT_COMMANDS pasa la validación sin ser nativo', () => {
    vi.stubEnv('BRAIN_AGENT_COMMANDS', 'opencode:opencode --profile local')
    expect(listAgentCommands()).toEqual({ opencode: 'opencode --profile local' })
    expect(isNativeAgentKind('opencode')).toBe(false)
    expect(() => assertKnownAgentKind('opencode')).not.toThrow()
  })

  it('rechaza un kind que no es nativo ni está configurado', () => {
    expect(() => assertKnownAgentKind('opencode')).toThrow('Agente desconocido')
  })
})
