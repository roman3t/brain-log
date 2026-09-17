/**
 * Lectura de todos desde el vault Markdown.
 *
 * El vault es la fuente de verdad; la caché local nunca almacena todos. Este
 * módulo sólo lee: devuelve además `file` y `line` de cada todo para que el
 * escritor pueda modificar exactamente esa línea y preservar el resto del
 * archivo byte a byte.
 *
 * Por qué no se usa `MarkdownProvider.getChecklist` para todo:
 *  - lanza ENOENT cuando el issue no tiene página en el vault, que es el caso
 *    de la mayoría de los issues del board;
 *  - sólo reconoce `- [ ] ` sin indentar, y el vault real tiene casillas
 *    indentadas con tab en Bugs.md y en dia/*.md.
 * Para las páginas de `task-jira/` el formato sí coincide, así que la
 * correlación por nombre de archivo se mantiene idéntica a la del CLI.
 */
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { config, getContext } from '@brain-log/shared'
import { issuePattern } from './issue-key'

export interface VaultTodo {
  text: string
  done: boolean
  /** Ruta relativa al vault, para mostrar procedencia y para escribir después. */
  file: string
  /** Línea 1-indexada dentro del archivo. */
  line: number
  /** Clave de issue correlacionada, o null si no se pudo determinar. */
  issueKey: string | null
  /**
   * Hash del archivo en el momento de leerlo. Se devuelve al escribir para
   * detectar que alguien lo tocó entretanto (Obsidian, `git pull`, el CLI).
   */
  fileHash: string
}

function hash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex')
}

/** Casilla Markdown, con indentación opcional (espacios o tabs) preservada. */
const CHECKBOX = /^(\s*)-\s\[([ xX])\]\s?(.*)$/

/** Raíz del contexto activo dentro del vault, replicando MarkdownProvider.contextPath(). */
function contextPath(): string {
  const vault = config.markdown.vaultPath
  if (!vault) throw new Error('MARKDOWN_VAULT_PATH no configurado en ~/.brain-log/.env')
  const { contexts, defaultContext } = config.markdown
  const alias = getContext() || defaultContext
  if (!alias || Object.keys(contexts).length === 0) return vault
  const relative = contexts[alias]
  if (!relative) return vault
  return path.join(vault, relative)
}

/** Directorios que nunca contienen todos del usuario. */
const SKIP_DIRS = new Set(['.git', '.obsidian', '.trash', 'node_modules', 'logseq'])

async function walk(dir: string, acc: string[] = []): Promise<string[]> {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      await walk(path.join(dir, e.name), acc)
    } else if (e.isFile() && e.name.endsWith('.md')) {
      acc.push(path.join(dir, e.name))
    }
  }
  return acc
}

/**
 * Correlaciona un todo con un issue, en orden de fuerza decreciente:
 *   1. el nombre del archivo, si es una página de `task-jira/` — es la
 *      convención que ya usa el CLI y no depende de heurística de texto;
 *   2. el encabezado más cercano por encima del todo;
 *   3. la clave en el propio texto del todo.
 * Si nada coincide devuelve null. Nunca se infiere por cercanía temporal ni
 * por autor.
 */
function correlate(
  fileName: string,
  lines: string[],
  index: number,
  pattern: RegExp,
): string | null {
  const fromFile = fileName.replace(/\.md$/, '').match(pattern)
  if (fromFile) return fromFile[1].toUpperCase()

  for (let i = index; i >= 0; i--) {
    if (lines[i].startsWith('#')) {
      const fromHeading = lines[i].match(pattern)
      if (fromHeading) return fromHeading[1].toUpperCase()
      break // el encabezado más cercano manda; no se sigue subiendo
    }
  }

  const fromText = lines[index].match(pattern)
  return fromText ? fromText[1].toUpperCase() : null
}

/** Lee todos los todos del contexto activo del vault. */
export async function listTodos(): Promise<VaultTodo[]> {
  const root = contextPath()
  const vault = config.markdown.vaultPath
  const pattern = issuePattern()

  // Se recorre también la raíz del vault: Bugs.md y dia/ viven fuera del
  // contexto y son todos igual de reales.
  const roots = root === vault ? [vault] : [root, vault]
  const seen = new Set<string>()
  const files: string[] = []
  for (const r of roots) {
    for (const f of await walk(r)) {
      if (!seen.has(f)) {
        seen.add(f)
        files.push(f)
      }
    }
  }

  const todos: VaultTodo[] = []
  for (const file of files) {
    let content: string
    try {
      content = await fs.readFile(file, 'utf-8')
    } catch {
      continue
    }
    const lines = content.split('\n')
    const base = path.basename(file)
    // Se calcula una vez por archivo y se comparte: todas las casillas del
    // mismo archivo divergen o no divergen juntas.
    const fileHash = hash(content)
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(CHECKBOX)
      if (!match) continue
      const text = match[3].trim()
      // Las casillas vacías son ruido de edición, no tareas.
      if (!text) continue
      todos.push({
        text,
        done: match[2].toLowerCase() === 'x',
        file: path.relative(vault, file),
        line: i + 1,
        issueKey: correlate(base, lines, i, pattern),
        fileHash,
      })
    }
  }
  return todos
}

/** Petición para cambiar el estado de una casilla concreta. */
export interface ToggleRequest {
  /** Ruta relativa al vault, tal como la devolvió listTodos. */
  file: string
  /** Línea 1-indexada. */
  line: number
  /** Texto esperado en esa línea. Se verifica antes de tocar nada. */
  text: string
  /** Estado deseado. */
  done: boolean
  /** Hash del archivo cuando se leyó. Si no coincide, hubo edición externa. */
  fileHash: string
}

/** Error con un `kind` que el frontend puede distinguir del resto. */
class TodoWriteError extends Error {
  constructor(public kind: 'diverged' | 'not_found' | 'unknown', message: string) {
    super(message)
  }
}

/**
 * Resuelve una ruta relativa dentro del vault, rechazando cualquier intento de
 * salir de él.
 *
 * El `file` viene del frontend. Sin esta comprobación, un `../../.ssh/config`
 * convertiría el conmutador de casillas en una escritura arbitraria de disco.
 */
function resolveInsideVault(relative: string): string {
  const vault = path.resolve(config.markdown.vaultPath)
  const resolved = path.resolve(vault, relative)
  if (resolved !== vault && !resolved.startsWith(vault + path.sep)) {
    throw new TodoWriteError('unknown', 'la ruta apunta fuera del vault')
  }
  return resolved
}

/**
 * Cambia el estado de una casilla preservando el resto del archivo.
 *
 * Sólo se sustituye la `x` o el espacio dentro de los corchetes: la
 * indentación (el vault usa tabs en Bugs.md y en dia/), el texto, el resto de
 * la línea, las demás líneas y el salto final quedan intactos byte a byte.
 *
 * Si el archivo cambió desde que se leyó, no se escribe nada: se informa de la
 * divergencia para que el usuario recargue y decida, en vez de pisar en
 * silencio una edición hecha en Obsidian o traída por `git pull`.
 */
export async function toggleTodo(req: ToggleRequest): Promise<{ done: boolean; fileHash: string }> {
  const filePath = resolveInsideVault(req.file)

  let content: string
  try {
    content = await fs.readFile(filePath, 'utf-8')
  } catch {
    throw new TodoWriteError('not_found', `no se pudo leer ${req.file}`)
  }

  if (hash(content) !== req.fileHash) {
    throw new TodoWriteError(
      'diverged',
      `${req.file} cambió en disco desde que se leyó; no se sobrescribió nada`,
    )
  }

  // split('\n') conserva el elemento vacío final si el archivo termina en
  // salto de línea, así que volver a unir con '\n' lo restituye tal cual.
  const lines = content.split('\n')
  const index = req.line - 1
  if (index < 0 || index >= lines.length) {
    throw new TodoWriteError('not_found', `la línea ${req.line} no existe en ${req.file}`)
  }

  const match = lines[index].match(CHECKBOX)
  if (!match) {
    throw new TodoWriteError('diverged', `la línea ${req.line} de ${req.file} ya no es una casilla`)
  }
  if (match[3].trim() !== req.text) {
    // El hash coincidía, así que esto sólo pasa si quien llama mandó una línea
    // que no corresponde. Se rechaza igual antes de escribir.
    throw new TodoWriteError(
      'diverged',
      `el texto de la línea ${req.line} no coincide con el esperado`,
    )
  }

  const marker = req.done ? 'x' : ' '
  // Se reemplaza únicamente el contenido de los corchetes, una sola vez.
  lines[index] = lines[index].replace(/\[[ xX]\]/, `[${marker}]`)

  const updated = lines.join('\n')
  await fs.writeFile(filePath, updated, 'utf-8')

  return { done: req.done, fileHash: hash(updated) }
}
