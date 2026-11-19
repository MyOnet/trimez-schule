// Sitzungen (Cookie «tzs», HttpOnly), Anmelde-Hilfen und die Routen-Hülle mit Rechte-Kontext
import { sql, mitSchule } from "./db.mjs";
import { hash, zufall } from "./krypto.mjs";
import { kontext } from "./kontext.mjs";
import { fehler } from "./fehler.mjs";

export const COOKIE = "tzs";
const PROD = process.env.NODE_ENV === "production";
const STUNDEN = Number(process.env.SITZUNG_STUNDEN || 12);

export async function neueSitzung(res, q, { schuleId, personId, stufe = "voll", via = "lokal", geraet = "" }) {
  const token = zufall(32);
  const ab = new Date(Date.now() + (stufe === "voll" ? STUNDEN * 3600e3 : 10 * 60e3));
  await q("INSERT INTO sitzung (token_hash, schule_id, person_id, stufe, via, laeuft_ab, geraet) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [hash(token), schuleId, personId, stufe, via, ab, String(geraet).slice(0, 160)]);
  res.setCookie(COOKIE, token, { path: "/", httpOnly: true, secure: PROD, sameSite: "lax", expires: ab });
  return token;
}
export async function sitzungLesen(req) {
  const t = req.cookies && req.cookies[COOKIE];
  if (!t || t.length > 100) return null;
  const { rows } = await sql("SELECT * FROM sitzung_finden($1)", [hash(t)]);
  return rows[0] ? { ...rows[0], tokenHash: hash(t) } : null;
}

// Eigene Konten von Admins, Schulleitung und Lehrpersonen brauchen einen zweiten Faktor.
// Bis er eingerichtet ist, sind nur die Konto-Seiten erlaubt.
export const zweiterFaktorPflicht = (ctx) => ["admin", "schulleitung", "lehrperson"].some((r) => ctx.rollen.has(r));

/**
 * Routen-Hülle: Sitzung prüfen, Schule setzen, Kontext laden, Handler in einer Transaktion ausführen.
 * opts.konto: erlaubt, auch wenn der zweite Faktor noch eingerichtet werden muss
 */
export function geschuetzt(handler, opts = {}) {
  return async (req, res) => {
    const s = await sitzungLesen(req);
    if (!s || s.stufe !== "voll") fehler(401, "Bitte melden Sie sich an.");
    req.sitzung = s;
    return mitSchule(s.schule_id, async (q) => {
      const ctx = await kontext(q, s.person_id);
      if (!ctx) fehler(401, "Bitte melden Sie sich an.");
      if (s.via === "lokal" && zweiterFaktorPflicht(ctx) && !opts.konto) {
        const [k] = await q("SELECT totp_aktiv FROM konto WHERE person_id = $1 AND art = 'lokal'", [s.person_id]);
        if (!k || !k.totp_aktiv) fehler(403, "Bitte richten Sie zuerst die Zwei-Faktor-Anmeldung ein.", "zweiter_faktor");
      }
      req.ctx = ctx;
      await q("UPDATE sitzung SET letzte_aktivitaet = now() WHERE token_hash = $1", [s.tokenHash]);
      return handler(req, res, q);
    });
  };
}
