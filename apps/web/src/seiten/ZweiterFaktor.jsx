import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useIch } from "../App.jsx";
import { useMeldung } from "../ui.jsx";

// Pflicht für Admins, Schulleitung und Lehrpersonen mit eigenem Konto
export default function ZweiterFaktor() {
  const ich = useIch(); const { kurz } = useParams(); const nav = useNavigate(); const meld = useMeldung();
  const [daten, setDaten] = useState(null); const [code, setCode] = useState(""); const [fehler, setFehler] = useState("");
  const start = async () => { setFehler(""); try { setDaten(await api("/api/konto/2fa/start", { methode: "POST" })); } catch (e) { setFehler(e.message); } };
  const ok = async (e) => { e.preventDefault(); setFehler(""); try { await api("/api/konto/2fa/bestaetigen", { methode: "POST", daten: { code } }); meld("Zwei-Faktor-Anmeldung ist eingerichtet."); await ich.neu(); nav(`/s/${kurz}/`); } catch (x) { setFehler(x.message); } };
  if (ich.zweiterFaktor.aktiv) return <div className="hinweis ok">Die Zwei-Faktor-Anmeldung ist eingerichtet.</div>;
  return (
    <div className="stapel" style={{ maxWidth: 620 }}>
      <div className="kopf"><div><h1>Zwei-Faktor-Anmeldung einrichten</h1><p>Weil Sie Noten und Personendaten sehen, braucht Ihr Konto einen zweiten Schutz. Das dauert zwei Minuten.</p></div></div>
      {fehler && <div className="hinweis fehler" role="alert">{fehler}</div>}
      <section className="karte stapel">
        <h2>1. Authenticator-App installieren</h2>
        <p>Zum Beispiel Microsoft Authenticator oder Google Authenticator auf Ihrem Handy.</p>
      </section>
      <section className="karte stapel">
        <h2>2. Code scannen</h2>
        {!daten ? <div><button className="knopf haupt-knopf" onClick={start}>QR-Code anzeigen</button></div> : <>
          <div className="qr" dangerouslySetInnerHTML={{ __html: daten.qr }} aria-label="QR-Code für die Authenticator-App" role="img" />
          <p className="klein leise">Scannen geht nicht? Diesen Schlüssel von Hand eingeben:</p>
          <p className="code">{daten.geheim}</p>
        </>}
      </section>
      {daten && <form className="karte formular" onSubmit={ok}>
        <h2>3. Code eingeben</h2>
        <label className="feld">6-stelliger Code aus der App<input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required autoFocus /></label>
        <div><button className="knopf haupt-knopf">Bestätigen</button></div>
      </form>}
    </div>
  );
}
