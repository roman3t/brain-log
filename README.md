# brain-log

Tu second brain personal: captura notas, to-dos, vibes y aprendizajes desde la terminal. Genera recaps diarios con Claude y los guarda en Notion.

## Setup

### 1. Variables de entorno

Copia `.env.example` a `.env` y llena los valores:

```bash
cp .env.example .env
```

```env
ANTHROPIC_API_KEY=sk-ant-...
NOTION_TOKEN=secret_...
NOTION_CAPTURES_DB=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
NOTION_RECAPS_DB=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
NOTION_DAILY_LOG_DB=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 2. Instalar dependencias y compilar

```bash
pnpm install
pnpm --filter @brain-log/shared build
cd packages/cli && pnpm build
```

### 3. Instalar el CLI globalmente

```bash
cd packages/cli
npm install -g .
```

### 4. Usar

```bash
brain note "arreglé el bug del cherry-pick en staging"
brain todo "revisar el schema de workorders"
brain vibe "prompt que usé para generar el wizard"
brain learn "aprendí sobre GraphQL mutations"
brain today        # ver capturas de hoy
brain recap        # generar recap del día con Claude → Notion
```

## Estructura

```
brain-log/
├── packages/
│   ├── shared/    → Clientes de Notion y Claude (lógica core)
│   └── cli/       → Comandos de terminal
├── apps/
│   └── api/       → API HTTP (Fase 2, para browser extension y móvil)
└── .env.example
```

## Roadmap

- [x] CLI: note, todo, vibe, learn, today, recap
- [ ] API HTTP para recibir capturas desde browser/móvil
- [ ] Chrome extension
- [ ] iOS Shortcut
