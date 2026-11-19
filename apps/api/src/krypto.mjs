import crypto from "node:crypto";
// Geheimer Schlüssel des Servers (32 Byte, Base64). In Produktion zwingend gesetzt.
const raw = process.env.APP_SECRET || (process.env.NODE_ENV === "production" ? null : crypto.createHash("sha256").update("nur-fuer-entwicklung").digest("base64"));
if (!raw) throw new Error("APP_SECRET fehlt.");
const KEY = Buffer.from(raw, "base64");
if (KEY.length !== 32) throw new Error("APP_SECRET muss 32 Byte (Base64) lang sein.");

export const zufall = (n = 32) => crypto.randomBytes(n).toString("base64url");
export const hash = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
export const ipHash = (ip) => crypto.createHmac("sha256", KEY).update(String(ip || "")).digest("hex").slice(0, 16);
export function verschluesseln(text) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([c.update(String(text), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64url")).join(".");
}
export function entschluesseln(s) {
  const [iv, tag, enc] = String(s).split(".").map((x) => Buffer.from(x, "base64url"));
  const d = crypto.createDecipheriv("aes-256-gcm", KEY, iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}
/** Abgeleiteter Schlüssel für einen Zweck (z. B. «dateien»), damit nicht überall derselbe Schlüssel verwendet wird */
export const schluessel = (zweck) => Buffer.from(crypto.hkdfSync("sha256", KEY, Buffer.alloc(0), Buffer.from("trimez-schule:" + zweck), 32));
