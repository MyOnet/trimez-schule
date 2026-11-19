//! Welche Adressen darf die Lernumgebung öffnen? Der eigene Server und die von der Lehrperson erlaubten Seiten.
use url::Url;

/// `erlaubt` = Präfixe wie «https://www.duden.de» oder «https://www.geogebra.org/calculator».
/// Ein Präfix gilt für die gleiche Herkunft (Schema, Host, Port) und Pfade darunter, an Abschnittsgrenzen:
/// «…/calculator» erlaubt «…/calculator/abc», aber nicht «…/calculatorX».
/// «www.» vor dem Namen zählt nicht: Viele Seiten leiten von «www.poki.com» auf «poki.com» um (oder umgekehrt).
pub fn erlaubt(adresse: &str, server: &str, seiten: &[String]) -> bool {
    let Ok(u) = Url::parse(adresse) else { return false };
    if !matches!(u.scheme(), "https" | "http") { return false; }
    if let Ok(s) = Url::parse(server) { if u.origin() == s.origin() { return true; } }
    if u.scheme() != "https" { return false; }
    seiten.iter().any(|p| {
        let Ok(pu) = Url::parse(p) else { return false };
        if pu.scheme() != u.scheme() || pu.port_or_known_default() != u.port_or_known_default() { return false; }
        let ohne_www = |h: Option<&str>| h.map(|h| h.strip_prefix("www.").unwrap_or(h).to_ascii_lowercase());
        if ohne_www(pu.host_str()).is_none() || ohne_www(pu.host_str()) != ohne_www(u.host_str()) { return false; }
        let basis = pu.path().trim_end_matches('/');
        let pfad = u.path();
        basis.is_empty() || pfad == basis || pfad.starts_with(&format!("{basis}/"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn s() -> Vec<String> { vec!["https://www.duden.de".into(), "https://www.geogebra.org/calculator".into()] }
    #[test]
    fn eigener_server_und_erlaubte_seiten() {
        assert!(erlaubt("https://schule.trimez.ch/s/seeufer/", "https://schule.trimez.ch", &s()));
        assert!(erlaubt("https://www.duden.de/rechtschreibung/Romantik", "https://schule.trimez.ch", &s()));
        assert!(erlaubt("https://www.geogebra.org/calculator/abc", "https://schule.trimez.ch", &s()));
    }
    #[test]
    fn mit_und_ohne_www() {
        let p = vec!["https://www.poki.com".to_string()];
        assert!(erlaubt("https://poki.com/", "https://schule.trimez.ch", &p));
        assert!(erlaubt("https://www.poki.com/de", "https://schule.trimez.ch", &p));
        assert!(erlaubt("https://www.duden.de/", "https://schule.trimez.ch", &["https://duden.de".to_string()]));
        assert!(!erlaubt("https://games.poki.com/", "https://schule.trimez.ch", &p));
        assert!(!erlaubt("https://wwwpoki.com/", "https://schule.trimez.ch", &p));
    }
    #[test]
    fn alles_andere_nicht() {
        assert!(!erlaubt("https://www.geogebra.org/classic", "https://schule.trimez.ch", &s()));
        assert!(!erlaubt("https://www.geogebra.org/calculatorX", "https://schule.trimez.ch", &s()));
        assert!(!erlaubt("https://duden.de.boese.example/", "https://schule.trimez.ch", &s()));
        assert!(!erlaubt("https://www.google.com/search?q=duden.de", "https://schule.trimez.ch", &s()));
        assert!(!erlaubt("http://www.duden.de/", "https://schule.trimez.ch", &s()));
        assert!(!erlaubt("file:///C:/Windows", "https://schule.trimez.ch", &s()));
        assert!(!erlaubt("javascript:alert(1)", "https://schule.trimez.ch", &s()));
    }
}
