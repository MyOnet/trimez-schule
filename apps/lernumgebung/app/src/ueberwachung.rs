// Überwachung während die App läuft: verbotene Programme beenden und melden, Hinweise der Plattform melden.
use std::collections::HashSet;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use lernumgebung_kern::{programme, signatur::{signieren, Anfrage}};
use tauri::Manager;
use crate::{server, Zustand};

pub fn starten(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut system = sysinfo::System::new();
        let mut gemeldet: HashSet<String> = HashSet::new();
        loop {
            tokio::time::sleep(Duration::from_secs(3)).await;
            let z = app.state::<Zustand>();
            system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
            let namen: Vec<(sysinfo::Pid, String)> = system.processes().iter().map(|(pid, p)| (*pid, p.name().to_string_lossy().to_string())).collect();
            let treffer = programme::verbotene(namen.iter().map(|(_, n)| n.as_str()));
            for (name, art) in treffer {
                // beenden, wenn möglich (eigene Prozesse des Benutzers); sonst nur melden
                for (pid, n) in &namen { if n.to_lowercase().trim_end_matches(".exe") == name { if let Some(p) = system.process(*pid) { let _ = p.kill(); } } }
                if gemeldet.insert(format!("prozess:{name}")) { melden(&z, "prozess", &format!("{} ({}) wurde beendet", name, art.name())).await; }
            }
            // Auf dem Haupt-Thread prüfen (macOS verlangt das für Bildschirm-Abfragen)
            let (tx, rx) = tokio::sync::oneshot::channel();
            let a = app.clone();
            let _ = app.run_on_main_thread(move || { let _ = tx.send(a.state::<Zustand>().sperre.pruefen()); });
            for (art, detail) in rx.await.unwrap_or_default() {
                if gemeldet.insert(format!("{art}:{detail}")) { melden(&z, art, &detail).await; }
            }
        }
    });
}

async fn melden(z: &Zustand, art: &str, detail: &str) {
    let Some(pfad) = z.meldungen_an.lock().unwrap().clone() else { return };
    let koerper = serde_json::json!({ "art": art, "detail": detail }).to_string();
    let zeit = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    let sperre = z.sperre_text();
    let konfig = z.konfig_wert.lock().unwrap().clone();
    let sig = signieren(&z.schluessel, &Anfrage { methode: "POST", pfad: &pfad, zeit_ms: zeit, geraet: &z.geraet, sperre: &sperre, konfig: &konfig, koerper: koerper.as_bytes() });
    let _ = z.client.post(format!("{}{}", server(), pfad))
        .header("content-type", "application/json").header("x-schule", "1")
        .header("x-lu-version", crate::VERSION).header("x-lu-plattform", crate::PLATTFORM).header("x-lu-geraet", &z.geraet)
        .header("x-lu-zeit", zeit.to_string()).header("x-lu-sperre", sperre).header("x-lu-konfig", konfig).header("x-lu-signatur", sig)
        .body(koerper).send().await;
}
