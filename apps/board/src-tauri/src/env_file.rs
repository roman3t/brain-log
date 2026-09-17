//! Lectura de ~/.brain-log/.env, el archivo de configuración del CLI.
//!
//! Existe como módulo propio porque dos consumidores lo necesitan por motivos
//! distintos: `credentials` sólo quiere saber si hay un token (un booleano,
//! nunca el valor) y el observador del vault necesita el valor de
//! `MARKDOWN_VAULT_PATH`, que no es secreto. Tener un solo parser evita que
//! diverjan, que es justo lo que ya le pasó a este monorepo con la regex de
//! URL de MR, duplicada en cuatro sitios.

use std::path::PathBuf;

pub fn path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home).join(".brain-log").join(".env"))
}

fn contents() -> Option<String> {
    std::fs::read_to_string(path()?).ok()
}

/// Valor de una clave, o None si no está o está vacía.
///
/// Usar sólo para configuración no secreta. Los tokens se leen del keychain y
/// se inyectan en el sidecar sin pasar por aquí.
pub fn value(key: &str) -> Option<String> {
    value_in(&contents()?, key)
}

/// ¿Hay un valor no vacío para `key`? No devuelve el valor.
pub fn has(key: &str) -> bool {
    contents().is_some_and(|c| value_in(&c, key).is_some())
}

/// Separado de la lectura de disco para poder probar el parseo.
fn value_in(contents: &str, key: &str) -> Option<String> {
    contents.lines().find_map(|line| {
        let line = line.trim_start();
        if line.starts_with('#') {
            return None;
        }
        // Exigir el '=' justo después de la clave evita que GITLAB_TOKEN_OLD
        // cuente como GITLAB_TOKEN.
        let value = line.strip_prefix(key)?.strip_prefix('=')?.trim();
        if value.is_empty() {
            None
        } else {
            Some(value.to_string())
        }
    })
}

#[cfg(test)]
mod tests {
    use super::value_in;

    #[test]
    fn detecta_una_clave_con_valor() {
        assert_eq!(
            value_in("GITLAB_TOKEN=glpat-abc\n", "GITLAB_TOKEN").as_deref(),
            Some("glpat-abc")
        );
    }

    #[test]
    fn una_clave_vacia_cuenta_como_ausente() {
        assert!(value_in("GITLAB_TOKEN=\n", "GITLAB_TOKEN").is_none());
        assert!(value_in("GITLAB_TOKEN=   \n", "GITLAB_TOKEN").is_none());
    }

    #[test]
    fn ignora_lineas_comentadas() {
        assert!(value_in("# GITLAB_TOKEN=glpat-abc\n", "GITLAB_TOKEN").is_none());
        assert!(value_in("   #GITLAB_TOKEN=glpat-abc\n", "GITLAB_TOKEN").is_none());
    }

    #[test]
    fn no_confunde_claves_con_prefijo_comun() {
        assert!(value_in("GITLAB_TOKEN_OLD=viejo\n", "GITLAB_TOKEN").is_none());
        assert!(value_in("MI_GITLAB_TOKEN=x\n", "GITLAB_TOKEN").is_none());
    }

    #[test]
    fn encuentra_la_clave_entre_otras() {
        let env = "JIRA_HOST=x.atlassian.net\n\n# comentario\nJIRA_API_TOKEN=ATATT-abc\nPORT=3141\n";
        assert_eq!(value_in(env, "JIRA_API_TOKEN").as_deref(), Some("ATATT-abc"));
        assert!(value_in(env, "GITLAB_TOKEN").is_none());
    }

    #[test]
    fn lee_una_ruta_con_espacios() {
        assert_eq!(
            value_in("MARKDOWN_VAULT_PATH=/Users/r/mi vault\n", "MARKDOWN_VAULT_PATH").as_deref(),
            Some("/Users/r/mi vault")
        );
    }

    #[test]
    fn archivo_vacio_o_sin_la_clave() {
        assert!(value_in("", "GITLAB_TOKEN").is_none());
        assert!(value_in("OTRA=1\n", "GITLAB_TOKEN").is_none());
    }
}
