//! Arranque y proxy del sidecar de Node.
//!
//! El sidecar corre `@brain-log/shared`, que es donde ya viven los clientes de
//! Jira y GitLab. Este módulo lo lanza con los secretos en el entorno, descubre
//! su puerto por el handshake de stdout, y le reenvía las peticiones.
//!
//! El webview nunca ve el puerto ni el token del sidecar.

use std::collections::HashMap;
use std::process::Stdio;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};

/// Error que sí puede cruzar al frontend. Nunca contiene credenciales.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceError {
    pub kind: String,
    pub message: String,
}

impl SourceError {
    pub fn new(kind: &str, message: impl Into<String>) -> Self {
        Self { kind: kind.into(), message: message.into() }
    }
}

/// Respuesta del sidecar, en el mismo formato que devuelve su /rpc.
///
/// Se discrimina por el campo `ok` explícitamente y no con `#[serde(untagged)]`:
/// untagged elige variante por la *forma* del JSON, así que una respuesta
/// exitosa cuyo `data` fuera `null` se interpretaría como error, y un error sin
/// `error` se interpretaría como éxito. El flag es la fuente de verdad.
#[derive(Debug, Deserialize)]
struct RpcResponse {
    ok: bool,
    #[serde(default)]
    data: Option<serde_json::Value>,
    #[serde(default)]
    error: Option<SourceError>,
}

pub struct Sidecar {
    port: u16,
    token: String,
    http: reqwest::Client,
    // Se retiene para que el proceso hijo muera con la app en vez de quedar huérfano.
    _child: Child,
}

/// Token de un solo uso por lanzamiento. No se persiste ni se reutiliza.
fn generate_token() -> Result<String, SourceError> {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes)
        .map_err(|e| SourceError::new("unknown", format!("no se pudo generar el token: {e}")))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

impl Sidecar {
    /// Lanza el sidecar y espera su handshake.
    ///
    /// `secrets` son las credenciales leídas del keychain. Van por entorno, no
    /// por argumentos de línea de comandos, porque los argumentos son visibles
    /// para cualquier proceso vía `ps`.
    pub async fn spawn(
        node_bin: &str,
        entry: &str,
        secrets: HashMap<String, String>,
    ) -> Result<Self, SourceError> {
        let token = generate_token()?;

        let mut cmd = Command::new(node_bin);
        cmd.arg(entry)
            .env("BOARD_SIDECAR_TOKEN", &token)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true);

        for (key, value) in secrets {
            cmd.env(key, value);
        }

        let mut child = cmd.spawn().map_err(|e| {
            SourceError::new("unknown", format!("no se pudo lanzar el sidecar ({node_bin}): {e}"))
        })?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| SourceError::new("unknown", "el sidecar no expuso stdout"))?;

        // El handshake debe llegar rápido; si no, algo falló al importar shared.
        let port = tokio::time::timeout(Duration::from_secs(30), read_handshake(stdout))
            .await
            .map_err(|_| SourceError::new("unknown", "el sidecar no respondió el handshake a tiempo"))??;

        Ok(Self {
            port,
            token,
            http: reqwest::Client::new(),
            _child: child,
        })
    }

    /// Reenvía una llamada al sidecar y devuelve su resultado ya normalizado.
    pub async fn call(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, SourceError> {
        let response = self
            .http
            .post(format!("http://127.0.0.1:{}/rpc", self.port))
            .bearer_auth(&self.token)
            .json(&serde_json::json!({ "method": method, "params": params }))
            .timeout(Duration::from_secs(60))
            .send()
            .await
            .map_err(|e| {
                // reqwest incluye la URL en el Display del error, pero es loopback
                // sin credenciales, así que es seguro propagarla.
                if e.is_timeout() {
                    SourceError::new("offline", "el sidecar no respondió a tiempo")
                } else {
                    SourceError::new("unknown", format!("fallo hablando con el sidecar: {e}"))
                }
            })?;

        let parsed: RpcResponse = response
            .json()
            .await
            .map_err(|e| SourceError::new("unknown", format!("respuesta ilegible del sidecar: {e}")))?;

        if parsed.ok {
            parsed
                .data
                .ok_or_else(|| SourceError::new("unknown", "el sidecar respondió ok sin datos"))
        } else {
            Err(parsed.error.unwrap_or_else(|| {
                SourceError::new("unknown", "el sidecar reportó un fallo sin detalle")
            }))
        }
    }
}

/// Lee stdout hasta encontrar la línea `BOARD_SIDECAR_READY {json}`.
async fn read_handshake(stdout: tokio::process::ChildStdout) -> Result<u16, SourceError> {
    #[derive(Deserialize)]
    struct Handshake {
        port: u16,
    }

    let mut lines = BufReader::new(stdout).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if let Some(payload) = line.strip_prefix("BOARD_SIDECAR_READY ") {
            let handshake: Handshake = serde_json::from_str(payload).map_err(|e| {
                SourceError::new("unknown", format!("handshake del sidecar ilegible: {e}"))
            })?;
            return Ok(handshake.port);
        }
        // Cualquier otra línea es log del sidecar; se deja pasar a la consola.
        println!("{line}");
    }
    Err(SourceError::new("unknown", "el sidecar terminó antes del handshake"))
}
