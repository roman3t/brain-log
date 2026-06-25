import { exec } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { promisify } from 'util'

const execAsync = promisify(exec)

export async function gitSync(vaultPath: string): Promise<void> {
  // Skip silently if the vault isn't a git repo (sync is opt-in).
  if (!existsSync(join(vaultPath, '.git'))) return

  const run = (cmd: string) => execAsync(cmd, { cwd: vaultPath })

  await run('git add .')
  try {
    await run(`git commit -m "sync ${new Date().toISOString()}"`)
    await run('git push')
  } catch (err: any) {
    if (err.message?.includes('nothing to commit')) return
    throw err
  }
}
