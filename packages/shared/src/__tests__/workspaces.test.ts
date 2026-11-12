import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openWork, closeWork, selectWork, getWorkRepository, discoverWorktrees, importWork, openRefinementSpace } from '../workspaces'
import { getWorkSession, getWorkSessionsForTask, readWorkSessions, withWorkLock, writeWorkSessions } from '../work-store'
import { getActiveTask, addActiveTask, getContext, setContext } from '../state'
import { MarkdownProvider } from '../providers/notes/markdown'
import { validateConfig } from '../config'

let root: string
let repo: string
let home: string

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function initRepo(name: string): string {
  const directory = path.join(root, name)
  fs.mkdirSync(directory)
  git(directory, 'init', '-b', 'main')
  git(directory, 'config', 'user.name', 'Brain test')
  git(directory, 'config', 'user.email', 'brain@example.test')
  git(directory, 'config', 'commit.gpgsign', 'false')
  git(directory, 'config', 'core.hooksPath', '/dev/null')
  fs.writeFileSync(path.join(directory, 'file.txt'), 'initial\n')
  fs.writeFileSync(path.join(directory, '.gitignore'), '.env\nnode_modules/\n')
  git(directory, 'add', '.')
  git(directory, 'commit', '-m', 'initial')
  return directory
}

function open(task = 'GCD-1', extra: Partial<Parameters<typeof openWork>[1]> = {}) {
  return openWork(task, { repo, context: 'work', herdr: false, ...extra })
}

function doImport(task: string, worktree: string, extra: Partial<Parameters<typeof importWork>[1]> = {}) {
  return importWork(task, { repo, context: 'work', herdr: false, worktree, ...extra })
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'brain-work-test-')))
  home = path.join(root, 'home')
  fs.mkdirSync(home)
  vi.spyOn(os, 'homedir').mockReturnValue(home)
  vi.stubEnv('BRAIN_WORKTREES_DIR', path.join(root, 'work trees'))
  vi.stubEnv('MARKDOWN_VAULT_PATH', path.join(root, 'vault'))
  vi.stubEnv('VAULT_CONTEXTS', 'work:company,personal:personal')
  vi.stubEnv('VAULT_CONTEXT_DEFAULT', 'personal')
  vi.stubEnv('NOTES_DEFAULT', 'markdown')
  vi.stubEnv('NOTION_TOKEN', '')
  repo = initRepo('repo with spaces')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('worktrees por tarea', () => {
  it('crea dos checkouts aislados y retoma sin crear otra rama o carpeta', () => {
    const a = open('gcd-1')
    const b = open('GCD-2')
    fs.writeFileSync(path.join(a.worktreePath, 'file.txt'), 'only first\n')
    expect(fs.readFileSync(path.join(b.worktreePath, 'file.txt'), 'utf8')).toBe('initial\n')
    expect(open('GCD-1').id).toBe(a.id)
    expect(getWorkRepository(a.worktreePath).commonDir).toBe(a.commonDir)
    expect(readWorkSessions()).toHaveLength(2)
    expect(git(repo, 'worktree', 'list', '--porcelain').match(/^worktree /gm)).toHaveLength(3)
  })

  it('usa el ticket y contexto del cwd aunque cambie el estado global', async () => {
    const a = open('GCD-1')
    const b = open('VAN-2', { context: 'personal' })
    addActiveTask({ id: 'OTHER-99', title: 'Global', url: '', setAt: '2026-01-01' })
    setContext('personal')
    fs.mkdirSync(path.join(a.worktreePath, 'nested'))
    vi.spyOn(process, 'cwd').mockReturnValue(path.join(a.worktreePath, 'nested'))
    expect(getActiveTask()?.id).toBe('GCD-1')
    expect(getContext()).toBe('work')
    validateConfig() // Markdown captures work without Notion credentials.
    await new MarkdownProvider().saveCapture({ type: 'note', raw: 'primera', source: 'cli', taskId: getActiveTask()?.id, date: '2026-11-11' })
    vi.mocked(process.cwd).mockReturnValue(b.worktreePath)
    expect(getActiveTask()?.id).toBe('VAN-2')
    await new MarkdownProvider().saveCapture({ type: 'todo', raw: 'segunda', source: 'cli', taskId: getActiveTask()?.id, date: '2026-11-11' })
    expect(fs.readFileSync(path.join(root, 'vault/company/journals/2026_11_11.md'), 'utf8')).toContain('[[GCD-1]]')
    expect(fs.readFileSync(path.join(root, 'vault/personal/journals/2026_11_11.md'), 'utf8')).toContain('[[VAN-2]]')
    vi.mocked(process.cwd).mockReturnValue(repo)
    expect(getActiveTask()?.id).toBe('OTHER-99')
  })

  it('un contexto raíz fijado no cambia al contexto global/default', async () => {
    const work = open('GCD-1', { context: '' })
    vi.spyOn(process, 'cwd').mockReturnValue(work.worktreePath)
    await new MarkdownProvider().saveCapture({ type: 'note', raw: 'root', source: 'cli', date: '2026-11-11' })
    expect(fs.existsSync(path.join(root, 'vault/journals/2026_11_11.md'))).toBe(true)
  })

  it('no confunde un directorio con nombre parecido con el worktree', () => {
    const work = open()
    const other = `${work.worktreePath}-other`
    fs.mkdirSync(other)
    expect(getWorkSession(other)).toBeUndefined()
  })

  it('rechaza IDs/rutas y ramas inválidas sin ejecutar texto de shell', () => {
    expect(() => open('../escape')).toThrow('ID')
    expect(() => open('GCD-1', { branch: '-invalid' })).toThrow('rama')
    expect(() => open('GCD-1', { base: git(repo, 'rev-parse', 'HEAD') })).toThrow('rama destino')
    expect(readWorkSessions()).toHaveLength(0)
  })

  it('rechaza una ruta ocupada por algo que no es un worktree de este repositorio', () => {
    vi.stubEnv('BRAIN_WORKTREES_DIR', '')
    const occupied = path.join(root, `${path.basename(repo)}-gcd-1`)
    fs.mkdirSync(occupied)
    fs.writeFileSync(path.join(occupied, 'ajeno.txt'), 'no es un worktree')
    expect(() => open('GCD-1')).toThrow('ya existe')
    expect(readWorkSessions()).toHaveLength(0)
    expect(fs.existsSync(path.join(occupied, 'ajeno.txt'))).toBe(true)
  })

  it('reutiliza un worktree real cuando el registro se perdió, sin volver a crear nada', () => {
    const work = open('GCD-1')
    fs.writeFileSync(path.join(work.worktreePath, 'mine.txt'), 'trabajo previo')
    const branchesBefore = git(repo, 'branch', '--list').split('\n').length
    writeWorkSessions([])

    const recovered = open('GCD-1')

    expect(recovered.worktreePath).toBe(work.worktreePath)
    expect(recovered.branch).toBe(work.branch)
    expect(fs.existsSync(path.join(work.worktreePath, 'mine.txt'))).toBe(true)
    expect(git(repo, 'branch', '--list').split('\n').length).toBe(branchesBefore)
    expect(git(repo, 'worktree', 'list', '--porcelain').match(/^worktree /gm)).toHaveLength(2)
  })

  it('crea el worktree como carpeta hermana del repo, sin hash ni .brain-worktrees', () => {
    vi.stubEnv('BRAIN_WORKTREES_DIR', '')
    const work = open('GCD-1')
    expect(work.worktreePath).toBe(path.join(root, `${path.basename(repo)}-gcd-1`))
    expect(fs.existsSync(path.join(root, '.brain-worktrees'))).toBe(false)
  })

  it('--descriptor controla el sufijo de la carpeta, independiente de --branch', () => {
    vi.stubEnv('BRAIN_WORKTREES_DIR', '')
    const work = open('GCD-1', { descriptor: 'multi-client-shipping', branch: 'feat/GCD-1-shipping' })
    expect(work.worktreePath).toBe(path.join(root, `${path.basename(repo)}-multi-client-shipping`))
    expect(work.branch).toBe('feat/GCD-1-shipping')
  })

  it('rechaza un descriptor con separadores de ruta', () => {
    expect(() => open('GCD-1', { descriptor: '../escape' })).toThrow('Descriptor inválido')
    expect(readWorkSessions()).toHaveLength(0)
  })

  it('BRAIN_WORKTREES_DIR personalizado crea ahí mismo, no como subcarpeta con hash', () => {
    const customDir = path.join(root, 'mis-worktrees')
    vi.stubEnv('BRAIN_WORKTREES_DIR', customDir)
    const work = open('GCD-1')
    expect(work.worktreePath).toBe(path.join(fs.realpathSync(customDir), `${path.basename(repo)}-gcd-1`))
  })

  it('una entrada bajo .claude/worktrees/ no interfiere con la creación de un worktree nuevo', () => {
    vi.stubEnv('BRAIN_WORKTREES_DIR', '')
    const harnessPath = path.join(repo, '.claude', 'worktrees', 'confident-allen')
    fs.mkdirSync(path.dirname(harnessPath), { recursive: true })
    git(repo, 'worktree', 'add', '-b', 'claude/harness-slug', harnessPath)

    const work = open('GCD-1')

    expect(work.worktreePath).toBe(path.join(root, `${path.basename(repo)}-gcd-1`))
    const discovered = discoverWorktrees(repo)
    expect(discovered.some(w => w.path === fs.realpathSync(harnessPath))).toBe(true)
  })

  it('rechaza reutilizar una carpeta convencional ya registrada bajo otro ticket', () => {
    const other = open('GCD-2', { descriptor: 'gcd-1' })
    expect(() => open('GCD-1')).toThrow('ya está registrada como GCD-2')
    expect(readWorkSessions().find(s => s.taskId === 'GCD-2')?.id).toBe(other.id)
  })

  it('no cambia silenciosamente la rama destino de una tarea abierta', () => {
    open()
    git(repo, 'branch', 'dev')
    expect(() => open('GCD-1', { base: 'dev' })).toThrow('otra rama/destino')
  })

  it('distingue la misma tarea en varios repositorios', () => {
    open()
    const other = initRepo('other')
    const b = open('GCD-1', { repo: other })
    vi.spyOn(process, 'cwd').mockReturnValue(root)
    expect(() => selectWork('GCD-1')).toThrow('varios repositorios')
    expect(selectWork('GCD-1', other).id).toBe(b.id)
  })

  it('guarda el alias de repo cuando se provee, sin romper sesiones sin alias', () => {
    const withAlias = open('GCD-1', { repoAlias: 'front' })
    expect(withAlias.repoAlias).toBe('front')
    expect(readWorkSessions()[0].repoAlias).toBe('front')
  })

  it('getWorkSessionsForTask agrupa las sesiones de una tarea entre repositorios', () => {
    const a = open('GCD-1')
    const other = initRepo('other')
    const b = open('GCD-1', { repo: other })
    open('VAN-2')

    const group = getWorkSessionsForTask('gcd-1')
    expect(group.map(s => s.id).sort()).toEqual([a.id, b.id].sort())
  })
})

describe('limpieza segura', () => {
  it.each(['modified', 'untracked', 'ignored'])('conserva el worktree con archivos %s', kind => {
    const work = open()
    fs.writeFileSync(path.join(work.worktreePath, kind === 'modified' ? 'file.txt' : kind === 'ignored' ? '.env' : 'new.txt'), 'keep me')
    expect(() => closeWork('GCD-1', { repo, cwd: root })).toThrow('cambios o archivos')
    expect(fs.existsSync(work.worktreePath)).toBe(true)
    expect(readWorkSessions()[0].closedAt).toBeUndefined()
  })

  it('conserva commits locales y permite cerrar después del merge; retiene rama, contexto e historial', () => {
    const work = open()
    fs.writeFileSync(path.join(work.worktreePath, 'file.txt'), 'feature\n')
    git(work.worktreePath, 'commit', '-am', 'feature')
    expect(() => closeWork('GCD-1', { repo, cwd: root })).toThrow('commits sin integrar')
    git(repo, 'merge', '--no-ff', work.branch, '-m', 'merged')
    closeWork('GCD-1', { repo, cwd: root, check: true })
    expect(fs.existsSync(work.worktreePath)).toBe(true)
    closeWork('GCD-1', { repo, cwd: root })
    expect(fs.existsSync(work.worktreePath)).toBe(false)
    expect(fs.existsSync(work.contextFile)).toBe(true)
    expect(git(repo, 'branch', '--list', work.branch)).toContain(work.branch)
    expect(readWorkSessions()[0].closedAt).toBeTruthy()
    expect(open().id).not.toBe(work.id)
    expect(readWorkSessions()).toHaveLength(2)
  })

  it('reconoce commits integrados mediante cherry-pick', () => {
    const work = open()
    fs.writeFileSync(path.join(work.worktreePath, 'file.txt'), 'feature\n')
    git(work.worktreePath, 'commit', '-am', 'feature')
    fs.writeFileSync(path.join(repo, 'other.txt'), 'other\n')
    git(repo, 'add', '.')
    git(repo, 'commit', '-m', 'other')
    git(repo, 'cherry-pick', work.branch)
    closeWork('GCD-1', { repo, cwd: root })
    expect(fs.existsSync(work.worktreePath)).toBe(false)
  })

  it('reconoce un squash de varios commits sin modificar el checkout destino', () => {
    const work = open()
    fs.writeFileSync(path.join(work.worktreePath, 'file.txt'), 'feature one\n')
    git(work.worktreePath, 'commit', '-am', 'one')
    fs.writeFileSync(path.join(work.worktreePath, 'second.txt'), 'feature two\n')
    git(work.worktreePath, 'add', '.')
    git(work.worktreePath, 'commit', '-m', 'two')
    git(repo, 'merge', '--squash', work.branch)
    git(repo, 'commit', '-m', 'squashed')
    const head = git(repo, 'rev-parse', 'HEAD')
    closeWork('GCD-1', { repo, cwd: root })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(head)
    expect(git(repo, 'status', '--porcelain')).toBe('')
    expect(fs.existsSync(work.worktreePath)).toBe(false)
  })

  it('conserva todas las capturas concurrentes en el mismo journal', async () => {
    const provider = new MarkdownProvider()
    await provider.saveCapture({ type: 'note', raw: 'inicio', source: 'cli', date: '2026-11-11' })
    await Promise.all(Array.from({ length: 20 }, (_, i) => provider.saveCapture({
      type: 'note', raw: `captura-${i}`, source: 'cli', date: '2026-11-11', taskId: `GCD-${i + 1}`,
    })))
    expect(await provider.getCapturesForDate('2026-11-11')).toHaveLength(21)
  })

  it('no borra una rama cambiada, un worktree bloqueado ni el cwd actual', () => {
    const work = open()
    expect(() => closeWork('GCD-1', { repo, cwd: work.worktreePath })).toThrow('fuera del worktree')
    git(repo, 'worktree', 'lock', work.worktreePath)
    expect(() => closeWork('GCD-1', { repo, cwd: root })).toThrow('bloqueado')
    git(repo, 'worktree', 'unlock', work.worktreePath)
    git(work.worktreePath, 'checkout', '-b', 'unrelated')
    expect(() => closeWork('GCD-1', { repo, cwd: root })).toThrow('ruta/rama cambió')
    expect(fs.existsSync(work.worktreePath)).toBe(true)
  })

  it('serializa operaciones y falla sin sobrescribir un registro corrupto', () => {
    expect(() => withWorkLock(() => open())).toThrow('operación de worktrees')
    open()
    const store = path.join(home, '.brain-log/workspaces.json')
    fs.writeFileSync(store, '{broken')
    expect(() => closeWork('GCD-1', { repo, cwd: root })).toThrow()
    expect(fs.readFileSync(store, 'utf8')).toBe('{broken')
  })
})

// Real subprocess contract fixture: exercises argument passing, JSON envelopes,
// persisted IDs, named sessions and failures, without installing/running agents.
function fakeHerdr(): string {
  const executable = path.join(root, 'herdr fixture')
  const state = path.join(root, 'herdr-state.json')
  fs.writeFileSync(executable, `#!/usr/bin/env node
const fs = require('fs');
const file = ${JSON.stringify(state)};
let state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { count: 0, workspaces: {}, agents: [], calls: [] };
const args = process.argv.slice(2);
if (args[0] !== '--session' || args[1] !== 'brain-test') { console.error('wrong session'); process.exit(1); }
args.splice(0, 2);
state.calls.push(args);
const value = flag => args[args.indexOf(flag) + 1];
let result = {};
const key = args.slice(0, 2).join(' ');
if (key === 'workspace create') {
  const id = 'w' + ++state.count;
  state.workspaces[id] = { workspace_id: id, cwd: value('--cwd') };
  result = { workspace: state.workspaces[id], root_pane: { pane_id: id + ':p1' } };
} else if (key === 'workspace get') {
  if (!state.workspaces[args[2]]) { console.error(JSON.stringify({error:{code:'workspace_not_found',message:'gone'}})); process.exit(1); }
  result = { workspace: state.workspaces[args[2]] };
} else if (key === 'workspace close') {
  delete state.workspaces[args[2]];
} else if (key === 'pane list') {
  result = { panes: [{ pane_id: value('--workspace') + ':p1', agent: process.env.BRAIN_TEST_BUSY === 'agent' ? 'codex' : null }] };
} else if (key === 'pane process-info') {
  result = { process_info: { shell_pid: 100, foreground_processes: process.env.BRAIN_TEST_BUSY === 'unknown' ? [] : [{pid: process.env.BRAIN_TEST_BUSY === 'process' ? 200 : 100}] } };
} else if (key === 'agent list') { result = { agents: state.agents }; }
else if (key === 'agent start') { state.agents.push({ pane_id: value('--pane') }); }
fs.writeFileSync(file, JSON.stringify(state));
console.log(JSON.stringify({ result }));
`, { mode: 0o755 })
  vi.stubEnv('HERDR_BIN_PATH', executable)
  return state
}

describe('puente Herdr', () => {
  it('abre, retoma y entrega contexto una sola vez al agente', () => {
    const stateFile = fakeHerdr()
    const options = { herdr: true, session: 'brain-test', agent: 'codex' }
    const work = open('GCD-1', options)
    expect(open('GCD-1', options).herdr).toEqual(work.herdr)
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    expect(state.count).toBe(1)
    expect(state.calls.filter((c: string[]) => c[0] === 'agent' && c[1] === 'prompt')).toHaveLength(1)
    expect(state.calls.find((c: string[]) => c[1] === 'create')).toContain(`BRAIN_WORK_CONTEXT=${work.contextFile}`)
  })

  it.each(['agent', 'process', 'unknown'])('bloquea la limpieza si hay %s', busy => {
    fakeHerdr()
    const work = open('GCD-1', { herdr: true, session: 'brain-test' })
    vi.stubEnv('BRAIN_TEST_BUSY', busy)
    expect(() => closeWork('GCD-1', { repo, cwd: root })).toThrow('agente/proceso activo')
    expect(fs.existsSync(work.worktreePath)).toBe(true)
  })

  it('cierra Herdr antes de quitar el checkout y --check no cierra nada', () => {
    const stateFile = fakeHerdr()
    const work = open('GCD-1', { herdr: true, session: 'brain-test' })
    closeWork('GCD-1', { repo, cwd: root, check: true })
    expect(JSON.parse(fs.readFileSync(stateFile, 'utf8')).workspaces[work.herdr!.workspaceId]).toBeTruthy()
    closeWork('GCD-1', { repo, cwd: root })
    expect(JSON.parse(fs.readFileSync(stateFile, 'utf8')).workspaces).toEqual({})
    expect(fs.existsSync(work.worktreePath)).toBe(false)
  })

  it('recupera un espacio cerrado sin duplicar el worktree', () => {
    const stateFile = fakeHerdr()
    const work = open('GCD-1', { herdr: true, session: 'brain-test' })
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    state.workspaces = {}
    fs.writeFileSync(stateFile, JSON.stringify(state))
    const resumed = open('GCD-1', { herdr: true })
    expect(resumed.id).toBe(work.id)
    expect(resumed.herdr!.workspaceId).not.toBe(work.herdr!.workspaceId)
  })

  it('no cierra un workspace cuyo ID fue reutilizado para otra carpeta', () => {
    const stateFile = fakeHerdr()
    const work = open('GCD-1', { herdr: true, session: 'brain-test' })
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    state.workspaces[work.herdr!.workspaceId].cwd = root
    fs.writeFileSync(stateFile, JSON.stringify(state))
    expect(() => closeWork('GCD-1', { repo, cwd: root })).toThrow('otra carpeta')
    expect(fs.existsSync(work.worktreePath)).toBe(true)
  })

  it('un kind sin integración nativa nunca intenta "agent start" en silencio', () => {
    vi.stubEnv('BRAIN_AGENT_COMMANDS', 'opencode:opencode --profile local')
    const stateFile = fakeHerdr()
    expect(() => open('GCD-1', { herdr: true, session: 'brain-test', agent: 'opencode' })).toThrow('Corré esto a mano')
    const work = readWorkSessions()[0]
    expect(fs.existsSync(work.worktreePath)).toBe(true)
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    expect(state.calls.some((c: string[]) => c[0] === 'agent' && c[1] === 'start')).toBe(false)
  })

  it('un error de Herdr conserva el worktree para retomarlo', () => {
    vi.stubEnv('HERDR_BIN_PATH', path.join(root, 'does-not-exist'))
    expect(() => open('GCD-1', { herdr: true })).toThrow('El worktree se conserva')
    const work = readWorkSessions()[0]
    expect(fs.existsSync(work.worktreePath)).toBe(true)
    expect(open().id).toBe(work.id)
  })
})

describe('descubrimiento de worktrees', () => {
  it('distingue registrados de no registrados y solo sugiere taskId para estos últimos', () => {
    const work = open('GCD-1')
    const manualPath = path.join(root, 'manual-worktree')
    git(repo, 'worktree', 'add', '-b', 'feat/GCD-42-foo', manualPath)
    const noTicketPath = path.join(root, 'no-ticket-worktree')
    git(repo, 'worktree', 'add', '-b', 'estandar/shippings_cross', noTicketPath)

    const found = discoverWorktrees(repo)

    const registered = found.find(w => w.path === work.worktreePath)
    expect(registered?.registered?.taskId).toBe('GCD-1')
    expect(registered?.suggestedTaskId).toBeUndefined()

    const manual = found.find(w => w.path === fs.realpathSync(manualPath))
    expect(manual?.registered).toBeUndefined()
    expect(manual?.suggestedTaskId).toBe('GCD-42')

    const noTicket = found.find(w => w.path === fs.realpathSync(noTicketPath))
    expect(noTicket?.registered).toBeUndefined()
    expect(noTicket?.suggestedTaskId).toBeUndefined()
  })

  it('no escribe el registro de worktrees ni toca Git', () => {
    open('GCD-1')
    const workspacesFile = path.join(home, '.brain-log/workspaces.json')
    const before = fs.readFileSync(workspacesFile, 'utf8')
    discoverWorktrees(repo)
    expect(fs.readFileSync(workspacesFile, 'utf8')).toBe(before)
  })
})

describe('espacio de refinamiento', () => {
  it('escribe un contexto de refinamiento y no toca el registro de worktrees ni Git', () => {
    const space = openRefinementSpace('GCD-99', 'Tarea sin refinar', '## Ticket\n\ndescripción corta', { herdr: false })
    expect(fs.existsSync(space.contextFile)).toBe(true)
    expect(fs.readFileSync(space.contextFile, 'utf8')).toMatch(/task-refinement/)
    expect(readWorkSessions()).toHaveLength(0)
    expect(fs.existsSync(path.join(home, '.brain-log/workspaces.json'))).toBe(false)
  })

  it('rechaza un agente desconocido antes de escribir nada', () => {
    expect(() => openRefinementSpace('GCD-99', 'x', '', { agent: 'otro', herdr: false })).toThrow('Agente desconocido')
  })
})

describe('importación de worktrees existentes', () => {
  it('registra un worktree creado a mano sin agregar otra carpeta ni rama', () => {
    const manualPath = path.join(root, 'manual-worktree')
    git(repo, 'worktree', 'add', '-b', 'feat/GCD-42-foo', manualPath)
    const worktreesBefore = git(repo, 'worktree', 'list').split('\n').length
    const branchesBefore = git(repo, 'branch', '--list').split('\n').length

    const work = doImport('GCD-42', manualPath)

    expect(work.branch).toBe('feat/GCD-42-foo')
    expect(work.worktreePath).toBe(fs.realpathSync(manualPath))
    expect(readWorkSessions()).toHaveLength(1)
    expect(git(repo, 'worktree', 'list').split('\n').length).toBe(worktreesBefore)
    expect(git(repo, 'branch', '--list').split('\n').length).toBe(branchesBefore)
  })

  it('rechaza una ruta que no es worktree de este repositorio', () => {
    const ajena = fs.mkdtempSync(path.join(root, 'ajena-'))
    expect(() => doImport('GCD-1', ajena)).toThrow('no es un worktree')
  })

  it('rechaza el checkout principal del repo', () => {
    expect(() => doImport('GCD-1', repo)).toThrow('checkout principal')
  })

  it('rechaza un worktree ya registrado, aunque sea con otro taskId', () => {
    const manualPath = path.join(root, 'manual-worktree')
    git(repo, 'worktree', 'add', '-b', 'feat/GCD-42-foo', manualPath)
    doImport('GCD-42', manualPath)
    expect(() => doImport('GCD-43', manualPath)).toThrow('ya está registrada como GCD-42')
  })

  it('rechaza importar si la tarea ya tiene un worktree abierto en este repo', () => {
    open('GCD-1')
    const manualPath = path.join(root, 'manual-worktree')
    git(repo, 'worktree', 'add', '-b', 'otra-rama', manualPath)
    expect(() => doImport('GCD-1', manualPath)).toThrow('ya tiene un worktree abierto')
  })

  it('rechaza un worktree bloqueado en Git', () => {
    const manualPath = path.join(root, 'manual-worktree')
    git(repo, 'worktree', 'add', '-b', 'feat/GCD-42-foo', manualPath)
    git(repo, 'worktree', 'lock', manualPath)
    expect(() => doImport('GCD-42', manualPath)).toThrow('bloqueado')
  })
})
