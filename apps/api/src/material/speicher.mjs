import { fileURLToPath } from "node:url";
// Dateispeicher. Zwei Treiber:
//   lokal (Entwicklung, kleine Installationen): Ordner auf dem Server, jede Datei mit AES-256-GCM verschlüsselt
//   s3 (Produktion, Infomaniak-Objektspeicher): serverseitig verschlüsselt, Download über kurzlebige signierte Links
// Auswahl über SPEICHER=lokal|s3. Für s3: S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ZUGRIFF, S3_GEHEIM.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { schluessel } from "../krypto.mjs";

const ART = process.env.SPEICHER || "lokal";
const ORDNER = path.resolve(process.env.SPEICHER_ORDNER || fileURLToPath(new URL("../../../../daten/dateien", import.meta.url)));
const DATEI_KEY = schluessel("dateien");

const keyPruefen = (key) => { if (!/^[0-9a-f-]{36}\/\d{4}\/[0-9a-f-]{36}$/.test(key)) throw new Error("Ungültiger Dateischlüssel."); return key; };
export const neuerKey = (schuleId) => `${schuleId}/${new Date().getFullYear()}/${crypto.randomUUID()}`;

let s3 = null;
async function s3Client() {
  if (s3) return s3;
  const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
  const client = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION || "us-east-1", forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ZUGRIFF, secretAccessKey: process.env.S3_GEHEIM } });
  s3 = { client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, getSignedUrl, bucket: process.env.S3_BUCKET };
  return s3;
}

export const speicher = {
  art: ART,
  async ablegen(key, daten, mime) {
    keyPruefen(key);
    if (ART === "s3") {
      const s = await s3Client();
      await s.client.send(new s.PutObjectCommand({ Bucket: s.bucket, Key: key, Body: daten, ContentType: mime, ServerSideEncryption: "AES256" }));
      return;
    }
    const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", DATEI_KEY, iv);
    c.setAAD(Buffer.from(key));
    const enc = Buffer.concat([c.update(daten), c.final()]);
    const ziel = path.join(ORDNER, key);
    await fs.mkdir(path.dirname(ziel), { recursive: true });
    await fs.writeFile(ziel + ".tmp", Buffer.concat([iv, c.getAuthTag(), enc]));
    await fs.rename(ziel + ".tmp", ziel);
  },
  /** Nur lokal: entschlüsselte Datei */
  async lesen(key) {
    keyPruefen(key);
    const roh = await fs.readFile(path.join(ORDNER, key));
    const d = crypto.createDecipheriv("aes-256-gcm", DATEI_KEY, roh.subarray(0, 12));
    d.setAAD(Buffer.from(key)); d.setAuthTag(roh.subarray(12, 28));
    return Buffer.concat([d.update(roh.subarray(28)), d.final()]);
  },
  /** Nur s3: signierter Link, 5 Minuten gültig */
  async link(key, { dateiname, mime, inline }) {
    const s = await s3Client();
    return s.getSignedUrl(s.client, new s.GetObjectCommand({ Bucket: s.bucket, Key: keyPruefen(key), ResponseContentType: mime,
      ResponseContentDisposition: `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(dateiname)}` }), { expiresIn: 300 });
  },
  async loeschen(key) {
    keyPruefen(key);
    if (ART === "s3") { const s = await s3Client(); await s.client.send(new s.DeleteObjectCommand({ Bucket: s.bucket, Key: key })); return; }
    await fs.rm(path.join(ORDNER, key), { force: true });
  },
};
