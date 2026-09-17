//! Observador del vault.
//!
//! El vault es la fuente de verdad de los todos y cambia por fuera de la app:
//! Obsidian, el CLI `brain`, o un `git pull`. La app no puede asumir que es la
//! única escritora, así que observa el directorio y avisa al frontend para que
//! recargue.
//!
//! Vive en Rust y no en el sidecar porque desde aquí se puede emitir un evento
//! de Tauri directamente; el sidecar sólo sabe responder peticiones.

use std::path::PathBuf;
use std::time::Duration;

use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebounceEventResult};
use tauri::{AppHandle, Emitter};

/// Evento que escucha el frontend para recargar los todos.
pub const VAULT_CHANGED: &str = "vault-changed";

/// Los editores escriben en ráfagas (archivo temporal, rename, ajuste de
/// mtime) y `git pull` toca muchos archivos de golpe. Sin agrupar, una sola
/// edición dispararía varias recargas.
const DEBOUNCE: Duration = Duration::from_millis(400);

/// Rutas que cambian constantemente y no contienen todos.
fn is_noise(path: &std::path::Path) -> bool {
    path.components().any(|c| {
        matches!(
            c.as_os_str().to_str(),
            Some(".git") | Some(".obsidian") | Some(".trash") | Some("node_modules")
        )
    }) || path.extension().is_none_or(|ext| ext != "md")
}

/// Arranca el observador en un hilo propio.
///
/// Si no hay vault configurado simplemente no observa: el resto de la app
/// funciona igual, sólo que los todos se refrescan al sincronizar a mano.
pub fn start(app: AppHandle) {
    let Some(vault) = crate::env_file::value("MARKDOWN_VAULT_PATH").map(PathBuf::from) else {
        eprintln!("[board] MARKDOWN_VAULT_PATH no configurado; no se observa el vault");
        return;
    };

    if !vault.is_dir() {
        eprintln!("[board] el vault {} no existe; no se observa", vault.display());
        return;
    }

    std::thread::spawn(move || {
        // El debouncer se mueve al hilo y debe seguir vivo mientras observa;
        // si se soltara, el watcher se cerraría en silencio.
        let handler = move |result: DebounceEventResult| match result {
            Ok(events) => {
                let relevant: Vec<_> = events.iter().filter(|e| !is_noise(&e.path)).collect();
                if relevant.is_empty() {
                    return;
                }
                if let Err(err) = app.emit(VAULT_CHANGED, relevant.len()) {
                    eprintln!("[board] no se pudo emitir {VAULT_CHANGED}: {err}");
                }
            }
            Err(err) => eprintln!("[board] error observando el vault: {err}"),
        };

        let mut debouncer = match new_debouncer(DEBOUNCE, handler) {
            Ok(d) => d,
            Err(err) => {
                eprintln!("[board] no se pudo crear el observador: {err}");
                return;
            }
        };

        if let Err(err) = debouncer.watcher().watch(&vault, RecursiveMode::Recursive) {
            eprintln!("[board] no se pudo observar {}: {err}", vault.display());
            return;
        }

        println!("[board] observando {}", vault.display());
        // Bloquea el hilo indefinidamente para mantener vivo el debouncer.
        loop {
            std::thread::park();
        }
    });
}
