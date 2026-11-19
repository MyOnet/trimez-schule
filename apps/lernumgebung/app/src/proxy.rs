// Eigenes Protokoll «trimez»: Jede Anfrage des Fensters geht über diese Funktion an den Server.
// API-Anfragen werden unterschrieben; Cookies bleiben in der App (das Fenster sieht sie nie).
use std::time::{SystemTime, UNIX_EPOCH};
use lernumgebung_kern::{konfig::{konfig_wert, Konfig}, signatur::{signieren, Anfrage}};
use tauri::{http, Manager};
use crate::{server, Zustand};

const DURCHREICHEN: &[&str] = &["content-type", "accept", "x-schule", "accept-language"];
const ZURUECK: &[&str] = &["content-type", "cache-control", "content-disposition", "content-security-policy", "x-content-type-options", "location"];

fn fehler(status: u16, text: &str) -> http::Response<Vec<u8>> {
    http::Response::builder().status(status).header("content-type", "text/plain; charset=utf-8").body(text.as_bytes().to_vec()).unwrap()
}

pub async fn weiterleiten(app: &tauri::AppHandle, anfrage: http::Request<Vec<u8>>) -> http::Response<Vec<u8>> {
    let z = app.state::<Zustand>();
    let pfad = anfrage.uri().path_and_query().map(|p| p.as_str().to_string()).unwrap_or_else(|| "/".into());
    if pfad.contains("..") { return fehler(400, "Ungültige Adresse"); }
    // Entwicklungs-Builds: Seite zum Eingeben der Server-Adresse
    if crate::ENTWICKLUNG && pfad.starts_with("/__einrichten") { return einrichten_seite(""); }
    let ziel = format!("{}{}", server(), pfad);
    let methode = reqwest::Method::from_bytes(anfrage.method().as_str().as_bytes()).unwrap_or(reqwest::Method::GET);
    let mut r = z.client.request(methode.clone(), &ziel);
    for (k, v) in anfrage.headers() { if DURCHREICHEN.contains(&k.as_str()) { r = r.header(k.as_str(), v.as_bytes()); } }
    if pfad.starts_with("/api/") {
        let zeit = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
        let sperre = z.sperre_text();
        let konfig = z.konfig_wert.lock().unwrap().clone();
        let sig = signieren(&z.schluessel, &Anfrage { methode: methode.as_str(), pfad: &pfad, zeit_ms: zeit, geraet: &z.geraet, sperre: &sperre, konfig: &konfig, koerper: anfrage.body() });
        r = r.header("x-lu-version", crate::VERSION).header("x-lu-plattform", crate::PLATTFORM).header("x-lu-geraet", &z.geraet)
            .header("x-lu-zeit", zeit.to_string()).header("x-lu-sperre", sperre).header("x-lu-konfig", konfig).header("x-lu-signatur", sig);
    }
    let antwort = match r.body(anfrage.body().clone()).send().await {
        Ok(a) => a,
        Err(e) => {
            crate::protokoll(&format!("{methode} {pfad}: {e}"));
            // Seite (nicht API) nicht erreichbar: im Entwicklungs-Build gleich nach der Adresse fragen
            if crate::ENTWICKLUNG && !pfad.starts_with("/api/") && methode == reqwest::Method::GET {
                return einrichten_seite(&format!("Keine Verbindung zu {}.", server()));
            }
            return fehler(502, "Keine Verbindung zum Server");
        }
    };
    let status = antwort.status().as_u16();
    let mut b = http::Response::builder().status(status);
    for (k, v) in antwort.headers() {
        if !ZURUECK.contains(&k.as_str()) { continue; }
        // Weiterleitungen auf den Server bleiben im eigenen Protokoll
        if k.as_str() == "location" {
            let l = v.to_str().unwrap_or("");
            let l = if let Some(rest) = l.strip_prefix(server().as_str()) { format!("{}{}", crate::eigene_herkunft(), rest) } else { l.to_string() };
            b = b.header("location", l);
        } else { b = b.header(k.as_str(), v.as_bytes()); }
    }
    let koerper = antwort.bytes().await.map(|x| x.to_vec()).unwrap_or_default();
    merken(&z, methode.as_str(), &pfad, status, &koerper);
    crate::tabs_pruefen(app);
    b.body(koerper).unwrap_or_else(|_| fehler(500, "Antwort ungültig"))
}

/// Beim Laden einer Prüfung oder Lektion: Konfiguration (erlaubte Seiten, Werkzeuge) und Ziel für Meldungen merken.
/// Prüfung: GET /api/versuche/{id}; Lektion: GET /api/lektionen/{id} (auch mit ?puls=1, alle paar Sekunden).
fn merken(z: &Zustand, methode: &str, pfad: &str, status: u16, koerper: &[u8]) {
    if methode != "GET" || status != 200 { return; }
    let ohne_abfrage = pfad.split('?').next().unwrap_or("");
    let (art, id) = if let Some(id) = ohne_abfrage.strip_prefix("/api/versuche/") { ("versuche", id) }
        else if let Some(id) = ohne_abfrage.strip_prefix("/api/lektionen/") { ("lektionen", id) }
        else { return };
    if id.len() != 36 || id.contains('/') { return; }
    if art == "versuche" && ohne_abfrage != pfad { return; }
    let Ok(json) = serde_json::from_slice::<serde_json::Value>(koerper) else { return };
    let konfig = json.get("lernumgebung").and_then(|l| l.get("konfig"));
    match konfig.and_then(|k| serde_json::from_value::<Konfig>(k.clone()).ok()) {
        Some(k) => {
            *z.meldungen_an.lock().unwrap() = Some(format!("/api/{art}/{id}/warnung"));
            *z.konfig_wert.lock().unwrap() = konfig_wert(&k);
            *z.konfig.lock().unwrap() = Some(k);
        }
        // Lektion beendet: keine erlaubten Seiten mehr, Meldungen gehen nirgends hin
        None if art == "lektionen" && konfig.is_some_and(|k| k.is_null()) => {
            let mut ziel = z.meldungen_an.lock().unwrap();
            if ziel.as_deref() == Some(&format!("/api/lektionen/{id}/warnung")) {
                *ziel = None;
                *z.konfig.lock().unwrap() = None;
                *z.konfig_wert.lock().unwrap() = "-".into();
            }
        }
        None => {}
    }
}

/// Entwicklungs-Builds: Server-Adresse eingeben (für Tests mit zwei Computern)
fn einrichten_seite(meldung: &str) -> http::Response<Vec<u8>> {
    let jetzt = server();
    let esc = |t: &str| t.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;");
    let html = format!(r#"<!doctype html><html lang="de"><meta charset="utf-8"><title>Server wählen</title>
<style>body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#1f3a30;font:16px system-ui,sans-serif;color:#1d2a24}}
main{{background:#fbfaf6;border-radius:18px;padding:32px 34px;width:min(520px,90vw);box-shadow:0 20px 50px rgba(0,0,0,.3)}}
h1{{margin:0 0 6px;font-size:1.5rem}}p{{color:#4b5a53;line-height:1.5}}input{{width:100%;box-sizing:border-box;font:inherit;padding:12px 14px;border:1.5px solid #c9d1cb;border-radius:10px;margin:8px 0 14px}}
button{{font:inherit;font-weight:700;padding:12px 20px;border:0;border-radius:10px;background:#2f6b4f;color:#fff;cursor:pointer}}button:disabled{{opacity:.6}}
.f{{color:#a33a1f;font-weight:600;min-height:1.4em}}small{{color:#6b776f}}</style>
<main><h1>Mit welchem Server verbinden?</h1>
<p>Testversion: Die Lernumgebung braucht die Adresse des Computers, auf dem der Server läuft. Sie steht dort im PowerShell-Fenster, z. B. <b>http://192.168.1.23:5180</b>, oder die Internetadresse des Testservers, z. B. <b>https://trimez-schule-test.onrender.com</b>.</p>
<form id="f"><label for="u">Adresse des Servers</label><input id="u" value="{wert}" placeholder="https://… oder http://192.168.…:5180" autofocus>
<p class="f" id="m">{meldung}</p><button id="b">Verbinden</button></form>
<p><small>Beide Computer müssen im selben Netz sein. Schul-WLANs trennen Geräte oft; dann hilft ein Handy-Hotspot oder das WLAN zu Hause.</small></p></main>
<script>document.getElementById("f").onsubmit=async(e)=>{{e.preventDefault();const b=document.getElementById("b"),m=document.getElementById("m");b.disabled=true;m.textContent="Verbinde … (ein Gratis-Server im Internet braucht beim Aufwachen bis zu einer Minute)";
try{{await window.__TAURI_INTERNALS__.invoke("lu_server_setzen",{{url:document.getElementById("u").value}});location.href="/";}}catch(x){{m.textContent=String(x);b.disabled=false;}}}};</script></html>"#,
        wert = esc(if jetzt == "http://localhost:5180" { "" } else { &jetzt }), meldung = esc(meldung));
    http::Response::builder().status(200).header("content-type", "text/html; charset=utf-8").body(html.into_bytes()).unwrap()
}
