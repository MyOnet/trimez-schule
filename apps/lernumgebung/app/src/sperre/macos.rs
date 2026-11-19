// Sperre unter macOS:
//   kiosk  Präsentations-Optionen von AppKit: Dock und Menüleiste weg, kein App-Wechsel (Cmd+Tab), kein «Sofort beenden»,
//          kein Abmelden/Ausschalten. Funktioniert ohne besondere Berechtigung.
//   aac    Apples Prüfungsschnittstelle (Automatic Assessment Configuration): sperrt das System wie Safe Exam Browser,
//          inkl. Bildschirmaufnahme, Diktat, Bedienungshilfen. Nur mit Feature «aac» und Berechtigung von Apple.
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(feature = "aac")]
use objc2::{msg_send, rc::Retained, runtime::{AnyClass, AnyObject}};
use objc2::MainThreadMarker;
use objc2_app_kit::{NSApplication, NSApplicationPresentationOptions, NSScreen};

fn sysctl(name: &str) -> String {
    std::process::Command::new("/usr/sbin/sysctl").args(["-n", name]).output().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default()
}

/// Ist das App-Paket unverändert und gültig signiert? (codesign prüft Signatur und alle Dateien des Pakets; einmal berechnet)
fn eigene_signatur() -> bool {
    static S: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *S.get_or_init(|| {
        let Ok(exe) = std::env::current_exe() else { return false };
        // …/trimez. Lernumgebung.app/Contents/MacOS/trimez-lernumgebung
        let Some(paket) = exe.ancestors().nth(3).filter(|p| p.extension().is_some_and(|e| e == "app")) else { return false };
        std::process::Command::new("/usr/bin/codesign").args(["--verify", "--deep", "--strict"]).arg(paket).status().map(|s| s.success()).unwrap_or(false)
    })
}

#[derive(Default)]
pub struct MacSperre {
    kiosk: AtomicBool,
    aac: AtomicBool,
}

fn kiosk_optionen() -> NSApplicationPresentationOptions {
    NSApplicationPresentationOptions::HideDock
        | NSApplicationPresentationOptions::HideMenuBar
        | NSApplicationPresentationOptions::DisableProcessSwitching
        | NSApplicationPresentationOptions::DisableForceQuit
        | NSApplicationPresentationOptions::DisableSessionTermination
        | NSApplicationPresentationOptions::DisableHideApplication
        | NSApplicationPresentationOptions::DisableAppleMenu
}

/// AAC-Sitzung starten (AEAssessmentSession). Gibt true zurück, wenn die Sitzung begonnen hat.
/// Ohne Berechtigung von Apple schlägt der Start fehl; dann bleibt der Kiosk-Modus.
#[cfg(feature = "aac")]
fn aac_starten() -> bool {
    // Klassen werden zur Laufzeit gesucht, damit die App auch ohne das Framework startet
    let (Some(konf_klasse), Some(sitzung_klasse)) = (AnyClass::get(c"AEAssessmentConfiguration"), AnyClass::get(c"AEAssessmentSession")) else { return false };
    unsafe {
        let konf: Retained<AnyObject> = msg_send![konf_klasse, new];
        let sitzung: *mut AnyObject = msg_send![sitzung_klasse, alloc];
        let sitzung: *mut AnyObject = msg_send![sitzung, initWithConfiguration: &*konf];
        if sitzung.is_null() { return false; }
        let _: () = msg_send![sitzung, begin];
        // Die Sitzung bleibt bis zum Beenden der App bestehen (bewusst nicht freigegeben)
        let aktiv: bool = msg_send![sitzung, isActive];
        aktiv
    }
}
#[cfg(not(feature = "aac"))]
fn aac_starten() -> bool { false }

impl super::Sperre for MacSperre {
    fn aktivieren(&self, _fenster: &tauri::WebviewWindow) {
        if let Some(mtm) = MainThreadMarker::new() {
            let app = NSApplication::sharedApplication(mtm);
            app.setPresentationOptions(kiosk_optionen());
            self.kiosk.store(true, Ordering::SeqCst);
        }
        if aac_starten() { self.aac.store(true, Ordering::SeqCst); }
    }
    fn aktive(&self) -> Vec<&'static str> {
        let mut v = vec![];
        if self.kiosk.load(Ordering::SeqCst) { v.push("kiosk"); v.push("vordergrund"); }
        if self.aac.load(Ordering::SeqCst) { v.push("aac"); v.push("aufnahme"); }
        if eigene_signatur() { v.push("signiert"); }
        v
    }
    fn pruefen(&self) -> Vec<(&'static str, String)> {
        let mut m = vec![];
        if let Some(mtm) = MainThreadMarker::new() {
            let n = NSScreen::screens(mtm).len();
            if n > 1 { m.push(("bildschirm", format!("{n} Bildschirme angeschlossen"))); }
        }
        // Läuft macOS selbst in einer virtuellen Maschine? (Prozessor, Modell, Hypervisor auf Intel-Macs)
        if sysctl("kern.hv_vmm_present") == "1" { m.push(("vm", "macOS läuft in einer virtuellen Maschine".into())); }
        let modell = sysctl("hw.model");
        if lernumgebung_kern::vm::mac_modell_verdaechtig(&modell) { m.push(("vm", format!("Modell {modell}"))); }
        if let Some(n) = lernumgebung_kern::vm::hypervisor_verdaechtig(&lernumgebung_kern::vm::hypervisor_name()) { m.push(("vm", format!("Prozessor meldet Hypervisor {n}"))); }
        // Eingeschleuste Bibliotheken über die Umgebung (DYLD_INSERT_LIBRARIES)
        if let Ok(x) = std::env::var("DYLD_INSERT_LIBRARIES") { m.push(("fremder_code", format!("Eingeschleuste Bibliothek: {x}"))); }
        if let Some(h) = super::vm_hinweis() { m.push(("vm", h)); }
        m
    }
    fn deaktivieren(&self) {
        if let Some(mtm) = MainThreadMarker::new() {
            NSApplication::sharedApplication(mtm).setPresentationOptions(NSApplicationPresentationOptions::Default);
        }
        self.kiosk.store(false, Ordering::SeqCst);
    }
}
