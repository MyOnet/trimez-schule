// OneNote-Import über die Microsoft-Anmeldung der Schule.
//   Die Schule hat RESCOOL bei der Einrichtung von Microsoft 365 einmal freigegeben (Administratorzustimmung).
//   Hier bittet RESCOOL zusätzlich um «Notizen lesen» (Notes.Read). Der Schlüssel bleibt auf dem Server, im Speicher,
//   nur für diese Sitzung und höchstens eine Stunde. Der Browser steuert den Import und holt die Daten über diesen Server.
import { Issuer, generators } from "openid-client";
import { geschuetzt } from "../sitzung.mjs";
import { fehler } from "../fehler.mjs";
import { protokolliere } from "../protokoll.mjs";
import { zufall } from "../krypto.mjs";
import { dateiAblegen, abschnitt } from "./notizbuch.mjs";
import { sauberName } from "../material/dateien.mjs";

const PUBLIC = () => (process.env.PUBLIC_URL || "http://localhost:5180").replace(/\/$/, "");
const RUECKRUF = () => `${PUBLIC()}/api/onenote/rueckruf`;
const SCOPE = "offline_access Notes.Read";
const GRAPH = "https://graph.microsoft.com/";

// sitzung → { access, refresh, ablauf, tenant }
const schluessel = new Map();
setInterval(() => { const t = Date.now(); for (const [k, v] of schluessel) if (v.weg < t) schluessel.delete(k); }, 60_000).unref();

const clients = new Map();
async function client(tenant) {
  if (clients.has(tenant)) return clients.get(tenant);
  const issuer = await Issuer.discover(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/v2.0`);
  const c = new issuer.Client({ client_id: process.env.MS_CLIENT_ID, client_secret: process.env.MS_CLIENT_SECRET, redirect_uris: [RUECKRUF()], response_types: ["code"] });
  clients.set(tenant, c);
  return c;
}

// Für Tests ohne Microsoft: ONENOTE_TEST=1 liefert Beispieldaten (nie in Produktion)
const TEST = process.env.ONENOTE_TEST === "1" && process.env.NODE_ENV !== "production";

async function zugriff(req) {
  const s = schluessel.get(req.sitzung.tokenHash);
  if (!s) fehler(401, "Bitte zuerst mit Microsoft verbinden.", "onenote");
  if (s.ablauf > Date.now() + 60_000 || !s.refresh) return s.access;
  const c = await client(s.tenant);
  const t = await c.refresh(s.refresh).catch(() => fehler(401, "Die Verbindung zu Microsoft ist abgelaufen. Bitte neu verbinden.", "onenote"));
  Object.assign(s, { access: t.access_token, refresh: t.refresh_token || s.refresh, ablauf: Date.now() + (t.expires_in || 3600) * 1000 });
  return s.access;
}
async function holen(req, url) {
  if (!String(url).startsWith(GRAPH)) fehler(400, "Nur Adressen von Microsoft Graph sind erlaubt.");
  if (TEST) return testAntwort(url);
  const r = await fetch(url, { headers: { authorization: `Bearer ${await zugriff(req)}` } });
  return r;
}

export default async function (app) {
  app.get("/api/onenote/status", geschuetzt(async (req, res, q) => {
    const [s] = await q("SELECT ms_tenant FROM schule");
    return { verbunden: TEST || schluessel.has(req.sitzung.tokenHash), moeglich: TEST || !!(s && s.ms_tenant && process.env.MS_CLIENT_ID) };
  }));

  // Anmeldung bei Microsoft (nur Notizen lesen). zurueck: Seite, auf die es danach geht
  app.get("/api/onenote/verbinden", geschuetzt(async (req, res, q) => {
    const zurueck = String(req.query.zurueck || "/").startsWith("/") ? String(req.query.zurueck || "/").slice(0, 300) : "/";
    if (TEST) { schluessel.set(req.sitzung.tokenHash, { access: "test", ablauf: Date.now() + 3600e3, weg: Date.now() + 3600e3 }); return res.redirect(zurueck + (zurueck.includes("?") ? "&" : "?") + "onenote=1"); }
    const [s] = await q("SELECT ms_tenant FROM schule");
    if (!s.ms_tenant || !process.env.MS_CLIENT_ID) fehler(400, "Microsoft 365 ist für diese Schule noch nicht verbunden. Bitte wenden Sie sich an die Administration.");
    const c = await client(s.ms_tenant);
    const st = { state: zufall(16), verifier: generators.codeVerifier(), tenant: s.ms_tenant, zurueck };
    res.setCookie("tzn", Buffer.from(JSON.stringify(st)).toString("base64url"), { path: "/api/onenote", httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 600, signed: true });
    return res.redirect(c.authorizationUrl({ scope: SCOPE, state: st.state, code_challenge: generators.codeChallenge(st.verifier), code_challenge_method: "S256", login_hint: req.ctx.person.email || undefined }));
  }));

  app.get("/api/onenote/rueckruf", geschuetzt(async (req, res, q) => {
    const raw = req.cookies.tzn && req.unsignCookie(req.cookies.tzn);
    if (!raw || !raw.valid) fehler(400, "Die Verbindung ist abgelaufen. Bitte nochmals versuchen.");
    const st = JSON.parse(Buffer.from(raw.value, "base64url").toString());
    res.clearCookie("tzn", { path: "/api/onenote" });
    if (req.query.error) return res.redirect(st.zurueck + (st.zurueck.includes("?") ? "&" : "?") + "onenote=fehler");
    const c = await client(st.tenant);
    const t = await c.oauthCallback(RUECKRUF(), c.callbackParams(req.raw), { state: st.state, code_verifier: st.verifier });
    schluessel.set(req.sitzung.tokenHash, { access: t.access_token, refresh: t.refresh_token, ablauf: Date.now() + (t.expires_in || 3600) * 1000, tenant: st.tenant, weg: Date.now() + 3600e3 });
    await protokolliere(q, req, "onenote.verbunden", "person", req.ctx.personId);
    return res.redirect(st.zurueck + (st.zurueck.includes("?") ? "&" : "?") + "onenote=1");
  }));

  app.post("/api/onenote/trennen", geschuetzt(async (req) => { schluessel.delete(req.sitzung.tokenHash); return { ok: true }; }));

  // Graph-Abfrage weiterreichen (Text: JSON, HTML, InkML)
  app.get("/api/onenote/graph", geschuetzt(async (req) => {
    const r = await holen(req, req.query.url);
    return { status: r.status, content_type: r.headers.get("content-type") || "", retry_after: Number(r.headers.get("retry-after")) || 0, body: await r.text() };
  }));

  // Bild oder Anhang direkt in den Abschnitt übernehmen
  app.post("/api/onenote/datei", geschuetzt(async (req, res, q) => {
    const b = req.body || {};
    const r = await holen(req, b.url);
    if (r.status < 200 || r.status >= 300) return { status: r.status, retry_after: Number(r.headers.get("retry-after")) || 0, name: "" };
    const typ = r.headers.get("content-type") || "";
    const ext = String(b.ext || typ.split("/")[1] || "bin").split(";")[0].replace("jpeg", "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 8);
    const name = sauberName(b.name || `bild.${ext}`);
    const { a } = await abschnitt(q, req.ctx, b.abschnitt_id, true);
    try {
      const f = await dateiAblegen(q, req, a, { buf: Buffer.from(await r.arrayBuffer()), name: /\.[a-z0-9]{1,8}$/i.test(name) ? name : `${name}.${ext}` });
      return { status: 200, name: f.id, content_type: f.mime };
    } catch (e) { return { status: e.status || 415, name: "", fehler: e.message }; }
  }));
}

/* ---------- Beispieldaten für Tests ---------- */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGklEQVR4nGNgGAWjYBSMglEwCkbBKBgFgwIAAX4AAa3IRm0AAAAASUVORK5CYII=", "base64");
function testAntwort(url) {
  const J = (v) => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
  const u = String(url);
  if (u.includes("/resources/")) return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
  if (u.includes("/notebooks?")) return J({ value: [{ id: "nb1", displayName: "Biologie" }] });
  if (u.includes("/notebooks/nb1/sections")) return J({ value: [{ id: "s1", displayName: "Zellen", createdDateTime: "2025-01-01T00:00:00Z" }, { id: "s0", displayName: "Einführung", createdDateTime: "2024-09-01T00:00:00Z" }] });
  if (u.includes("/notebooks/nb1/sectionGroups")) return J({ value: [{ id: "g1", displayName: "Archiv 2024" }] });
  if (u.includes("/sectionGroups/g1/sections")) return J({ value: [{ id: "s2", displayName: "Ökologie" }] });
  if (u.includes("/sectionGroups/g1/sectionGroups")) return J({ value: [{ id: "g2", displayName: "Alt" }] });
  if (u.includes("/sectionGroups/g2/sections")) return J({ value: [{ id: "s3", displayName: "Notizen" }] });
  if (u.includes("/sectionGroups/g2/sectionGroups")) return J({ value: [] });
  if (u.includes("/pages?")) return J({ value: [{ id: "p2", title: "Mitose", level: 1, order: 1 }, { id: "p1", title: "Die Zelle", level: 0, order: 0 }, { id: "p3", title: "Repetition", level: 0, order: 2 }] });
  if (u.includes("/content")) {
    const html = `<html><head><title>x</title></head><body data-absolute-enabled="true" style="font-family:Calibri;font-size:11pt">
<div style="position:absolute;left:48px;top:120px;width:560px"><p>Die Zelle ist die <span style="font-weight:bold">kleinste Einheit</span> des Lebens.</p>
<ul><li data-tag="to-do">Skizze zeichnen</li><li data-tag="to-do:completed">Kapitel lesen</li></ul><p data-tag="important">Prüfung am Freitag</p></div>
<img width="120" height="120" src="https://graph.microsoft.com/v1.0/users('x')/onenote/resources/1/$value" data-src-type="image/png" style="position:absolute;left:640px;top:130px" /></body></html>`;
    const ink = `<inkml:ink xmlns:inkml="http://www.w3.org/2003/InkML"><inkml:definitions><inkml:brush xml:id="b"><inkml:brushProperty name="width" value="60" units="himetric"/><inkml:brushProperty name="color" value="#2F5BEA"/></inkml:brush></inkml:definitions><inkml:trace brushRef="#b">2000 9000, 4000 9600, 6000 8800, 8000 9800</inkml:trace></inkml:ink>`;
    return new Response(`--b1\r\nContent-Type: text/html\r\n\r\n${html}\r\n--b1\r\nContent-Type: application/inkml+xml\r\n\r\n${ink}\r\n--b1--`, { status: 200, headers: { "content-type": "multipart/related; boundary=b1" } });
  }
  return new Response("{}", { status: 404 });
}
