// Sperre des Betriebssystems, je Plattform eigene Umsetzung
pub trait Sperre: Send + Sync {
    /// Sperre einschalten (Vollbild-Fenster ist schon offen)
    fn aktivieren(&self, fenster: &tauri::WebviewWindow);
    /// Welche Sperren wirken, z. B. ["desktop", "tastatur", "aufnahme"]; leer = keine
    fn aktive(&self) -> Vec<&'static str>;
    /// Regelmässige Prüfung: (Art, Beschreibung) für die Lehrperson, z. B. ("bildschirm", "2 Bildschirme angeschlossen")
    fn pruefen(&self) -> Vec<(&'static str, String)>;
    fn deaktivieren(&self);
}

#[cfg(windows)] mod windows;
#[cfg(windows)] pub mod desktop;
#[cfg(windows)] mod echtheit_win;
#[cfg(target_os = "macos")] mod macos;
#[cfg(not(any(windows, target_os = "macos")))] mod andere;

pub fn neu() -> Box<dyn Sperre> {
    #[cfg(windows)] { Box::new(windows::WindowsSperre::default()) }
    #[cfg(target_os = "macos")] { Box::new(macos::MacSperre::default()) }
    #[cfg(not(any(windows, target_os = "macos")))] { Box::new(andere::KeineSperre) }
}

/// Netzwerkkarten virtueller Maschinen (gemeinsam für alle Plattformen)
pub fn vm_hinweis() -> Option<String> {
    let netze = sysinfo::Networks::new_with_refreshed_list();
    for (name, n) in &netze {
        let mac = n.mac_address().to_string();
        if lernumgebung_kern::vm::mac_verdaechtig(&mac) { return Some(format!("Netzwerkkarte {name} einer virtuellen Maschine")); }
    }
    None
}
