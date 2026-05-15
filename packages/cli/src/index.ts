#!/usr/bin/env node
import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  validateConfig,
  validateAnthropicConfig,
  saveCapture,
  saveRecap,
  getCapturesForToday,
  generateRecap,
  getJiraIssue,
  getJiraIssueDetail,
  getActiveTask,
  setActiveTask,
  clearActiveTask,
  upsertTrackedTask,
  getTrackedTasks,
  setupTasksDatabase,
} from '@brain-log/shared'

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
      const task = getActiveTask()
      await saveCapture({ type: 'note', raw: text, source: 'cli', task: task?.id })
      spinner.succeed(chalk.green('Nota guardada') + (task ? chalk.dim(` [${task.id}]`) : ''))
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
      const task = getActiveTask()
      await saveCapture({ type: 'todo', raw: text, source: 'cli', task: task?.id })
      spinner.succeed(chalk.green('To-do guardado') + (task ? chalk.dim(` [${task.id}]`) : ''))
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
      const task = getActiveTask()
      await saveCapture({ type: 'vibe', raw: text, source: 'cli', task: task?.id })
      spinner.succeed(chalk.green('Vibe guardado') + (task ? chalk.dim(` [${task.id}]`) : ''))
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
      const task = getActiveTask()
      await saveCapture({ type: 'learn', raw: text, source: 'cli', task: task?.id })
      spinner.succeed(chalk.green('Aprendizaje guardado') + (task ? chalk.dim(` [${task.id}]`) : ''))
    } catch (e: any) {
      spinner.fail(chalk.red(e.message))
      process.exit(1)
    }
  })

// ── brain task [issueKey] [text...] ────────────────────────────
program
  .command('task [issueKey] [text...]')
  .description('Activa una tarea Jira o guarda una captura vinculada a ella')
  .option('-c, --clear', 'Limpia la tarea activa')
  .option('-s, --show', 'Muestra los detalles completos del ticket')
  .option('-a, --add', 'Agrega o actualiza el ticket en tu tabla de Notion')
  .option('--sync', 'Sincroniza el estado de todas las tareas desde Jira')
  .option('--setup <pageId>', 'Crea la base de datos Tasks en Notion (requiere ID de página)')
  .action(async (issueKey: string | undefined, textParts: string[], opts: { clear?: boolean; show?: boolean; add?: boolean; sync?: boolean; setup?: string }) => {

    if (opts.setup) {
      const spinner = ora('Creando base de datos Tasks en Notion...').start()
      try {
        const dbId = await setupTasksDatabase(opts.setup)
        const envPath = path.join(os.homedir(), '.brain-log', '.env')
        const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : ''
        if (envContent.includes('NOTION_TASKS_DB=')) {
          fs.writeFileSync(envPath, envContent.replace(/NOTION_TASKS_DB=.*/, `NOTION_TASKS_DB=${dbId}`))
        } else {
          fs.appendFileSync(envPath, `\nNOTION_TASKS_DB=${dbId}\n`)
        }
        spinner.succeed(chalk.green('Base de datos Tasks creada'))
        console.log(chalk.dim(`   ID: ${dbId}`))
        console.log(chalk.yellow('\n  Agrega también esto a tu .env del proyecto:'))
        console.log(chalk.cyan(`   NOTION_TASKS_DB=${dbId}\n`))
      } catch (e: any) {
        spinner.fail(chalk.red(e.message))
        process.exit(1)
      }
      return
    }

    if (opts.sync) {
      const spinner = ora('Obteniendo tareas desde Notion...').start()
      try {
        const tasks = await getTrackedTasks()
        if (tasks.length === 0) {
          spinner.warn(chalk.yellow('No hay tareas en la tabla. Usa brain task GCD-1234 --add primero.'))
          return
        }
        spinner.text = `Sincronizando ${tasks.length} tareas con Jira...`
        let updated = 0
        for (const t of tasks) {
          try {
            const issue = await getJiraIssueDetail(t.taskId)
            await upsertTrackedTask(issue)
            if (issue.status !== t.status) {
              console.log(chalk.cyan(`  ${t.taskId}`) + chalk.dim(` ${t.status} → `) + chalk.green(issue.status))
              updated++
            }
          } catch {
            console.log(chalk.dim(`  ${t.taskId} — no se pudo sincronizar`))
          }
        }
        spinner.succeed(chalk.green(`Sync completo — ${updated} cambios de estado`))
      } catch (e: any) {
        spinner.fail(chalk.red(e.message))
        process.exit(1)
      }
      return
    }
    if (opts.show && issueKey) {
      const spinner = ora(`Cargando ${issueKey}...`).start()
      try {
        const issue = await getJiraIssueDetail(issueKey)
        spinner.stop()
        console.log()
        console.log(chalk.bold(`${chalk.cyan(issue.id)} — ${issue.title}`))
        console.log(chalk.dim(`${issue.type} · ${issue.status} · Prioridad: ${issue.priority} · Asignado: ${issue.assignee}`))
        console.log(chalk.dim(issue.url))
        if (issue.description) {
          console.log(chalk.bold('\nDescripción:'))
          console.log(issue.description)
        }
        if (issue.comments.length > 0) {
          console.log(chalk.bold(`\nComentarios (${issue.comments.length}):`))
          issue.comments.slice(-5).forEach(c => {
            console.log(chalk.cyan(`  ${c.author}`) + chalk.dim(` · ${c.created}`))
            console.log(`  ${c.body.replace(/\n/g, '\n  ')}`)
          })
        }
        console.log()
      } catch (e: any) {
        spinner.fail(chalk.red(e.message))
        process.exit(1)
      }
      return
    }

    if (opts.clear) {
      clearActiveTask()
      console.log(chalk.green('✔ Tarea activa eliminada'))
      return
    }

    if (!issueKey) {
      const task = getActiveTask()
      if (task) {
        console.log(chalk.bold(`\n🎯 Tarea activa: ${chalk.cyan(task.id)} — ${task.title}`))
        if (task.url) console.log(chalk.dim(`   ${task.url}`))
        console.log()
      } else {
        console.log(chalk.yellow('No hay tarea activa. Usa: brain task GCD-1234'))
      }
      return
    }

    const text = textParts.join(' ').trim()

    if (text) {
      // Guardar captura vinculada a la tarea
      const spinner = ora('Guardando nota...').start()
      try {
        validateConfig()
        await saveCapture({ type: 'note', raw: text, source: 'cli', task: issueKey })
        spinner.succeed(chalk.green('Nota guardada') + chalk.dim(` [${issueKey}]`))
      } catch (e: any) {
        spinner.fail(chalk.red(e.message))
        process.exit(1)
      }
    } else {
      // Activar tarea (y --add si se especifica)
      const useDetail = opts.add
      const spinner = ora(`Buscando ${issueKey} en Jira...`).start()
      try {
        const issue = useDetail
          ? await getJiraIssueDetail(issueKey)
          : await getJiraIssue(issueKey)
        setActiveTask({ id: issue.id, title: issue.title, url: issue.url, setAt: new Date().toISOString() })

        let savedToNotion = false
        if (opts.add || process.env.NOTION_TASKS_DB) {
          if (!process.env.NOTION_TASKS_DB) {
            spinner.warn(chalk.yellow(`Tarea activa: ${chalk.cyan(issue.id)} — ${issue.title}`))
            console.log(chalk.red('\n  NOTION_TASKS_DB no configurado. Crea la tabla primero:'))
            console.log(chalk.dim('  brain task --setup <notion-page-id>\n'))
            return
          }
          spinner.text = 'Guardando en tabla de Notion...'
          const detail = useDetail ? issue as any : await getJiraIssueDetail(issueKey)
          await upsertTrackedTask(detail)
          savedToNotion = true
        }

        spinner.succeed(chalk.green(`Tarea activa: ${chalk.cyan(issue.id)} — ${issue.title}`))
        if (issue.url) console.log(chalk.dim(`   ${issue.url}`))
        if (savedToNotion) console.log(chalk.dim('   ✓ Guardado en tabla de Notion'))
        console.log(chalk.dim('   Todas las capturas siguientes se etiquetarán con esta tarea'))
      } catch (e: any) {
        if (e.message?.includes('no encontró')) {
          spinner.fail(chalk.red(e.message))
          process.exit(1)
        }
        setActiveTask({ id: issueKey, title: issueKey, url: '', setAt: new Date().toISOString() })
        spinner.warn(chalk.yellow(`Tarea activa: ${issueKey}`) + chalk.dim(' (Jira no configurado, usando solo el ID)'))
      }
    }
  })

// ── brain today ─────────────────────────────────────────────────
program
  .command('today')
  .description('Ve tus capturas de hoy')
  .action(async () => {
    try {
      validateConfig()

      const activeTask = getActiveTask()
      if (activeTask) {
        console.log(chalk.bold(`\n🎯 Tarea activa: ${chalk.cyan(activeTask.id)} — ${activeTask.title}`))
      }

      const captures = await getCapturesForToday()

      if (captures.length === 0) {
        console.log(chalk.yellow('\nNo hay capturas hoy todavía.'))
        return
      }

      console.log(chalk.bold(`\n📋 Capturas de hoy (${captures.length}):\n`))
      captures.forEach((c) => {
        const icon = { note: '📝', todo: '☑️', vibe: '⚡', learn: '🧠' }[c.type] || '•'
        const color = { note: chalk.white, todo: chalk.cyan, vibe: chalk.magenta, learn: chalk.green }[c.type] || chalk.white
        const taskTag = c.task ? chalk.dim(` [${c.task}]`) : ''
        console.log(`${icon} ${color(`[${c.type}]`)}${taskTag} ${c.raw}`)
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
      validateAnthropicConfig()

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
