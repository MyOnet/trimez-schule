// Wer darf was? Eine Stelle für alle Rechte. Der Server ruft darf() vor jeder Aktion auf,
// die Oberfläche nur, um Knöpfe auszublenden. Massgebend ist immer der Server.
//
// ctx = { personId, rollen: Set<'admin'|'schulleitung'|'lehrperson'|'schueler'|'eltern'>,
//         unterricht: Set<id>  (Unterricht, den die Person erteilt bzw. besucht),
//         lehrt: Set<id>       (Unterricht, den sie selbst erteilt),
//         klassen: Set<id>     (Klassen, in denen sie unterrichtet, Klassenlehrperson ist oder Schüler/in ist),
//         faecher: Set<id>     (Fächer ihrer Fachgruppen und ihres Unterrichts),
//         klp: Set<id>         (Klassen, deren Klassenlehrperson sie ist),
//         kinder: Set<id>      (Eltern: Kinder, die sie einsehen dürfen; unter 18 oder mit Freigabe) }

export const AKTIONEN = [
  "schule.einstellungen", "schuljahr.lesen", "schuljahr.verwalten",
  "klasse.lesen", "klasse.verwalten", "fach.lesen", "fach.verwalten",
  "person.lesen", "person.verwalten", "unterricht.lesen", "unterricht.verwalten",
  "import.ausfuehren", "protokoll.lesen", "konto.selbst",
  "noten.lesen", "noten.schreiben", "noten.eigene",
  "material.erstellen", "material.lesen", "material.bearbeiten", "material.freigeben",
  "pruefung.verwalten", "aufgabe.lesen", "aufgabe.bearbeiten",
  "lektion.leiten", "lektion.teilnehmen", "notizbuch.leiten", "notizbuch.teilnehmen",
  "auftrag.verwalten", "auftrag.abgeben", "raum.lesen", "raum.moderieren", "schulmitteilung.verfassen",
  "formular.verwalten", "stundenplan.verwalten", "stundenplan.aendern", "termin.schule", "termin.klasse",
  "pruefung.ankuendigen", "pruefungslimit.ausnahme", "absenz.erfassen", "absenz.klasse", "absenz.eigene",
  "entschuldigung.einreichen", "zeugnis.erstellen", "promotion.entscheiden", "matura.verwalten", "matura.betreuen",
  "eltern.kind", "eltern.verwalten",
];

const hat = (ctx, r) => ctx.rollen.has(r);

/** objekt: { klasseId?, unterrichtId?, personId? } je nach Aktion */
export function darf(ctx, aktion, objekt = {}) {
  if (!ctx || !ctx.rollen) return false;
  const admin = hat(ctx, "admin"), sl = hat(ctx, "schulleitung"), lp = hat(ctx, "lehrperson"), sch = hat(ctx, "schueler"), el = hat(ctx, "eltern");
  const lehrt = (u) => lp && !!u && !!ctx.lehrt && ctx.lehrt.has(u);
  const klp = (k) => lp && !!k && !!ctx.klp && ctx.klp.has(k);
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
    // Aufträge: die Lehrperson im eigenen Unterricht; Schüler/innen geben in ihrem Unterricht ab
    case "auftrag.verwalten": return lehrt(objekt.unterrichtId);
    case "auftrag.abgeben": return sch && !!objekt.unterrichtId && ctx.unterricht.has(objekt.unterrichtId);
    // Klassenraum: wer den Unterricht erteilt oder besucht. Moderieren (anheften, löschen, Schreibrecht) nur die Lehrperson.
    // Die Schulleitung liest nicht mit (wie im Klassenzimmer).
    case "raum.lesen": return lehrt(objekt.unterrichtId) || (sch && !!objekt.unterrichtId && ctx.unterricht.has(objekt.unterrichtId));
    case "raum.moderieren": return lehrt(objekt.unterrichtId);
    case "schulmitteilung.verfassen": return admin || sl;
    // Formulare (Quiz, Umfragen, Anmeldungen): Lehrpersonen für den eigenen Unterricht oder ohne Unterricht, Schulleitung
    case "formular.verwalten": return objekt.unterrichtId ? lehrt(objekt.unterrichtId) : lp || sl;
    // Kalender: Stundenplan pflegt die Administration, Änderungen (Ausfall, Vertretung) auch die Schulleitung
    case "stundenplan.verwalten": return admin;
    case "stundenplan.aendern": return admin || sl;
    case "termin.schule": return admin || sl;
    case "termin.klasse": return admin || sl || klp(objekt.klasseId);
    case "pruefung.ankuendigen": return lehrt(objekt.unterrichtId);
    case "pruefungslimit.ausnahme": return sl;
    // Absenzen: erfassen im eigenen Unterricht (und die Klassenlehrperson für ihre Klasse); verwalten (Entschuldigungen
    // entscheiden, Übersicht) die Klassenlehrperson, die Schulleitung und die Administration
    case "absenz.erfassen": return lehrt(objekt.unterrichtId) || klp(objekt.klasseId) || admin || sl;
    case "absenz.klasse": return admin || sl || klp(objekt.klasseId);
    case "absenz.eigene": return sch || el;
    case "entschuldigung.einreichen":
      if (!objekt.personId) return sch || el;
      return (sch && objekt.personId === ctx.personId) || (el && !!ctx.kinder && ctx.kinder.has(objekt.personId));
    // Zeugnisse: Klassenlehrperson für ihre Klasse, Schulleitung und Administration. Promotion entscheidet die Schulleitung.
    case "zeugnis.erstellen": return admin || sl || klp(objekt.klasseId);
    case "promotion.entscheiden": return sl;
    // Maturaarbeit: Schulleitung teilt zu; die Betreuungsperson (und Koreferent/in) betreut, der Server prüft die Zuteilung
    case "matura.verwalten": return admin || sl;
    case "matura.betreuen": return lp;
    // Eltern: nur die eigenen Kinder (unter 18 oder mit Freigabe der volljährigen Person); verknüpfen tut die Administration
    case "eltern.kind": return el && !!objekt.personId && !!ctx.kinder && ctx.kinder.has(objekt.personId);
    case "eltern.verwalten": return admin;
    default: return false;
  }
}

/** Wie darf(), wirft aber einen Fehler mit Status 403 */
export function pruefe(ctx, aktion, objekt) {
  if (!darf(ctx, aktion, objekt)) { const e = new Error("Dafür fehlt Ihnen die Berechtigung."); e.status = 403; throw e; }
}
