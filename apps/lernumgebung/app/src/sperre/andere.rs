// Für die Entwicklung unter Linux: keine Sperre. Der Server weist Prüfungen mit Sperre-Pflicht darum ab («nicht gesperrt»).
pub struct KeineSperre;
impl super::Sperre for KeineSperre {
    fn aktivieren(&self, _f: &tauri::WebviewWindow) {}
    fn aktive(&self) -> Vec<&'static str> { vec![] }
    fn pruefen(&self) -> Vec<(&'static str, String)> { vec![] }
    fn deaktivieren(&self) {}
}
