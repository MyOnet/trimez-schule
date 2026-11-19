//! Unterschrift jeder Anfrage an den Server (HMAC-SHA256), Gegenstück zu `signieren` in lernumgebung.mjs.
use base64::Engine;
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

pub struct Anfrage<'a> {
    pub methode: &'a str,
    /// Pfad mit Abfrage, z. B. «/api/versuche/…/antworten?x=1»
    pub pfad: &'a str,
    pub zeit_ms: u64,
    pub geraet: &'a str,
    /// «aktiv;desktop,tastatur,aufnahme» oder «aus»
    pub sperre: &'a str,
    /// Prüfwert der Konfiguration oder «-»
    pub konfig: &'a str,
    pub koerper: &'a [u8],
}

pub fn signieren(schluessel: &[u8], a: &Anfrage) -> String {
    let koerper = super::konfig::hex(&Sha256::digest(a.koerper));
    let text = [a.methode.to_uppercase().as_str(), a.pfad, &a.zeit_ms.to_string(), a.geraet, a.sperre, a.konfig, &koerper].join("\n");
    let mut mac = Hmac::<Sha256>::new_from_slice(schluessel).expect("HMAC nimmt jede Schlüssellänge");
    mac.update(text.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
}

/// Schlüssel aus base64url (so wird er beim Bauen übergeben)
pub fn schluessel_lesen(b64: &str) -> Option<Vec<u8>> { base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(b64.trim()).ok() }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn gleiche_unterschrift_wie_der_server() {
        let k = schluessel_lesen("8Lso78ecnU7n-OLvG-Sz1509JK1H3y8Ev_EIvEr7WqE").unwrap();
        let s = signieren(&k, &Anfrage { methode: "post", pfad: "/api/versuche/abc/antworten?x=1", zeit_ms: 1795000000000, geraet: "geraet-lea-0001",
            sperre: "aktiv;desktop,tastatur", konfig: "-", koerper: "{\"a\":\"ä\"}".as_bytes() });
        assert_eq!(s, "OvXAWBCR10qx3IEoAvawbfk4QgfqXqGX-39wAn0EsEU");
    }
}
