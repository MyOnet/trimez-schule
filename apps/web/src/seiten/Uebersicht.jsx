import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useIch } from "../App.jsx";
import { useLaden, Laden, Note, Verteilung, Symbol } from "../ui.jsx";

const datumLang = () => new Date().toLocaleDateString("de-CH", { weekday: "long", day: "numeric", month: "long" });

export default function Uebersicht() {
  const ich = useIch(); const { kurz } = useParams();
  const z = useLaden("/api/uebersicht");
  const h = new Date().getHours();
  const gruss = h < 11 ? "Guten Morgen" : h < 18 ? "Guten Tag" : "Guten Abend";
  const schueler = ich.rollen.includes("schueler") && ich.rollen.length === 1;
  return (
    <Laden zustand={z}>{(d) => {
      const lehrt = d.meinUnterricht.filter((u) => u.lehrt);
      const entwuerfe = lehrt.reduce((a, u) => a + (u.entwuerfe || 0), 0);
      return (
        <div>
          <div className="kopf"><div><p className="pfad" style={{ textTransform: "none" }}>{datumLang()}{d.schuljahr ? `, Schuljahr ${d.schuljahr.bezeichnung}` : ""}</p><h1>{gruss}, {ich.person.vorname}.</h1></div></div>

          {!d.schuljahr && ich.rechte["schuljahr.verwalten"] && <div className="hinweis" style={{ marginBottom: 24 }}>Legen Sie zuerst ein Schuljahr an und markieren Sie es als aktiv. <Link to={`/s/${kurz}/schuljahre`}>Zu den Schuljahren</Link></div>}
          {schueler && <MeineLektionen kurz={kurz} />}
          {schueler && <MeinePruefungen kurz={kurz} />}
          {d.materialNeu > 0 && <div className="hinweis" style={{ marginBottom: 24 }}><span><b>{d.materialNeu === 1 ? "Neues Material" : `${d.materialNeu} neue Materialien`}</b> von Ihren Lehrpersonen. <Link to={`/s/${kurz}/material`}>Zum Material</Link></span></div>}
          {entwuerfe > 0 && <div className="hinweis" style={{ marginBottom: 24 }}><span><b>{entwuerfe === 1 ? "Eine Bewertung ist" : `${entwuerfe} Bewertungen sind`} noch nicht freigegeben.</b> Die Schülerinnen und Schüler sehen diese Noten erst nach der Freigabe.</span></div>}

          {lehrt.length > 0 && <section className="abschnitt" aria-labelledby="h-mein">
            <div className="abschnitt-kopf"><h2 id="h-mein">Mein Unterricht</h2><p>Schnitt der Klasse im laufenden Semester</p></div>
            <div className="regal">
              {lehrt.map((u) => (
                <div key={u.id} className="heft">
                  <Link to={`/s/${kurz}/notizbuch/${u.id}`} className="ukarte" style={{ "--farbe": u.farbe }} title={`Kursnotizbuch ${u.fach} ${u.klasse}`}>
                    <div className="etikett-heft">
                      <div className="oben">
                        <div><div className="klasse">{u.klasse}{u.gruppe ? <span style={{ fontSize: ".9rem", color: "#6C7690" }}> {u.gruppe}</span> : null}</div><div className="fach">{u.fach}</div></div>
                        <Note wert={u.klassenschnitt} gross titel="Schnitt der Klasse" />
                      </div>
                      <Verteilung v={u.verteilung} />
                    </div>
                    <div className="unten"><span>{u.schueler} Lernende</span><span>{u.bewertungen ? `${u.bewertungen} Bewertungen` : "noch keine Noten"}{u.entwuerfe ? `, ${u.entwuerfe} Entwurf` : ""}</span></div>
                  </Link>
                  <div className="heft-links">
                    <Link to={`/s/${kurz}/notizbuch/${u.id}`}>Notizbuch</Link>
                    <Link to={`/s/${kurz}/unterricht/${u.id}/noten`}>Noten</Link>
                    <Link to={`/s/${kurz}/unterricht/${u.id}/material`}>Material</Link>
                    <Link to={`/s/${kurz}/unterricht/${u.id}/lektion`}>Lektion</Link>
                  </div>
                </div>))}
            </div>
          </section>}

          {schueler && <section className="abschnitt">
            <div className="abschnitt-kopf"><h2>Meine Fächer</h2><p>Ein Klick öffnet das Kursnotizbuch</p></div>
            <div className="regal">{d.meinUnterricht.map((u) => <div key={u.id} className="heft">
              <Link to={`/s/${kurz}/notizbuch/${u.id}`} className="ukarte" style={{ "--farbe": u.farbe }}>
                <div className="etikett-heft"><div className="klasse">{u.fach}</div><div className="fach">Klasse {u.klasse}</div></div>
                <div className="unten"><span>Kursnotizbuch</span></div>
              </Link>
              <div className="heft-links"><Link to={`/s/${kurz}/material`}>Material</Link><Link to={`/s/${kurz}/meine-noten`}>Noten</Link></div>
            </div>)}</div>
          </section>}

          {d.zahlen && <section className="abschnitt" aria-labelledby="h-zahlen">
            <div className="abschnitt-kopf"><h2 id="h-zahlen">Schule</h2></div>
            <div className="kennzahlen">
              {[["klassen", "Klassen", "klassen"], ["schueler", "Schülerinnen und Schüler", "personen"], ["lehrpersonen", "Lehrpersonen", "personen"], ["unterricht", "Fächer in Klassen", "unterricht"]].map(([k, t, l]) =>
                <Link key={k} to={`/s/${kurz}/${l}`} className="kennzahl"><b>{d.zahlen[k]}</b><span>{t}</span></Link>)}
            </div>
            {d.zahlen.ohne_lp > 0 && <div className="hinweis">{d.zahlen.ohne_lp === 1 ? "Einem Fach" : `${d.zahlen.ohne_lp} Fächern`} in Klassen ist noch keine Lehrperson zugeteilt. <Link to={`/s/${kurz}/unterricht`}>Jetzt zuteilen</Link></div>}
          </section>}

          {!lehrt.length && !schueler && !d.zahlen && <div className="leer"><b>Noch kein Unterricht</b><span>Sobald Ihnen die Administration Fächer zuteilt, erscheinen sie hier.</span></div>}
        </div>
      );
    }}</Laden>
  );
}

// Laufende Prüfung: Code eingeben. Zurückgegebene Prüfungen: Ergebnis ansehen.
// Laufende Lektion: direkt hinein
function MeineLektionen({ kurz }) {
  const z = useLaden("/api/meine-lektionen");
  if (!z.daten || !z.daten.laufend.length) return null;
  return z.daten.laufend.map((l) => (
    <div key={l.id} className="pruefung-jetzt lektion-jetzt">
      <div><span>Lektion läuft</span><b>{l.fach} bei {l.lp_vorname} {l.lp_nachname}</b>{l.lernumgebung && <small>Mit der Lernumgebung</small>}</div>
      <Link className="knopf haupt-knopf" to={`/s/${kurz}/lektion/${l.id}`}>Zur Lektion</Link>
    </div>));
}

function MeinePruefungen({ kurz }) {
  const z = useLaden("/api/meine-pruefungen"); const nav = useNavigate();
  const [code, setCode] = useState(""); const [fehler, setFehler] = useState(""); const [laeuft, setLaeuft] = useState(false);
  if (!z.daten) return null;
  const { laufend, zurueck } = z.daten;
  const beitreten = async (e) => {
    e.preventDefault(); setFehler(""); setLaeuft(true);
    try { const r = await api("/api/pruefungen/beitreten", { methode: "POST", daten: { code } }); nav(`/s/${kurz}/pruefung/${r.versuch_id}`); }
    catch (x) { setFehler(x.feld === "lernumgebung" ? <>{x.message} <Link to={`/s/${kurz}/lernumgebung`} style={{ color: "inherit" }}>So geht es</Link></> : x.message); setLaeuft(false); }
  };
  return <>
    {laufend.map((p) => p.versuch_id && p.versuch_status === "laeuft"
      ? <div key={p.id} className="pruefung-jetzt"><div><span>Prüfung läuft</span><b>{p.fach}: {p.titel}</b></div><Link className="knopf haupt-knopf" to={`/s/${kurz}/pruefung/${p.versuch_id}`}>Weiterschreiben</Link></div>
      : p.versuch_status === "abgegeben" ? null
      : <form key={p.id} className="pruefung-jetzt" onSubmit={beitreten}>
          <div><span>Prüfung läuft</span><b>{p.fach}: {p.titel}</b></div>
          <label className="code-feld"><span>Code von der Tafel</span><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))} placeholder="ABC123" autoComplete="off" autoCapitalize="characters" spellCheck={false} aria-invalid={!!fehler} /></label>
          <button className="knopf haupt-knopf" disabled={code.length !== 6 || laeuft}>Beginnen</button>
          {fehler && <p className="feld-fehler" role="alert" style={{ gridColumn: "1 / -1" }}>{fehler}</p>}
        </form>)}
    {zurueck.length > 0 && <section className="abschnitt" style={{ marginBottom: 28 }}><div className="abschnitt-kopf"><h2>Korrigierte Prüfungen</h2></div>
      <div className="mliste">{zurueck.slice(0, 5).map((p) => <Link key={p.id} to={`/s/${kurz}/ergebnis/${p.versuch_id}`} className="pzeile" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
        <div><div className="titel"><span className="punkt" style={{ background: p.farbe }} />{p.titel}</div><div className="meta"><span>{p.fach}</span><span>zurückgegeben {new Date(p.zurueckgegeben_am).toLocaleDateString("de-CH")}</span></div></div><span className="leise klein">Ansehen</span></Link>)}</div></section>}
  </>;
}
