#!/usr/bin/env node
import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import { validateConfig, saveCapture, saveRecap, getCapturesForToday, generateRecap } from '@brain-log/shared'

const program = new Command()

program
  .name('brain')
  .description('Tu second brain personal — captura, procesa, recuerda')
  .version('1.0.0')

// ── brain note "texto" ──────────────────────────────────────────
program
  .command('note <text>')
  .description('Guarda una nota rápida')
  .action(async (text: string) => {
    const spinner = ora('Guardando nota...').start()
    try {
      validateConfig()
      await saveCapture({ type: 'note', raw: text, source: 'cli' })
      spinner.succeed(chalk.green('Nota guardada'))
    } catch (e: any) {
      spinner.fail(chalk.red(e.message))
      process.exit(1)
    }
  })

// ── brain todo "texto" ──────────────────────────────────────────
program
  .command('todo <text>')
  .description('Agrega un to-do')
  .action(async (text: string) => {
    const spinner = ora('Guardando to-do...').start()
    try {
      validateConfig()
      await saveCapture({ type: 'todo', raw: text, source: 'cli' })
      spinner.succeed(chalk.green('To-do guardado'))
    } catch (e: any) {
      spinner.fail(chalk.red(e.message))
      process.exit(1)
    }
  })

// ── brain vibe "prompt o descripción" ──────────────────────────
program
  .command('vibe <text>')
  .description('Guarda un prompt o resultado de vibecoding')
  .action(async (text: string) => {
    const spinner = ora('Guardando vibe...').start()
    try {
      validateConfig()
      await saveCapture({ type: 'vibe', raw: text, source: 'cli' })
      spinner.succeed(chalk.green('Vibe guardado'))
    } catch (e: any) {
      spinner.fail(chalk.red(e.message))
      process.exit(1)
    }
  })

// ── brain learn "texto" ─────────────────────────────────────────
program
  .command('learn <text>')
  .description('Documenta algo que aprendiste')
  .action(async (text: string) => {
    const spinner = ora('Guardando aprendizaje...').start()
    try {
      validateConfig()
      await saveCapture({ type: 'learn', raw: text, source: 'cli' })
      spinner.succeed(chalk.green('Aprendizaje guardado'))
    } catch (e: any) {
      spinner.fail(chalk.red(e.message))
      process.exit(1)
    }
  })

// ── brain today ─────────────────────────────────────────────────
program
  .command('today')
  .description('Ve tus capturas de hoy')
  .action(async () => {
    try {
      validateConfig()
      const captures = await getCapturesForToday()

      if (captures.length === 0) {
        console.log(chalk.yellow('No hay capturas hoy todavía.'))
        return
      }

      console.log(chalk.bold(`\n📋 Capturas de hoy (${captures.length}):\n`))
      captures.forEach((c) => {
        const icon = { note: '📝', todo: '☑️', vibe: '⚡', learn: '🧠' }[c.type] || '•'
        const color = { note: chalk.white, todo: chalk.cyan, vibe: chalk.magenta, learn: chalk.green }[c.type] || chalk.white
        console.log(`${icon} ${color(`[${c.type}]`)} ${c.raw}`)
      })
      console.log()
    } catch (e: any) {
      console.error(chalk.red(e.message))
      process.exit(1)
    }
  })

// ── brain recap ─────────────────────────────────────────────────
program
  .command('recap')
  .description('Genera el recap del día con Claude y lo guarda en Notion')
  .action(async () => {
    try {
      validateConfig()

      const spinner = ora('Leyendo tus capturas de hoy...').start()
      const captures = await getCapturesForToday()

      if (captures.length === 0) {
        spinner.warn(chalk.yellow('No hay capturas hoy. Agrega algunas primero.'))
        return
      }

      spinner.text = `Procesando ${captures.length} capturas con Claude...`
      const recap = await generateRecap(captures)

      spinner.text = 'Guardando recap en Notion...'
      const today = new Date().toISOString().split('T')[0]
      await saveRecap({ date: today, ...recap })

      spinner.succeed(chalk.green('Recap del día guardado en Notion'))
      console.log(chalk.bold('\n🌙 Tu día:\n'))
      console.log(chalk.cyan('Lo que hiciste:'), recap.whatIDid)
      console.log(chalk.green('Lo que aprendiste:'), recap.whatILearned)
      console.log(chalk.yellow('Mañana:'), recap.tomorrow)
      console.log()
    } catch (e: any) {
      console.error(chalk.red(e.message))
      process.exit(1)
    }
  })

program.parse()
