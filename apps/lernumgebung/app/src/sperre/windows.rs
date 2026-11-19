// Sperre unter Windows (ohne Administratorrechte, für private Laptops):
//   tastatur  Tastenkombinationen zum Wechseln (Windows-Taste, Alt+Tab, Alt+Esc, Strg+Esc, Alt+F4, Druck) abfangen
//   aufnahme  Fenster von Bildschirmaufnahmen ausnehmen (SetWindowDisplayAffinity, ab Windows 10 2004)
//   vordergrund  Fenster bleibt oben; wird es verlassen (z. B. Strg+Alt+Entf), holt die App es zurück und meldet es
// Strg+Alt+Entf lässt sich unter Windows von keiner App sperren; der Wechsel wird darum gemeldet.
//   desktop  eigener Desktop wie bei Safe Exam Browser (siehe desktop.rs): keine Taskleiste, keine fremden Fenster
//   fernzugriff  Remotedesktop-Sitzung und Debugger von aussen werden gemeldet
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::Mutex;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard};
use windows::Win32::System::Diagnostics::Debug::{CheckRemoteDebuggerPresent, IsDebuggerPresent};
use windows::Win32::System::Threading::GetCurrentProcess;
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Threading::GetCurrentProcessId;
use windows::Win32::UI::Input::KeyboardAndMouse::{VK_APPS, VK_ESCAPE, VK_F4, VK_F12, VK_LWIN, VK_RWIN, VK_SNAPSHOT, VK_TAB};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetForegroundWindow, GetMessageW, GetWindowThreadProcessId, GetSystemMetrics, SetForegroundWindow, SetWindowDisplayAffinity,
    SetWindowsHookExW, TranslateMessage, UnhookWindowsHookEx, HHOOK, KBDLLHOOKSTRUCT, LLKHF_ALTDOWN, MSG, SM_CMONITORS, SM_REMOTESESSION, WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
    WH_KEYBOARD_LL, WM_KEYDOWN, WM_SYSKEYDOWN,
};

static AKTIV: AtomicBool = AtomicBool::new(false);
static HAUPT: AtomicIsize = AtomicIsize::new(0);

#[derive(Default)]
pub struct WindowsSperre {
    tastatur: AtomicBool,
    aufnahme: AtomicBool,
    hook: Mutex<Option<isize>>,
}

// Zustand der Umschalttasten, im Hook selbst mitgeführt (GetAsyncKeyState ist im Hook und auf einem eigenen Desktop unzuverlässig)
static STRG: AtomicBool = AtomicBool::new(false);
static ALT: AtomicBool = AtomicBool::new(false);
static UMSCHALT: AtomicBool = AtomicBool::new(false);

unsafe extern "system" fn tastatur_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    let msg = wparam.0 as u32;
    if code >= 0 {
        // SAFETY: Bei WH_KEYBOARD_LL zeigt lParam auf eine KBDLLHOOKSTRUCT
        let k = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
        let unten = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
        match k.vkCode as u16 {
            0xA2 | 0xA3 | 0x11 => STRG.store(unten, Ordering::SeqCst),      // VK_LCONTROL, VK_RCONTROL, VK_CONTROL
            0xA4 | 0xA5 | 0x12 => ALT.store(unten, Ordering::SeqCst),       // VK_LMENU, VK_RMENU, VK_MENU
            0xA0 | 0xA1 | 0x10 => UMSCHALT.store(unten, Ordering::SeqCst),  // VK_LSHIFT, VK_RSHIFT, VK_SHIFT
            _ => {}
        }
    }
    if code >= 0 && AKTIV.load(Ordering::SeqCst) && (msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN) {
        // SAFETY: wie oben
        let k = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
        let vk = k.vkCode as u16;
        if crate::ENTWICKLUNG { static ERSTE: AtomicBool = AtomicBool::new(true); if ERSTE.swap(false, Ordering::SeqCst) { crate::protokoll(&format!("Tastatur-Hook: erste Taste erhalten ({vk})")); } }
        let alt = ALT.load(Ordering::SeqCst) || (k.flags.0 & LLKHF_ALTDOWN.0) != 0;
        let strg = STRG.load(Ordering::SeqCst);
        // Notausgang nur in Entwicklungs-Builds: Strg+Alt+Umschalt+Q (oder F12; auf vielen Laptops braucht F12 zusätzlich Fn)
        if crate::ENTWICKLUNG && strg && alt && UMSCHALT.load(Ordering::SeqCst) && (vk == 0x51 || vk == VK_F12.0) {
            super::desktop::zurueck();
            std::process::exit(0);
        }
        let sperren = vk == VK_LWIN.0 || vk == VK_RWIN.0 || vk == VK_APPS.0 || vk == VK_SNAPSHOT.0
            || (alt && (vk == VK_TAB.0 || vk == VK_ESCAPE.0 || vk == VK_F4.0))
            || (strg && vk == VK_ESCAPE.0);
        if sperren { return LRESULT(1); }
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

fn zwischenablage_leeren() {
    unsafe { if OpenClipboard(None).is_ok() { let _ = EmptyClipboard(); let _ = CloseClipboard(); } }
}

impl super::Sperre for WindowsSperre {
    fn aktivieren(&self, fenster: &tauri::WebviewWindow) {
        AKTIV.store(true, Ordering::SeqCst);
        zwischenablage_leeren();
        if let Ok(hwnd) = fenster.hwnd() {
            HAUPT.store(hwnd.0 as isize, Ordering::SeqCst);
            let h = HWND(hwnd.0 as _);
            // SAFETY: gültiges Fenster dieser App
            if unsafe { SetWindowDisplayAffinity(h, WDA_EXCLUDEFROMCAPTURE) }.is_ok() { self.aufnahme.store(true, Ordering::SeqCst); }
        }
        // Tastatur-Hook braucht einen Thread mit Nachrichtenschleife
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || unsafe {
            let modul = GetModuleHandleW(None).ok();
            let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(tastatur_hook), modul.map(|m| m.into()), 0);
            crate::protokoll(&format!("Tastatur-Hook: {}", match &hook { Ok(_) => "aktiv".to_string(), Err(e) => format!("FEHLER {e}") }));
            let _ = tx.send(hook.as_ref().map(|h: &HHOOK| h.0 as isize).ok());
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() { let _ = TranslateMessage(&msg); DispatchMessageW(&msg); }
        });
        if let Ok(Some(h)) = rx.recv() { *self.hook.lock().unwrap() = Some(h); self.tastatur.store(true, Ordering::SeqCst); }
    }
    fn aktive(&self) -> Vec<&'static str> {
        let mut v = vec![];
        if super::desktop::aufseher().is_some() { v.push("desktop"); }
        if super::echtheit_win::eigene_signatur() { v.push("signiert"); }
        if self.tastatur.load(Ordering::SeqCst) { v.push("tastatur"); }
        if self.aufnahme.load(Ordering::SeqCst) { v.push("aufnahme"); }
        if !v.is_empty() { v.push("vordergrund"); }
        v
    }
    fn pruefen(&self) -> Vec<(&'static str, String)> {
        let mut m = vec![];
        unsafe {
            let n = GetSystemMetrics(SM_CMONITORS);
            if n > 1 { m.push(("bildschirm", format!("{n} Bildschirme angeschlossen"))); }
            let mut fern = windows::core::BOOL(0);
            if IsDebuggerPresent().as_bool() || (CheckRemoteDebuggerPresent(GetCurrentProcess(), &mut fern).is_ok() && fern.as_bool()) { m.push(("debugger", "Debugger angehängt".to_string())); }
            if GetSystemMetrics(SM_REMOTESESSION) != 0 { m.push(("prozess", "Läuft in einer Remotedesktop-Sitzung".to_string())); }
            let haupt = HAUPT.load(Ordering::SeqCst);
            // Im Vordergrund muss ein Fenster dieser App sein (Prüfung oder Hilfsmittel)
            let mut pid = 0u32;
            GetWindowThreadProcessId(GetForegroundWindow(), Some(&mut pid));
            if haupt != 0 && pid != GetCurrentProcessId() {
                m.push(("sperre", "Prüfungsfenster war nicht im Vordergrund".to_string()));
                let _ = SetForegroundWindow(HWND(haupt as _));
            }
        }
        if let Some(h) = super::vm_hinweis() { m.push(("vm", h)); }
        for h in super::echtheit_win::vm_hinweise() { m.push(("vm", h.clone())); }
        for p in super::echtheit_win::fremde_module() { m.push(("fremder_code", format!("Nicht signierte Programmbibliothek geladen: {p}"))); }
        m
    }
    fn deaktivieren(&self) {
        AKTIV.store(false, Ordering::SeqCst);
        if let Some(h) = self.hook.lock().unwrap().take() { unsafe { let _ = UnhookWindowsHookEx(HHOOK(h as _)); } }
        let haupt = HAUPT.load(Ordering::SeqCst);
        if haupt != 0 { unsafe { let _ = SetWindowDisplayAffinity(HWND(haupt as _), WDA_NONE); } }
        zwischenablage_leeren();
        self.tastatur.store(false, Ordering::SeqCst);
        self.aufnahme.store(false, Ordering::SeqCst);
    }
}
