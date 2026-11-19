// PDF selbst darstellen (pdf.js), statt sich auf den eingebauten PDF-Betrachter zu verlassen.
// Nötig für die Lernumgebung: Dort gibt es keine neuen Tabs, und ob die Webansicht PDFs anzeigt, hängt vom System ab.
import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import worker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = worker;

export default function PdfAnsicht({ src, titel }) {
  const huelle = useRef(null);
  const [zustand, setZustand] = useState("laedt");
  useEffect(() => {
    let aus = false, dok = null;
    (async () => {
      try {
        dok = await pdfjs.getDocument({ url: src, withCredentials: true }).promise;
        const el = huelle.current; if (!el || aus) return;
        el.innerHTML = "";
        const breite = Math.min(el.clientWidth - 32, 1000), dpr = window.devicePixelRatio || 1;
        for (let n = 1; n <= dok.numPages && !aus; n++) {
          const seite = await dok.getPage(n);
          const v = seite.getViewport({ scale: breite / seite.getViewport({ scale: 1 }).width });
          const c = document.createElement("canvas");
          c.width = Math.floor(v.width * dpr); c.height = Math.floor(v.height * dpr);
          c.style.width = `${Math.floor(v.width)}px`; c.style.height = `${Math.floor(v.height)}px`;
          c.setAttribute("aria-label", `${titel}, Seite ${n} von ${dok.numPages}`); c.setAttribute("role", "img");
          el.appendChild(c);
          await seite.render({ canvasContext: c.getContext("2d"), viewport: v, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
        }
        if (!aus) setZustand("fertig");
      } catch { if (!aus) setZustand("fehler"); }
    })();
    return () => { aus = true; if (dok) dok.destroy(); };
  }, [src]);
  return <div className="pdf-ansicht">
    {zustand === "laedt" && <p className="leise" style={{ padding: 24 }}>PDF wird geladen …</p>}
    {zustand === "fehler" && <div className="leer" style={{ margin: 24 }}><b>Das PDF lässt sich nicht anzeigen</b><span>Bitte die Lehrperson informieren.</span></div>}
    <div ref={huelle} className="pdf-seiten" />
  </div>;
}
