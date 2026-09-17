// Sin consola en Windows en release. En macOS no aplica pero no estorba.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cache;
mod credentials;
mod env_file;
mod sidecar;
mod watcher;

use std::path::PathBuf;
use std::sync::Arc;

use tauri::{Manager, State};
use tokio::sync::Mutex;

use sidecar::{Sidecar, SourceError};

/// El sidecar se lanza perezosamente en la primera consulta, no al abrir la
/// ventana: el board debe pintar desde caché sin esperar a la red ni a Node.
///
/// Se guarda en un Mutex<Option<..>> y no en un OnceCell porque debe poder
/// reiniciarse: los secretos se inyectan en el entorno del proceso hijo al
/// lanzarlo, así que un token guardado después de arrancar no llegaría al
/// sidecar vivo. Al cambiar una credencial se descarta el proceso y el
/// siguiente uso lo relanza con el entorno nuevo.
struct AppState {
    sidecar: Arc<Mutex<Option<Arc<Sidecar>>>>,
    cache: Arc<Mutex<cache::Cache>>,
    node_bin: String,
    entry: PathBuf,
}

/// Marca de tiempo en milisegundos.
fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

impl AppState {
    /// Devuelve el sidecar vivo, lanzándolo si hace falta.
    ///
    /// El candado se suelta antes de usarlo para que las tres fuentes puedan
    /// consultarse en paralelo; si se mantuviera durante la llamada, Jira,
    /// vault y GitLab se serializarían.
    async fn sidecar(&self) -> Result<Arc<Sidecar>, SourceError> {
        let mut guard = self.sidecar.lock().await;
        if let Some(existing) = guard.as_ref() {
            return Ok(existing.clone());
        }

        let entry = self.entry.to_str().ok_or_else(|| {
            SourceError::new("unknown", "ruta del sidecar no representable en UTF-8")
        })?;
        if !self.entry.exists() {
            return Err(SourceError::new(
                "not_found",
                format!("no existe el bundle del sidecar en {entry}; corre `pnpm --filter @brain-log/board build:sidecar`"),
            ));
        }

        // Igual que en credential_status: leer el keychain puede bloquear
        // esperando al usuario, así que no se hace en un hilo del executor.
        let secrets = tokio::task::spawn_blocking(credentials::load_for_sidecar)
            .await
            .map_err(|e| SourceError::new("unknown", format!("fallo leyendo el keychain: {e}")))?;

        let spawned = Arc::new(Sidecar::spawn(&self.node_bin, entry, secrets).await?);
        *guard = Some(spawned.clone());
        Ok(spawned)
    }

    /// Descarta el sidecar actual. `Child` tiene `kill_on_drop`, así que el
    /// proceso muere en cuanto se suelta la última referencia.
    async fn reset_sidecar(&self) {
        *self.sidecar.lock().await = None;
    }
}

/// Resuelve el entry del sidecar.
///
/// En debug se lee del árbol del monorepo; en release, de los recursos del
/// bundle. Se permite forzarlo por entorno para depurar.
fn resolve_sidecar_entry(app: &tauri::App) -> PathBuf {
    if let Ok(explicit) = std::env::var("BOARD_SIDECAR_ENTRY") {
        return PathBuf::from(explicit);
    }
    if cfg!(debug_assertions) {
        // src-tauri/ -> apps/board/
        return PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .map(|p| p.join("sidecar/dist/index.js"))
            .unwrap_or_default();
    }
    app.path()
        .resolve("sidecar/index.js", tauri::path::BaseDirectory::Resource)
        .unwrap_or_default()
}

/// Columnas del tablero, en el mismo orden que usa el sidecar.
fn board_columns() -> Vec<String> {
    std::env::var("BOARD_COLUMNS")
        .unwrap_or_else(|_| {
            "TO DO,DOING,TESTING DEV,TESTING QA,TESTING PROD,DEPLOY TO PROD,HOLD".into()
        })
        .split(',')
        .map(|c| c.trim().to_string())
        .filter(|c| !c.is_empty())
        .collect()
}

/// Reagrupa issues por columna, que es la forma que espera el frontend.
fn group_board(issues: Vec<cache::CachedIssue>) -> serde_json::Value {
    let columns = board_columns();
    let mut grouped: std::collections::BTreeMap<String, Vec<&cache::CachedIssue>> =
        columns.iter().map(|c| (c.clone(), Vec::new())).collect();

    for issue in &issues {
        // Un issue en un estado que no está en COLUMNS no se pierde: se le
        // hace hueco. Descartarlo silenciosamente ocultaría trabajo real.
        grouped.entry(issue.status.clone()).or_default().push(issue);
    }

    let mut all_columns = columns.clone();
    for status in grouped.keys() {
        if !all_columns.contains(status) {
            all_columns.push(status.clone());
        }
    }

    serde_json::json!({
        "columns": all_columns,
        "counts": grouped.iter().map(|(k, v)| (k.clone(), v.len())).collect::<std::collections::BTreeMap<_, _>>(),
        "grouped": grouped.iter().map(|(k, v)| {
            (k.clone(), v.iter().map(|i| serde_json::json!({
                "id": i.key, "key": i.key, "title": i.title, "status": i.status,
                "priority": i.priority, "assignee": i.assignee, "provider": "jira",
                "url": i.url, "numericId": i.numeric_id,
            })).collect::<Vec<_>>())
        }).collect::<std::collections::BTreeMap<_, _>>(),
        "total": issues.len(),
    })
}

/// Lee el tablero de la caché. No toca la red: devuelve al instante lo último
/// sincronizado junto con su antigüedad, para que la ventana pinte sin esperar.
#[tauri::command]
async fn get_board(state: State<'_, AppState>) -> Result<serde_json::Value, SourceError> {
    let cache = state.cache.lock().await;
    let issues = cache.issues()?;
    let sync = cache.sync_state("jira")?;
    Ok(serde_json::json!({ "board": group_board(issues), "sync": sync }))
}

/// Lee la actividad de la caché. Tampoco toca la red.
#[tauri::command]
async fn get_activity(state: State<'_, AppState>) -> Result<serde_json::Value, SourceError> {
    let cache = state.cache.lock().await;
    let activity = cache.activity()?;
    let sync = cache.sync_state("gitlab")?;
    Ok(serde_json::json!({ "activity": activity, "sync": sync }))
}

/// Los todos no se cachean: viven en el vault, que es la fuente de verdad y
/// puede cambiar por fuera. Leer el disco es barato y siempre está actualizado.
#[tauri::command]
async fn get_todos(state: State<'_, AppState>) -> Result<serde_json::Value, SourceError> {
    state.sidecar().await?.call("todos.list", serde_json::json!({})).await
}

/// Marca o desmarca una casilla en el archivo Markdown del vault.
///
/// `file_hash` es el del archivo cuando se leyó: si no coincide, el sidecar
/// rechaza la escritura en vez de pisar una edición externa.
#[tauri::command]
async fn toggle_todo(
    state: State<'_, AppState>,
    file: String,
    line: u32,
    text: String,
    done: bool,
    file_hash: String,
) -> Result<serde_json::Value, SourceError> {
    state
        .sidecar()
        .await?
        .call(
            "todos.toggle",
            serde_json::json!({
                "file": file, "line": line, "text": text,
                "done": done, "fileHash": file_hash,
            }),
        )
        .await
}

/// Trae issues de Jira y los persiste. Devuelve el tablero ya actualizado.
#[tauri::command]
async fn sync_jira(state: State<'_, AppState>) -> Result<serde_json::Value, SourceError> {
    let fetched = state.sidecar().await?.call("board.get", serde_json::json!({})).await;

    match fetched {
        Ok(board) => {
            // El sidecar devuelve el tablero agrupado; se aplana para guardarlo.
            let mut issues: Vec<cache::CachedIssue> = Vec::new();
            if let Some(grouped) = board.get("grouped").and_then(|g| g.as_object()) {
                for list in grouped.values() {
                    if let Some(items) = list.as_array() {
                        for item in items {
                            issues.push(serde_json::from_value(item.clone()).map_err(|e| {
                                SourceError::new("unknown", format!("issue ilegible del sidecar: {e}"))
                            })?);
                        }
                    }
                }
            }
            let mut cache = state.cache.lock().await;
            cache.replace_issues(&issues, now_ms())?;
            cache.mark_synced("jira", now_ms())?;
            let sync = cache.sync_state("jira")?;
            Ok(serde_json::json!({ "board": group_board(cache.issues()?), "sync": sync }))
        }
        Err(err) => {
            // El fallo se registra pero los datos en caché se conservan.
            let cache = state.cache.lock().await;
            cache.mark_error("jira", &err.message)?;
            Err(err)
        }
    }
}

/// Trae actividad de GitLab y la persiste.
#[tauri::command]
async fn sync_gitlab(state: State<'_, AppState>) -> Result<serde_json::Value, SourceError> {
    let fetched = state.sidecar().await?.call("activity.list", serde_json::json!({})).await;

    match fetched {
        Ok(payload) => {
            let items: Vec<cache::CachedActivity> = payload
                .get("activity")
                .cloned()
                .map(serde_json::from_value)
                .transpose()
                .map_err(|e| SourceError::new("unknown", format!("actividad ilegible del sidecar: {e}")))?
                .unwrap_or_default();

            let mut cache = state.cache.lock().await;
            cache.replace_activity(&items)?;
            cache.mark_synced("gitlab", now_ms())?;
            let sync = cache.sync_state("gitlab")?;
            Ok(serde_json::json!({ "activity": cache.activity()?, "sync": sync }))
        }
        Err(err) => {
            let cache = state.cache.lock().await;
            cache.mark_error("gitlab", &err.message)?;
            Err(err)
        }
    }
}

/// Vacía la caché. Es desechable por diseño: tras esto una sincronización
/// completa restaura el mismo estado.
#[tauri::command]
async fn reset_cache(state: State<'_, AppState>) -> Result<(), SourceError> {
    state.cache.lock().await.reset()
}

#[tauri::command]
async fn health(state: State<'_, AppState>) -> Result<serde_json::Value, SourceError> {
    state.sidecar().await?.call("health", serde_json::json!({})).await
}

/// Leer del keychain puede abrir un diálogo del sistema y quedarse esperando a
/// que el usuario responda. Si eso ocurriera en el hilo principal, la ventana
/// entera se congelaría detrás del propio diálogo. Por eso todo acceso al
/// keychain va a `spawn_blocking`.
#[tauri::command]
async fn credential_status() -> Result<Vec<credentials::CredentialStatus>, SourceError> {
    tokio::task::spawn_blocking(credentials::status)
        .await
        .map_err(|e| SourceError::new("unknown", format!("fallo leyendo el keychain: {e}")))
}

/// Abre en el navegador la página donde se crea el token de una fuente.
///
/// Recibe el identificador de la fuente, no una URL: así el webview no puede
/// pedir que se abra un destino arbitrario, que sería una redirección abierta
/// con el navegador del usuario. Las URLs son fijas salvo el host de GitLab,
/// que puede ser una instancia propia.
#[tauri::command]
fn open_token_page(source: String) -> Result<(), SourceError> {
    let url = match source.as_str() {
        "gitlab" => {
            let base = std::env::var("GITLAB_URL")
                .unwrap_or_else(|_| "https://gitlab.com".into());
            // Sólo se acepta un host http(s); nada de file:// ni esquemas raros.
            if !base.starts_with("https://") && !base.starts_with("http://") {
                return Err(SourceError::new("unknown", "GITLAB_URL no es una URL http(s)"));
            }
            format!("{}/-/user_settings/personal_access_tokens", base.trim_end_matches('/'))
        }
        "jira" => "https://id.atlassian.com/manage-profile/security/api-tokens".to_string(),
        other => {
            return Err(SourceError::new("not_found", format!("fuente desconocida: {other}")))
        }
    };

    std::process::Command::new("open")
        .arg(&url)
        .spawn()
        .map(|_| ())
        .map_err(|e| SourceError::new("unknown", format!("no se pudo abrir el navegador: {e}")))
}

/// Guarda el token y relanza el sidecar para que lo tome.
///
/// Sin el reinicio, el proceso hijo seguiría con el entorno del arranque y el
/// token nuevo no surtiría efecto hasta cerrar la app.
#[tauri::command]
async fn set_credential(
    state: State<'_, AppState>,
    source: String,
    token: String,
) -> Result<(), SourceError> {
    tokio::task::spawn_blocking(move || credentials::set(&source, &token))
        .await
        .map_err(|e| SourceError::new("unknown", format!("fallo escribiendo en el keychain: {e}")))??;
    state.reset_sidecar().await;
    Ok(())
}

#[tauri::command]
async fn clear_credential(state: State<'_, AppState>, source: String) -> Result<(), SourceError> {
    tokio::task::spawn_blocking(move || credentials::clear(&source))
        .await
        .map_err(|e| SourceError::new("unknown", format!("fallo borrando del keychain: {e}")))??;
    state.reset_sidecar().await;
    Ok(())
}

/// Comprueba contra el proveedor que la credencial realmente sirve.
///
/// `credential_status` sólo dice si hay un token guardado. Eso no basta: un
/// token caducado está presente y no funciona, que es exactamente el estado en
/// que puede quedarse un `.env` durante semanas sin que nadie se entere.
#[tauri::command]
async fn verify_credential(
    state: State<'_, AppState>,
    source: String,
) -> Result<serde_json::Value, SourceError> {
    let method = match source.as_str() {
        "jira" => "jira.whoami",
        "gitlab" => "gitlab.whoami",
        other => {
            return Err(SourceError::new("not_found", format!("fuente desconocida: {other}")))
        }
    };
    state.sidecar().await?.call(method, serde_json::json!({})).await
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let entry = resolve_sidecar_entry(app);
            let db_path = app
                .path()
                .app_data_dir()
                .map(|dir| dir.join("cache.sqlite"))
                .unwrap_or_else(|_| PathBuf::from("cache.sqlite"));
            let cache = cache::Cache::open(&db_path)
                .map_err(|e| std::io::Error::other(e.message))?;

            app.manage(AppState {
                sidecar: Arc::new(Mutex::new(None)),
                cache: Arc::new(Mutex::new(cache)),
                node_bin: std::env::var("BOARD_NODE_BIN").unwrap_or_else(|_| "node".into()),
                entry,
            });

            // El vault puede cambiar por fuera; se observa para recargar.
            watcher::start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_board,
            get_todos,
            toggle_todo,
            get_activity,
            sync_jira,
            sync_gitlab,
            reset_cache,
            health,
            credential_status,
            open_token_page,
            set_credential,
            clear_credential,
            verify_credential,
        ])
        .run(tauri::generate_context!())
        .expect("error arrancando el board");
}
