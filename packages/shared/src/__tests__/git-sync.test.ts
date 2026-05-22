import { describe, it, expect, vi } from 'vitest'

vi.mock('child_process', () => ({
  exec: vi.fn((cmd, opts, callback) => callback(null, '', '')),
}))

import { gitSync } from '../providers/notes/git-sync'
import { exec } from 'child_process'

describe('gitSync', () => {

  it('ejecuta git add, commit y push en el vault path', async () => {
    vi.mocked(exec).mockClear()

    await gitSync('/fake/vault')

    const llamadas = (exec as any).mock.calls.map((c: any) => c[0])

    expect(llamadas[0]).toBe('git add .')
    expect(llamadas[1]).toContain('git commit -m "sync')
    expect(llamadas[2]).toBe('git push')
  })

  it('ejecuta los comandos en el vault path correcto', async () => {
    vi.mocked(exec).mockClear()

    await gitSync('/Users/roman/brain-vault')

    const opciones = (exec as any).mock.calls[0][1]
    expect(opciones.cwd).toBe('/Users/roman/brain-vault')
  })

  it('incluye timestamp en el mensaje del commit', async () => {
    vi.mocked(exec).mockClear()

    await gitSync('/fake/vault')

    const commitCmd = (exec as any).mock.calls[1][0]
    expect(commitCmd).toMatch(/git commit -m "sync \d{4}-\d{2}-\d{2}/)
  })
})
