import { describe, it, expect, vi, beforeEach } from 'vitest'

const fsMocks = vi.hoisted(() => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockRejectedValue(new Error('not found')),
  writeFile: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('fs/promises', () => ({
  default: fsMocks,
  ...fsMocks,
}))

import { MarkdownProvider } from '../providers/notes/markdown'

describe('MarkdownProvider', () => {

  beforeEach(() => {
    vi.clearAllMocks()
    fsMocks.readFile.mockRejectedValue(new Error('not found'))
    process.env.MARKDOWN_VAULT_PATH = '/fake/vault'
  })

  it('escribe una nota con el formato correcto', async () => {
    const provider = new MarkdownProvider()

    await provider.saveCapture({
      type: 'note',
      raw: 'arreglé el bug del cherry-pick',
      source: 'cli',
      date: '2026-05-21',
    })

    expect(fsMocks.writeFile).toHaveBeenCalled()
    const [, contenidoEscrito] = fsMocks.writeFile.mock.calls[0]
    expect(contenidoEscrito).toContain('## 2026-05-21')
    expect(contenidoEscrito).toContain('📝 arreglé el bug del cherry-pick #note')
  })

  it('escribe un todo con el ícono correcto', async () => {
    const provider = new MarkdownProvider()

    await provider.saveCapture({
      type: 'todo',
      raw: 'revisar el schema de workorders',
      source: 'cli',
      date: '2026-05-21',
    })

    const [, contenido] = fsMocks.writeFile.mock.calls[0]
    expect(contenido).toContain('☑️ revisar el schema de workorders #todo')
  })

  it('incluye el wikilink del ticket cuando hay taskId', async () => {
    const provider = new MarkdownProvider()

    await provider.saveCapture({
      type: 'vibe',
      raw: 'prompt para el wizard',
      source: 'cli',
      date: '2026-05-21',
      taskId: 'GCD-1134',
    })

    const [, contenido] = fsMocks.writeFile.mock.calls[0]
    expect(contenido).toContain('[[GCD-1134]]')
  })

  it('no duplica el heading si el archivo ya tiene el día', async () => {
    fsMocks.readFile.mockResolvedValueOnce(
      '## 2026-05-21\n- 📝 nota anterior #note\n' as any
    )

    const provider = new MarkdownProvider()

    await provider.saveCapture({
      type: 'note',
      raw: 'nueva nota',
      source: 'cli',
      date: '2026-05-21',
    })

    const [, contenido] = fsMocks.writeFile.mock.calls[0]
    const ocurrencias = (contenido.match(/## 2026-05-21/g) || []).length
    expect(ocurrencias).toBe(1)
  })

  it('escribe el recap con las tres secciones', async () => {
    const provider = new MarkdownProvider()

    await provider.saveRecap({
      date: '2026-05-21',
      whatIDid: 'Trabajé en GCD-1142',
      whatILearned: 'Aprendí sobre GraphQL mutations',
      tomorrow: 'Revisar el schema de workorders',
    })

    const [, contenido] = fsMocks.writeFile.mock.calls[0]
    expect(contenido).toContain('# Recap 2026-05-21')
    expect(contenido).toContain('## Lo que hice')
    expect(contenido).toContain('Trabajé en GCD-1142')
    expect(contenido).toContain('## Lo que aprendí')
    expect(contenido).toContain('## Mañana')
  })
})
