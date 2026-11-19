//! Kern der trimez. Lernumgebung. Ohne Abhängigkeit vom Betriebssystem, darum auf jedem Rechner testbar.
//! Die Berechnungen müssen genau zu denen des Servers passen (apps/api/src/lernumgebung.mjs).

pub mod konfig;
pub mod freigabe;
pub mod signatur;
pub mod programme;
pub mod vm;

/// Zufällige Gerätekennung (22 Zeichen, base64url), wird beim ersten Start gespeichert
pub fn neue_geraet_id() -> String {
    use base64::Engine;
    let b: [u8; 16] = rand::random();
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(b)
}
