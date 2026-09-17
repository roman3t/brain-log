//! Credenciales en el keychain del sistema operativo.
//!
//! Sólo los tokens viven aquí. El host de Jira, el email y la URL de GitLab no
//! son secretos y siguen en ~/.brain-log/.env junto al resto de la configuración
//! del CLI.
//!
//! Regla que este módulo hace cumplir: ningún valor de token sale de aquí hacia
//! el frontend. `status()` devuelve un booleano y una identidad, nunca el token.
//! Los secretos sólo salen por `load_for_sidecar`, que los entrega al proceso
//! hijo por entorno.

use std::collections::HashMap;

use keyring::Entry;
use serde::{Deserialize, Serialize};

use crate::sidecar::SourceError;

const SERVICE: &str = "brain-log-board";

/// Fuente de datos que requiere credencial.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Jira,
    Gitlab,
}

impl Source {
    /// Clave dentro del keychain.
    fn account(self) -> &'static str {
        match self {
            Source::Jira => "jira_api_token",
            Source::Gitlab => "gitlab_token",
        }
    }

    /// Variable de entorno que espera @brain-log/shared.
    fn env_var(self) -> &'static str {
        match self {
            Source::Jira => "JIRA_API_TOKEN",
            Source::Gitlab => "GITLAB_TOKEN",
        }
    }

    fn parse(raw: &str) -> Option<Self> {
        match raw {
            "jira" => Some(Source::Jira),
            "gitlab" => Some(Source::Gitlab),
            _ => None,
        }
    }

    fn all() -> [Source; 2] {
        [Source::Jira, Source::Gitlab]
    }
}

/// De dónde sale la credencial que se está usando.
///
/// La distinción importa: un token en el keychain sólo sirve al board,
/// mientras que uno en ~/.brain-log/.env lo comparten el CLI y el cron de
/// deploy-check. Decir sólo "configurado" ocultaría que rotar el token en el
/// panel puede dejar al cron con el viejo.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Origin {
    Keychain,
    Env,
    None,
}

/// Lo que ve el frontend. Deliberadamente sin campo para el token.
#[derive(Debug, Clone, Serialize)]
pub struct CredentialStatus {
    pub source: String,
    pub configured: bool,
    pub origin: Origin,
    /// Identidad legible de la cuenta, p. ej. el email de Jira. Nunca el secreto.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account: Option<String>,
}

// El parseo del .env vive en `env_file`: lo comparten este módulo (que sólo
// quiere un booleano) y el observador del vault (que necesita una ruta).

fn entry(source: Source) -> Result<Entry, SourceError> {
    Entry::new(SERVICE, source.account())
        .map_err(|e| SourceError::new("unknown", format!("no se pudo abrir el keychain: {e}")))
}

pub fn set(source_raw: &str, token: &str) -> Result<(), SourceError> {
    let source = Source::parse(source_raw)
        .ok_or_else(|| SourceError::new("not_found", format!("fuente desconocida: {source_raw}")))?;
    if token.trim().is_empty() {
        return Err(SourceError::new("unknown", "el token está vacío"));
    }
    entry(source)?
        .set_password(token)
        // El error del keychain no incluye el valor, pero lo acotamos igual.
        .map_err(|e| SourceError::new("unknown", format!("no se pudo guardar en el keychain: {e}")))
}

pub fn clear(source_raw: &str) -> Result<(), SourceError> {
    let source = Source::parse(source_raw)
        .ok_or_else(|| SourceError::new("not_found", format!("fuente desconocida: {source_raw}")))?;
    match entry(source)?.delete_credential() {
        Ok(()) => Ok(()),
        // Borrar algo que no existe es el estado deseado, no un error.
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(SourceError::new("unknown", format!("no se pudo borrar del keychain: {e}"))),
    }
}

/// Estado de cada integración, sin exponer secretos.
pub fn status() -> Vec<CredentialStatus> {
    Source::all()
        .iter()
        .map(|&source| {
            let in_keychain = entry(source)
                .and_then(|e| match e.get_password() {
                    Ok(_) => Ok(true),
                    Err(keyring::Error::NoEntry) => Ok(false),
                    Err(err) => Err(SourceError::new("unknown", err.to_string())),
                })
                // Un keychain ilegible se reporta como "no configurado" en vez de
                // romper la pantalla de ajustes.
                .unwrap_or(false);

            // El keychain gana sobre el .env, igual que en load_for_sidecar:
            // lo que Rust inyecta tiene precedencia sobre dotenv (first-wins).
            let origin = if in_keychain {
                Origin::Keychain
            } else if crate::env_file::has(source.env_var())
                || std::env::var(source.env_var()).is_ok_and(|v| !v.is_empty())
            {
                Origin::Env
            } else {
                Origin::None
            };

            CredentialStatus {
                source: match source {
                    Source::Jira => "jira".into(),
                    Source::Gitlab => "gitlab".into(),
                },
                configured: origin != Origin::None,
                origin,
                account: match source {
                    Source::Jira => std::env::var("JIRA_EMAIL").ok().filter(|v| !v.is_empty()),
                    Source::Gitlab => None,
                },
            }
        })
        .collect()
}

/// Secretos a inyectar en el entorno del sidecar.
///
/// Lo que no esté en el keychain se omite; el sidecar lo resolverá por dotenv
/// desde ~/.brain-log/.env, que es first-wins y por tanto cede ante lo que
/// inyectamos aquí.
pub fn load_for_sidecar() -> HashMap<String, String> {
    let mut secrets = HashMap::new();
    for source in Source::all() {
        if let Ok(e) = entry(source) {
            if let Ok(token) = e.get_password() {
                secrets.insert(source.env_var().to_string(), token);
            }
        }
    }
    secrets
}
