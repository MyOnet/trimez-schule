//! Hinweise auf eine virtuelle Maschine. Allein kein Beweis (es gibt Fehlalarme), darum nur eine Meldung an die Lehrperson.

/// Hersteller- oder Modellangaben des Systems, die typisch für virtuelle Maschinen sind
pub fn hersteller_verdaechtig(text: &str) -> bool {
    let t = text.to_lowercase();
    ["vmware", "virtualbox", "vbox", "qemu", "kvm", "parallels", "hyper-v", "virtual machine", "xen", "bochs", "utm"].iter().any(|m| t.contains(m))
}

/// MAC-Adressen-Präfixe bekannter Anbieter virtueller Netzwerkkarten
pub fn mac_verdaechtig(mac: &str) -> bool {
    let m = mac.to_lowercase().replace('-', ":");
    ["00:05:69", "00:0c:29", "00:1c:14", "00:50:56", "08:00:27", "00:1c:42", "00:16:3e", "52:54:00"].iter().any(|p| m.starts_with(p))
}

/// Hypervisor-Bit der CPU (nur x86). Auf Windows mit aktivierter Virtualisierungs-Sicherheit ist es auch ohne VM gesetzt,
/// darum nur zusammen mit anderen Hinweisen verwenden.
#[cfg(any(target_arch = "x86_64", target_arch = "x86"))]
pub fn hypervisor_bit() -> bool {
    #[cfg(target_arch = "x86_64")]
    use core::arch::x86_64::__cpuid;
    #[cfg(target_arch = "x86")]
    use core::arch::x86::__cpuid;
    // SAFETY: CPUID ist auf allen x86-64-Prozessoren vorhanden (je nach Rust-Version gilt der Aufruf als sicher)
    #[allow(unused_unsafe)]
    unsafe { (__cpuid(1).ecx >> 31) & 1 == 1 }
}
#[cfg(not(any(target_arch = "x86_64", target_arch = "x86")))]
pub fn hypervisor_bit() -> bool { false }

/// Name des Hypervisors aus CPUID 0x40000000 (z. B. «VMwareVMware»). Leer, wenn keiner meldet (nur x86).
#[cfg(any(target_arch = "x86_64", target_arch = "x86"))]
pub fn hypervisor_name() -> String {
    if !hypervisor_bit() { return String::new(); }
    #[cfg(target_arch = "x86_64")]
    use core::arch::x86_64::__cpuid;
    #[cfg(target_arch = "x86")]
    use core::arch::x86::__cpuid;
    #[allow(unused_unsafe)]
    let r = unsafe { __cpuid(0x4000_0000) };
    let mut b = Vec::with_capacity(12);
    for x in [r.ebx, r.ecx, r.edx] { b.extend_from_slice(&x.to_le_bytes()); }
    String::from_utf8_lossy(&b).trim_matches(char::from(0)).to_string()
}
#[cfg(not(any(target_arch = "x86_64", target_arch = "x86")))]
pub fn hypervisor_name() -> String { String::new() }

/// Ist der gemeldete Hypervisor ein Hinweis auf eine VM? «Microsoft Hv» nicht: Windows 11 läuft mit
/// Virtualisierungs-Sicherheit (VBS, WSL2) selbst über Hyper-V, auch auf einem gewöhnlichen Laptop.
pub fn hypervisor_verdaechtig(name: &str) -> Option<&'static str> {
    const BEKANNT: &[(&str, &str)] = &[("VMwareVMware", "VMware"), ("VBoxVBoxVBox", "VirtualBox"), ("KVMKVMKVM", "KVM/QEMU"), ("TCGTCGTCGTCG", "QEMU"),
        ("XenVMMXenVMM", "Xen"), (" lrpepyh  vr", "Parallels"), ("prl hyperv", "Parallels"), ("bhyve bhyve", "bhyve"), ("ACRNACRNACRN", "ACRN"), ("QNXQVMBSQG", "QNX"), ("VirtualApple", "Apple Virtualization")];
    BEKANNT.iter().find(|(k, _)| name.trim() == k.trim()).map(|(_, n)| *n)
}

/// Treiber, die nur in einer virtuellen Maschine (als Gast) installiert sind. Auf dem Gastgeber fehlen sie.
pub const GAST_TREIBER: &[&str] = &[
    "VBoxGuest.sys", "VBoxMouse.sys", "VBoxSF.sys", "VBoxVideo.sys", "VBoxWddm.sys",
    "vmhgfs.sys", "vmmouse.sys", "vm3dmp.sys", "vmusbmouse.sys", "vmrawdsk.sys", "vmmemctl.sys",
    "prl_fs.sys", "prl_tg.sys", "prl_eth5.sys", "prl_memdev.sys",
    "viostor.sys", "vioscsi.sys", "vioinput.sys", "balloon.sys", "netkvm.sys",
    "xenbus.sys", "xenvbd.sys",
];

/// Modell eines Macs aus sysctl hw.model: «VirtualMac2,1» (Apple-Virtualisierung), «VMware7,1», «Parallels…»
pub fn mac_modell_verdaechtig(modell: &str) -> bool {
    let m = modell.to_lowercase();
    m.starts_with("virtualmac") || m.contains("vmware") || m.contains("parallels")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hypervisor_und_modelle() {
        assert_eq!(hypervisor_verdaechtig("VMwareVMware"), Some("VMware"));
        assert_eq!(hypervisor_verdaechtig("VBoxVBoxVBox"), Some("VirtualBox"));
        assert_eq!(hypervisor_verdaechtig("Microsoft Hv"), None);
        assert_eq!(hypervisor_verdaechtig(""), None);
        assert!(mac_modell_verdaechtig("VirtualMac2,1"));
        assert!(!mac_modell_verdaechtig("Mac14,2"));
        let _ = hypervisor_name();
    }
    #[test]
    fn erkennt_typische_angaben() {
        assert!(hersteller_verdaechtig("VMware, Inc. VMware Virtual Platform"));
        assert!(hersteller_verdaechtig("innotek GmbH VirtualBox"));
        assert!(!hersteller_verdaechtig("LENOVO ThinkPad T14 Gen 3"));
        assert!(mac_verdaechtig("08-00-27-AB-CD-EF"));
        assert!(!mac_verdaechtig("a4:83:e7:12:34:56"));
    }
}
