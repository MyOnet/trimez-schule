// Kleines PDF mit Text für die Testdaten (ohne zusätzliche Pakete). Unterstützt Umlaute (WinAnsi).
export function beispielPdf(titel, absaetze) {
  const esc = (s) => s.replace(/[\\()]/g, (c) => "\\" + c);
  const zeilen = [];
  for (const a of absaetze) { let z = ""; for (const w of a.split(" ")) { if ((z + " " + w).length > 85) { zeilen.push(z); z = w; } else z = z ? z + " " + w : w; } zeilen.push(z, ""); }
  let s = `BT /F2 20 Tf 60 780 Td (${esc(titel)}) Tj ET\nBT /F1 11 Tf 60 745 Td 15 TL\n`;
  for (const z of zeilen.slice(0, 44)) s += `(${esc(z)}) '\n`;
  s += "ET\n";
  const stream = Buffer.from(s, "latin1");
  const obj = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ];
  const teile = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const off = []; let len = teile[0].length;
  const add = (b) => { teile.push(b); len += b.length; };
  obj.forEach((o, i) => { off.push(len); add(Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, "latin1")); });
  off.push(len); add(Buffer.concat([Buffer.from(`6 0 obj\n<< /Length ${stream.length} >>\nstream\n`, "latin1"), stream, Buffer.from("\nendstream\nendobj\n", "latin1")]));
  const xref = len;
  add(Buffer.from(`xref\n0 7\n0000000000 65535 f \n${off.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`, "latin1"));
  return Buffer.concat(teile);
}
