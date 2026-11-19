//! Konfiguration einer Prüfung, wie sie der Server schickt, und ihr Prüfwert.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Konfig {
    pub pruefung: String,
    #[serde(default)]
    pub rechner: bool,
    #[serde(default)]
    pub seiten: Vec<String>,
}

/// SHA-256 über das JSON mit alphabetisch sortierten Schlüsseln, ohne Leerzeichen (wie JSON.stringify auf dem Server).
/// Die Felder von `Konfig` sind alphabetisch deklariert; serde_json hält diese Reihenfolge ein.
pub fn konfig_wert(k: &Konfig) -> String {
    let mut seiten = k.seiten.clone();
    seiten.sort();
    let json = serde_json::to_string(&Konfig { pruefung: k.pruefung.clone(), rechner: k.rechner, seiten }).expect("Konfiguration als JSON");
    hex(&Sha256::digest(json.as_bytes()))
}

pub(crate) fn hex(b: &[u8]) -> String { b.iter().map(|x| format!("{x:02x}")).collect() }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn gleicher_wert_wie_der_server() {
        // Vergleichswert aus apps/api/src/lernumgebung.mjs (konfigWert)
        let k = Konfig { pruefung: "385896b3-5932-4627-9720-5d804c18bb1b".into(), rechner: true,
            seiten: vec!["https://www.geogebra.org/calculator".into(), "https://www.duden.de".into()] };
        assert_eq!(konfig_wert(&k), "088b09293d51b5e84af6c9bcd72858558b50b9293b415088cfd0dbcaef3ab411");
    }
}
