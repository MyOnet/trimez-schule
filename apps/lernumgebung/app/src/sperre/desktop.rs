// Eigener Desktop unter Windows (wie Safe Exam Browser):
// Die App startet sich selbst ein zweites Mal auf einem neuen, leeren Desktop und schaltet dorthin.
// Auf diesem Desktop gibt es keine Taskleiste, kein Startmenü und keine Fenster anderer Programme.
// Was ausserhalb läuft, ist nicht sichtbar und nicht erreichbar; Strg+Alt+Entf öffnet zwar den Sicherheitsbildschirm,
// der Task-Manager erscheint aber auf dem normalen Desktop, den man von hier aus nicht sieht.
//
// Ablauf:  Aufseher (erster Prozess, unsichtbar)  →  Desktop anlegen  →  App auf dem Desktop starten  →  hinüberschalten
//          Wartet, bis die App endet, und schaltet in jedem Fall zurück. Meldet die App nicht innert 30 Sekunden
//          «bereit» (z. B. weil WebView2 auf dem Desktop nicht startet), beendet der Aufseher sie und schaltet zurück.
// Die App schaltet beim Beenden selbst ebenfalls zurück, falls der Aufseher fehlt.
use windows::core::{w, HSTRING, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0, WAIT_TIMEOUT};
use windows::Win32::System::StationsAndDesktops::{
    CloseDesktop, CreateDesktopW, OpenDesktopW, OpenInputDesktop, SwitchDesktop, DESKTOP_CONTROL_FLAGS, DESKTOP_SWITCHDESKTOP, HDESK,
};
use windows::Win32::System::Threading::{
    CreateEventW, CreateProcessW, GetCurrentProcessId, GetExitCodeProcess, OpenEventW, SetEvent, TerminateProcess, WaitForSingleObject,
    EVENT_MODIFY_STATE, PROCESS_CREATION_FLAGS, PROCESS_INFORMATION, STARTUPINFOW,
};

const KENNUNG: &str = "--trimez-desktop=";
const GENERIC_ALL: u32 = 0x1000_0000;

/// Läuft diese Instanz auf dem eigenen Desktop? Dann die Nummer des Aufsehers.
pub fn aufseher() -> Option<u32> {
    std::env::args().find_map(|a| a.strip_prefix(KENNUNG).and_then(|n| n.parse().ok()))
}

fn ereignis_name(aufseher: u32) -> HSTRING { HSTRING::from(format!("Local\\trimez-lu-bereit-{aufseher}")) }

/// Von der App aufzurufen, sobald ihr Fenster steht.
pub fn bereit_melden() {
    let Some(a) = aufseher() else { return };
    unsafe { if let Ok(h) = OpenEventW(EVENT_MODIFY_STATE, false, &ereignis_name(a)) { let _ = SetEvent(h); let _ = CloseHandle(h); } }
}

/// Zum normalen Desktop zurückschalten (beim Beenden der App, falls der Aufseher nicht mehr da ist).
pub fn zurueck() {
    unsafe { if let Ok(d) = OpenDesktopW(w!("Default"), DESKTOP_CONTROL_FLAGS(0), false, DESKTOP_SWITCHDESKTOP.0) { let _ = SwitchDesktop(d); let _ = CloseDesktop(d); } }
}

/// Erster Start: Desktop anlegen, App dort starten, warten, zurückschalten. Gibt den Exit-Code zurück.
/// None: eigener Desktop nicht möglich, die App läuft dann im selben Prozess ohne eigenen Desktop weiter.
pub fn als_aufseher_starten() -> Option<i32> {
    if aufseher().is_some() { return None; }
    unsafe {
        let ich = GetCurrentProcessId();
        let name = format!("trimez-lu-{ich}");
        let vorher: Option<HDESK> = OpenInputDesktop(DESKTOP_CONTROL_FLAGS(0), false, DESKTOP_SWITCHDESKTOP).ok();
        let desktop = CreateDesktopW(&HSTRING::from(name.as_str()), None, None, DESKTOP_CONTROL_FLAGS(0), GENERIC_ALL, None).ok()?;
        let bereit: HANDLE = match CreateEventW(None, true, false, &ereignis_name(ich)) { Ok(h) => h, Err(_) => { let _ = CloseDesktop(desktop); return None; } };

        let exe = std::env::current_exe().ok()?;
        let mut zeile: Vec<u16> = format!("\"{}\" {KENNUNG}{ich}", exe.display()).encode_utf16().chain([0]).collect();
        let mut ort: Vec<u16> = format!("winsta0\\{name}").encode_utf16().chain([0]).collect();
        let si = STARTUPINFOW { cb: std::mem::size_of::<STARTUPINFOW>() as u32, lpDesktop: PWSTR(ort.as_mut_ptr()), ..Default::default() };
        let mut pi = PROCESS_INFORMATION::default();
        if CreateProcessW(&HSTRING::from(exe.as_os_str()), Some(PWSTR(zeile.as_mut_ptr())), None, None, false, PROCESS_CREATION_FLAGS(0), None, None, &si, &mut pi).is_err() {
            let _ = CloseHandle(bereit); let _ = CloseDesktop(desktop);
            return None;
        }
        let _ = SwitchDesktop(desktop);

        // Wächter: Startet die App nicht richtig, nicht auf einem leeren Desktop festsitzen
        let mut code = 1u32;
        if WaitForSingleObject(bereit, 30_000) == WAIT_TIMEOUT && WaitForSingleObject(pi.hProcess, 0) != WAIT_OBJECT_0 {
            let _ = TerminateProcess(pi.hProcess, 3);
        }
        let _ = WaitForSingleObject(pi.hProcess, u32::MAX);
        let _ = GetExitCodeProcess(pi.hProcess, &mut code);

        match vorher { Some(d) => { let _ = SwitchDesktop(d); let _ = CloseDesktop(d); } None => zurueck() }
        let _ = CloseHandle(pi.hProcess); let _ = CloseHandle(pi.hThread); let _ = CloseHandle(bereit);
        let _ = CloseDesktop(desktop);
        Some(code as i32)
    }
}
