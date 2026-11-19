//! Programme, die während einer Prüfung nicht laufen dürfen (Fernsteuerung, Aufnahme, Nachrichten, KI-Helfer).
//! Die Liste ist bewusst vorsichtig: Sie trifft Programme, deren einziger Zweck in der Prüfung Betrug wäre.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Art { Fernsteuerung, Aufnahme, Nachrichten, Virtualisierung, Entwicklerwerkzeug, Makro }

impl Art {
    pub fn name(self) -> &'static str {
        match self { Art::Fernsteuerung => "Fernsteuerung", Art::Aufnahme => "Bildschirmaufnahme", Art::Nachrichten => "Nachrichten", Art::Virtualisierung => "virtuelle Maschine", Art::Entwicklerwerkzeug => "Entwicklerwerkzeug", Art::Makro => "Tastatur-Makro" }
    }
}

/// (Teil des Prozessnamens in Kleinbuchstaben, Art). Verglichen wird der Dateiname ohne «.exe».
const LISTE: &[(&str, Art)] = &[
    ("teamviewer", Art::Fernsteuerung), ("anydesk", Art::Fernsteuerung), ("rustdesk", Art::Fernsteuerung), ("chrome_remote_desktop", Art::Fernsteuerung),
    ("remoting_host", Art::Fernsteuerung), ("parsec", Art::Fernsteuerung), ("vncserver", Art::Fernsteuerung), ("tvnserver", Art::Fernsteuerung), ("splashtop", Art::Fernsteuerung),
    ("obs64", Art::Aufnahme), ("obs", Art::Aufnahme), ("bandicam", Art::Aufnahme), ("camtasia", Art::Aufnahme), ("sharex", Art::Aufnahme), ("screenrec", Art::Aufnahme), ("loom", Art::Aufnahme),
    ("discord", Art::Nachrichten), ("whatsapp", Art::Nachrichten), ("telegram", Art::Nachrichten), ("signal", Art::Nachrichten), ("slack", Art::Nachrichten), ("ms-teams", Art::Nachrichten), ("zoom", Art::Nachrichten),
    ("vmware", Art::Virtualisierung), ("virtualbox", Art::Virtualisierung), ("vboxsvc", Art::Virtualisierung), ("prl_client_app", Art::Virtualisierung), ("utm", Art::Virtualisierung),
    // Gast-Werkzeuge: laufen nur innerhalb einer virtuellen Maschine
    ("vboxservice", Art::Virtualisierung), ("vboxtray", Art::Virtualisierung), ("vmtoolsd", Art::Virtualisierung), ("vmwaretray", Art::Virtualisierung), ("vmwareuser", Art::Virtualisierung),
    ("prl_cc", Art::Virtualisierung), ("prl_tools", Art::Virtualisierung), ("qemu-ga", Art::Virtualisierung), ("xenservice", Art::Virtualisierung),
    // Tastatur-Makros und Textbausteine: tippen vorbereitete Antworten, hängen sich in die Tastatur ein
    ("autohotkey", Art::Makro), ("autohotkey64", Art::Makro), ("autohotkeyu64", Art::Makro), ("autoit3", Art::Makro), ("tinytask", Art::Makro), ("macrorecorder", Art::Makro),
    ("phrase express", Art::Makro), ("phraseexpress", Art::Makro), ("beeftext", Art::Makro), ("espanso", Art::Makro), ("powertoys.keyboardmanagerengine", Art::Makro),
    ("keyboard maestro engine", Art::Makro), ("karabiner_grabber", Art::Makro), ("bettertouchtool", Art::Makro), ("textexpander", Art::Makro),
    ("cheatengine", Art::Entwicklerwerkzeug), ("x64dbg", Art::Entwicklerwerkzeug), ("ollydbg", Art::Entwicklerwerkzeug), ("wireshark", Art::Entwicklerwerkzeug), ("fiddler", Art::Entwicklerwerkzeug),
];

/// Prüft eine Liste laufender Prozesse. Gibt (Prozessname, Art) für jeden Treffer zurück.
pub fn verbotene<'a>(prozesse: impl IntoIterator<Item = &'a str>) -> Vec<(String, Art)> {
    let mut treffer = Vec::new();
    for p in prozesse {
        let name = p.rsplit(['/', '\\']).next().unwrap_or(p).to_lowercase();
        let name = name.strip_suffix(".exe").unwrap_or(&name).to_string();
        // ganze Wörter vergleichen, damit z. B. «obsidian» nicht als «obs» gilt
        if let Some((_, art)) = LISTE.iter().find(|(m, _)| name == *m || name.starts_with(&format!("{m}_")) || name.starts_with(&format!("{m}-")) || name.starts_with(&format!("{m} ")) || (m.len() >= 8 && name.contains(m))) {
            if !treffer.iter().any(|(n, _): &(String, Art)| *n == name) { treffer.push((name, *art)); }
        }
    }
    treffer
}

/// Geladene Programmbibliotheken (DLL) im eigenen Prozess: gehört diese zu Windows, zur App oder zu WebView2?
/// Alles andere wurde von aussen eingeschleust (z. B. Virenschutz, Bildschirm-Overlays, Betrugswerkzeuge) und wird
/// zusätzlich auf eine gültige Signatur geprüft.
pub fn modul_bekannt(pfad: &str, windows_ordner: &str, app_ordner: &str) -> bool {
    let p = pfad.to_lowercase().replace('/', "\\");
    let unter = |o: &str| { let o = o.to_lowercase().trim_end_matches('\\').to_string(); !o.is_empty() && p.starts_with(&(o + "\\")) };
    unter(windows_ordner) || unter(app_ordner)
        || p.contains("\\microsoft\\edgewebview\\application\\") || p.contains("\\microsoft\\edge\\application\\")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn findet_verbotene() {
        let t = verbotene(["C:\\Program Files\\AnyDesk\\AnyDesk.exe", "explorer.exe", "obs64.exe", "Discord", "TeamViewer_Service.exe"]);
        let n: Vec<_> = t.iter().map(|x| x.0.as_str()).collect();
        assert_eq!(n, ["anydesk", "obs64", "discord", "teamviewer_service"]);
        assert_eq!(t[0].1, Art::Fernsteuerung);
    }
    #[test]
    fn module() {
        let w = "C:\\Windows"; let a = "C:\\Users\\lea\\AppData\\Local\\trimez";
        assert!(modul_bekannt("C:\\Windows\\System32\\user32.dll", w, a));
        assert!(modul_bekannt("C:\\Program Files (x86)\\Microsoft\\EdgeWebView\\Application\\131.0\\msedgewebview2.dll", w, a));
        assert!(modul_bekannt("c:\\users\\lea\\appdata\\local\\trimez\\WebView2Loader.dll", w, a));
        assert!(!modul_bekannt("C:\\Users\\lea\\Downloads\\hook.dll", w, a));
        assert!(!modul_bekannt("C:\\WindowsApps\\x.dll", w, a));
    }
    #[test]
    fn makros_und_gastwerkzeuge() {
        let t = verbotene(["AutoHotkey64.exe", "VBoxTray.exe", "vmtoolsd.exe", "espanso", "PowerToys.KeyboardManagerEngine.exe"]);
        assert_eq!(t.len(), 5);
        assert_eq!(t[0].1, Art::Makro);
        assert_eq!(t[1].1, Art::Virtualisierung);
    }
    #[test]
    fn keine_falschen_treffer() {
        assert!(verbotene(["obsidian.exe", "explorer.exe", "msedge.exe", "Code.exe", "utmp", "signalrgb.exe", "zoomit64.exe", "slackware"]).is_empty());
    }
}
