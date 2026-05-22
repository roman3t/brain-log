# brain-log

Tu second brain personal. Captura notas, to-dos, vibes y aprendizajes desde la terminal o el browser. Los guarda en archivos Markdown compatibles con Obsidian/Logseq (con sync opcional a Notion), los vincula a tickets de Jira y genera recaps diarios con Claude. Monitorea el estado de tus MRs y pipelines de GitLab con notificaciones nativas.

---

## Requisitos

- Node.js 20+, pnpm
- Cuenta Jira (Atlassian)
- Vault local de Markdown (cualquier carpeta — Obsidian, Logseq, o carpeta vacía)
- Cuenta Notion con integración configurada _(opcional, para sync en segundo plano)_
- Cuenta GitLab con Personal Access Token _(opcional, para monitoreo de pipelines)_
- API key de Anthropic _(opcional, solo para `brain recap`)_

---

## Setup

### 1. Variables de entorno

```bash
cp .env.example .env
```

```env
# Jira
JIRA_HOST=tuempresa.atlassian.net
JIRA_EMAIL=tu@email.com
JIRA_API_TOKEN=<token>

# Notes provider (markdown por defecto)
NOTES_DEFAULT=markdown                         # markdown | notion
MARKDOWN_VAULT_PATH=/Users/tu-usuario/brain-vault
VAULT_CONTEXT_DEFAULT=g-global
VAULT_CONTEXTS=g-global:ret/work/g-global,vaneco:ret/projects/vaneco,learning:ret/learning,personal:ret/personal

# Notion (opcional — sync en segundo plano cuando NOTES_DEFAULT=markdown)
NOTION_TOKEN=secret_...
NOTION_CAPTURES_DB=<id>
NOTION_RECAPS_DB=<id>
NOTION_DAILY_LOG_DB=<id>
NOTION_TASKS_DB=<id>

# API
API_SECRET=brain-log-secret
PORT=3141

# GitLab (opcional, para monitoreo de pipelines y MRs)
GITLAB_URL=https://gitlab.com
GITLAB_TOKEN=glpat-...

# Claude (opcional, solo para brain recap)
ANTHROPIC_API_KEY=sk-ant-...
```

> API token de Jira: `https://id.atlassian.com/manage-profile/security/api-tokens`

### 2. Instalar dependencias y compilar

```bash
pnpm install
pnpm --filter @brain-log/shared build
cd packages/cli && npm install -g .
```

### 3. Copiar credenciales al directorio de usuario

```bash
cp .env ~/.brain-log/.env
```

### 4. Crear tabla Tasks en Notion (opcional)

Si quieres usar Notion para gestionar tasks:

```bash
# Crea una página en blanco en Notion, copia su ID de la URL y ejecuta:
brain task --setup <notion-page-id>
```

Copia el `NOTION_TASKS_DB` que te da y agrégalo a `~/.brain-log/.env`.

---

## CLI

### Capturas

```bash
brain note "arreglé el bug del cherry-pick"
brain todo "revisar el schema de workorders"
brain vibe "prompt que usé para generar el wizard"
brain learn "aprendí sobre GraphQL mutations"
```

Todas las capturas se etiquetan automáticamente con la tarea activa si hay una. Puedes sobreescribir el task con `--task`:

```bash
brain note "arreglé el bug del auth" --task GCD-1199
```

### Notes provider

Por defecto las capturas se escriben en archivos `.md` dentro de tu vault local, en formato compatible con Obsidian/Logseq:

```
~/brain-vault/
  journals/
    2026_05_21.md    ← capturas del día
  recaps/
    2026_05_21.md    ← recap generado con Claude
```

Formato de cada captura:
```markdown
## 2026-05-21
- 📝 cambié el middleware de autenticación #note [[GCD-1134]]
- ☑️ escribir tests del nuevo endpoint #todo
- 🧠 los hooks de React se ejecutan en orden de definición #learn
```

Si tienes `NOTION_TOKEN` configurado, cada captura también se sincroniza a Notion en segundo plano (no bloquea).

Para usar Notion como provider principal (comportamiento anterior):
```env
NOTES_DEFAULT=notion
```

#### Sincronización

Después de cada captura, brain-log hace `git commit + push` del vault en segundo plano (si el vault tiene remoto configurado) y sincroniza a Notion en segundo plano (si `NOTION_TOKEN` está presente). Ambos son silenciosos y no bloquean.

```bash
brain sync                        # sincroniza capturas de hoy a Notion
brain sync --date 2026-05-20      # día específico a Notion
brain sync --notion               # forzar push a Notion (aunque Markdown sea el default)
brain sync --git                  # forzar git add + commit + push del vault
brain sync --status               # listar journals en el vault local
```

Para activar el sync automático entre máquinas, el vault debe ser un repo git:

```bash
cd ~/brain-vault
git init
git remote add origin git@github.com:tu-usuario/brain-vault.git
git add . && git commit -m "init" && git push -u origin main
```

### Contextos del vault

El vault se organiza en contextos: trabajo, proyectos personales, estudio, vida personal. Cada contexto tiene sus propias carpetas de journals, tasks y recaps.

```bash
brain context                  # ver contexto activo
brain context --list           # listar todos los contextos
brain context work             # cambiar a trabajo
brain context project-x        # cambiar a un proyecto personal
brain context learning         # cambiar a estudio
```

Los contextos se configuran en `.env`:

```env
VAULT_CONTEXT_DEFAULT=work
VAULT_CONTEXTS=work:work/my-company,project-x:projects/project-x,learning:learning,personal:personal
```

Al cambiar de contexto, todas las capturas, tasks y recaps van a la carpeta correspondiente:

```
~/brain-vault/
  work/my-company/{journals,tasks,recaps}    ← contexto work
  projects/project-x/{journals,tasks,recaps} ← contexto project-x
  learning/{journals,tasks,recaps}            ← contexto learning
  personal/{journals,tasks,recaps}            ← contexto personal
```

### Ver el día

```bash
brain today   # muestra capturas del día del contexto activo
```

### Recap diario

```bash
brain recap
# Genera resumen con Claude → guarda en vault (+ Notion si está configurado):
# Lo que hiciste / Lo que aprendiste / Sugerencias para mañana
```

### Gestión de tareas

```bash
brain task GCD-1134                        # activar tarea (Jira) → crea GCD-1134.md en vault
brain task GCD-1134 --add                  # activar + guardar en tabla Notion Tasks
brain task GCD-1134 --show                 # ver descripción completa + comentarios
brain task GCD-1134 --status               # ver PRs y deploys del ticket
brain task GCD-1134 "nota"                 # captura directa vinculada al ticket
brain task                                 # ver tareas activas actuales
brain task --active                        # listar todas las tareas activas
brain task --clear GCD-1134               # limpiar una tarea específica
brain task --clear-all                     # limpiar todas las tareas activas
brain task --sync                          # sincronizar estados desde Jira

# Tareas personales (sin Jira)
brain task VAN-01 --new "revisar cotización de mármol"
```

Puedes tener **múltiples tareas activas** simultáneamente. Cada captura se vincula automáticamente a todas las activas, o puedes especificar una con `--task GCD-XXX`.

Al activar una tarea se crea automáticamente su página `.md` en el vault (`tasks/GCD-1154.md`).

#### Checklist y log por ticket

Cada ticket tiene su propia página en el vault con checklist personal e historial de notas, independiente de Jira:

```bash
brain task GCD-1134 --checklist            # ver subtareas del ticket
brain task GCD-1134 --check "texto"        # agregar subtarea
brain task --check "texto"                 # agregar a la tarea activa
brain task GCD-1134 --done "texto parcial" # marcar subtarea como completada
brain task GCD-1134 --log "nota"           # agrega entrada al log (vault + Notion)
brain task --log "nota"                    # igual, usando la tarea activa
```

Formato del archivo en el vault:

```markdown
# GCD-1154 — Buscar por PO - Cambios_1

**Status:** DOING
**URL:** https://g-global.atlassian.net/browse/GCD-1154

## Checklist
- [x] actualizar el schema de MongoDB
- [ ] escribir tests del componente SearchByPO
- [ ] hacer PR a dev

## Log
- **2026-05-22 10:30** — el filtro por PO necesita índice compuesto en MongoDB
```

Los checkboxes son compatibles con Obsidian y Logseq — puedes marcarlos directamente desde el editor y brain-log los leerá correctamente.

### Tablero

```bash
brain pm --board                 # tablero del sprint usando el provider configurado
brain pm --board --provider jira # fuerza un provider específico
brain pm --todo                  # picker interactivo de tickets en TO DO

# Alias directo para Jira:
brain jira --board          # tablero del sprint activo (tus tickets)
brain jira --board --all    # tablero completo (todo el equipo)
brain jira --todo
```

`--board` muestra las columnas activas del sprint (TO DO, DOING, TESTING DEV, TESTING QA, TESTING PROD, DEPLOY TO PROD) con prioridad y labels.

`--todo` permite seleccionar un ticket con flechas y desde el menú:
- **Asignarme + mover a DOING + activar tarea** — combo completo para empezar a trabajar
- **Solo asignarme / Mover a columna... / Solo activar**
- **Ver detalles** — muestra descripción y últimos comentarios y vuelve al menú

### Automatización de deploy

El CLI incluye un comando que mueve tickets automáticamente según el estado de los PRs en GitLab:

```bash
brain deploy-check
```

Revisa todos los tickets asignados en el sprint activo y aplica transiciones según reglas `branch:Transición`:

| PR mergeado a | Transición aplicada |
|---|---|
| `dev` | Testing Dev |
| `qa` | Testing QA |

Configurable via `.env`:
```env
JIRA_DEPLOY_RULES=dev:Testing Dev,qa:Testing QA,main:Done
```

#### Lógica de regresión

Si alguien mueve un ticket hacia atrás (ej. de TESTING QA a DOING), `deploy-check` lo detecta y lo salta notificando. Pero si después subes un fix y mergeas un PR **después** de esa regresión, el siguiente ciclo lo detecta automáticamente y retoma el flujo normal.

```
10:00  ticket regresado a DOING  → notifica, salta
11:00  PR mergeado a dev         → PR.lastUpdated > movedAt → procesa normalmente
```

#### Cron automático (macOS)

Para que corra cada 5 minutos en segundo plano sin mantener la terminal abierta:

```bash
# Verificar que está activo:
launchctl list | grep brain-log

# Activar:
launchctl load ~/Library/LaunchAgents/com.brain-log.deploy-watch.plist

# Desactivar:
launchctl unload ~/Library/LaunchAgents/com.brain-log.deploy-watch.plist

# Ver log:
tail -f ~/.brain-log/deploy-watch.log
```

> **Requisito:** los MRs de deploy deben incluir el issue key en el título para que Jira los linkee automáticamente.
> Ejemplo: `deploy to qa: GCD-1149, GCD-1152`

### Monitoreo de MRs y pipelines de GitLab

Jira puede tardar hasta 1h en indexar un merge. Para recibir notificaciones en tiempo real:

```bash
brain mr-watch "https://gitlab.com/grupo/proyecto/-/merge_requests/123"
```

Registra el MR para monitoreo. A partir de ahí, el cron de cada 5 minutos notifica via macOS cuando:

| Evento | Notificación |
|---|---|
| Pipeline pasa | brain-log ✅ Pipeline pasó — listo para mergear |
| Pipeline falla | brain-log ❌ Pipeline falló |
| MR mergeado | brain-log 🎉 MR mergeado a dev |

El MR se elimina de la lista watched automáticamente al mergearse.

El menubar también muestra el estado del pipeline debajo de cada MR de la tarea activa, incluyendo el pipeline post-merge en la branch destino (ej. `pipeline running… en dev`). Los puntos son clickeables para abrir el pipeline en GitLab.

---

## API

Levantar: `pnpm dev:api` → `http://localhost:3141`

Todos los endpoints requieren el header `x-api-key: brain-log-secret`.

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/health` | Estado de la API |
| `POST` | `/capture` | Guarda una captura. Body: `{ type, raw, source? }` |
| `GET` | `/today` | Capturas del día |
| `POST` | `/recap` | Genera recap con Claude y guarda en Notion |
| `POST` | `/task` | Agrega ticket Jira a Notion Tasks. Body: `{ issueKey }` |

---

## Extensión Chrome

### Instalar
1. Ve a `chrome://extensions` → activa **Developer mode**
2. Click **Load unpacked** → selecciona la carpeta `packages/extension`

### Configurar
1. Click en el ícono 🧠 → pestaña **Config**
2. **API URL**: `http://localhost:3141`
3. **API Secret**: `brain-log-secret`
4. Guardar → punto verde = conectado ✓

### Funcionalidades
- **Capturar**: escribe cualquier nota desde el popup y elige tipo
- **Texto seleccionado**: selecciona texto en cualquier página → el popup lo precarga
- **Click derecho**: selecciona texto → *brain-log: capturar selección*
- **Jira detectado**: al abrir el popup en un ticket Jira aparece un banner con **+ Agregar a Tasks en Notion**

---

## Integración con Claude Code

Si usas [Claude Code](https://claude.ai/code), puedes integrar brain-log para que Claude tenga siempre el contexto de tu tarea activa y entienda comandos en lenguaje natural.

### 1. Crear `~/.claude/CLAUDE.md`

```bash
touch ~/.claude/CLAUDE.md
```

Agrega este contenido:

```markdown
# Contexto personal

## brain-log (second brain)

Al inicio de cada conversación, lee el estado activo:
\`\`\`
~/.brain-log/state.json
\`\`\`

Si hay `activeTask`, tenla presente: todas las capturas del CLI se vinculan a ese ticket Jira.

### Comandos disponibles (CLI global `brain`)

| Intención del usuario | Comando a ejecutar |
|---|---|
| "activa tarea GCD-XXX" / "brain task GCD-XXX" | `brain task GCD-XXX --show` |
| "agrega GCD-XXX a brain" | `brain task GCD-XXX --add` |
| "guarda nota en brain" | `brain note "texto"` |
| "agrega todo en brain" | `brain todo "texto"` |
| "guarda vibe / prompt en brain" | `brain vibe "texto"` |
| "aprendí / guarda aprendizaje" | `brain learn "texto"` |
| "qué hice hoy / capturas de hoy" | `brain today` |
| "genera recap / resumen del día" | `brain recap` |
| "tarea activa" | `brain task` |
| "limpia tarea" | `brain task --clear` |
| "sync tareas" | `brain task --sync` |
| "detalle del ticket GCD-XXX" | `brain task GCD-XXX --show` |

### Al activar una tarea
Cuando el usuario activa una tarea, ejecuta `brain task GCD-XXX --show` para obtener descripción completa y comentarios. Mantén ese contexto durante la conversación.
```

### 2. Agregar permisos en `~/.claude/settings.json`

Para que Claude ejecute los comandos sin pedir confirmación en cada llamada:

```json
{
  "permissions": {
    "allow": [
      "Bash(brain *)",
      "Read(/Users/TU_USUARIO/.brain-log/*)"
    ]
  }
}
```

### 3. Uso

En cualquier conversación con Claude Code puedes decir:

```
brain: estaremos trabajando con la task GCD-1134
agrega a BRAIN la tarea GCD-1134
guarda nota en brain: resolví el bug del cherry-pick
```

Claude leerá el estado activo, traerá el contexto del ticket desde Jira y etiquetará tus capturas automáticamente.

---

## Menubar (macOS)

App nativa en el menubar que muestra el estado del sprint en tiempo real.

```bash
cd apps/menubar
npm run build
npx electron .        # lanzar
npm run stop          # cerrar todas las instancias
```

### Qué muestra

- **Tarea activa** — key, status en Jira, PRs vinculados (MERGED/OPEN) con **estado del pipeline de GitLab** en tiempo real (punto pulsante amarillo = running, verde = passed, rojo = failed). Para MRs mergeados muestra el pipeline post-merge en la branch destino.
- **Sprint — mis tickets** — columnas con conteo y barra proporcional; click para expandir issues
- **Últimos eventos** — log del cron de deploy-check
- **Botón Avanzar** — mueve la tarea activa al siguiente estado del pipeline directamente desde el menubar
- **Ejecutar deploy-check** — corre el check manualmente (no bloquea la UI)

---

## Tests

Los tests cubren la lógica crítica del notes provider (escritura de `.md`, parser, factory, git sync).

```bash
# Correr todos los tests una vez
cd packages/shared && pnpm test

# Modo watch — re-ejecuta al guardar cualquier archivo
cd packages/shared && pnpm test:watch

# Desde la raíz del repo
pnpm --filter @brain-log/shared test
```

Output esperado:

```
✓ src/__tests__/markdown.test.ts        (5 tests)
✓ src/__tests__/captures-parser.test.ts (5 tests)
✓ src/__tests__/notes-factory.test.ts   (3 tests)
✓ src/__tests__/git-sync.test.ts        (3 tests)

Test Files  4 passed (4)
Tests      16 passed (16)
```

---

## Archivos importantes

```
~/.brain-log/
  .env                  → credenciales (fuente de verdad para el CLI global)
  state.json            → tareas activas (múltiples) + watched MRs
  deploy-watch.log      → log del cron de deploy-check y mr-check
  .mr-states.json       → estados de pipeline por MR (evita notificaciones duplicadas)

~/brain-vault/          → vault Markdown (MARKDOWN_VAULT_PATH)
  journals/
    YYYY_MM_DD.md       → capturas del día
  recaps/
    YYYY_MM_DD.md       → recap diario generado con Claude

brain-log/
  apps/
    api/                → API HTTP
    menubar/            → app macOS menubar (Electron)
  packages/
    cli/                → comandos de terminal
    shared/             → providers (notes/pm/git), Jira, Claude + estado
    extension/          → extensión Chrome
  .env                  → credenciales del proyecto
```

---

## Flujo diario

```bash
# Mañana: ver qué hay disponible y tomar una tarea
brain pm --board                # revisar el sprint
brain jira --todo               # tomar un ticket de TO DO (asignar + mover + activar)

# Activar tareas (puedes tener varias simultáneas)
brain task GCD-1134             # activa tarea principal
brain task GCD-1199             # activa segunda tarea
brain task --active             # ver todas las activas

# Durante el día — capturas se vinculan a todas las tareas activas
brain note "cambié el middleware de autenticación"
brain todo "escribir tests para el nuevo endpoint"
brain learn "los hooks de React se ejecutan en orden de definición"
brain note "fix específico del auth" --task GCD-1199   # vincular a una sola tarea
brain task GCD-1134 --status    # ver si el PR ya fue mergeado

# Al abrir un MR, registrarlo para monitoreo en tiempo real:
brain mr-watch "https://gitlab.com/grupo/proyecto/-/merge_requests/XXX"
# → notificaciones macOS cuando pipeline pasa/falla y cuando se mergea

# Al hacer un MR de deploy, incluir el issue key en el título:
# "deploy to qa: GCD-1134" → Jira lo linkea y el cron mueve el ticket automáticamente

# Al final del día
brain today                     # revisar capturas del vault local
brain recap                     # generar resumen con Claude → vault + Notion en background
brain sync --git                # forzar push del vault a git (si no es automático)
brain task --clear-all          # limpiar todas las tareas activas
```

---

## Setup para compañeros de equipo

Solo necesitan Jira + una carpeta local para el vault. Notion es completamente opcional.

### Setup compañeros

1. Clonar el repo e instalar:
```bash
pnpm install && pnpm --filter @brain-log/shared build
cd packages/cli && npm install -g .
```

2. Llenar `~/.brain-log/.env` con lo mínimo:
```env
JIRA_HOST=tuempresa.atlassian.net
JIRA_EMAIL=tu@email.com
JIRA_API_TOKEN=<token>

NOTES_DEFAULT=markdown
MARKDOWN_VAULT_PATH=/Users/tu-usuario/brain-vault
```

3. _(Opcional)_ Para Tasks en Notion: crear una página en blanco en Notion, copiar su ID de la URL y ejecutar:
```bash
brain task --setup <notion-page-id>
```
Agregar `NOTION_TASKS_DB` al `.env`.

4. Levantar la API (solo si se usa la extensión Chrome): `pnpm dev:api`

5. _(Opcional)_ Instalar la extensión Chrome desde `packages/extension` con **Load unpacked**
