import fs from 'fs'
import path from 'path'

function parseAliasMap(raw: string): Record<string, string> {
  if (!raw) return {}
  return Object.fromEntries(
    raw.split(',').map(pair => {
      const idx = pair.indexOf(':')
      return [pair.slice(0, idx).trim(), pair.slice(idx + 1).trim()]
    }).filter(([alias, value]) => alias && value),
  )
}

// alias:ruta,alias:ruta en BRAIN_REPOS de ~/.brain-log/.env — config local, nunca un archivo del workspace.
export function listRepoAliases(): Record<string, string> {
  return parseAliasMap(process.env.BRAIN_REPOS || '')
}

export interface RepoAliasEntry {
  alias: string
  path: string
  exists: boolean
}

export function listKnownRepos(): RepoAliasEntry[] {
  return Object.entries(listRepoAliases()).map(([alias, repoPath]) => ({
    alias, path: repoPath, exists: fs.existsSync(repoPath),
  }))
}

// Si aliasOrPath coincide con un alias conocido, resuelve su ruta; si no, se trata como ruta literal.
export function resolveRepoAlias(aliasOrPath: string): string {
  const aliases = listRepoAliases()
  return aliases[aliasOrPath] ? path.resolve(aliases[aliasOrPath]) : aliasOrPath
}
