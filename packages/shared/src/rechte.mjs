// Wer darf was? Eine Stelle für alle Rechte. Der Server ruft darf() vor jeder Aktion auf,
// die Oberfläche nur, um Knöpfe auszublenden. Massgebend ist immer der Server.
//
// ctx = { personId, rollen: Set<'admin'|'schulleitung'|'lehrperson'|'schueler'|'eltern'>,
//         unterricht: Set<id>  (Unterricht, den die Person erteilt bzw. besucht),
//         lehrt: Set<id>       (Unterricht, den sie selbst erteilt),
//         klassen: Set<id>     (Klassen, in denen sie unterrichtet, Klassenlehrperson ist oder Schüler/in ist),
//         faecher: Set<id>     (Fächer ihrer Fachgruppen und ihres Unterrichts) }

export const AKTIONEN = [
  "schule.einstellungen", "schuljahr.lesen", "schuljahr.verwalten",
  "klasse.lesen", "klasse.verwalten", "fach.lesen", "fach.verwalten",
  "person.lesen", "person.verwalten", "unterricht.lesen", "unterricht.verwalten",
  "import.ausfuehren", "protokoll.lesen", "konto.selbst",
  "noten.lesen", "noten.schreiben", "noten.eigene",
  "material.erstellen", "material.lesen", "material.bearbeiten", "material.freigeben",
  "pruefung.verwalten", "aufgabe.lesen", "aufgabe.bearbeiten",
  "lektion.leiten", "lektion.teilnehmen", "notizbuch.leiten", "notizbuch.teilnehmen",
];

const hat = (ctx, r) => ctx.rollen.has(r);

/** objekt: { klasseId?, unterrichtId?, personId? } je nach Aktion */
export function darf(ctx, aktion, objekt = {}) {
  if (!ctx || !ctx.rollen) return false;
  const admin = hat(ctx, "admin"), sl = hat(ctx, "schulleitung"), lp = hat(ctx, "lehrperson"), sch = hat(ctx, "schueler");
  switch (aktion) {
    case "konto.selbst": return true;
    case "schule.einstellungen": case "schuljahr.verwalten": case "klasse.verwalten": case "fach.verwalten":
    case "person.verwalten": case "unterricht.verwalten": case "import.ausfuehren":
      return admin;
    case "protokoll.lesen": return admin || sl;
    case "schuljahr.lesen": case "fach.lesen": return admin || sl || lp || sch;
    case "klasse.lesen":
      if (admin || sl) return true;
      if (!objekt.klasseId) return lp || sch; // Liste: der Server filtert danach auf eigene Klassen
      return (lp || sch) && ctx.klassen.has(objekt.klasseId);
    case "unterricht.lesen":
      if (admin || sl) return true;
      if (!objekt.unterrichtId) return lp || sch;
      return ctx.unterricht.has(objekt.unterrichtId);
    case "person.lesen":
      if (admin || sl) return true;
      if (objekt.personId && objekt.personId === ctx.personId) return true;
      // Lehrpersonen sehen Schüler ihrer Klassen (der Server prüft die Zugehörigkeit über objekt.klasseId)
      if (lp && objekt.klasseId) return ctx.klassen.has(objekt.klasseId);
      return false;
    // Notenbuch: die unterrichtende Lehrperson; Schulleitung und Administration lesen (Zugriff wird protokolliert).
    // Die Schulleitung darf mit Begründung ändern (der Server verlangt den Grund).
    case "noten.lesen": return admin || sl || (lp && !!objekt.unterrichtId && !!ctx.lehrt && ctx.lehrt.has(objekt.unterrichtId));
    case "noten.schreiben": return sl || (lp && !!objekt.unterrichtId && !!ctx.lehrt && ctx.lehrt.has(objekt.unterrichtId));
    case "noten.eigene": return sch;
    // Material. objekt: { besitzerId, sichtbarkeit, fachId, freigegebenFuer: [unterrichtId, …] (nur aktuell gültige Freigaben), geloescht }
    // Privates Material sieht nur, wer es besitzt, auch nicht die Administration.
    case "material.erstellen": return lp || sl;
    case "material.lesen": {
      if (objekt.besitzerId === ctx.personId) return true;
      if (objekt.geloescht) return false;
      if ((lp || sl) && objekt.sichtbarkeit === "schule") return true;
      if ((lp || sl) && objekt.sichtbarkeit === "fachgruppe" && objekt.fachId && ctx.faecher && ctx.faecher.has(objekt.fachId)) return true;
      return (objekt.freigegebenFuer || []).some((u) => ctx.unterricht.has(u));
    }
    case "material.bearbeiten": return objekt.besitzerId === ctx.personId;
    // Freigeben für einen Unterricht, den man selbst erteilt; das Material muss man lesen dürfen
    case "material.freigeben": return (lp || sl) && !!objekt.unterrichtId && !!ctx.lehrt && ctx.lehrt.has(objekt.unterrichtId) && darf(ctx, "material.lesen", { ...objekt, freigegebenFuer: [] });
    // Prüfungen erstellt die Lehrperson für ihren eigenen Unterricht (Liste ohne objekt: ob sie überhaupt unterrichtet)
    case "pruefung.verwalten": return lp && (objekt.unterrichtId ? !!ctx.lehrt && ctx.lehrt.has(objekt.unterrichtId) : !!ctx.lehrt && ctx.lehrt.size > 0);
    // Aufgabenbank: wie Material (privat, Fachgruppe, Schule), nie für Schülerinnen und Schüler
    case "aufgabe.lesen":
      if (!(lp || sl)) return false;
      if (objekt.besitzerId === ctx.personId) return true;
      return objekt.geteilt === "schule" || (objekt.geteilt === "fachgruppe" && !!objekt.fachId && !!ctx.faecher && ctx.faecher.has(objekt.fachId));
    case "aufgabe.bearbeiten": return (lp || sl) && objekt.besitzerId === ctx.personId;
    // Unterrichtsmodus: die Lehrperson leitet Lektionen im eigenen Unterricht; Schüler/innen nehmen an ihrem Unterricht teil
    case "lektion.leiten": return lp && !!objekt.unterrichtId && !!ctx.lehrt && ctx.lehrt.has(objekt.unterrichtId);
    case "lektion.teilnehmen": return sch && !!objekt.unterrichtId && ctx.unterricht.has(objekt.unterrichtId);
    // Kursnotizbuch: die Lehrperson im eigenen Unterricht (immer), Schüler/innen in ihrem Unterricht (wenn erlaubt; das prüft der Server).
    // Die Administration und die Schulleitung sehen keine Notizen.
    case "notizbuch.leiten": return lp && !!objekt.unterrichtId && !!ctx.lehrt && ctx.lehrt.has(objekt.unterrichtId);
    case "notizbuch.teilnehmen": return sch && !!objekt.unterrichtId && ctx.unterricht.has(objekt.unterrichtId);
    default: return false;
  }
}

/** Wie darf(), wirft aber einen Fehler mit Status 403 */
export function pruefe(ctx, aktion, objekt) {
  if (!darf(ctx, aktion, objekt)) { const e = new Error("Dafür fehlt Ihnen die Berechtigung."); e.status = 403; throw e; }
}
