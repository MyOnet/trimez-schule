// Echtheit und Umgebung unter Windows:
//   eigene Signatur   Ist die App so, wie sie signiert wurde? (Erst mit Code-Signatur aussagekräftig; ohne Signatur: «unsigniert»)
//   fremder Code      Programmbibliotheken im eigenen Prozess, die weder zu Windows, zur App noch zu WebView2 gehören und
//                     nicht gültig signiert sind (eingeschleuster Code). Signierte wie Virenschutz gelten als harmlos.
//   virtuelle Maschine  Hypervisor der CPU, Angaben des BIOS, Gast-Treiber
// Grenze: Wer die App selbst verändert, kann auch diese Prüfungen entfernen. Sie erschweren, sie verhindern nicht.
use std::collections::HashSet;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use lernumgebung_kern::{programme, vm};
use windows::core::{w, HSTRING, PCWSTR};
use windows::Win32::Foundation::{HANDLE, HMODULE, HWND};
use windows::Win32::Security::WinTrust::{
    WinVerifyTrust, WINTRUST_ACTION_GENERIC_VERIFY_V2, WINTRUST_DATA, WINTRUST_DATA_0, WINTRUST_FILE_INFO, WTD_CHOICE_FILE,
    WTD_REVOKE_NONE, WTD_STATEACTION_CLOSE, WTD_STATEACTION_VERIFY, WTD_UI_NONE,
};
use windows::Win32::System::ProcessStatus::{EnumProcessModules, GetModuleFileNameExW};
use windows::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};
use windows::Win32::System::SystemInformation::GetWindowsDirectoryW;
use windows::Win32::System::Threading::GetCurrentProcess;

pub fn signatur_gueltig(pfad: &Path) -> bool {
    let name = HSTRING::from(pfad.as_os_str());
    let mut datei = WINTRUST_FILE_INFO { cbStruct: std::mem::size_of::<WINTRUST_FILE_INFO>() as u32, pcwszFilePath: PCWSTR(name.as_ptr()), ..Default::default() };
    let mut daten = WINTRUST_DATA {
        cbStruct: std::mem::size_of::<WINTRUST_DATA>() as u32, dwUIChoice: WTD_UI_NONE, fdwRevocationChecks: WTD_REVOKE_NONE,
        dwUnionChoice: WTD_CHOICE_FILE, Anonymous: WINTRUST_DATA_0 { pFile: &mut datei }, dwStateAction: WTD_STATEACTION_VERIFY, ..Default::default()
    };
    let mut aktion = WINTRUST_ACTION_GENERIC_VERIFY_V2;
    unsafe {
        let r = WinVerifyTrust(HWND::default(), &mut aktion, &mut daten as *mut _ as *mut _);
        daten.dwStateAction = WTD_STATEACTION_CLOSE;
        let _ = WinVerifyTrust(HWND::default(), &mut aktion, &mut daten as *mut _ as *mut _);
        r == 0
    }
}

/// Ist die laufende App gültig signiert? (einmal berechnet)
pub fn eigene_signatur() -> bool {
    static S: OnceLock<bool> = OnceLock::new();
    *S.get_or_init(|| std::env::current_exe().map(|p| signatur_gueltig(&p)).unwrap_or(false))
}

fn windows_ordner() -> String {
    let mut b = [0u16; 260];
    let n = unsafe { GetWindowsDirectoryW(Some(&mut b)) } as usize;
    String::from_utf16_lossy(&b[..n.min(b.len())])
}

fn bios(wert: PCWSTR) -> String {
    let mut b = [0u16; 256];
    let mut n = (b.len() * 2) as u32;
    let r = unsafe { RegGetValueW(HKEY_LOCAL_MACHINE, w!("HARDWARE\\DESCRIPTION\\System\\BIOS"), wert, RRF_RT_REG_SZ, None, Some(b.as_mut_ptr() as *mut _), Some(&mut n)) };
    if r.is_err() { return String::new(); }
    String::from_utf16_lossy(&b[..(n as usize / 2).saturating_sub(1).min(b.len())])
}

/// Hinweise auf eine virtuelle Maschine (einmal beim Start gesammelt; ändern sich während der Prüfung nicht)
pub fn vm_hinweise() -> &'static Vec<String> {
    static H: OnceLock<Vec<String>> = OnceLock::new();
    H.get_or_init(|| {
        let mut h = vec![];
        if let Some(n) = vm::hypervisor_verdaechtig(&vm::hypervisor_name()) { h.push(format!("Prozessor meldet Hypervisor {n}")); }
        let angaben = [bios(w!("SystemManufacturer")), bios(w!("SystemProductName")), bios(w!("BIOSVendor"))].join(" ");
        if vm::hersteller_verdaechtig(&angaben) { h.push(format!("Systemangaben: {}", angaben.trim())); }
        let treiber = Path::new(&windows_ordner()).join("System32").join("drivers");
        let gefunden: Vec<&str> = vm::GAST_TREIBER.iter().copied().filter(|t| treiber.join(t).exists()).collect();
        if !gefunden.is_empty() { h.push(format!("Treiber einer virtuellen Maschine: {}", gefunden.join(", "))); }
        h
    })
}

/// Eingeschleuste, nicht signierte Programmbibliotheken im eigenen Prozess
pub fn fremde_module() -> Vec<String> {
    static GEPRUEFT: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    let geprueft = GEPRUEFT.get_or_init(|| Mutex::new(HashSet::new()));
    let win = windows_ordner();
    let app = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.display().to_string())).unwrap_or_default();
    let mut module = vec![HMODULE::default(); 1024];
    let mut noetig = 0u32;
    let proz: HANDLE = unsafe { GetCurrentProcess() };
    if unsafe { EnumProcessModules(proz, module.as_mut_ptr(), (module.len() * std::mem::size_of::<HMODULE>()) as u32, &mut noetig) }.is_err() { return vec![]; }
    let anzahl = (noetig as usize / std::mem::size_of::<HMODULE>()).min(module.len());
    let mut fremd = vec![];
    for m in &module[..anzahl] {
        let mut b = [0u16; 1024];
        let n = unsafe { GetModuleFileNameExW(Some(proz), Some(*m), &mut b) } as usize;
        if n == 0 { continue; }
        let pfad = String::from_utf16_lossy(&b[..n]);
        if programme::modul_bekannt(&pfad, &win, &app) { continue; }
        if !geprueft.lock().unwrap().insert(pfad.clone()) { continue; } // schon geprüft (gemeldet oder signiert)
        if !signatur_gueltig(Path::new(&pfad)) { fremd.push(pfad); }
    }
    fremd
}
