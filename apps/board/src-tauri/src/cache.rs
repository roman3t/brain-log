//! Caché local en SQLite.
//!
//! Es desechable por diseño: borrarla y resincronizar debe dejar el sistema en
//! un estado equivalente. Nada originado por el usuario vive aquí — los todos
//! están en el vault Markdown, que es la fuente de verdad y ya se versiona.
//!
//! Cada sincronización reemplaza por completo los datos de su fuente dentro de
//! una transacción, en vez de fusionarlos. Fusionar dejaría residuos: un issue
//! que sale del sprint seguiría en la caché para siempre, y entonces "borrar y
//! resincronizar" no daría el mismo resultado.

use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::sidecar::SourceError;

fn db_err(context: &str) -> impl Fn(rusqlite::Error) -> SourceError + '_ {
    move |e| SourceError::new("unknown", format!("{context}: {e}"))
}

/// Issue cacheado. `priority` no está en el esquema del diseño pero la tarjeta
/// lo muestra, así que se persiste en vez de re-pedirlo.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedIssue {
    pub key: String,
    pub title: String,
    pub status: String,
    pub priority: String,
    pub assignee: Option<String>,
    pub url: String,
    #[serde(rename = "numericId")]
    pub numeric_id: Option<String>,
}

/// Actividad cacheada. Se guarda repartida en branches / pull_requests /
/// commits según el esquema del diseño, y se recompone al leer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedActivity {
    pub kind: String,
    pub title: String,
    pub repo: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    /// Nullable sin excepciones: un nulo significa "no correlacionado".
    #[serde(rename = "issueKey")]
    pub issue_key: Option<String>,
    pub conflicts: Vec<String>,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

/// Frescura y último error por fuente.
#[derive(Debug, Clone, Serialize)]
pub struct SyncState {
    pub source: String,
    #[serde(rename = "lastSyncedAt")]
    pub last_synced_at: Option<i64>,
    #[serde(rename = "lastError")]
    pub last_error: Option<String>,
}

pub struct Cache {
    conn: Connection,
}

impl Cache {
    pub fn open(path: &Path) -> Result<Self, SourceError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                SourceError::new("unknown", format!("no se pudo crear el directorio de datos: {e}"))
            })?;
        }
        let conn = Connection::open(path).map_err(db_err("no se pudo abrir la caché"))?;
        let cache = Self { conn };
        cache.migrate()?;
        Ok(cache)
    }

    /// Caché en memoria, para pruebas.
    #[cfg(test)]
    pub fn in_memory() -> Result<Self, SourceError> {
        let conn = Connection::open_in_memory().map_err(db_err("memoria"))?;
        let cache = Self { conn };
        cache.migrate()?;
        Ok(cache)
    }

    fn migrate(&self) -> Result<(), SourceError> {
        self.conn
            .execute_batch(
                r#"
                PRAGMA journal_mode = WAL;
                PRAGMA foreign_keys = ON;

                CREATE TABLE IF NOT EXISTS issues (
                    key        TEXT PRIMARY KEY,
                    title      TEXT NOT NULL,
                    status     TEXT NOT NULL,
                    priority   TEXT NOT NULL DEFAULT '',
                    assignee   TEXT,
                    url        TEXT NOT NULL DEFAULT '',
                    numeric_id TEXT,
                    updated_at TEXT,
                    synced_at  INTEGER NOT NULL
                );

                -- issue_key es nullable en las tres tablas de actividad.
                -- Un nulo significa "no correlacionado" y se muestra como tal.
                CREATE TABLE IF NOT EXISTS branches (
                    id         TEXT PRIMARY KEY,
                    repo       TEXT NOT NULL,
                    name       TEXT NOT NULL,
                    issue_key  TEXT,
                    conflicts  TEXT NOT NULL DEFAULT '[]',
                    url        TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS pull_requests (
                    id         TEXT PRIMARY KEY,
                    repo       TEXT NOT NULL,
                    title      TEXT NOT NULL,
                    state      TEXT,
                    issue_key  TEXT,
                    conflicts  TEXT NOT NULL DEFAULT '[]',
                    url        TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS commits (
                    sha         TEXT PRIMARY KEY,
                    repo        TEXT NOT NULL,
                    message     TEXT NOT NULL,
                    issue_key   TEXT,
                    conflicts   TEXT NOT NULL DEFAULT '[]',
                    url         TEXT NOT NULL DEFAULT '',
                    authored_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS sync_state (
                    source         TEXT PRIMARY KEY,
                    last_synced_at INTEGER,
                    last_error     TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_branches_issue ON branches(issue_key);
                CREATE INDEX IF NOT EXISTS idx_prs_issue      ON pull_requests(issue_key);
                CREATE INDEX IF NOT EXISTS idx_commits_issue  ON commits(issue_key);
                "#,
            )
            .map_err(db_err("migración fallida"))
    }

    // ---- issues ----------------------------------------------------------

    /// Reemplaza todos los issues. Transaccional: o entra el lote entero o
    /// ninguno, para que un fallo a mitad no deje la caché en un estado que no
    /// corresponde a ninguna sincronización real.
    pub fn replace_issues(&mut self, issues: &[CachedIssue], now: i64) -> Result<(), SourceError> {
        let tx = self.conn.transaction().map_err(db_err("transacción"))?;
        tx.execute("DELETE FROM issues", []).map_err(db_err("limpiando issues"))?;
        {
            let mut stmt = tx
                .prepare(
                    "INSERT INTO issues (key, title, status, priority, assignee, url, numeric_id, synced_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                )
                .map_err(db_err("preparando insert de issues"))?;
            for issue in issues {
                stmt.execute(params![
                    issue.key,
                    issue.title,
                    issue.status,
                    issue.priority,
                    issue.assignee,
                    issue.url,
                    issue.numeric_id,
                    now,
                ])
                .map_err(db_err("insertando issue"))?;
            }
        }
        tx.commit().map_err(db_err("commit de issues"))
    }

    pub fn issues(&self) -> Result<Vec<CachedIssue>, SourceError> {
        let mut stmt = self
            .conn
            .prepare("SELECT key, title, status, priority, assignee, url, numeric_id FROM issues")
            .map_err(db_err("leyendo issues"))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(CachedIssue {
                    key: row.get(0)?,
                    title: row.get(1)?,
                    status: row.get(2)?,
                    priority: row.get(3)?,
                    assignee: row.get(4)?,
                    url: row.get(5)?,
                    numeric_id: row.get(6)?,
                })
            })
            .map_err(db_err("mapeando issues"))?;
        rows.collect::<Result<_, _>>().map_err(db_err("recogiendo issues"))
    }

    // ---- actividad -------------------------------------------------------

    /// Reemplaza toda la actividad, repartiéndola por tipo.
    pub fn replace_activity(&mut self, items: &[CachedActivity]) -> Result<(), SourceError> {
        let tx = self.conn.transaction().map_err(db_err("transacción"))?;
        for table in ["branches", "pull_requests", "commits"] {
            tx.execute(&format!("DELETE FROM {table}"), [])
                .map_err(db_err("limpiando actividad"))?;
        }
        {
            let mut branch = tx
                .prepare("INSERT OR REPLACE INTO branches (id, repo, name, issue_key, conflicts, url, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7)")
                .map_err(db_err("preparando ramas"))?;
            let mut pr = tx
                .prepare("INSERT OR REPLACE INTO pull_requests (id, repo, title, state, issue_key, conflicts, url, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)")
                .map_err(db_err("preparando PRs"))?;
            let mut commit = tx
                .prepare("INSERT OR REPLACE INTO commits (sha, repo, message, issue_key, conflicts, url, authored_at) VALUES (?1,?2,?3,?4,?5,?6,?7)")
                .map_err(db_err("preparando commits"))?;

            for item in items {
                let conflicts = serde_json::to_string(&item.conflicts).unwrap_or_else(|_| "[]".into());
                // La API no da un id estable para todo, así que se deriva de
                // la URL y, si falta, del repo + título. INSERT OR REPLACE
                // absorbe los duplicados que eso pueda producir.
                let id = if item.url.is_empty() {
                    format!("{}::{}", item.repo, item.title)
                } else {
                    item.url.clone()
                };
                match item.kind.as_str() {
                    "branch" => {
                        branch.execute(params![id, item.repo, item.title, item.issue_key, conflicts, item.url, item.updated_at])
                            .map_err(db_err("insertando rama"))?;
                    }
                    "merge_request" => {
                        pr.execute(params![id, item.repo, item.title, item.state, item.issue_key, conflicts, item.url, item.updated_at])
                            .map_err(db_err("insertando PR"))?;
                    }
                    "commit" => {
                        commit.execute(params![id, item.repo, item.title, item.issue_key, conflicts, item.url, item.updated_at])
                            .map_err(db_err("insertando commit"))?;
                    }
                    // Un tipo desconocido se descarta en vez de inventarle
                    // tabla; el esquema manda.
                    _ => {}
                }
            }
        }
        tx.commit().map_err(db_err("commit de actividad"))
    }

    pub fn activity(&self) -> Result<Vec<CachedActivity>, SourceError> {
        let mut out = Vec::new();

        let mut push = |sql: &str, kind: &str, has_state: bool| -> Result<(), SourceError> {
            let mut stmt = self.conn.prepare(sql).map_err(db_err("leyendo actividad"))?;
            let rows = stmt
                .query_map([], |row| {
                    let conflicts: String = row.get(4)?;
                    Ok(CachedActivity {
                        kind: kind.to_string(),
                        repo: row.get(0)?,
                        title: row.get(1)?,
                        issue_key: row.get(2)?,
                        state: if has_state { row.get(3)? } else { None },
                        conflicts: serde_json::from_str(&conflicts).unwrap_or_default(),
                        url: row.get(5)?,
                        updated_at: row.get(6)?,
                    })
                })
                .map_err(db_err("mapeando actividad"))?;
            for row in rows {
                out.push(row.map_err(db_err("recogiendo actividad"))?);
            }
            Ok(())
        };

        push("SELECT repo, title, issue_key, NULL, conflicts, url, updated_at FROM pull_requests", "merge_request", false)?;
        push("SELECT repo, name, issue_key, NULL, conflicts, url, updated_at FROM branches", "branch", false)?;
        push("SELECT repo, message, issue_key, NULL, conflicts, url, authored_at FROM commits", "commit", false)?;

        // El estado del MR se rellena aparte porque sólo esa tabla lo tiene.
        let mut stmt = self
            .conn
            .prepare("SELECT url, state FROM pull_requests WHERE state IS NOT NULL")
            .map_err(db_err("leyendo estados de PR"))?;
        let states: Vec<(String, String)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(db_err("mapeando estados"))?
            .collect::<Result<_, _>>()
            .map_err(db_err("recogiendo estados"))?;
        for (url, state) in states {
            for item in out.iter_mut().filter(|i| i.kind == "merge_request" && i.url == url) {
                item.state = Some(state.clone());
            }
        }

        // Más reciente primero, igual que sirve el sidecar.
        out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(out)
    }

    // ---- estado de sincronización ---------------------------------------

    pub fn mark_synced(&self, source: &str, at: i64) -> Result<(), SourceError> {
        self.conn
            .execute(
                "INSERT INTO sync_state (source, last_synced_at, last_error) VALUES (?1, ?2, NULL)
                 ON CONFLICT(source) DO UPDATE SET last_synced_at = ?2, last_error = NULL",
                params![source, at],
            )
            .map(|_| ())
            .map_err(db_err("guardando sincronización"))
    }

    /// Registra el fallo sin tocar `last_synced_at`: los datos ya en caché
    /// siguen siendo válidos y su antigüedad no cambia porque un intento
    /// posterior haya fallado.
    pub fn mark_error(&self, source: &str, error: &str) -> Result<(), SourceError> {
        self.conn
            .execute(
                "INSERT INTO sync_state (source, last_synced_at, last_error) VALUES (?1, NULL, ?2)
                 ON CONFLICT(source) DO UPDATE SET last_error = ?2",
                params![source, error],
            )
            .map(|_| ())
            .map_err(db_err("guardando error"))
    }

    pub fn sync_state(&self, source: &str) -> Result<SyncState, SourceError> {
        let found = self
            .conn
            .query_row(
                "SELECT last_synced_at, last_error FROM sync_state WHERE source = ?1",
                params![source],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(db_err("leyendo estado de sincronización"))?;

        let (last_synced_at, last_error) = found.unwrap_or((None, None));
        Ok(SyncState { source: source.to_string(), last_synced_at, last_error })
    }

    /// Vacía la caché conservando el esquema. Equivale a borrar el archivo,
    /// pero sin cerrar la conexión ni arriesgarse a dejarlo a medias.
    pub fn reset(&mut self) -> Result<(), SourceError> {
        let tx = self.conn.transaction().map_err(db_err("transacción"))?;
        for table in ["issues", "branches", "pull_requests", "commits", "sync_state"] {
            tx.execute(&format!("DELETE FROM {table}"), [])
                .map_err(db_err("vaciando caché"))?;
        }
        tx.commit().map_err(db_err("commit del vaciado"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn issue(key: &str) -> CachedIssue {
        CachedIssue {
            key: key.into(),
            title: format!("titulo de {key}"),
            status: "DOING".into(),
            priority: "High".into(),
            assignee: Some("Roman".into()),
            url: format!("https://j/{key}"),
            numeric_id: Some("1".into()),
        }
    }

    fn activity(kind: &str, key: Option<&str>, url: &str) -> CachedActivity {
        CachedActivity {
            kind: kind.into(),
            title: format!("{kind} de prueba"),
            repo: "g/p".into(),
            url: url.into(),
            state: if kind == "merge_request" { Some("opened".into()) } else { None },
            issue_key: key.map(String::from),
            conflicts: vec![],
            updated_at: "2026-09-15T10:00:00Z".into(),
        }
    }

    #[test]
    fn guarda_y_lee_issues() {
        let mut c = Cache::in_memory().unwrap();
        c.replace_issues(&[issue("GCD-1"), issue("GCD-2")], 100).unwrap();
        let read = c.issues().unwrap();
        assert_eq!(read.len(), 2);
        assert_eq!(read[0].priority, "High");
    }

    #[test]
    fn resincronizar_reemplaza_en_vez_de_acumular() {
        // Si fusionara, GCD-1 seguiría presente tras salir del sprint y
        // "borrar y resincronizar" no daría el mismo estado.
        let mut c = Cache::in_memory().unwrap();
        c.replace_issues(&[issue("GCD-1"), issue("GCD-2")], 100).unwrap();
        c.replace_issues(&[issue("GCD-2")], 200).unwrap();
        let read = c.issues().unwrap();
        assert_eq!(read.len(), 1);
        assert_eq!(read[0].key, "GCD-2");
    }

    #[test]
    fn issue_key_nulo_se_conserva_como_nulo() {
        let mut c = Cache::in_memory().unwrap();
        c.replace_activity(&[activity("branch", None, "u1")]).unwrap();
        let read = c.activity().unwrap();
        assert_eq!(read.len(), 1);
        assert!(read[0].issue_key.is_none(), "un nulo debe seguir siendo nulo, no cadena vacía");
    }

    #[test]
    fn reparte_actividad_por_tipo_y_la_recompone() {
        let mut c = Cache::in_memory().unwrap();
        c.replace_activity(&[
            activity("merge_request", Some("GCD-1"), "u1"),
            activity("branch", Some("GCD-1"), "u2"),
            activity("commit", None, "u3"),
        ])
        .unwrap();
        let read = c.activity().unwrap();
        assert_eq!(read.len(), 3);
        let mr = read.iter().find(|a| a.kind == "merge_request").unwrap();
        assert_eq!(mr.state.as_deref(), Some("opened"));
        assert!(read.iter().any(|a| a.kind == "branch"));
        assert!(read.iter().any(|a| a.kind == "commit"));
    }

    #[test]
    fn conserva_los_conflictos_de_correlacion() {
        let mut c = Cache::in_memory().unwrap();
        let mut item = activity("merge_request", Some("GCD-1378"), "u1");
        item.conflicts = vec!["GCD-1387".into()];
        c.replace_activity(&[item]).unwrap();
        assert_eq!(c.activity().unwrap()[0].conflicts, vec!["GCD-1387".to_string()]);
    }

    #[test]
    fn un_error_no_altera_la_antiguedad_de_los_datos() {
        let c = Cache::in_memory().unwrap();
        c.mark_synced("jira", 1000).unwrap();
        c.mark_error("jira", "sin conexión").unwrap();
        let state = c.sync_state("jira").unwrap();
        assert_eq!(state.last_synced_at, Some(1000), "los datos cacheados no envejecen por un fallo");
        assert_eq!(state.last_error.as_deref(), Some("sin conexión"));
    }

    #[test]
    fn una_sincronizacion_exitosa_limpia_el_error_previo() {
        let c = Cache::in_memory().unwrap();
        c.mark_error("gitlab", "401").unwrap();
        c.mark_synced("gitlab", 2000).unwrap();
        let state = c.sync_state("gitlab").unwrap();
        assert!(state.last_error.is_none());
        assert_eq!(state.last_synced_at, Some(2000));
    }

    #[test]
    fn fuente_sin_sincronizar_no_es_un_error() {
        let c = Cache::in_memory().unwrap();
        let state = c.sync_state("jira").unwrap();
        assert!(state.last_synced_at.is_none());
        assert!(state.last_error.is_none());
    }

    #[test]
    fn borrar_y_resincronizar_produce_el_mismo_estado() {
        // El requisito central: la caché es reconstruible.
        let mut c = Cache::in_memory().unwrap();
        c.replace_issues(&[issue("GCD-1")], 100).unwrap();
        c.replace_activity(&[activity("commit", Some("GCD-1"), "u1")]).unwrap();
        c.mark_synced("jira", 100).unwrap();
        let antes = (c.issues().unwrap().len(), c.activity().unwrap().len());

        c.reset().unwrap();
        assert_eq!(c.issues().unwrap().len(), 0);
        assert!(c.sync_state("jira").unwrap().last_synced_at.is_none());

        c.replace_issues(&[issue("GCD-1")], 100).unwrap();
        c.replace_activity(&[activity("commit", Some("GCD-1"), "u1")]).unwrap();
        c.mark_synced("jira", 100).unwrap();
        assert_eq!((c.issues().unwrap().len(), c.activity().unwrap().len()), antes);
    }
}
