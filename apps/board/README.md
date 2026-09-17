# @brain-log/board

Board de escritorio que reúne en una sola vista los issues de Jira, la actividad
de código y los todos del vault, agrupados por issue.

## Arquitectura

Tres procesos, con una regla: **el token nunca entra al webview.**

```
┌─────────────┐  invoke()   ┌──────────────┐   HTTP loopback   ┌──────────────────┐
│   webview   │ ──────────> │  Rust (Tauri)│ ────────────────> │ sidecar (Node)   │
│ React + TS  │ <────────── │   keychain   │ <──────────────── │ @brain-log/shared│
└─────────────┘  datos ya   └──────────────┘  puerto efímero   └──────────────────┘
                normalizados                  + token por lanzamiento      │
                                                                           ▼
                                                                    Jira / GitLab
```

- **Rust** es dueño del keychain y actúa de proxy. Lee los tokens, los inyecta en
  el entorno del sidecar al lanzarlo, y expone comandos de Tauri al webview.
- **El sidecar** corre `@brain-log/shared`, que es donde ya viven los clientes de
  Jira y GitLab del monorepo. No se reimplementaron en Rust.
- **El webview** sólo llama `invoke()`. No conoce URLs, ni esquemas de
  autenticación, ni la forma de respuesta de ningún proveedor.

El sidecar escucha sólo en `127.0.0.1` con un puerto efímero y exige un token
generado en cada lanzamiento, que sólo Rust conoce. El handshake viaja por stdout.

### Por qué un sidecar y no Rust puro

El design original pedía reimplementar Jira y el lector del vault en Rust. Eso
habría duplicado unas 900 líneas de TypeScript ya probado (`shared/src/jira.ts`,
`providers/notes/markdown.ts` con sus tests). Las dos razones reales de la
decisión —evitar CORS y que el token no viva en el contexto de JavaScript del
webview— se cumplen igual mientras la red salga de **fuera del webview**; no hace
falta que salga de Rust específicamente.

## Configuración

La app lee la misma configuración que el CLI, en `~/.brain-log/.env`:

| Variable | Uso | Dónde vive |
|---|---|---|
| `JIRA_HOST` | host de Jira Cloud | `.env` (no es secreto) |
| `JIRA_EMAIL` | identidad de la cuenta | `.env` (no es secreto) |
| `JIRA_API_TOKEN` | token | **keychain**, con fallback a `.env` |
| `GITLAB_URL` | instancia de GitLab | `.env` (no es secreto) |
| `GITLAB_TOKEN` | token | **keychain**, con fallback a `.env` |
| `BOARD_COLUMNS` | columnas del tablero | `.env`, opcional |

Los tokens en el keychain ganan sobre los del `.env`: `dotenv` es *first-wins*,
así que lo que Rust inyecta tiene precedencia. Eso permite migrar gradualmente
sin romper el CLI, que sigue leyendo el `.env`.

### Variables de depuración

| Variable | Uso |
|---|---|
| `BOARD_SIDECAR_ENTRY` | ruta alterna al bundle del sidecar |
| `BOARD_NODE_BIN` | binario de Node a usar (por defecto `node` del PATH) |

## Desarrollo

Desde la raíz del monorepo:

```bash
pnpm dev:board     # compila shared, compila el sidecar y abre la ventana
```

O por partes, desde `apps/board`:

```bash
pnpm build:sidecar   # tsc del sidecar -> sidecar/dist/index.js
pnpm dev:vite        # sólo el frontend en http://localhost:1420
pnpm typecheck       # frontend + sidecar
pnpm tauri dev       # ventana completa
```

El sidecar debe estar compilado antes de abrir la ventana; `pnpm dev` ya lo hace.

### Probar el sidecar sin la ventana

Útil para aislar si un fallo es de red, de credenciales o del puente:

```bash
export BOARD_SIDECAR_TOKEN=dev
node sidecar/dist/index.js &
# el handshake imprime el puerto:  BOARD_SIDECAR_READY {"port":58088}
curl -s -X POST http://127.0.0.1:58088/rpc \
  -H "Authorization: Bearer dev" -H 'content-type: application/json' \
  -d '{"method":"board.get"}' | jq
```

## Requisitos

- Rust 1.77+ y Xcode Command Line Tools
- Node 20 en el `PATH` (el sidecar corre sobre Node; aún no se empaqueta el
  runtime dentro del bundle)

## Caché local

SQLite en el directorio de datos de la app, vía `rusqlite` desde Rust. El
frontend nunca ve SQL: pide comandos tipados.

Es **desechable por diseño**. Borrar el archivo y resincronizar deja el sistema
en un estado equivalente, y hay una prueba que lo verifica
(`borrar_y_resincronizar_produce_el_mismo_estado`). Nada originado por el
usuario vive ahí.

Las lecturas (`get_board`, `get_activity`) sólo tocan la caché y responden al
instante; las sincronizaciones (`sync_jira`, `sync_gitlab`) van a la red y
después persisten. La ventana pinta primero desde la caché y sincroniza después,
nunca al revés.

La frescura sale de la tabla `sync_state`, no del reloj del frontend: así la
antigüedad sobrevive a cerrar la app, que es lo que hace falta para abrir sin
conexión y saber de cuándo son los datos. Un fallo de sincronización registra el
error pero **no** toca `last_synced_at`: los datos cacheados no envejecen porque
un intento posterior fallara.

Para inspeccionarla:

```bash
sqlite3 ~/Library/Application\ Support/com.brainlog.board/cache.sqlite \
  "SELECT source, last_synced_at, last_error FROM sync_state;"
```

## Todos: lectura, escritura y observación

Los todos **no** se cachean. Viven en el vault Markdown, que es la fuente de
verdad, y se leen del disco en cada consulta.

Al escribir se sustituye únicamente la `x` o el espacio dentro de los corchetes.
La indentación (el vault usa **tabs** en `Bugs.md` y en `dia/`), el texto, el
resto de la línea y el salto final quedan intactos byte a byte.

Antes de escribir se compara un hash del archivo con el que tenía al leerlo. Si
no coincide, **no se escribe nada**: alguien lo editó por fuera (Obsidian, el
CLI, un `git pull`) y pisarlo sería perder su cambio. La app avisa y recarga.

Rust observa el vault con `notify` y emite el evento `vault-changed`, que el
frontend usa para releer. Por eso un `git pull` o una edición en Obsidian se
reflejan sin reiniciar.

## Pruebas

```bash
pnpm test                       # sidecar: correlación y escritura de todos
cd src-tauri && cargo test      # Rust: caché y parseo del .env
```

Las que importan: preservación byte a byte con tabs, rechazo de escritura ante
divergencia, rechazo de rutas fuera del vault, y reconstruibilidad de la caché.

## El CLI no se toca

Esta app es otro cliente del mismo vault y de la misma configuración. El vault
Markdown sigue siendo la fuente de verdad de los todos; la caché local es
desechable y sólo guarda lo que vino de las APIs.

Ojo con las credenciales: un token guardado en el panel de Conexiones va al
keychain y **sólo lo usa el board**. El CLI y el cron de `deploy-check` siguen
leyendo `~/.brain-log/.env`. Si rotas un token, actualiza también ese archivo o
el cron se quedará con el viejo y fallará en silencio.
