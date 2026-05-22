import { describe, it, expect, beforeEach, afterEach } from 'vitest'

describe('getNotesProvider factory', () => {

  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('retorna MarkdownProvider cuando NOTES_DEFAULT es markdown', async () => {
    process.env.NOTES_DEFAULT = 'markdown'
    process.env.MARKDOWN_VAULT_PATH = '/fake/vault'

    const { getNotesProvider } = await import('../providers/notes/index')
    const provider = getNotesProvider()

    expect(provider.name).toBe('markdown')
  })

  it('retorna NotionProvider cuando NOTES_DEFAULT es notion', async () => {
    process.env.NOTES_DEFAULT = 'notion'
    process.env.NOTION_TOKEN = 'fake-token'

    const { getNotesProvider } = await import('../providers/notes/index')
    const provider = getNotesProvider()

    expect(provider.name).toBe('notion')
  })

  it('usa markdown como default si NOTES_DEFAULT no está definido', async () => {
    delete process.env.NOTES_DEFAULT
    process.env.MARKDOWN_VAULT_PATH = '/fake/vault'

    const { getNotesProvider } = await import('../providers/notes/index')
    const provider = getNotesProvider()

    expect(provider.name).toBe('markdown')
  })
})
