import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { AnmeldeTafel } from "../App.jsx";
import { TEXTE } from "@schule/shared";
const T = TEXTE.anmelden;

export default function Anmelden() {
  const { kurz } = useParams();
  const nav = useNavigate();
  const [schule, setSchule] = useState(null);
  const [fehler, setFehler] = useState("");
  const [schritt, setSchritt] = useState("passwort");
  const [f, setF] = useState({ email: "", passwort: "", code: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => { api(`/api/schule/${kurz}`).then(setSchule).catch((e) => setFehler(e.message)); }, [kurz]);
  const senden = async (e) => {
    e.preventDefault(); setBusy(true); setFehler("");
    try {
      if (schritt === "passwort") {
        const d = await api(`/api/s/${kurz}/anmelden`, { methode: "POST", daten: { email: f.email, passwort: f.passwort } });
        if (d.zweiterFaktor) { setSchritt("code"); setBusy(false); return; }
      } else await api("/api/anmelden/code", { methode: "POST", daten: { code: f.code } });
      nav(`/s/${kurz}/`);
    } catch (x) { setFehler(x.message); if (x.status === 401 && schritt === "code" && /anmelden/.test(x.message)) setSchritt("passwort"); }
    setBusy(false);
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="anmelde-seite">
      <AnmeldeTafel schule={schule} />
      <div className="anmelde-papier">
      <main className="anmelde-karte">
        <div><h1 style={{ fontSize: "1.6rem" }}>{T.titel}</h1>{schule && <p className="leise" style={{ marginTop: 6 }}>{schule.name.replace(/ \(Testschule\)$/, "")}</p>}</div>
        {fehler && <div className="hinweis fehler" role="alert">{fehler}</div>}
        {schule && schritt === "passwort" && <>
          {(schule.wege.ms || schule.wege.eduid) && <div className="stapel" style={{ gap: 10 }}>
            {schule.wege.ms && <a className="knopf breit" href={`/api/s/${kurz}/oidc/ms`}>{T.ms}</a>}
            {schule.wege.eduid && <a className="knopf breit" href={`/api/s/${kurz}/oidc/eduid`}>{T.eduid}</a>}
          </div>}
          {schule.wege.lokal && <>
            {(schule.wege.ms || schule.wege.eduid) && <div className="trenner">{T.oder}</div>}
            <form className="formular" onSubmit={senden}>
              <label className="feld">{T.email}<input type="email" autoComplete="username" value={f.email} onChange={set("email")} required autoFocus /></label>
              <label className="feld">{T.passwort}<input type="password" autoComplete="current-password" value={f.passwort} onChange={set("passwort")} required /></label>
              <button className="knopf haupt-knopf breit" disabled={busy}>{busy ? "Bitte warten …" : T.knopf}</button>
            </form>
          </>}
        </>}
        {schritt === "code" && <form className="formular" onSubmit={senden}>
          <p>Öffnen Sie Ihre Authenticator-App und geben Sie den 6-stelligen Code für trimez. Schule ein.</p>
          <label className="feld">{T.code}<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" value={f.code} onChange={set("code")} required autoFocus /></label>
          <button className="knopf haupt-knopf breit" disabled={busy}>{T.codeKnopf}</button>
        </form>}
      </main>
      </div>
    </div>
  );
}
