import { describe, it, expect, beforeEach } from 'vitest'
import { MarkdownProvider } from '../providers/notes/markdown'

const provider = new MarkdownProvider() as any

describe('parseCaptures', () => {

  beforeEach(() => {
    process.env.MARKDOWN_VAULT_PATH = '/fake/vault'
  })

  it('parsea una nota correctamente', () => {
    const contenido = '## 2026-05-21\n- 📝 arreglé el bug #note\n'

    const captures = provider.parseCaptures(contenido, '2026-05-21')

    expect(captures).toHaveLength(1)
    expect(captures[0]).toEqual({
      type: 'note',
      raw: 'arreglé el bug',
      source: 'cli',
      date: '2026-05-21',
      taskId: undefined,
    })
  })

  it('parsea múltiples captures de diferentes tipos', () => {
    const contenido = [
      '## 2026-05-21',
      '- 📝 nota de hoy #note',
      '- ☑️ tarea pendiente #todo',
      '- ⚡ prompt del wizard #vibe',
      '- 🧠 aprendí hooks #learn',
    ].join('\n')

    const captures = provider.parseCaptures(contenido, '2026-05-21')

    expect(captures).toHaveLength(4)
    expect(captures[0].type).toBe('note')
    expect(captures[1].type).toBe('todo')
    expect(captures[2].type).toBe('vibe')
    expect(captures[3].type).toBe('learn')
  })

  it('extrae el taskId del wikilink', () => {
    const contenido = '## 2026-05-21\n- 📝 arreglé el bug #note [[GCD-1134]]\n'

    const captures = provider.parseCaptures(contenido, '2026-05-21')

    expect(captures[0].taskId).toBe('GCD-1134')
  })

  it('retorna array vacío si no hay captures', () => {
    const contenido = '## 2026-05-21\n\nSolo texto sin formato de capture\n'

    const captures = provider.parseCaptures(contenido, '2026-05-21')

    expect(captures).toHaveLength(0)
  })

  it('ignora líneas que no son captures válidas', () => {
    const contenido = [
      '## 2026-05-21',
      '- 📝 capture válida #note',
      '- línea sin formato',
      '  texto indentado',
      '# heading que no es capture',
    ].join('\n')

    const captures = provider.parseCaptures(contenido, '2026-05-21')

    expect(captures).toHaveLength(1)
  })
})
