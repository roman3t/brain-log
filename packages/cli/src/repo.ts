import type { Command } from 'commander'
import chalk from 'chalk'
import { listKnownRepos } from '@brain-log/shared'

export function registerRepoCommands(program: Command): void {
  const command = program.command('repo')
    .description('Comandos de repositorios')

  command.command('list')
    .description('Lista los alias de BRAIN_REPOS y si su carpeta existe')
    .action(() => {
      const repos = listKnownRepos()
      if (!repos.length) {
        console.log(chalk.yellow('No hay alias configurados. Agrega BRAIN_REPOS a ~/.brain-log/.env (alias:ruta,alias:ruta).'))
        return
      }
      for (const { alias, path: repoPath, exists } of repos) {
        const mark = exists ? chalk.green('✔') : chalk.red('✘ falta carpeta')
        console.log(`${chalk.cyan(alias.padEnd(16))} ${repoPath}  ${mark}`)
      }
    })
}
