import { fileURLToPath } from "node:url";
// RESCOOL: Server
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import statik from "@fastify/static";
import path from "node:path";
import fs from "node:fs";
import { Fehler } from "./fehler.mjs";
import { zufall } from "./krypto.mjs";

export async function bauen({ log = false } = {}) {
  const app = Fastify({ logger: log, trustProxy: true, bodyLimit: 2 * 1024 * 1024 });
  await app.register(cookie, { secret: process.env.COOKIE_SECRET || process.env.APP_SECRET || "nur-fuer-entwicklung-" + (process.env.NODE_ENV === "production" ? zufall() : "x") });
  (await import("./lernumgebung.mjs")).einrichten(app);
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, files: 1, fields: 30 } });
  await app.register(rateLimit, { global: false });

  // Sicherheits-Header
  app.addHook("onSend", async (req, res, payload) => {
    res.header("X-Content-Type-Options", "nosniff");
    res.header("Referrer-Policy", "same-origin");
    if (!res.getHeader("X-Frame-Options")) res.header("X-Frame-Options", "DENY");
    if (!res.getHeader("Cache-Control") && req.url.startsWith("/api/")) res.header("Cache-Control", "no-store");
    return payload;
  });
  // Schutz gegen fremde Formulare: schreibende API-Aufrufe nur mit eigenem Header (der Browser setzt ihn nur für eigene Seiten)
  app.addHook("onRequest", async (req) => {
    if (req.url.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(req.method) && req.headers["x-schule"] !== "1") throw new Fehler(403, "Ungültige Anfrage.");
  });

  app.setErrorHandler((e, req, res) => {
    if (e instanceof Fehler || (Number.isInteger(e.status) && e.status >= 400 && e.status < 500)) return res.status(e.status).send({ fehler: e.message, feld: e.feld || null });
    if (e.statusCode === 429) return res.status(429).send({ fehler: "Zu viele Versuche. Bitte kurz warten." });
    if (e.statusCode && e.statusCode < 500) return res.status(e.statusCode).send({ fehler: "Ungültige Anfrage." });
    req.log.error(e);
    return res.status(500).send({ fehler: "Es ist ein Fehler aufgetreten. Bitte nochmals versuchen." });
  });

  await app.register((await import("./routes/anmeldung.mjs")).default);
  await app.register((await import("./routes/verwaltung.mjs")).default);
  await app.register((await import("./routes/import.mjs")).default);
  await app.register((await import("./routes/noten.mjs")).default);
  await app.register((await import("./routes/material.mjs")).default);
  await app.register((await import("./routes/pruefungen.mjs")).default);
  await app.register((await import("./routes/durchfuehrung.mjs")).default);
  await app.register((await import("./routes/lektionen.mjs")).default);
  await app.register((await import("./routes/notizbuch.mjs")).default);
  await app.register((await import("./routes/onenote.mjs")).default);

  // Oberfläche (gebaut mit Vite) ausliefern; alle anderen Pfade → index.html
  const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  if (fs.existsSync(web)) {
    await app.register(statik, { root: web, wildcard: false, index: false });
    const html = fs.readFileSync(path.join(web, "index.html"), "utf8");
    app.setNotFoundHandler((req, res) => (req.url.startsWith("/api/") ? res.status(404).send({ fehler: "Nicht gefunden." }) : res.type("text/html").header("Cache-Control", "no-cache").send(html)));
  }
  return app;
}

// Direkt gestartet (node apps/api/src/server.mjs)? Vergleich über echte Pfade, damit es auch unter Windows klappt
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await bauen({ log: { level: "info" } });
  await app.listen({ port: Number(process.env.PORT || 5180), host: "0.0.0.0" });
}
