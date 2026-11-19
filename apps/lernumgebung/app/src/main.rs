// trimez. Lernumgebung
// Ein Vollbild-Fenster, das nur trimez. zeigt. Alle Anfragen gehen über ein eigenes Protokoll durch diese App an den Server;
// dabei wird jede Anfrage unterschrieben (Nachweis, dass sie aus einer echten, gesperrten Lernumgebung kommt).
// Erlaubte Seiten (z. B. Duden) öffnen in einem zweiten Fenster, alles andere wird blockiert.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod proxy;
mod sperre;
mod ueberwachung;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use lernumgebung_kern::{freigabe, konfig::Konfig};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
/// Nur wenn die App selbst beendet (lu_beenden, Notausgang), darf sie sich schliessen. Alt+F4, Schliessen-Knopf,
/// Abmelde-Anfragen anderer Programme usw. werden verweigert – unabhängig davon, ob der Tastatur-Hook greift.
pub static BEENDEN_ERLAUBT: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Entwicklungs-Build (ohne LU_SERVER gebaut): hat einen Notausgang (Strg+Alt+Umschalt+F12), den echte Versionen nicht haben
pub const ENTWICKLUNG: bool = option_env!("LU_SERVER").is_none();
pub const PLATTFORM: &str = if cfg!(target_os = "macos") { "macos" } else { "windows" };
/// Adresse des Servers. Echte Versionen: beim Bauen festgelegt (LU_SERVER), nicht änderbar.
/// Entwicklungs-Builds: aus «server.txt» neben der App (beim ersten Start auf einer Seite eingegeben), sonst der lokale Server.
static SERVER_ADRESSE: std::sync::RwLock<String> = std::sync::RwLock::new(String::new());
fn server_datei() -> Option<std::path::PathBuf> { std::env::current_exe().ok()?.parent().map(|d| d.join("server.txt")) }
pub fn server() -> String {
    if let Some(s) = option_env!("LU_SERVER") { return s.trim_end_matches('/').to_string(); }
    {
        let s = SERVER_ADRESSE.read().unwrap();
        if !s.is_empty() { return s.clone(); }
    }
    let gelesen = server_datei().and_then(|p| std::fs::read_to_string(p).ok()).map(|t| t.trim().trim_end_matches('/').to_string()).filter(|t| t.starts_with("http"));
    let s = gelesen.unwrap_or_else(|| "http://localhost:5180".into());
    *SERVER_ADRESSE.write().unwrap() = s.clone();
    s
}

/// Nur Entwicklungs-Builds: Server-Adresse festlegen (prüft, ob dort trimez. antwortet) und in server.txt merken
#[tauri::command]
async fn lu_server_setzen(zustand: tauri::State<'_, Zustand>, url: String) -> Result<(), String> {
    if !ENTWICKLUNG { return Err("Nicht verfügbar.".into()); }
    let mut u = url.trim().trim_end_matches('/').to_string();
    if !u.starts_with("http://") && !u.starts_with("https://") { u = format!("http://{u}"); }
    let teile: url::Url = u.parse().map_err(|_| "Das ist keine gültige Adresse.".to_string())?;
    if teile.host_str().is_none() { return Err("Das ist keine gültige Adresse.".into()); }
    // Ohne Anschluss (Port) den Standard des Servers annehmen
    if teile.port().is_none() && teile.scheme() == "http" { u = format!("{}://{}:5180", teile.scheme(), teile.host_str().unwrap_or_default()); }
    let antwort = zustand.client.get(format!("{u}/api/schule/seeufer")).timeout(std::time::Duration::from_secs(90)).send().await
        .map_err(|e| format!("Keine Verbindung zu {u}. Läuft der Server dort, und sind beide Computer im selben Netz? ({e})"))?;
    if antwort.status().is_server_error() { return Err(format!("{u} antwortet, aber mit einem Fehler ({}).", antwort.status())); }
    if let Some(p) = server_datei() { std::fs::write(p, &u).map_err(|e| format!("Konnte die Adresse nicht speichern: {e}"))?; }
    *SERVER_ADRESSE.write().unwrap() = u.clone();
    protokoll(&format!("Server gesetzt: {u}"));
    Ok(())
}
// Schlüssel dieser Version, beim Bauen übergeben und verdeckt abgelegt (siehe build.rs)
include!(concat!(env!("OUT_DIR"), "/schluessel.rs"));
#[inline(never)]
fn schluessel() -> Vec<u8> { VERDECKT.iter().zip(MASKE.iter()).map(|(a, b)| a ^ b).collect() }

/// Adresse, unter der die Seiten von trimez. im Fenster erscheinen (eigenes Protokoll; Windows braucht http://<name>.localhost)
pub fn eigene_herkunft() -> &'static str { if cfg!(windows) { "http://trimez.localhost" } else { "trimez://localhost" } }

pub struct Zustand {
    pub client: reqwest::Client,
    pub schluessel: Vec<u8>,
    pub geraet: String,
    pub konfig: Mutex<Option<Konfig>>,
    pub konfig_wert: Mutex<String>,
    /// Wohin die App Meldungen schickt: /api/versuche/{id}/warnung oder /api/lektionen/{id}/warnung
    pub meldungen_an: Mutex<Option<String>>,
    pub pruefung_aktiv: AtomicBool,
    pub sperre: Box<dyn sperre::Sperre>,
    pub tabs: Mutex<Tabs>,
}

/// Erlaubte fremde Seiten als Tabs im Hauptfenster (je eine eigene Webansicht unter der Tab-Leiste von trimez.)
#[derive(Clone, serde::Serialize)]
pub struct Tab { id: String, url: String }
#[derive(Default)]
pub struct Tabs { liste: Vec<Tab>, aktiv: Option<String>, naechste: u32 }
#[derive(serde::Serialize)]
pub struct TabStand { tabs: Vec<Tab>, aktiv: Option<String> }
/// Höhe der Tab-Leiste, die trimez. oben zeichnet (logische Pixel; gleich wie .lu-tabs in stil.css)
const LEISTE: f64 = 46.0;
const MAX_TABS: usize = 6;
impl Zustand {
    /// «aktiv;desktop,tastatur,aufnahme» oder «aus»
    pub fn sperre_text(&self) -> String {
        let s = self.sperre.aktive();
        if s.is_empty() { "aus".into() } else { format!("aktiv;{}", s.join(",")) }
    }
    pub fn seiten(&self) -> Vec<String> { self.konfig.lock().unwrap().as_ref().map(|k| k.seiten.clone()).unwrap_or_default() }
}

/// Fehlerprotokoll für die Fehlersuche (nur Entwicklungs-Builds): trimez-lernumgebung.log neben der App
pub fn protokoll(text: &str) {
    if !ENTWICKLUNG { return; }
    use std::io::Write;
    let zeit = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.join("trimez-lernumgebung.log"))).unwrap_or_else(|| std::env::temp_dir().join("trimez-lernumgebung.log"))) {
        let _ = writeln!(f, "{zeit} {text}");
    }
}

fn geraet_id() -> String {
    let ordner = dirs::data_local_dir().unwrap_or_else(std::env::temp_dir).join("trimez-lernumgebung");
    let datei = ordner.join("geraet.txt");
    if let Ok(s) = std::fs::read_to_string(&datei) { let s = s.trim().to_string(); if s.len() >= 8 { return s; } }
    let neu = lernumgebung_kern::neue_geraet_id();
    let _ = std::fs::create_dir_all(&ordner);
    let _ = std::fs::write(&datei, &neu);
    neu
}

/// Die Seite meldet, ob gerade eine Prüfung (oder eine Lektion, die die Lernumgebung verlangt) läuft; dann lässt sich die App nicht schliessen
#[tauri::command]
fn lu_status(zustand: tauri::State<Zustand>, aktiv: bool) { zustand.pruefung_aktiv.store(aktiv, Ordering::SeqCst); }

/// Statt einer weissen Seite im Tab sagen, welche Adresse gesperrt wurde (kurz warten, bis die Navigation abgebrochen ist)
fn gesperrt_anzeigen(app: tauri::AppHandle, tab: String, adresse: String) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));
        let Some(w) = app.get_webview(&tab) else { return };
        // Nur wenn noch nichts geladen ist: Eine gesperrte Weiterleitung aus einer geladenen Seite (z. B. Werbung) lässt die Seite stehen
        if w.url().map(|u| u.as_str() != "about:blank").unwrap_or(true) { return; }
        let text = serde_json::to_string(&adresse).unwrap_or_else(|_| "\"\"".into());
        let html = "<meta charset=utf-8><body style=\"font:16px system-ui,sans-serif;margin:48px;color:#1d2a24\"><h2>Diese Seite ist nicht freigegeben</h2><p>Die Lehrperson hat sie nicht erlaubt. Mit «trimez.» oben links geht es zurück.</p><p id=a style=\"color:#667;word-break:break-all\"></p></body>";
        let _ = w.eval(format!("document.open();document.write({});document.close();document.getElementById('a').textContent={};", serde_json::to_string(html).unwrap_or_default(), text));
    });
}

fn stand(app: &tauri::AppHandle) -> TabStand {
    let z = app.state::<Zustand>();
    let t = z.tabs.lock().unwrap();
    TabStand { tabs: t.liste.clone(), aktiv: t.aktiv.clone() }
}

/// Platz für die Tabs: das ganze Hauptfenster unter der Leiste
fn bereich(app: &tauri::AppHandle) -> Option<(tauri::LogicalPosition<f64>, tauri::LogicalSize<f64>)> {
    let w = app.get_window("haupt")?;
    let g = w.inner_size().ok()?.to_logical::<f64>(w.scale_factor().ok()?);
    Some((tauri::LogicalPosition::new(0.0, LEISTE), tauri::LogicalSize::new(g.width, (g.height - LEISTE).max(100.0))))
}

/// Einen Tab zeigen (oder keinen: dann ist trimez. zu sehen). Alle anderen Tabs werden versteckt.
fn zeigen(app: &tauri::AppHandle, id: Option<String>) {
    let z = app.state::<Zustand>();
    let ids: Vec<String> = { let mut t = z.tabs.lock().unwrap(); t.aktiv = id.clone(); t.liste.iter().map(|x| x.id.clone()).collect() };
    let platz = bereich(app);
    for i in ids {
        let Some(wv) = app.get_webview(&i) else { continue };
        if Some(&i) == id.as_ref() {
            if let Some((pos, groesse)) = platz { let _ = wv.set_position(pos); let _ = wv.set_size(groesse); }
            let _ = wv.show();
            let _ = wv.set_focus();
        } else { let _ = wv.hide(); }
    }
}

/// Tabs schliessen, deren Seite nicht mehr erlaubt ist (z. B. Lektion beendet, Lehrperson hat eine Seite entfernt)
pub fn tabs_pruefen(app: &tauri::AppHandle) {
    let z = app.state::<Zustand>();
    let seiten = z.seiten();
    let weg: Vec<String> = z.tabs.lock().unwrap().liste.iter().filter(|t| !freigabe::erlaubt(&t.url, "https://ungueltig.invalid", &seiten)).map(|t| t.id.clone()).collect();
    for id in weg { tab_schliessen(app, &id); }
}

fn tab_schliessen(app: &tauri::AppHandle, id: &str) {
    if let Some(wv) = app.get_webview(id) { let _ = wv.close(); }
    let z = app.state::<Zustand>();
    let mut t = z.tabs.lock().unwrap();
    t.liste.retain(|x| x.id != id);
    if t.aktiv.as_deref() == Some(id) { t.aktiv = None; }
}

/// Erlaubte Seite als Tab öffnen (oder den bestehenden Tab dieser Seite zeigen).
/// Muss «async» sein: Webansichten entstehen auf dem Hauptthread; ein synchroner Befehl würde ihn unter Windows blockieren.
#[tauri::command]
async fn lu_seite_oeffnen(app: tauri::AppHandle, url: String) -> Result<TabStand, String> {
    let seiten = app.state::<Zustand>().seiten();
    if !freigabe::erlaubt(&url, "https://ungueltig.invalid", &seiten) { return Err("Diese Seite ist nicht freigegeben.".into()); }
    let ziel: url::Url = url.parse().map_err(|_| "Ungültige Adresse")?;
    let vorhanden = app.state::<Zustand>().tabs.lock().unwrap().liste.iter().find(|t| t.url == url).map(|t| t.id.clone());
    if let Some(id) = vorhanden { zeigen(&app, Some(id)); return Ok(stand(&app)); }
    let z = app.state::<Zustand>();
    let id = {
        let mut t = z.tabs.lock().unwrap();
        if t.liste.len() >= MAX_TABS { return Err(format!("Höchstens {MAX_TABS} Tabs. Bitte zuerst einen schliessen.")); }
        t.naechste += 1;
        format!("seite-{}", t.naechste)
    };
    let fenster = app.get_window("haupt").ok_or("Hauptfenster fehlt")?;
    let (pos, groesse) = bereich(&app).ok_or("Fenstergrösse unbekannt")?;
    let pruef = app.clone();
    let tab = id.clone();
    protokoll(&format!("Tab {id} öffnen: {url} bei {pos:?} {groesse:?}"));
    let wv = tauri::webview::WebviewBuilder::new(&id, WebviewUrl::External(ziel))
        .on_navigation(move |u| {
            let ok = u.as_str() == "about:blank" || freigabe::erlaubt(u.as_str(), "https://ungueltig.invalid", &pruef.state::<Zustand>().seiten());
            protokoll(&format!("Tab-Navigation {} {}", if ok { "erlaubt" } else { "GESPERRT" }, u));
            if !ok { gesperrt_anzeigen(pruef.clone(), tab.clone(), u.to_string()); }
            ok
        })
        .on_page_load(|wv, p| protokoll(&format!("Tab {} lädt {:?}: {}", wv.label(), p.event(), p.url())));
    if let Err(e) = fenster.add_child(wv, pos, groesse) { protokoll(&format!("Tab {id} Fehler: {e}")); return Err(e.to_string()); }
    app.state::<Zustand>().tabs.lock().unwrap().liste.push(Tab { id: id.clone(), url });
    zeigen(&app, Some(id));
    Ok(stand(&app))
}

#[tauri::command]
async fn lu_tabs(app: tauri::AppHandle) -> TabStand { stand(&app) }

#[tauri::command]
async fn lu_tab_zeigen(app: tauri::AppHandle, id: Option<String>) -> TabStand { zeigen(&app, id); stand(&app) }

#[tauri::command]
async fn lu_tab_schliessen(app: tauri::AppHandle, id: String) -> TabStand { tab_schliessen(&app, &id); stand(&app) }

/// Alle Tabs verstecken (z. B. wenn die Lehrperson die Bildschirme anhält): trimez. ist wieder zu sehen
#[tauri::command]
async fn lu_hilfsmittel_schliessen(app: tauri::AppHandle) { zeigen(&app, None); }

/// Beenden nur, wenn keine Prüfung läuft
#[tauri::command]
fn lu_beenden(app: tauri::AppHandle, zustand: tauri::State<Zustand>) -> Result<(), String> {
    if zustand.pruefung_aktiv.load(Ordering::SeqCst) { return Err("Während einer Prüfung (oder einer Lektion, die die Lernumgebung verlangt) lässt sie sich nicht schliessen. Bitte zuerst abgeben oder warten, bis die Lehrperson die Lektion beendet.".into()); }
    zustand.sperre.deaktivieren();
    #[cfg(windows)] sperre::desktop::zurueck();
    BEENDEN_ERLAUBT.store(true, Ordering::SeqCst);
    app.exit(0);
    Ok(())
}

/// Notausgang für Tests (nur Entwicklungs-Builds): Strg+Alt+Umschalt+Q auf der Seite von trimez.
#[tauri::command]
fn lu_notausgang(app: tauri::AppHandle, zustand: tauri::State<Zustand>) -> Result<(), String> {
    if !ENTWICKLUNG { return Err("Nicht verfügbar.".into()); }
    protokoll("Notausgang über die Seite");
    zustand.sperre.deaktivieren();
    #[cfg(windows)] sperre::desktop::zurueck();
    BEENDEN_ERLAUBT.store(true, Ordering::SeqCst);
    app.exit(0);
    Ok(())
}

// Für die Seiten von trimez.: Schnittstelle zur App (die Seite erkennt daran, dass sie in der Lernumgebung läuft)
fn einstieg_skript() -> String {
    format!(r#"
      window.trimezLernumgebung = Object.freeze({{
        version: {v:?}, plattform: {p:?},
        status: (aktiv) => window.__TAURI_INTERNALS__.invoke("lu_status", {{ aktiv: !!aktiv }}),
        seiteOeffnen: (url) => window.__TAURI_INTERNALS__.invoke("lu_seite_oeffnen", {{ url: String(url) }}).then((r) => {{ window.dispatchEvent(new Event("trimez-tabs")); return r; }}),
        tabs: () => window.__TAURI_INTERNALS__.invoke("lu_tabs"),
        tabZeigen: (id) => window.__TAURI_INTERNALS__.invoke("lu_tab_zeigen", {{ id: id || null }}),
        tabSchliessen: (id) => window.__TAURI_INTERNALS__.invoke("lu_tab_schliessen", {{ id: String(id) }}),
        beenden: () => window.__TAURI_INTERNALS__.invoke("lu_beenden"),
        hilfsmittelSchliessen: () => window.__TAURI_INTERNALS__.invoke("lu_hilfsmittel_schliessen").then(() => window.dispatchEvent(new Event("trimez-tabs"))),
      }});
      // Kontextmenü, Drucken und Entwicklerwerkzeuge sperren
      window.addEventListener("contextmenu", (e) => e.preventDefault(), true);
      window.addEventListener("keydown", (e) => {{
        const k = e.key.toLowerCase();
        if (e.ctrlKey && e.altKey && e.shiftKey && (k === "q" || e.code === "KeyQ")) {{ window.__TAURI_INTERNALS__.invoke("lu_notausgang").catch(() => {{}}); }}
        if (e.altKey && k === "f4") {{ e.preventDefault(); e.stopPropagation(); }}
        if (k === "f12" || ((e.ctrlKey || e.metaKey) && ["p", "s", "o", "u", "r"].includes(k)) || ((e.ctrlKey || e.metaKey) && e.shiftKey && ["i", "j", "c"].includes(k))) {{ e.preventDefault(); e.stopPropagation(); }}
      }}, true);
    "#, v = VERSION, p = PLATTFORM)
}

fn main() {
    // Windows: zuerst auf einen eigenen Desktop wechseln (diese Instanz bleibt als unsichtbarer Aufseher zurück)
    #[cfg(windows)]
    if let Some(code) = sperre::desktop::als_aufseher_starten() { std::process::exit(code); }
    let schluessel = schluessel();
    let client = reqwest::Client::builder()
        .cookie_store(true)
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(format!("trimez-Lernumgebung/{VERSION} ({PLATTFORM})"))
        .timeout(std::time::Duration::from_secs(90)) // Gratis-Hosting schläft nach 15 Minuten ein; das Aufwachen dauert bis zu einer Minute
        .build()
        .expect("HTTP-Client");
    let zustand = Zustand {
        client, schluessel, geraet: geraet_id(),
        konfig: Mutex::new(None), konfig_wert: Mutex::new("-".into()), meldungen_an: Mutex::new(None),
        tabs: Mutex::new(Tabs::default()),
        pruefung_aktiv: AtomicBool::new(false), sperre: sperre::neu(),
    };

    tauri::Builder::default()
        .manage(zustand)
        .register_asynchronous_uri_scheme_protocol("trimez", |ctx, anfrage, antwort| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn(async move { antwort.respond(proxy::weiterleiten(&app, anfrage).await); });
        })
        .invoke_handler(tauri::generate_handler![lu_server_setzen, lu_status, lu_seite_oeffnen, lu_tabs, lu_tab_zeigen, lu_tab_schliessen, lu_hilfsmittel_schliessen, lu_beenden, lu_notausgang])
        .setup(|app| {
            let start: url::Url = format!("{}/", eigene_herkunft()).parse().expect("Startadresse");
            let pruef = app.handle().clone();
            let fenster = WebviewWindowBuilder::new(app, "haupt", WebviewUrl::CustomProtocol(start))
                .title("trimez. Lernumgebung")
                .fullscreen(true)
                .decorations(false)
                .always_on_top(true)
                .resizable(false)
                .skip_taskbar(true)
                .initialization_script(einstieg_skript())
                .on_navigation(move |u| {
                    // Nur die eigenen Seiten im Hauptfenster; erlaubte fremde Seiten gehen ins Hilfsmittel-Fenster
                    if u.as_str().starts_with(eigene_herkunft()) { return true; }
                    let z = pruef.state::<Zustand>();
                    if freigabe::erlaubt(u.as_str(), "https://ungueltig.invalid", &z.seiten()) {
                        // Nicht hier im Navigations-Rückruf öffnen (gleiches Problem wie oben), sondern auf einem anderen Thread
                        let app = pruef.clone(); let ziel = u.to_string();
                        tauri::async_runtime::spawn(async move { let _ = lu_seite_oeffnen(app, ziel).await; });
                    }
                    false
                })
                .build()?;
            let z = app.state::<Zustand>();
            z.sperre.aktivieren(&fenster);
            ueberwachung::starten(app.handle().clone());
            #[cfg(windows)] sperre::desktop::bereit_melden();
            Ok(())
        })
        .on_window_event(|fenster, ereignis| {
            if let WindowEvent::Resized(_) = ereignis {
                if fenster.label() == "haupt" { let app = fenster.app_handle().clone(); let aktiv = stand(&app).aktiv; if aktiv.is_some() { zeigen(&app, aktiv); } }
            }
            if let WindowEvent::CloseRequested { api, .. } = ereignis {
                // Hauptfenster nie über Alt+F4 o. Ä. schliessen; nur über «Lernumgebung schliessen»
                if fenster.label() == "haupt" && !BEENDEN_ERLAUBT.load(Ordering::SeqCst) { protokoll("Schliessen verweigert (z. B. Alt+F4)"); api.prevent_close(); }
            }
        })
        .build(tauri::generate_context!())
        .expect("Lernumgebung konnte nicht starten")
        .run(|_app, ereignis| {
            if let tauri::RunEvent::ExitRequested { api, code, .. } = ereignis {
                if !BEENDEN_ERLAUBT.load(Ordering::SeqCst) && code.is_none() { protokoll("Beenden verweigert"); api.prevent_exit(); }
            }
        });
}
