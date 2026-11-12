const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const cli = path.resolve(__dirname, '../dist/index.js');
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'brain-cli-smoke-')));
const repo = path.join(root, 'repo');
const home = path.join(root, 'home');
fs.mkdirSync(repo); fs.mkdirSync(home);
const env = {
  PATH: process.env.PATH, HOME: home, NOTES_DEFAULT: 'markdown',
  MARKDOWN_VAULT_PATH: path.join(root, 'vault'), VAULT_CONTEXTS: 'work:company,personal:personal',
  VAULT_CONTEXT_DEFAULT: 'personal', BRAIN_WORKTREES_DIR: path.join(root, 'worktrees'),
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
};
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const brain = (cwd, ...args) => execFileSync(process.execPath, [cli, ...args], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
try {
  git('init', '-b', 'main'); git('config', 'user.name', 'Smoke'); git('config', 'user.email', 'smoke@example.test');
  fs.writeFileSync(path.join(repo, 'file.txt'), 'original\n');
  git('add', '.'); git('commit', '-m', 'initial');
  brain(repo, 'task', 'GLOBAL-99', '--new', 'global');
  brain(repo, 'work', 'GCD-1', '--personal', 'first', '--context', 'work', '--no-herdr');
  brain(repo, 'work', 'VAN-2', '--personal', 'second', '--context', 'personal', '--no-herdr');
  const sessions = () => JSON.parse(fs.readFileSync(path.join(home, '.brain-log/workspaces.json'), 'utf8')).sessions;
  const [a, b] = sessions();
  // Sin --repo, sin --personal y sin sesión previa: entra en refinamiento, no crea worktree ni sesión.
  const refineOut = brain(repo, 'work', 'GCD-99', '--no-herdr');
  assert.match(refineOut, /refinamiento/);
  assert.equal(sessions().length, 2);
  brain(a.worktreePath, 'note', 'first task note');
  brain(a.worktreePath, 'task', '--check', 'check first');
  brain(b.worktreePath, 'todo', 'second task note');
  brain(repo, 'work', 'GCD-1', '--no-herdr');
  assert.equal(sessions().length, 2);
  const list = brain(repo, 'work', 'list');
  assert.match(list, /GCD-1/); assert.match(list, /VAN-2/);
  const day = new Date().toISOString().slice(0, 10).replaceAll('-', '_');
  const first = fs.readFileSync(path.join(root, 'vault/company/journals', day + '.md'), 'utf8');
  const second = fs.readFileSync(path.join(root, 'vault/personal/journals', day + '.md'), 'utf8');
  assert.match(first, /first task note.*\[\[GCD-1\]\]/);
  assert.match(second, /second task note.*\[\[VAN-2\]\]/);
  assert.match(fs.readFileSync(path.join(root, 'vault/company/task-jira/GCD-1.md'), 'utf8'), /check first/);
  fs.writeFileSync(path.join(a.worktreePath, 'file.txt'), 'pending\n');
  const blocked = spawnSync(process.execPath, [cli, 'work', 'close', 'GCD-1', '--repo', repo], { cwd: repo, env, encoding: 'utf8' });
  assert.equal(blocked.status, 1); assert.ok(fs.existsSync(a.worktreePath));
  execFileSync('git', ['-C', a.worktreePath, 'restore', 'file.txt'], { env });
  brain(repo, 'work', 'close', 'GCD-1', '--check');
  assert.ok(fs.existsSync(a.worktreePath));
  brain(repo, 'work', 'close', 'GCD-1');
  assert.equal(fs.existsSync(a.worktreePath), false);
  assert.ok(fs.existsSync(b.worktreePath));
  assert.ok(sessions()[0].closedAt);
  assert.match(brain(repo, 'work', 'list', '--all'), /cerrado/);
  assert.ok(git('branch', '--list', a.branch));
  console.log('CLI smoke passed: create/resume/list, scoped notes and checklist, blocked dirty close, dry-run and safe removal.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
