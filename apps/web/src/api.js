// Aufrufe an den Server. Schreibende Aufrufe senden «x-schule: 1» (Schutz gegen fremde Formulare).
export class ApiFehler extends Error { constructor(status, msg, feld) { super(msg); this.status = status; this.feld = feld; } }
export async function api(pfad, { methode = "GET", daten, datei } = {}) {
  const opts = { method: methode, headers: {}, credentials: "same-origin" };
  if (methode !== "GET") opts.headers["x-schule"] = "1";
  if (datei) { const f = new FormData(); f.append("datei", datei); opts.body = f; }
  else if (daten !== undefined) { opts.headers["content-type"] = "application/json"; opts.body = JSON.stringify(daten); }
  let res;
  try { res = await fetch(pfad, opts); } catch { throw new ApiFehler(0, "Keine Verbindung zum Server. Bitte Internet prüfen."); }
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiFehler(res.status, d.fehler || "Das hat nicht geklappt.", d.feld);
  return d;
}

/** Datei hochladen mit Fortschritt (0…1). felder: weitere Formularfelder */
export function hochladen(pfad, datei, felder = {}, fortschritt = () => {}) {
  return new Promise((ok, nein) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(felder)) if (v != null && v !== "") f.append(k, v);
    f.append("datei", datei);
    const x = new XMLHttpRequest();
    x.open("POST", pfad); x.setRequestHeader("x-schule", "1");
    x.upload.onprogress = (e) => e.lengthComputable && fortschritt(e.loaded / e.total);
    x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText); } catch {} x.status < 300 ? ok(d) : nein(new ApiFehler(x.status, d.fehler || "Das Hochladen hat nicht geklappt.", d.feld)); };
    x.onerror = () => nein(new ApiFehler(0, "Keine Verbindung zum Server. Bitte Internet prüfen."));
    x.send(f);
  });
}
