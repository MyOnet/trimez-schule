// Neue Version der Lernumgebung vorbereiten: eigener Schlüssel pro Version.
//   node scripts/lu-neue-version.mjs 1.1.0
// Gibt aus, was wohin gehört (nichts wird gespeichert):
//   - LU_SCHLUESSEL als Secret für den Build (GitHub Actions)
//   - die Ergänzung für LERNUMGEBUNG_SCHLUESSEL auf dem Server
// Danach: LERNUMGEBUNG_MIN_VERSION auf die neue Version setzen, sobald alle sie haben. Ältere Versionen werden dann abgewiesen.
import crypto from "node:crypto";
const v = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(v || "")) { console.error("Bitte die Version angeben, z. B.: node scripts/lu-neue-version.mjs 1.1.0"); process.exit(1); }
const k = crypto.randomBytes(32).toString("base64url");
console.log(`Version ${v}

1. Secret für den Build (GitHub → Settings → Secrets → Actions):
   LU_SCHLUESSEL = ${k}

2. Auf dem Server an LERNUMGEBUNG_SCHLUESSEL anhängen (mit «;» getrennt):
   ${v}=${k}

3. Versionsnummer in apps/lernumgebung/Cargo.toml (workspace.package.version) auf ${v} setzen und bauen.
4. Wenn alle die neue Version haben: LERNUMGEBUNG_MIN_VERSION=${v}`);
