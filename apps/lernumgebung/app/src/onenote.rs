// OneNote auf diesem Computer: Die Lernumgebung bereitet die OneNote-Notizbücher selbst vor, damit sie sich in RESCOOL
// mit einem Klick übernehmen lassen. Kein Programm zum Herunterladen, kein Fenster:
//   - Das Installationsprogramm startet «<app> --onenote-export» gleich nach der Installation (siehe installer.nsh).
//   - Danach bei jedem Start, wenn der letzte Lauf älter als 6 Stunden ist (dann werden nur geänderte Seiten neu gelesen).
// Der Export liest nur aus OneNote (über die OneNote-App für Windows) und legt die Dateien im Datenordner der App ab;
// nichts verlässt den Computer, bis die Person in RESCOOL «Übernehmen» wählt.
// Zuletzt bearbeitete Seiten kommen zuerst; was fertig ist, lässt sich übernehmen, während der Rest noch läuft.
use std::path::{Component, Path, PathBuf};

/// Dasselbe Exportprogramm wie zum Herunterladen auf der Website (eine Quelle)
const SKRIPT: &str = include_str!("../../../web/public/OneNote-zu-RESCOOL.ps1");
pub const ARGUMENT: &str = "--onenote-export";
/// Neuer Lauf beim Start, wenn der letzte länger her ist
const AUFFRISCHEN_NACH: u64 = 6 * 3600;

fn ordner() -> PathBuf { dirs::data_local_dir().unwrap_or_else(std::env::temp_dir).join("trimez-lernumgebung").join("onenote") }
fn export_ordner() -> PathBuf { ordner().join("export") }
fn stand_datei() -> PathBuf { ordner().join("stand.txt") }
fn pid_datei() -> PathBuf { ordner().join("laeuft.pid") }

fn alter_sekunden(p: &Path) -> Option<u64> {
    let m = std::fs::metadata(p).ok()?.modified().ok()?;
    Some(std::time::SystemTime::now().duration_since(m).map(|d| d.as_secs()).unwrap_or(0))
}

/// Läuft gerade ein Export (dieser Computer, dieser Benutzer)?
pub fn laeuft() -> bool {
    let Some(pid) = std::fs::read_to_string(pid_datei()).ok().and_then(|s| s.trim().parse::<u32>().ok()) else { return false };
    let mut s = sysinfo::System::new();
    let pid = sysinfo::Pid::from_u32(pid);
    s.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[pid]), true);
    let eigener = std::env::current_exe().ok().and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_lowercase()));
    s.process(pid).map(|p| Some(p.name().to_string_lossy().to_lowercase()) == eigener).unwrap_or(false)
}

/// «--onenote-export»: den Export ausführen und warten (ohne Fenster). Gibt den Exit-Code zurück.
pub fn hintergrund() -> i32 {
    if !cfg!(windows) || laeuft() { return 0; }
    let dir = ordner();
    if std::fs::create_dir_all(&dir).is_err() { return 1; }
    let _ = std::fs::write(pid_datei(), std::process::id().to_string());
    let skript = dir.join("OneNote-zu-RESCOOL.ps1");
    // Mit BOM (steht schon in der Datei), sonst liest Windows PowerShell die Umlaute falsch
    let code = if std::fs::write(&skript, SKRIPT).is_err() { 1 } else {
        let mut c = std::process::Command::new("powershell.exe");
        c.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File"]).arg(&skript)
            .args(["-Still", "-OhneZip", "-Fortlaufend", "-Ausgabe"]).arg(dir.join("export.zip")).arg("-Fortschritt").arg(stand_datei());
        #[cfg(windows)] { use std::os::windows::process::CommandExt; c.creation_flags(0x0800_0000); } // CREATE_NO_WINDOW
        c.status().map(|s| s.code().unwrap_or(1)).unwrap_or(1)
    };
    let _ = std::fs::remove_file(pid_datei());
    code
}

/// Beim Start der App (noch auf dem normalen Desktop): Export im Hintergrund anstossen, wenn nötig
pub fn beim_start() {
    if !cfg!(windows) || laeuft() { return; }
    // Abgeschlossen (fertig oder ohne OneNote) und noch frisch: nichts tun. Unterbrochen (z. B. ausgeschaltet): weitermachen.
    let abgeschlossen = std::fs::read_to_string(stand_datei()).map(|s| s.starts_with("100|")).unwrap_or(false);
    if abgeschlossen && alter_sekunden(&stand_datei()).map(|a| a < AUFFRISCHEN_NACH).unwrap_or(false) { return; }
    if let Ok(exe) = std::env::current_exe() { let _ = std::process::Command::new(exe).arg(ARGUMENT).spawn(); }
}

/// Von der Seite aus (die App läuft dann auf ihrem eigenen Desktop): den Export auf dem normalen Desktop starten,
/// damit OneNote, falls es dafür startet, später ganz normal erscheint.
#[cfg(windows)]
fn auf_normalem_desktop_starten() -> Result<(), String> {
    use windows::core::{HSTRING, PWSTR};
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{CreateProcessW, PROCESS_CREATION_FLAGS, PROCESS_INFORMATION, STARTUPINFOW};
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut zeile: Vec<u16> = format!("\"{}\" {ARGUMENT}", exe.display()).encode_utf16().chain([0]).collect();
    let mut ort: Vec<u16> = "winsta0\\default".encode_utf16().chain([0]).collect();
    let si = STARTUPINFOW { cb: std::mem::size_of::<STARTUPINFOW>() as u32, lpDesktop: PWSTR(ort.as_mut_ptr()), ..Default::default() };
    let mut pi = PROCESS_INFORMATION::default();
    unsafe {
        CreateProcessW(&HSTRING::from(exe.as_os_str()), Some(PWSTR(zeile.as_mut_ptr())), None, None, false, PROCESS_CREATION_FLAGS(0x0800_0000), None, None, &si, &mut pi)
            .map_err(|e| e.to_string())?;
        let _ = CloseHandle(pi.hProcess); let _ = CloseHandle(pi.hThread);
    }
    Ok(())
}

#[derive(serde::Serialize)]
pub struct Stand { moeglich: bool, laeuft: bool, prozent: u32, text: String, vorhanden: bool, zeit: u64 }

#[tauri::command]
pub async fn lu_onenote_stand() -> Stand {
    let roh = std::fs::read_to_string(stand_datei()).unwrap_or_default();
    let (p, t) = roh.split_once('|').unwrap_or(("0", ""));
    let aufbau = export_ordner().join("aufbau.xml");
    let zeit = std::fs::metadata(&aufbau).ok().and_then(|m| m.modified().ok()).and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
    Stand { moeglich: cfg!(windows), laeuft: laeuft(), prozent: p.trim().parse().unwrap_or(0), text: t.trim().to_string(), vorhanden: aufbau.exists(), zeit }
}

#[tauri::command]
pub async fn lu_onenote_starten() -> Result<(), String> {
    if !cfg!(windows) { return Err("Nur unter Windows mit der OneNote-App.".into()); }
    if laeuft() { return Ok(()); }
    #[cfg(windows)] { auf_normalem_desktop_starten() }
    #[cfg(not(windows))] { Ok(()) }
}

/// Alle Dateien des Exports (relativ, mit «/»)
#[tauri::command]
pub async fn lu_onenote_dateien() -> Vec<String> {
    fn gehen(basis: &Path, dir: &Path, out: &mut Vec<String>) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() { gehen(basis, &p, out); } else if let Ok(r) = p.strip_prefix(basis) {
                out.push(r.components().map(|c| c.as_os_str().to_string_lossy().to_string()).collect::<Vec<_>>().join("/"));
            }
        }
    }
    let basis = export_ordner();
    let mut out = Vec::new();
    gehen(&basis, &basis, &mut out);
    out
}

/// Eine Datei des Exports lesen (nur innerhalb des Export-Ordners)
#[tauri::command]
pub async fn lu_onenote_lesen(pfad: String) -> Result<tauri::ipc::Response, String> {
    let rel = Path::new(&pfad);
    if pfad.is_empty() || !rel.components().all(|c| matches!(c, Component::Normal(_))) { return Err("Ungültiger Pfad.".into()); }
    std::fs::read(export_ordner().join(rel)).map(tauri::ipc::Response::new).map_err(|e| format!("{pfad}: {e}"))
}
