// Linke Spalten: Bereiche mit Abschnitten und Gruppen, daneben die Seiten des Abschnitts.
import { useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Copy, FilePlus2, Folder, FolderPlus, IndentDecrease, IndentIncrease, Palette, Pencil, Plus, Send, Trash2 } from "lucide-react";
import * as S from "./store.js";
import { COLORS, fmtShort } from "./model.js";
import { ask, confirm, Rename, Swatches, useMenu } from "./ui.jsx";
import { api } from "../api.js";

export function Abschnitte({ buch, symbole }) {
  const sel = S.useStore((s) => s.sel);
  const bereich = S.useStore(S.curBereich);
  const [renaming, setRenaming] = useState(null);
  const [drop, setDrop] = useState(null);
  const [menu, openMenu, openAt] = useMenu();
  const addRef = useRef(null), schuelerRef = useRef(null);
  const lp = buch.rolle === "lp";
  const feste = buch.bereiche.filter((b) => b.bereich !== "schueler" || !lp);
  const schueler = lp ? buch.bereiche.filter((b) => b.bereich === "schueler") : [];
  const istSchueler = bereich && bereich.bereich === "schueler" && lp;
  const schreiben = bereich && bereich.schreiben;

  const nodeMenu = (e, n) => {
    if (!schreiben) return;
    openMenu(e, [
      { label: "Umbenennen", icon: Pencil, onClick: () => setRenaming(n.id) },
      n.art === "abschnitt" && { label: "Farbe", icon: Palette, render: <Swatches colors={COLORS} value={n.farbe} onPick={(c) => S.updateNode(n.id, { farbe: c })} /> },
      "-",
      { label: "Neuer Abschnitt", icon: Plus, onClick: async () => { const r = await S.addSection(n.art === "gruppe" ? n.id : null); if (r) setRenaming(r.id); } },
      { label: "Neue Gruppe", icon: FolderPlus, onClick: async () => { const r = await S.addGroup(); if (r) setRenaming(r.id); } },
      "-",
      { label: "Löschen", icon: Trash2, danger: true, onClick: async () => { if (await confirm({ title: n.art === "gruppe" ? "Gruppe löschen?" : "Abschnitt löschen?", text: `«${n.name}» und alle Seiten darin kommen in den Papierkorb. Dort lassen sie sich 30 Tage lang wiederherstellen.`, ok: "Löschen", danger: true })) S.deleteNode(n.id); } },
    ]);
  };
  const dragOver = (e, n) => {
    const t = e.dataTransfer.types;
    if (!schreiben) return;
    if (t.includes("sheaf/page") && n.art === "abschnitt") { e.preventDefault(); setDrop({ id: n.id, pos: "inside" }); return; }
    if (!t.includes("sheaf/node")) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect(), f = (e.clientY - r.top) / r.height;
    setDrop({ id: n.id, pos: n.art === "gruppe" && f > 0.3 && f < 0.7 ? "inside" : f < 0.5 ? "before" : "after" });
  };
  const onDrop = (e, n) => {
    e.preventDefault(); const d = drop; setDrop(null);
    const page = e.dataTransfer.getData("sheaf/page"), node = e.dataTransfer.getData("sheaf/node");
    if (page && n.art === "abschnitt") S.movePage(page, n.id);
    else if (node && node !== n.id) S.moveNode(node, n.id, d ? d.pos : "after");
  };
  const row = (n, depth) => {
    const dz = drop && drop.id === n.id ? " drop-" + drop.pos : "";
    const common = {
      draggable: schreiben && renaming !== n.id, onDragStart: (e) => { e.dataTransfer.setData("sheaf/node", n.id); e.dataTransfer.effectAllowed = "move"; },
      onDragOver: (e) => dragOver(e, n), onDragLeave: () => setDrop(null), onDrop: (e) => onDrop(e, n), onDragEnd: () => setDrop(null),
      onContextMenu: (e) => nodeMenu(e, n), onDoubleClick: () => schreiben && setRenaming(n.id), style: { paddingLeft: 10 + depth * 14, "--c": n.farbe },
    };
    const name = renaming === n.id ? <Rename value={n.name} onDone={(v) => { if (v) S.updateNode(n.id, { name: v }); setRenaming(null); }} /> : <span className="nm">{n.name}</span>;
    if (n.art === "gruppe") return <div key={n.id}>
      <div className={"sec group" + (n.offen ? " open" : "") + dz} {...common} onClick={() => S.updateNode(n.id, { offen: !n.offen })}>
        <ChevronRight className="chev" /><Folder />{name}
      </div>
      {n.offen && n.kinder.map((c) => row(c, depth + 1))}
    </div>;
    return <div key={n.id} className={"sec" + dz} aria-current={n.id === sel.secId} {...common} onClick={() => S.waehleAbschnitt(n.id)} title={n.name}>
      <span className="tab" />{name}<span className="zahl">{n.seiten.length}</span>
    </div>;
  };

  const schuelerIndex = istSchueler ? schueler.findIndex((b) => S.bereichKey(b) === sel.bereich) : -1;
  const Sym = (b) => { const I = symbole[b.bereich]; return I ? <I /> : null; };
  return <aside className="sections">
    <nav className="bereiche" aria-label="Bereiche">
      {feste.map((b) => <button key={S.bereichKey(b)} className="bereich" aria-current={S.bereichKey(b) === sel.bereich} onClick={() => S.waehleBereich(S.bereichKey(b))}>
        {Sym(b)}<span>{b.name}</span>{!b.schreiben && <small>lesen</small>}
      </button>)}
      {lp && schueler.length > 0 && <button ref={schuelerRef} className="bereich" aria-current={istSchueler} onClick={() => openAt(schuelerRef.current.getBoundingClientRect(), schueler.map((b) => ({ label: b.name + (b.abschnitte.length ? "" : " (leer)"), onClick: () => S.waehleBereich(S.bereichKey(b)) })))}>
        <symbole.schueler /><span>{istSchueler ? bereich.name : "Schüler/innen"}</span><ChevronDown style={{ marginLeft: "auto", width: 14, height: 14 }} />
      </button>}
      {istSchueler && <div className="blaettern">
        <button className="ib" disabled={schuelerIndex <= 0} onClick={() => S.waehleBereich(S.bereichKey(schueler[schuelerIndex - 1]))} title="Vorherige Person"><ChevronLeft /></button>
        <span>{schuelerIndex + 1} von {schueler.length}</span>
        <button className="ib" disabled={schuelerIndex >= schueler.length - 1} onClick={() => S.waehleBereich(S.bereichKey(schueler[schuelerIndex + 1]))} title="Nächste Person"><ChevronRight /></button>
      </div>}
    </nav>
    <div className="col-head"><span>Abschnitte</span>
      {schreiben && <button ref={addRef} className="ib" title="Neuer Abschnitt" onClick={() => openAt(addRef.current.getBoundingClientRect(), [
        { label: "Neuer Abschnitt", icon: Plus, onClick: async () => { const r = await S.addSection(); if (r) setRenaming(r.id); } },
        { label: "Neue Gruppe", icon: FolderPlus, onClick: async () => { const r = await S.addGroup(); if (r) setRenaming(r.id); } },
      ])}><Plus /></button>}
    </div>
    <div className="sec-list scroll" onDragOver={(e) => { if (schreiben && e.dataTransfer.types.includes("sheaf/node") && e.target === e.currentTarget) e.preventDefault(); }}
      onDrop={(e) => { if (e.target === e.currentTarget) { const n = e.dataTransfer.getData("sheaf/node"); if (n) S.moveNode(n, null); } }}>
      {bereich && bereich.abschnitte.map((n) => row(n, 0))}
      {bereich && !bereich.abschnitte.length && <p className="small muted" style={{ padding: "6px 10px" }}>{schreiben ? "Noch keine Abschnitte." : "Noch leer."}</p>}
    </div>
    {menu}
  </aside>;
}

export function Seiten() {
  const sec = S.useStore(S.curSec);
  const pageId = S.useStore((s) => s.sel.pageId);
  const buch = S.useStore((s) => s.buch);
  const bereich = S.useStore(S.curBereich);
  const [drop, setDrop] = useState(null);
  const [menu, openMenu] = useMenu();
  const seen = useRef(new Set());
  const fresh = useMemo(() => {
    const f = new Set(); if (!sec) return f;
    if (seen.current.sec === sec.id) for (const p of sec.seiten) if (!seen.current.has(p.id)) f.add(p.id);
    seen.current = new Set(sec.seiten.map((p) => p.id)); seen.current.sec = sec.id;
    return f;
  }, [sec]);
  if (!sec) return <section className="pages" />;
  const schreiben = bereich && bereich.schreiben;
  const lp = buch && buch.rolle === "lp";

  const pageMenu = (e, p) => {
    S.selectPage(p.id);
    if (!schreiben && !lp) { e.preventDefault(); return; }
    const ziele = S.allSections(bereich).filter((x) => x.id !== sec.id);
    openMenu(e, [
      schreiben && { label: "Neue Seite darunter", icon: FilePlus2, kbd: "Ctrl+N", onClick: () => S.addPage({ after: true }) },
      schreiben && { label: "Neue Unterseite", icon: Plus, onClick: () => S.addPage({ after: true, sub: true }) },
      schreiben && "-",
      schreiben && { label: "Zur Unterseite machen", icon: IndentIncrease, kbd: "Ctrl+Alt+]", disabled: p.ebene >= 2, onClick: () => S.setLevel(p.id, 1) },
      schreiben && { label: "Eine Ebene höher", icon: IndentDecrease, kbd: "Ctrl+Alt+[", disabled: p.ebene === 0, onClick: () => S.setLevel(p.id, -1) },
      schreiben && { label: "Duplizieren", icon: Copy, onClick: () => S.duplicatePage(p.id) },
      lp && { label: "An alle Schüler/innen verteilen …", icon: Send, onClick: () => verteilen(p) },
      schreiben && ziele.length > 0 && { head: "Verschieben nach" },
      ...(schreiben ? ziele.slice(0, 25).map((x) => ({ label: x.name, swatch: x.farbe, onClick: () => S.movePage(p.id, x.id) })) : []),
      schreiben && "-",
      schreiben && { label: "Seite löschen", icon: Trash2, danger: true, onClick: () => S.deletePage(p.id) },
    ].filter((x) => x !== false && x !== undefined));
  };
  async function verteilen(p) {
    const name = await ask({ title: "Seite an alle verteilen", text: `«${p.titel || "Seite ohne Titel"}» kommt als Kopie in den eigenen Bereich jeder Schülerin und jedes Schülers, in diesen Abschnitt:`, value: "Aufträge", ok: "Verteilen" });
    if (!name) return;
    await S.speichern();
    try { const r = await api(`/api/notizbuch/${S.get().uid}/verteilen`, { methode: "POST", daten: { seite_id: p.id, abschnitt: name } }); S.toast(`An ${r.anzahl} Schüler/innen verteilt, Abschnitt «${r.abschnitt}».`, "ok"); S.laden(S.get().uid); }
    catch (e) { S.toast(e.message, "error"); }
  }

  return <section className="pages" style={{ "--sec": sec.farbe }}>
    {schreiben ? <button className="add-page" onClick={() => S.addPage({ after: false })}><Plus />Seite hinzufügen<span className="kbd">Ctrl+N</span></button>
      : <div className="nb-sec-name"><span className="tab" style={{ background: sec.farbe }} />{sec.name}</div>}
    <div className="pg-list scroll" role="listbox" aria-label="Seiten"
      onDragOver={(e) => { if (schreiben && e.dataTransfer.types.includes("sheaf/page")) e.preventDefault(); }}
      onDrop={(e) => { const id = e.dataTransfer.getData("sheaf/page"); if (id && e.target === e.currentTarget) S.movePage(id, sec.id); setDrop(null); }}>
      {sec.seiten.map((p) => <div key={p.id} role="option" className={"pg" + (fresh.has(p.id) ? " enter" : "") + (drop === p.id ? " drop-before" : "")} data-lv={p.ebene} style={{ "--lv": p.ebene }}
        aria-current={p.id === pageId} aria-selected={p.id === pageId} onClick={() => S.selectPage(p.id)} onContextMenu={(e) => pageMenu(e, p)}
        draggable={!!schreiben} onDragStart={(e) => { e.dataTransfer.setData("sheaf/page", p.id); e.dataTransfer.effectAllowed = "move"; }}
        onDragOver={(e) => { if (schreiben && e.dataTransfer.types.includes("sheaf/page")) { e.preventDefault(); setDrop(p.id); } }} onDragLeave={() => setDrop(null)}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDrop(null); const id = e.dataTransfer.getData("sheaf/page"); if (id) S.movePage(id, sec.id, p.id); }}>
        <div className={"t" + (p.titel ? "" : " empty")}>{p.titel || "Seite ohne Titel"}</div>
        <div className="m"><span>{fmtShort(p.geaendert_am)}</span><span>{(p.vorschau || "").replace(/\s+/g, " ")}</span></div>
      </div>)}
    </div>
    {menu}
  </section>;
}
