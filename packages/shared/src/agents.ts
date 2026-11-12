function parseAliasMap(raw: string): Record<string, string> {
  if (!raw) return {}
  return Object.fromEntries(
    raw.split(',').map(pair => {
      const idx = pair.indexOf(':')
      return [pair.slice(0, idx).trim(), pair.slice(idx + 1).trim()]
    }).filter(([kind, command]) => kind && command),
  )
}

// kind:comando,kind:comando en BRAIN_AGENT_COMMANDS de ~/.brain-log/.env — config local, nunca un archivo del workspace.
export function listAgentCommands(): Record<string, string> {
  return parseAliasMap(process.env.BRAIN_AGENT_COMMANDS || '')
}

// Únicos kinds con integración confirmada en el `agent start --kind` de Herdr.
const NATIVE_AGENT_KINDS = ['claude', 'codex']

export function isNativeAgentKind(kind: string): boolean {
  return NATIVE_AGENT_KINDS.includes(kind)
}

export function assertKnownAgentKind(kind: string): void {
  if (isNativeAgentKind(kind) || listAgentCommands()[kind]) return
  throw new Error(`Agente desconocido: ${kind}. Usa claude, codex, o configura BRAIN_AGENT_COMMANDS con "${kind}:<comando>" en ~/.brain-log/.env.`)
}
