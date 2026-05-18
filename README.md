# brain-log

Tu second brain personal. Captura notas, to-dos, vibes y aprendizajes desde la terminal o el browser. Los guarda en Notion, los vincula a tickets de Jira y genera recaps diarios con Claude.

---

## Requisitos

- Node.js 20+, pnpm
- Cuenta Notion con integración configurada
- Cuenta Jira (Atlassian)
- API key de Anthropic _(opcional, solo para `brain recap`)_

---

## Setup

### 1. Variables de entorno

```bash
cp .env.example .env
```

```env
# Notion
NOTION_TOKEN=secret_...
NOTION_CAPTURES_DB=<id>
NOTION_RECAPS_DB=<id>
NOTION_DAILY_LOG_DB=<id>
NOTION_TASKS_DB=<id>

# Jira
JIRA_HOST=tuempresa.atlassian.net
JIRA_EMAIL=tu@email.com
JIRA_API_TOKEN=<token>

# API
API_SECRET=brain-log-secret
PORT=3141

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

### 3. Crear tabla Tasks en Notion (primera vez)

```bash
# Crea una página en blanco en Notion, copia su ID de la URL y ejecuta:
brain task --setup <notion-page-id>
```

Copia el `NOTION_TASKS_DB` que te da y agrégalo al `.env`. Luego:

```bash
cp .env ~/.brain-log/.env
```

---

## CLI

### Capturas

```bash
brain note "arreglé el bug del cherry-pick"
brain todo "revisar el schema de workorders"
brain vibe "prompt que usé para generar el wizard"
brain learn "aprendí sobre GraphQL mutations"
```

Todas las capturas se etiquetan automáticamente con la tarea activa si hay una.

### Ver el día

```bash
brain today
```

### Recap diario

```bash
brain recap
# Genera resumen con Claude → Notion:
# Lo que hiciste / Lo que aprendiste / Sugerencias para mañana
```

### Gestión de tareas Jira

```bash
brain task GCD-1134            # activar tarea
brain task GCD-1134 --add      # activar + guardar en tabla Notion Tasks
brain task GCD-1134 --show     # ver descripción completa + comentarios
brain task GCD-1134 "nota"     # captura directa vinculada al ticket
brain task                     # ver tarea activa actual
brain task --clear             # limpiar tarea activa
brain task --sync              # sincronizar estados desde Jira
```

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

## Archivos importantes

```
~/.brain-log/
  .env          → credenciales (fuente de verdad para el CLI global)
  state.json    → tarea activa actual

brain-log/
  apps/api/         → API HTTP
  packages/
    cli/            → comandos de terminal
    shared/         → clientes Notion, Jira, Claude + estado
    extension/      → extensión Chrome
  .env              → credenciales del proyecto
```

---

## Flujo diario

```bash
# Mañana: activar la tarea del día
brain task GCD-1134 --add

# Durante el día
brain note "cambié el middleware de autenticación"
brain todo "escribir tests para el nuevo endpoint"
brain learn "los hooks de React se ejecutan en orden de definición"

# Al final del día
brain today         # revisar capturas
brain recap         # generar resumen con Claude → Notion
brain task --clear  # limpiar tarea activa
```

---

## Setup para compañeros de equipo

Ver sección [Setup para compañeros](#setup-compañeros) — solo necesitan Notion + Jira, sin `ANTHROPIC_API_KEY`.

### Setup compañeros

1. Clonar el repo e instalar:
```bash
pnpm install && pnpm --filter @brain-log/shared build
cd packages/cli && npm install -g .
```

2. Llenar el `.env` con solo:
```env
NOTION_TOKEN=secret_...
JIRA_HOST=tuempresa.atlassian.net
JIRA_EMAIL=tu@email.com
JIRA_API_TOKEN=<token>
NOTION_CAPTURES_DB=
NOTION_RECAPS_DB=
NOTION_DAILY_LOG_DB=
```

3. Crear tabla Tasks: `brain task --setup <notion-page-id>`

4. Agregar `NOTION_TASKS_DB` al `.env` y copiar: `cp .env ~/.brain-log/.env`

5. Levantar la API: `pnpm dev:api`

6. Instalar la extensión Chrome desde `packages/extension` con **Load unpacked**
