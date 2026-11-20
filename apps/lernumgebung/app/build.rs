// Beim Bauen: Server-Adresse und Schlüssel der Version kommen aus der Build-Umgebung (LU_SERVER, LU_SCHLUESSEL), nie aus dem Quelltext.
// Der Schlüssel steht nicht im Klartext in der App: Er wird mit einer zufälligen Maske verdeckt und erst beim Start zusammengesetzt.
// Das hält einfache Suchen (z. B. «strings») ab; wer die App gründlich zerlegt, findet ihn trotzdem (darum Schlüssel pro Version).
use base64::Engine;
use std::hash::{BuildHasher, Hasher};

fn zufall(n: usize) -> Vec<u8> {
    let mut v = Vec::with_capacity(n);
    while v.len() < n {
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_usize(v.len());
        v.extend_from_slice(&h.finish().to_le_bytes());
    }
    v.truncate(n);
    v
}

fn main() {
    println!("cargo:rerun-if-env-changed=LU_SERVER");
    println!("cargo:rerun-if-env-changed=LU_SCHLUESSEL");
    // Entwicklungsschlüssel, solange keiner übergeben wird (passt nur zu Servern ohne NODE_ENV=production)
    let roh = std::env::var("LU_SCHLUESSEL").unwrap_or_else(|_| "8Lso78ecnU7n-OLvG-Sz1509JK1H3y8Ev_EIvEr7WqE".into());
    let schluessel = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(roh.trim()).expect("LU_SCHLUESSEL muss base64url sein");
    let maske = zufall(schluessel.len());
    let verdeckt: Vec<u8> = schluessel.iter().zip(&maske).map(|(a, b)| a ^ b).collect();
    let aus = std::path::Path::new(&std::env::var("OUT_DIR").unwrap()).join("schluessel.rs");
    std::fs::write(aus, format!("const MASKE: [u8; {n}] = {maske:?};\nconst VERDECKT: [u8; {n}] = {verdeckt:?};\n", n = maske.len())).unwrap();
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&["lu_status", "lu_seite_oeffnen", "lu_tabs", "lu_tab_zeigen", "lu_tab_schliessen", "lu_hilfsmittel_schliessen", "lu_beenden", "lu_notausgang", "lu_server_setzen", "lu_onenote_stand", "lu_onenote_starten", "lu_onenote_dateien", "lu_onenote_lesen"])))
        .expect("tauri-build");
}
