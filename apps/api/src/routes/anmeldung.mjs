// Anmeldung: eigenes Konto (Passwort + Zwei-Faktor), Microsoft 365 und edu-ID (OpenID Connect)
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { authenticator } from "otplib";
import QRCode from "qrcode";
import { Issuer, generators } from "openid-client";
import { sql, mitSchule } from "../db.mjs";
import { verschluesseln, entschluesseln, hash, zufall } from "../krypto.mjs";
import { fehler, gueltig } from "../fehler.mjs";
import { neueSitzung, sitzungLesen, geschuetzt, COOKIE, zweiterFaktorPflicht } from "../sitzung.mjs";
import { protokolliere } from "../protokoll.mjs";
import { Passwort, TEXTE } from "@schule/shared";

const T = TEXTE.anmelden;
authenticator.options = { window: 1 };
const PUBLIC = () => (process.env.PUBLIC_URL || "http://localhost:5180").replace(/\/$/, "");
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };
export const passwortHash = (p) => argonHash(p, ARGON);

async function schuleNach(kurz) {
  const { rows } = await sql("SELECT * FROM schule_oeffentlich($1)", [String(kurz || "").toLowerCase()]);
  if (!rows[0]) fehler(404, T.schuleUnbekannt);
  return rows[0];
}

// Gleiche Antwortzeit, auch wenn es die E-Mail nicht gibt
const DUMMY = await argonHash("dummy-passwort-zum-vergleichen", ARGON);

export default async function (app) {
  app.get("/api/schule/:kurz", async (req) => {
    const s = await schuleNach(req.params.kurz);
    return { kurzname: s.kurzname, name: s.name, wege: { ms: s.ms && !!process.env.MS_CLIENT_ID, eduid: s.eduid && !!process.env.EDUID_CLIENT_ID, lokal: s.lokal } };
  });

  // ---------- Eigenes Konto ----------
  // Grenze pro Netzadresse UND Konto: Eine ganze Klasse meldet sich oft gleichzeitig über dieselbe Adresse der Schule an.
  // Wiederholte Fehlversuche auf ein Konto sperren es zusätzlich (siehe unten).
  const proKonto = { max: Number(process.env.ANMELDE_LIMIT) || 10, timeWindow: "1 minute", hook: "preHandler", keyGenerator: (req) => `${req.ip}|${String((req.body && req.body.email) || "").trim().toLowerCase().slice(0, 200)}` };
  app.post("/api/s/:kurz/anmelden", { config: { rateLimit: proKonto } }, async (req, res) => {
    const s = await schuleNach(req.params.kurz);
    if (!s.lokal) fehler(403, "Diese Schule erlaubt nur die Anmeldung über Microsoft 365 oder edu-ID.");
    const email = String(req.body && req.body.email || "").trim().toLowerCase().slice(0, 200);
    const pw = String(req.body && req.body.passwort || "").slice(0, 200);
    // Fehlversuche werden gespeichert (Transaktion wird bestätigt), der Fehler erst danach geworfen
    const r = await mitSchule(s.id, async (q) => {
      const [k] = await q(`SELECT k.*, p.status FROM konto k JOIN person p ON p.id = k.person_id WHERE k.art = 'lokal' AND p.email = $1`, [email]);
      if (k && k.gesperrt_bis && new Date(k.gesperrt_bis) > new Date()) return { fehler: [429, T.gesperrt] };
      const ok = await argonVerify(k ? k.passwort_hash : DUMMY, pw).catch(() => false);
      if (!k || !ok || k.status !== "aktiv") {
        if (k) await q("UPDATE konto SET fehlversuche = fehlversuche + 1, gesperrt_bis = CASE WHEN fehlversuche + 1 >= 8 THEN now() + interval '15 minutes' ELSE gesperrt_bis END WHERE id = $1", [k.id]);
        await protokolliere(q, req, "anmeldung.fehlgeschlagen", "konto", k && k.id);
        return { fehler: [401, T.falsch] };
      }
      await q("UPDATE konto SET fehlversuche = 0, gesperrt_bis = NULL WHERE id = $1", [k.id]);
      if (k.totp_aktiv) {
        await neueSitzung(res, q, { schuleId: s.id, personId: k.person_id, stufe: "zweiter_faktor", via: "lokal", geraet: req.headers["user-agent"] });
        return { zweiterFaktor: true };
      }
      await q("UPDATE konto SET letzte_anmeldung = now() WHERE id = $1", [k.id]);
      await neueSitzung(res, q, { schuleId: s.id, personId: k.person_id, via: "lokal", geraet: req.headers["user-agent"] });
      await protokolliere(q, req, "anmeldung", "konto", k.id);
      return { ok: true };
    });
    if (r.fehler) fehler(...r.fehler);
    return r;
  });

  app.post("/api/anmelden/code", { config: { rateLimit: { max: 10, timeWindow: "1 minute", hook: "preHandler", keyGenerator: (req) => `${req.ip}|${req.cookies ? Object.values(req.cookies).join("").slice(0, 80) : ""}` } } }, async (req, res) => {
    const s = await sitzungLesen(req);
    if (!s || s.stufe !== "zweiter_faktor") fehler(401, "Bitte zuerst mit E-Mail und Passwort anmelden.");
    const code = String(req.body && req.body.code || "").replace(/\s/g, "");
    const r = await mitSchule(s.schule_id, async (q) => {
      const [k] = await q("SELECT * FROM konto WHERE person_id = $1 AND art = 'lokal'", [s.person_id]);
      if (!k || !k.totp_aktiv) return { fehler: [401, T.codeFalsch] };
      if (k.fehlversuche >= 8) { await q("DELETE FROM sitzung WHERE token_hash = $1", [s.tokenHash]); return { fehler: [429, T.gesperrt] }; }
      if (!authenticator.check(code, entschluesseln(k.totp_geheimnis))) {
        await q("UPDATE konto SET fehlversuche = fehlversuche + 1, gesperrt_bis = CASE WHEN fehlversuche + 1 >= 8 THEN now() + interval '15 minutes' ELSE gesperrt_bis END WHERE id = $1", [k.id]);
        return { fehler: [401, T.codeFalsch] };
      }
      await q("DELETE FROM sitzung WHERE token_hash = $1", [s.tokenHash]);
      await q("UPDATE konto SET letzte_anmeldung = now(), fehlversuche = 0 WHERE id = $1", [k.id]);
      await neueSitzung(res, q, { schuleId: s.schule_id, personId: s.person_id, via: "lokal", geraet: req.headers["user-agent"] });
      await protokolliere(q, { ...req, ctx: { personId: s.person_id } }, "anmeldung", "konto", k.id);
      return { ok: true };
    });
    if (r.fehler) fehler(...r.fehler);
    return r;
  });

  app.post("/api/abmelden", async (req, res) => {
    const s = await sitzungLesen(req);
    if (s) await mitSchule(s.schule_id, (q) => q("DELETE FROM sitzung WHERE token_hash = $1", [s.tokenHash]));
    res.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/ich", geschuetzt(async (req, res, q) => {
    const [schule] = await q("SELECT id, kurzname, name, kanton, typ FROM schule");
    const [k] = await q("SELECT totp_aktiv FROM konto WHERE person_id = $1 AND art = 'lokal'", [req.ctx.personId]);
    const pflicht = req.sitzung.via === "lokal" && zweiterFaktorPflicht(req.ctx) && !(k && k.totp_aktiv);
    return { person: req.ctx.person, rollen: [...req.ctx.rollen], schule, via: req.sitzung.via, zweiterFaktor: { aktiv: !!(k && k.totp_aktiv), einrichtenPflicht: pflicht, lokalesKonto: !!k } };
  }, { konto: true }));

  // ---------- Zwei-Faktor einrichten ----------
  app.post("/api/konto/2fa/start", geschuetzt(async (req, res, q) => {
    const [k] = await q("SELECT * FROM konto WHERE person_id = $1 AND art = 'lokal'", [req.ctx.personId]);
    if (!k) fehler(400, "Sie melden sich über Microsoft 365 oder edu-ID an; der zweite Faktor läuft dort.");
    if (k.totp_aktiv) fehler(400, "Die Zwei-Faktor-Anmeldung ist schon eingerichtet.");
    const geheim = authenticator.generateSecret(20);
    await q("UPDATE konto SET totp_geheimnis = $1 WHERE id = $2", [verschluesseln(geheim), k.id]);
    const [sch] = await q("SELECT name FROM schule");
    const uri = authenticator.keyuri(req.ctx.person.email || req.ctx.person.nachname, `trimez. Schule (${sch.name})`, geheim);
    return { geheim, qr: await QRCode.toString(uri, { type: "svg", margin: 1 }) };
  }, { konto: true }));

  app.post("/api/konto/2fa/bestaetigen", geschuetzt(async (req, res, q) => {
    const [k] = await q("SELECT * FROM konto WHERE person_id = $1 AND art = 'lokal'", [req.ctx.personId]);
    if (!k || !k.totp_geheimnis) fehler(400, "Bitte zuerst neu starten.");
    if (!authenticator.check(String(req.body && req.body.code || "").replace(/\s/g, ""), entschluesseln(k.totp_geheimnis))) fehler(400, T.codeFalsch, "code");
    await q("UPDATE konto SET totp_aktiv = true WHERE id = $1", [k.id]);
    await protokolliere(q, req, "konto.zweiter_faktor_eingerichtet", "konto", k.id);
    return { ok: true };
  }, { konto: true }));

  app.post("/api/konto/passwort", geschuetzt(async (req, res, q) => {
    const [k] = await q("SELECT * FROM konto WHERE person_id = $1 AND art = 'lokal'", [req.ctx.personId]);
    if (!k) fehler(400, "Sie haben kein eigenes Passwort bei trimez. Schule.");
    if (!(await argonVerify(k.passwort_hash, String(req.body && req.body.alt || "")).catch(() => false))) fehler(400, "Das bisherige Passwort stimmt nicht.", "alt");
    const neu = gueltig(Passwort, req.body && req.body.neu);
    await q("UPDATE konto SET passwort_hash = $1 WHERE id = $2", [await passwortHash(neu), k.id]);
    await q("DELETE FROM sitzung WHERE person_id = $1 AND token_hash <> $2", [req.ctx.personId, req.sitzung.tokenHash]); // andere Geräte abmelden
    await protokolliere(q, req, "konto.passwort_geaendert", "konto", k.id);
    return { ok: true };
  }, { konto: true }));

  // ---------- Microsoft 365 und edu-ID (OpenID Connect) ----------
  // Microsoft: pro Schule ihr Mandant (ms_tenant). edu-ID: ein gemeinsamer Zugang von trimez bei SWITCH.
  const clients = new Map();
  async function client(anbieter, tenant) {
    const key = anbieter + ":" + (tenant || "");
    if (clients.has(key)) return clients.get(key);
    const issuer = anbieter === "ms"
      ? await Issuer.discover(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/v2.0`)
      : await Issuer.discover(process.env.EDUID_ISSUER || "https://login.eduid.ch/");
    const c = new issuer.Client({
      client_id: anbieter === "ms" ? process.env.MS_CLIENT_ID : process.env.EDUID_CLIENT_ID,
      client_secret: anbieter === "ms" ? process.env.MS_CLIENT_SECRET : process.env.EDUID_CLIENT_SECRET,
      redirect_uris: [`${PUBLIC()}/api/oidc/rueckruf`], response_types: ["code"],
    });
    clients.set(key, c);
    return c;
  }

  app.get("/api/s/:kurz/oidc/:anbieter", async (req, res) => {
    const anbieter = req.params.anbieter;
    if (!["ms", "eduid"].includes(anbieter)) fehler(404, "Unbekannter Anmeldeweg.");
    const s = await schuleNach(req.params.kurz);
    const tenant = anbieter === "ms" ? (await mitSchule(s.id, (q) => q("SELECT ms_tenant FROM schule")))[0].ms_tenant : null;
    if (anbieter === "ms" && !tenant) fehler(400, "Microsoft 365 ist für diese Schule noch nicht verbunden.");
    if (anbieter === "eduid" && !s.eduid) fehler(400, "edu-ID ist für diese Schule ausgeschaltet.");
    const c = await client(anbieter, tenant);
    const st = { kurz: s.kurzname, anbieter, state: zufall(16), nonce: zufall(16), verifier: generators.codeVerifier() };
    res.setCookie("tzo", Buffer.from(JSON.stringify(st)).toString("base64url"), { path: "/api/oidc", httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 600, signed: true });
    return res.redirect(c.authorizationUrl({ scope: "openid email profile", state: st.state, nonce: st.nonce, code_challenge: generators.codeChallenge(st.verifier), code_challenge_method: "S256", ...(anbieter === "ms" ? { prompt: "select_account" } : {}) }));
  });

  app.get("/api/oidc/rueckruf", async (req, res) => {
    const raw = req.cookies.tzo && req.unsignCookie(req.cookies.tzo);
    if (!raw || !raw.valid) fehler(400, "Die Anmeldung ist abgelaufen. Bitte nochmals versuchen.");
    const st = JSON.parse(Buffer.from(raw.value, "base64url").toString());
    res.clearCookie("tzo", { path: "/api/oidc" });
    const s = await schuleNach(st.kurz);
    const tenant = st.anbieter === "ms" ? (await mitSchule(s.id, (q) => q("SELECT ms_tenant FROM schule")))[0].ms_tenant : null;
    const c = await client(st.anbieter, tenant);
    const tokens = await c.callback(`${PUBLIC()}/api/oidc/rueckruf`, c.callbackParams(req.raw), { state: st.state, nonce: st.nonce, code_verifier: st.verifier });
    const claims = tokens.claims();
    // Microsoft: Mandant muss stimmen (sonst könnte sich jedes Microsoft-Konto anmelden)
    if (st.anbieter === "ms" && claims.tid !== tenant) fehler(403, "Dieses Microsoft-Konto gehört nicht zu Ihrer Schule.");
    const subjekt = st.anbieter === "ms" ? claims.oid : claims.sub;
    const email = String(claims.email || claims.preferred_username || "").toLowerCase();
    await mitSchule(s.id, async (q) => {
      let [k] = await q("SELECT k.person_id FROM konto k JOIN person p ON p.id = k.person_id WHERE k.art = $1 AND k.subjekt = $2 AND p.status = 'aktiv'", [st.anbieter, subjekt]);
      if (!k && email) {
        // Erste Anmeldung: über die E-Mail mit der Person verknüpfen, die die Schule erfasst hat
        const [p] = await q("SELECT id FROM person WHERE email = $1 AND status = 'aktiv'", [email]);
        if (p) { await q("INSERT INTO konto (person_id, art, subjekt) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [p.id, st.anbieter, subjekt]); k = { person_id: p.id }; }
      }
      if (!k) fehler(403, "Ihr Konto ist an dieser Schule nicht erfasst. Bitte wenden Sie sich an die Administration.");
      await neueSitzung(res, q, { schuleId: s.id, personId: k.person_id, via: st.anbieter, geraet: req.headers["user-agent"] });
      await protokolliere(q, { ...req, ctx: { personId: k.person_id } }, "anmeldung", "konto", st.anbieter);
    });
    return res.redirect(`/s/${s.kurzname}/`);
  });
}
