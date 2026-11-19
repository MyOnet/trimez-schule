export class Fehler extends Error { constructor(status, msg, feld) { super(msg); this.status = status; this.feld = feld; } }
export const fehler = (status, msg, feld) => { throw new Fehler(status, msg, feld); };
/** zod-Ergebnis → Daten oder Fehler 400 mit erstem Feld */
export function gueltig(schema, daten) {
  const r = schema.safeParse(daten);
  if (r.success) return r.data;
  const i = r.error.issues[0];
  throw new Fehler(400, i.message, i.path.join("."));
}
