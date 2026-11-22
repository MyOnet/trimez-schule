// Eingaben prüfen (Server und Oberfläche verwenden dieselben Regeln)
import { z } from "zod";

const text = (max) => z.string().trim().min(1, "Bitte ausfüllen.").max(max, `Höchstens ${max} Zeichen.`);
const datum = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum im Format JJJJ-MM-TT.");
const id = z.string().uuid();

export const Schuljahr = z.object({
  bezeichnung: z.string().trim().regex(/^\d{4}\/\d{2}$/, "Format «2026/27»."),
  von: datum, bis: datum, aktiv: z.boolean().optional(),
  semester: z.array(z.object({ nr: z.union([z.literal(1), z.literal(2)]), von: datum, bis: datum })).max(2).optional(),
}).refine((x) => x.bis > x.von, { message: "Das Ende muss nach dem Anfang liegen.", path: ["bis"] });

export const Fach = z.object({
  name: text(60), kuerzel: z.string().trim().min(1).max(8).regex(/^[A-Za-zÄÖÜäöü0-9]+$/, "Nur Buchstaben und Ziffern."),
  farbe: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(), promotionsrelevant: z.boolean().optional(),
});

export const Klasse = z.object({
  schuljahr_id: id, name: z.string().trim().min(1).max(12),
  stufe: z.number().int().min(1).max(6).nullable().optional(), profil: z.string().trim().max(40).nullable().optional(),
  klassenlehrperson_id: id.nullable().optional(),
});

export const Person = z.object({
  vorname: text(60), nachname: text(60),
  email: z.string().trim().toLowerCase().email("Keine gültige E-Mail-Adresse.").max(200).nullable().optional(),
  kuerzel: z.string().trim().max(6).nullable().optional(), extern_id: z.string().trim().max(40).nullable().optional(),
  rollen: z.array(z.enum(["admin", "schulleitung", "lehrperson", "schueler", "eltern"])).min(1, "Mindestens eine Rolle."),
  geburtsdatum: datum.nullable().optional(),
});

export const Unterricht = z.object({
  klasse_id: id, fach_id: id, gruppe: z.string().trim().max(40).optional(),
  lehrpersonen: z.array(id).max(4).optional(),
});

export const Passwort = z.string().min(12, "Mindestens 12 Zeichen.").max(200);
