# OneNote zu RESCOOL
# Exportiert alle geöffneten OneNote-Notizbücher mit ihrem genauen Aufbau (Reihenfolge, Farben, Abschnittsgruppen,
# Unterseiten) in eine ZIP-Datei, die RESCOOL beim Import einliest. Es wird nichts in OneNote verändert und nichts verschickt.
# Braucht die OneNote-App für Windows (Microsoft 365 / Office), nicht die Web-Version, und Windows PowerShell (powershell.exe).
#
# Starten: Rechtsklick auf die Datei > «Mit PowerShell ausführen»
# oder in PowerShell:  powershell -ExecutionPolicy Bypass -File "$HOME\Downloads\OneNote-zu-RESCOOL.ps1"
# Apps (Sheaf) rufen es mit -Still -Ausgabe <zip> -Fortschritt <datei> auf: ohne Rückfragen, Fortschritt in eine Datei.
# Die RESCOOL Lernumgebung ruft es bei der Installation mit -Fortlaufend auf: zuletzt bearbeitete Seiten zuerst, aufbau.xml
# wird unterwegs immer wieder geschrieben (was fertig ist, lässt sich sofort übernehmen), und beim nächsten Lauf werden nur
# geänderte Seiten neu gelesen.
param([string]$Ausgabe = '', [string]$Fortschritt = '', [switch]$Still, [switch]$OhneZip, [switch]$NurAufbau, [string]$Auswahl = '', [switch]$Fortlaufend)

$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'OneNote zu RESCOOL'
function Melden([int]$prozent, [string]$text) { if ($Fortschritt) { try { [IO.File]::WriteAllText($Fortschritt, "$prozent|$text", (New-Object Text.UTF8Encoding $false)) } catch { } } }
function Ende($code) { if ($Fortschritt) { Melden 100 ($(if ($code) { 'FEHLER' } else { 'FERTIG' })) }; if (-not $Still) { Write-Host ''; Read-Host 'Enter drücken zum Schliessen' | Out-Null }; exit $code }

# Handschrift: Windows liest das Tintenformat von OneNote (ISF) selbst. Jeder Strich kommt mit allen Punkten,
# Druck, Farbe, Dicke und Stiftart heraus, nichts wird nachgezeichnet oder geglättet.
$tinteMoeglich = $true
# Schnell: das Auslesen der Striche läuft kompiliert (C#), nicht Punkt für Punkt in PowerShell
$tinteCode = @'
using System; using System.IO; using System.Text; using System.Globalization; using System.Windows.Ink;
public static class RescoolTinte {
  static readonly CultureInfo I = CultureInfo.InvariantCulture;
  public static string Lesen(string b64, int knoten) {
    var sc = new StrokeCollection(new MemoryStream(Convert.FromBase64String(b64)));
    if (sc.Count == 0) return null;
    var b = sc.GetBounds();
    var sb = new StringBuilder();
    sb.Append("{\"knoten\":").Append(knoten).Append(",\"x\":").Append(b.X.ToString("0.##", I)).Append(",\"y\":").Append(b.Y.ToString("0.##", I))
      .Append(",\"w\":").Append(b.Width.ToString("0.##", I)).Append(",\"h\":").Append(b.Height.ToString("0.##", I)).Append(",\"striche\":[");
    bool erst = true;
    foreach (Stroke s in sc) {
      var d = s.DrawingAttributes; var c = d.Color;
      if (!erst) sb.Append(','); erst = false;
      sb.Append("{\"farbe\":\"#").Append(c.R.ToString("X2")).Append(c.G.ToString("X2")).Append(c.B.ToString("X2"))
        .Append("\",\"deckung\":").Append((c.A / 255.0).ToString("0.###", I)).Append(",\"breite\":").Append(d.Width.ToString("0.###", I))
        .Append(",\"hoehe\":").Append(d.Height.ToString("0.###", I)).Append(",\"marker\":").Append(d.IsHighlighter ? "true" : "false")
        .Append(",\"spitze\":\"").Append(d.StylusTip.ToString()).Append("\",\"druck\":").Append(d.IgnorePressure ? "false" : "true").Append(",\"punkte\":\"");
      bool e2 = true;
      foreach (var p in s.StylusPoints) { if (!e2) sb.Append(';'); e2 = false; sb.Append(p.X.ToString("0.##", I)).Append(',').Append(p.Y.ToString("0.##", I)).Append(',').Append(p.PressureFactor.ToString("0.###", I)); }
      sb.Append("\"}");
    }
    return sb.Append("]}").ToString();
  }
}
'@
$tinteSchnell = $false
try { Add-Type -AssemblyName PresentationCore, WindowsBase } catch { $tinteMoeglich = $false }
if ($tinteMoeglich) {
  try { Add-Type -AssemblyName System.Xaml } catch { }
  try {
    $refs = @([AppDomain]::CurrentDomain.GetAssemblies() | Where-Object { @('PresentationCore', 'WindowsBase', 'System.Xaml') -contains $_.GetName().Name } | ForEach-Object { $_.Location })
    Add-Type -TypeDefinition $tinteCode -ReferencedAssemblies $refs
    $tinteSchnell = $true
  } catch { }
}
$inv = [Globalization.CultureInfo]::InvariantCulture
# Ersatz, falls der schnelle Weg nicht kompiliert (gleiches Ergebnis, nur langsamer)
function Tinte([string]$b64) {
  $bytes = [Convert]::FromBase64String($b64)
  $ms = New-Object IO.MemoryStream(, $bytes)
  $sc = New-Object System.Windows.Ink.StrokeCollection($ms)
  $b = $sc.GetBounds()
  $striche = New-Object System.Collections.ArrayList
  foreach ($s in $sc) {
    $da = $s.DrawingAttributes
    $sb = New-Object Text.StringBuilder
    foreach ($pt in $s.StylusPoints) { [void]$sb.Append($pt.X.ToString('0.##', $inv)).Append(',').Append($pt.Y.ToString('0.##', $inv)).Append(',').Append($pt.PressureFactor.ToString('0.###', $inv)).Append(';') }
    $c = $da.Color
    [void]$striche.Add([ordered]@{ farbe = ('#{0:X2}{1:X2}{2:X2}' -f $c.R, $c.G, $c.B); deckung = [Math]::Round($c.A / 255, 3); breite = [Math]::Round($da.Width, 3); hoehe = [Math]::Round($da.Height, 3)
      marker = [bool]$da.IsHighlighter; spitze = $da.StylusTip.ToString(); druck = -not $da.IgnorePressure; punkte = $sb.ToString().TrimEnd(';') })
  }
  return [ordered]@{ x = $b.X; y = $b.Y; w = $b.Width; h = $b.Height; striche = $striche }
}
function TinteJson([string]$b64, [int]$k) {
  if ($tinteSchnell) { return [RescoolTinte]::Lesen($b64, $k) }
  $t = Tinte $b64; $t['knoten'] = $k
  return (ConvertTo-Json -InputObject $t -Depth 6 -Compress)
}

Write-Host ''
Write-Host '  OneNote zu RESCOOL' -ForegroundColor Cyan
Write-Host '  Alle geöffneten Notizbücher werden exportiert. OneNote bleibt unverändert.'
Write-Host ''

try { $on = New-Object -ComObject OneNote.Application }
catch {
  Melden 0 'Die OneNote-App für Windows wurde nicht gefunden. Installieren Sie OneNote aus Microsoft 365 und öffnen Sie dort Ihre Notizbücher.'
  if ($Fortschritt) { exit 1 }
  Write-Host 'Die OneNote-App für Windows wurde nicht gefunden.' -ForegroundColor Red
  Write-Host 'Installieren Sie OneNote aus Microsoft 365 (nicht die Web-Version) und öffnen Sie dort Ihre Notizbücher.'
  Ende 1
}

# Nur die Liste (Notizbücher, Abschnitte, Seiten mit Änderungsdatum), damit eine App eine Auswahl anbieten kann: dauert Sekunden
if ($NurAufbau) {
  [string]$h = ''
  $on.GetHierarchy('', 4, [ref]$h)
  [IO.File]::WriteAllText($Ausgabe, $h, (New-Object Text.UTF8Encoding $false))
  Ende 0
}

# 1. Notizbücher synchronisieren, damit alle Seiten auf diesem Computer sind
[string]$h = ''
$on.GetHierarchy('', 2, [ref]$h)   # 2 = Abschnitte
$x0 = [xml]$h
$ns0 = New-Object Xml.XmlNamespaceManager $x0.NameTable
$ns0.AddNamespace('one', $x0.DocumentElement.NamespaceURI)
$bucher = $x0.SelectNodes('/one:Notebooks/one:Notebook', $ns0)
if ($bucher.Count -eq 0) { Melden 0 'In OneNote ist kein Notizbuch geöffnet.'; if ($Fortschritt) { exit 1 }; Write-Host 'In OneNote ist kein Notizbuch geöffnet.' -ForegroundColor Red; Ende 1 }
foreach ($b in $bucher) {
  Write-Host ("  Synchronisiere «{0}» …" -f $b.name)
  Melden 1 ("Synchronisiere «{0}» …" -f $b.name)
  try { $on.SyncHierarchy($b.ID) } catch { }
}
Start-Sleep -Seconds 3

# 2. Aufbau mit allen Seiten
[string]$h = ''
$on.GetHierarchy('', 4, [ref]$h)   # 4 = bis zu den Seiten
$xml = [xml]$h
$ns = New-Object Xml.XmlNamespaceManager $xml.NameTable
$ns.AddNamespace('one', $xml.DocumentElement.NamespaceURI)

$ziel = if ($Ausgabe) { $Ausgabe -replace '\.zip$', '' } else { Join-Path ([Environment]::GetFolderPath('Desktop')) ('OneNote-Export-' + (Get-Date -Format 'yyyy-MM-dd-HHmm')) }
# Fortlaufend: was vom letzten Lauf da ist und sich nicht geändert hat, bleibt (Seiten-ID -> Änderungszeit, Datei)
$vorher = @{}
if ($Fortlaufend -and (Test-Path -LiteralPath (Join-Path $ziel 'aufbau.xml'))) {
  try {
    $alt = New-Object Xml.XmlDocument; $alt.Load((Join-Path $ziel 'aufbau.xml'))
    $ans = New-Object Xml.XmlNamespaceManager $alt.NameTable; $ans.AddNamespace('one', $alt.DocumentElement.NamespaceURI)
    foreach ($ap in $alt.SelectNodes('//one:Page[@rescoolDatei]', $ans)) { $vorher[$ap.ID] = @($ap.lastModifiedTime, $ap.GetAttribute('rescoolDatei')) }
  } catch { $vorher = @{} }
}
if (-not $Fortlaufend -and (Test-Path -LiteralPath $ziel)) { Remove-Item -LiteralPath $ziel -Recurse -Force }
foreach ($o in @($ziel, (Join-Path $ziel 'seiten'), (Join-Path $ziel 'dateien'))) { if (-not (Test-Path -LiteralPath $o)) { New-Item -ItemType Directory -Path $o | Out-Null } }
$md5 = [Security.Cryptography.MD5]::Create()
function DateiName([string]$id) { 'p' + (($md5.ComputeHash([Text.Encoding]::UTF8.GetBytes($id)) | ForEach-Object { $_.ToString('x2') }) -join '').Substring(0, 20) }
function AufbauSpeichern([bool]$fertig) {
  $xml.DocumentElement.SetAttribute('rescoolFertig', $(if ($fertig) { '1' } else { '0' }))
  $xml.DocumentElement.SetAttribute('rescoolStand', ('{0}/{1}' -f $i, $seiten.Count))
  $tmp = Join-Path $ziel 'aufbau.tmp'
  $xml.Save($tmp)
  Move-Item -LiteralPath $tmp -Destination (Join-Path $ziel 'aufbau.xml') -Force
}

$seiten = @($xml.SelectNodes("//one:Page[not(@isInRecycleBin='true') and not(ancestor::one:SectionGroup[@isRecycleBin='true']) and not(ancestor::one:Section[@locked='true'])]", $ns))
# Nur ausgewählte Seiten (Liste der Seiten-IDs, eine pro Zeile)
if ($Auswahl -and (Test-Path -LiteralPath $Auswahl)) {
  $wahl = New-Object 'System.Collections.Generic.HashSet[string]'
  foreach ($zeile in [IO.File]::ReadAllLines($Auswahl)) { if ($zeile.Trim()) { [void]$wahl.Add($zeile.Trim()) } }
  $seiten = @($seiten | Where-Object { $wahl.Contains($_.ID) })
  $xml.DocumentElement.SetAttribute('rescoolAuswahl', '1')
}
# Zuletzt bearbeitete Seiten zuerst: sie sind am schnellsten in RESCOOL
if ($Fortlaufend) { $seiten = @($seiten | Sort-Object -Property @{ Expression = { $_.lastModifiedTime }; Descending = $true }) }
$gesperrt = @($xml.SelectNodes("//one:Section[@locked='true']", $ns))
Write-Host ''
Write-Host ("  {0} Notizbücher, {1} Seiten" -f $bucher.Count, $seiten.Count)
foreach ($g in $gesperrt) { Write-Host ("  Übersprungen (mit Kennwort geschützt): {0}" -f $g.name) -ForegroundColor Yellow }
Write-Host ''

$fehler = New-Object System.Collections.ArrayList
$i = 0
$neu = 0
$uhr = [Diagnostics.Stopwatch]::StartNew()
if ($Fortlaufend) { AufbauSpeichern $false }
foreach ($p in $seiten) {
  $i++
  if ($Fortlaufend) {
    # unverändert seit dem letzten Lauf: nichts lesen
    $v = $vorher[$p.ID]
    if ($v -and $v[0] -eq $p.lastModifiedTime -and (Test-Path -LiteralPath (Join-Path $ziel $v[1]))) { $p.SetAttribute('rescoolDatei', $v[1]); continue }
    $neu++
    if ($neu -eq 10 -or ($neu % 25) -eq 0) { AufbauSpeichern $false }
  }
  Write-Progress -Activity 'OneNote wird exportiert' -Status ("{0} von {1}: {2}" -f $i, $seiten.Count, $p.name) -PercentComplete ([int]($i * 100 / [Math]::Max(1, $seiten.Count)))
  $rest = ''
  $gelesen = if ($Fortlaufend) { $neu } else { $i }
  if ($gelesen -gt 5) { $min = [Math]::Ceiling($uhr.Elapsed.TotalMinutes / ($gelesen - 1) * ($seiten.Count - $i + 1)); $rest = if ($min -le 1) { ' · noch etwa 1 Minute' } else { " · noch etwa $min Minuten" } }
  Melden ([int](2 + $i * 95 / [Math]::Max(1, $seiten.Count))) ("Seite {0} von {1}: {2}{3}" -f $i, $seiten.Count, $p.name, $rest)
  $name = if ($Fortlaufend) { DateiName $p.ID } else { 's' + $i }
  try {
    [string]$c = ''
    $on.GetPageContent($p.ID, [ref]$c, 1)   # 1 = mit Bildern
    $px = [xml]$c
    $pns = New-Object Xml.XmlNamespaceManager $px.NameTable
    $pns.AddNamespace('one', $px.DocumentElement.NamespaceURI)
    # Angehängte Dateien liegen im Zwischenspeicher von OneNote: mitnehmen
    foreach ($f in $px.SelectNodes('//one:InsertedFile', $pns)) {
      $quelle = $f.GetAttribute('pathCache')
      if ($quelle -and (Test-Path -LiteralPath $quelle)) {
        $neu = ([guid]::NewGuid().ToString('N')) + [IO.Path]::GetExtension($f.GetAttribute('preferredName'))
        Copy-Item -LiteralPath $quelle -Destination (Join-Path $ziel ('dateien\' + $neu))
        $f.SetAttribute('rescoolDatei', 'dateien/' + $neu)
      }
    }
    # Handschrift als echte Striche; nur wenn das nicht geht, die ganze Seite zusätzlich als PDF
    $tinte = New-Object System.Collections.ArrayList
    $ohne = $false
    $k = 0
    foreach ($ink in $px.SelectNodes('//one:InkDrawing|//one:InkWord', $pns)) {
      $d = $ink.SelectSingleNode('one:Data', $pns)
      if (-not $d -or -not $tinteMoeglich) { $ohne = $true; continue }
      try { $t = TinteJson $d.InnerText $k; if ($t) { [void]$tinte.Add($t); $ink.SetAttribute('rescoolTinte', [string]$k); $k++ } }
      catch { $ohne = $true; [void]$fehler.Add(("Handschrift auf «{0}» nicht lesbar: {1}" -f $p.name, $_.Exception.Message)) }
    }
    if ($tinte.Count) { [IO.File]::WriteAllText((Join-Path $ziel ('seiten\' + $name + '-tinte.json')), ('[' + ($tinte -join ',') + ']'), (New-Object Text.UTF8Encoding $false)) }
    if ($ohne -or $px.SelectSingleNode('//one:InkParagraph', $pns)) {
      try { $on.Publish($p.ID, (Join-Path $ziel ('seiten\' + $name + '.pdf')), 3, '') } catch { [void]$fehler.Add(("Handschrift auf «{0}»: {1}" -f $p.name, $_.Exception.Message)) }
    }
    $px.Save((Join-Path $ziel ('seiten\' + $name + '.xml')))
    $p.SetAttribute('rescoolDatei', 'seiten/' + $name + '.xml')
  } catch {
    [void]$fehler.Add(("Seite «{0}»: {1}" -f $p.name, $_.Exception.Message))
  }
}
Write-Progress -Activity 'OneNote wird exportiert' -Completed
if ($Fortlaufend) { AufbauSpeichern $true } else { $xml.Save((Join-Path $ziel 'aufbau.xml')) }

$zip = $ziel + '.zip'
if (-not $OhneZip) {
  Write-Host '  ZIP-Datei wird erstellt …'
  Melden 98 'ZIP-Datei wird erstellt …'
  if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::CreateFromDirectory($ziel, $zip, [IO.Compression.CompressionLevel]::Fastest, $false)
  Remove-Item -LiteralPath $ziel -Recurse -Force
}

Write-Host ''
if ($fehler.Count) {
  Write-Host ("  {0} Hinweise:" -f $fehler.Count) -ForegroundColor Yellow
  $fehler | ForEach-Object { Write-Host ('   - ' + $_) -ForegroundColor Yellow }
  Write-Host ''
}
if ($fehler.Count) { [IO.File]::WriteAllLines($zip + '.hinweise.txt', [string[]]$fehler, (New-Object Text.UTF8Encoding $false)) }
Write-Host '  Fertig.' -ForegroundColor Green
Write-Host ('  Datei: ' + $zip)
Write-Host '  In RESCOOL: Notizbuch öffnen > Importieren > «OneNote-Export hochladen» und diese Datei wählen.'
if (-not $Still) { try { Start-Process explorer.exe "/select,`"$zip`"" } catch { } }
Ende 0
