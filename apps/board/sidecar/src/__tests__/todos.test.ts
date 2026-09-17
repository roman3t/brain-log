import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * El vault se configura por variable de entorno y `config` de @brain-log/shared
 * lee `process.env` en cada acceso (son getters), así que basta con apuntarla a
 * un directorio temporal antes de importar el módulo.
 */
let vault: string
let toggleTodo: typeof import('../todos').toggleTodo
let listTodos: typeof import('../todos').listTodos

const sha = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest('hex')

beforeEach(async () => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-'))
  process.env.MARKDOWN_VAULT_PATH = vault
  process.env.VAULT_CONTEXTS = ''
  process.env.VAULT_CONTEXT_DEFAULT = ''
  const mod = await import('../todos')
  toggleTodo = mod.toggleTodo
  listTodos = mod.listTodos
})

afterEach(() => {
  fs.rmSync(vault, { recursive: true, force: true })
})

function write(rel: string, content: string) {
  const full = path.join(vault, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content, 'utf-8')
  return content
}

const read = (rel: string) => fs.readFileSync(path.join(vault, rel), 'utf-8')

describe('toggleTodo', () => {
  it('marca una casilla sin tocar el resto del archivo', async () => {
    const original = '# Notas\n\n- [ ] primera\n- [ ] segunda\n\ntexto final\n'
    write('n.md', original)

    await toggleTodo({ file: 'n.md', line: 3, text: 'primera', done: true, fileHash: sha(original) })

    expect(read('n.md')).toBe('# Notas\n\n- [x] primera\n- [ ] segunda\n\ntexto final\n')
  })

  it('preserva la indentación con tabs', async () => {
    // Bugs.md y dia/25 08.md del vault real usan tabs; perderlos rompería el
    // anidamiento en Obsidian.
    const original = '- [ ] padre\n\t- [ ] hijo con tab\n'
    write('b.md', original)

    await toggleTodo({
      file: 'b.md',
      line: 2,
      text: 'hijo con tab',
      done: true,
      fileHash: sha(original),
    })

    expect(read('b.md')).toBe('- [ ] padre\n\t- [x] hijo con tab\n')
  })

  it('desmarca igual de bien que marca', async () => {
    const original = '- [x] hecha\n'
    write('n.md', original)
    await toggleTodo({ file: 'n.md', line: 1, text: 'hecha', done: false, fileHash: sha(original) })
    expect(read('n.md')).toBe('- [ ] hecha\n')
  })

  it('respeta un archivo sin salto de línea final', async () => {
    const original = '- [ ] sin salto final'
    write('n.md', original)
    await toggleTodo({ file: 'n.md', line: 1, text: 'sin salto final', done: true, fileHash: sha(original) })
    expect(read('n.md')).toBe('- [x] sin salto final')
  })

  it('no altera el número de bytes salvo el marcador', async () => {
    const original = '# T\n\n- [ ] algo con acentos: café, ñu\n\n## Otra\n'
    write('n.md', original)
    await toggleTodo({
      file: 'n.md',
      line: 3,
      text: 'algo con acentos: café, ñu',
      done: true,
      fileHash: sha(original),
    })
    const after = read('n.md')
    expect(Buffer.byteLength(after)).toBe(Buffer.byteLength(original))
    expect(after.replace('[x]', '[ ]')).toBe(original)
  })

  it('rechaza la escritura si el archivo cambió en disco', async () => {
    const original = '- [ ] uno\n'
    write('n.md', original)
    const staleHash = sha(original)

    // Simula una edición externa (Obsidian, git pull, el CLI).
    write('n.md', '- [ ] uno\n- [ ] dos añadida por fuera\n')

    await expect(
      toggleTodo({ file: 'n.md', line: 1, text: 'uno', done: true, fileHash: staleHash }),
    ).rejects.toMatchObject({ kind: 'diverged' })

    // Lo más importante: el cambio externo sigue intacto.
    expect(read('n.md')).toBe('- [ ] uno\n- [ ] dos añadida por fuera\n')
  })

  it('rechaza si el texto de la línea no es el esperado', async () => {
    const original = '- [ ] uno\n- [ ] dos\n'
    write('n.md', original)
    await expect(
      toggleTodo({ file: 'n.md', line: 2, text: 'uno', done: true, fileHash: sha(original) }),
    ).rejects.toMatchObject({ kind: 'diverged' })
    expect(read('n.md')).toBe(original)
  })

  it('rechaza una línea que no es una casilla', async () => {
    const original = '# encabezado\n- [ ] uno\n'
    write('n.md', original)
    await expect(
      toggleTodo({ file: 'n.md', line: 1, text: 'encabezado', done: true, fileHash: sha(original) }),
    ).rejects.toMatchObject({ kind: 'diverged' })
  })

  it('rechaza una línea fuera de rango', async () => {
    const original = '- [ ] uno\n'
    write('n.md', original)
    await expect(
      toggleTodo({ file: 'n.md', line: 99, text: 'uno', done: true, fileHash: sha(original) }),
    ).rejects.toMatchObject({ kind: 'not_found' })
  })

  it('rechaza rutas que salen del vault', async () => {
    // Sin esta comprobación, el conmutador de casillas sería una escritura
    // arbitraria de disco dirigida desde el webview.
    const outside = path.join(os.tmpdir(), 'fuera-del-vault.md')
    fs.writeFileSync(outside, '- [ ] ajeno\n', 'utf-8')
    try {
      await expect(
        toggleTodo({
          file: '../fuera-del-vault.md',
          line: 1,
          text: 'ajeno',
          done: true,
          fileHash: sha('- [ ] ajeno\n'),
        }),
      ).rejects.toThrow(/fuera del vault/)
      expect(fs.readFileSync(outside, 'utf-8')).toBe('- [ ] ajeno\n')
    } finally {
      fs.rmSync(outside, { force: true })
    }
  })

  it('el hash devuelto sirve para un segundo cambio inmediato', async () => {
    const original = '- [ ] uno\n'
    write('n.md', original)
    const first = await toggleTodo({
      file: 'n.md',
      line: 1,
      text: 'uno',
      done: true,
      fileHash: sha(original),
    })
    // Sin recargar: el hash devuelto debe permitir encadenar.
    await toggleTodo({ file: 'n.md', line: 1, text: 'uno', done: false, fileHash: first.fileHash })
    expect(read('n.md')).toBe('- [ ] uno\n')
  })
})

describe('listTodos', () => {
  it('devuelve file, line y hash utilizables para escribir', async () => {
    write('n.md', '- [ ] alfa\n\t- [x] beta\n')
    const todos = await listTodos()

    expect(todos).toHaveLength(2)
    const beta = todos.find(t => t.text === 'beta')!
    expect(beta.done).toBe(true)
    expect(beta.line).toBe(2)
    expect(beta.file).toBe('n.md')

    // El hash que devuelve leer debe bastar para escribir acto seguido.
    await toggleTodo({
      file: beta.file,
      line: beta.line,
      text: beta.text,
      done: false,
      fileHash: beta.fileHash,
    })
    expect(read('n.md')).toBe('- [ ] alfa\n\t- [ ] beta\n')
  })

  it('ignora casillas sin texto', async () => {
    write('n.md', '- [ ] real\n- [ ] \n- [ ]\n')
    const todos = await listTodos()
    expect(todos.map(t => t.text)).toEqual(['real'])
  })
})
