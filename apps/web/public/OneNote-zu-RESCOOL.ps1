# OneNote zu RESCOOL
# Exportiert alle geöffneten OneNote-Notizbücher mit ihrem genauen Aufbau (Reihenfolge, Farben, Abschnittsgruppen,
# Unterseiten) in eine ZIP-Datei, die RESCOOL beim Import einliest. Es wird nichts in OneNote verändert und nichts verschickt.
# Braucht die OneNote-App für Windows (Microsoft 365 / Office), nicht die Web-Version.
#
# Starten: Rechtsklick auf die Datei > «Mit PowerShell ausführen»
# oder in PowerShell:  powershell -ExecutionPolicy Bypass -File "$HOME\Downloads\OneNote-zu-RESCOOL.ps1"

$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'OneNote zu RESCOOL'
function Ende($code) { Write-Host ''; Read-Host 'Enter drücken zum Schliessen' | Out-Null; exit $code }

Write-Host ''
Write-Host '  OneNote zu RESCOOL' -ForegroundColor Cyan
Write-Host '  Alle geöffneten Notizbücher werden exportiert. OneNote bleibt unverändert.'
Write-Host ''

try { $on = New-Object -ComObject OneNote.Application }
catch {
  Write-Host 'Die OneNote-App für Windows wurde nicht gefunden.' -ForegroundColor Red
  Write-Host 'Installieren Sie OneNote aus Microsoft 365 (nicht die Web-Version) und öffnen Sie dort Ihre Notizbücher.'
  Ende 1
}

# 1. Notizbücher synchronisieren, damit alle Seiten auf diesem Computer sind
[string]$h = ''
$on.GetHierarchy('', 2, [ref]$h)   # 2 = Abschnitte
$x0 = [xml]$h
$ns0 = New-Object Xml.XmlNamespaceManager $x0.NameTable
$ns0.AddNamespace('one', $x0.DocumentElement.NamespaceURI)
$bucher = $x0.SelectNodes('/one:Notebooks/one:Notebook', $ns0)
if ($bucher.Count -eq 0) { Write-Host 'In OneNote ist kein Notizbuch geöffnet.' -ForegroundColor Red; Ende 1 }
foreach ($b in $bucher) {
  Write-Host ("  Synchronisiere «{0}» …" -f $b.name)
  try { $on.SyncHierarchy($b.ID) } catch { }
}
Start-Sleep -Seconds 3

# 2. Aufbau mit allen Seiten
[string]$h = ''
$on.GetHierarchy('', 4, [ref]$h)   # 4 = bis zu den Seiten
$xml = [xml]$h
$ns = New-Object Xml.XmlNamespaceManager $xml.NameTable
$ns.AddNamespace('one', $xml.DocumentElement.NamespaceURI)

$ziel = Join-Path ([Environment]::GetFolderPath('Desktop')) ('OneNote-Export-' + (Get-Date -Format 'yyyy-MM-dd-HHmm'))
New-Item -ItemType Directory -Path $ziel, (Join-Path $ziel 'seiten'), (Join-Path $ziel 'dateien') | Out-Null

$seiten = @($xml.SelectNodes("//one:Page[not(@isInRecycleBin='true') and not(ancestor::one:SectionGroup[@isRecycleBin='true']) and not(ancestor::one:Section[@locked='true'])]", $ns))
$gesperrt = @($xml.SelectNodes("//one:Section[@locked='true']", $ns))
Write-Host ''
Write-Host ("  {0} Notizbücher, {1} Seiten" -f $bucher.Count, $seiten.Count)
foreach ($g in $gesperrt) { Write-Host ("  Übersprungen (mit Kennwort geschützt): {0}" -f $g.name) -ForegroundColor Yellow }
Write-Host ''

$fehler = New-Object System.Collections.ArrayList
$i = 0
foreach ($p in $seiten) {
  $i++
  Write-Progress -Activity 'OneNote wird exportiert' -Status ("{0} von {1}: {2}" -f $i, $seiten.Count, $p.name) -PercentComplete ([int]($i * 100 / [Math]::Max(1, $seiten.Count)))
  $name = 's' + $i
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
    $px.Save((Join-Path $ziel ('seiten\' + $name + '.xml')))
    # Handschrift: zusätzlich die ganze Seite als PDF, damit nichts verloren geht
    if ($px.SelectSingleNode('//one:InkDrawing|//one:InkWord|//one:InkParagraph', $pns)) {
      try { $on.Publish($p.ID, (Join-Path $ziel ('seiten\' + $name + '.pdf')), 3, '') } catch { [void]$fehler.Add(("Handschrift auf «{0}»: {1}" -f $p.name, $_.Exception.Message)) }
    }
    $p.SetAttribute('rescoolDatei', 'seiten/' + $name + '.xml')
  } catch {
    [void]$fehler.Add(("Seite «{0}»: {1}" -f $p.name, $_.Exception.Message))
  }
}
Write-Progress -Activity 'OneNote wird exportiert' -Completed
$xml.Save((Join-Path $ziel 'aufbau.xml'))

Write-Host '  ZIP-Datei wird erstellt …'
$zip = $ziel + '.zip'
Compress-Archive -Path (Join-Path $ziel '*') -DestinationPath $zip -Force
Remove-Item -LiteralPath $ziel -Recurse -Force

Write-Host ''
if ($fehler.Count) {
  Write-Host ("  {0} Hinweise:" -f $fehler.Count) -ForegroundColor Yellow
  $fehler | ForEach-Object { Write-Host ('   - ' + $_) -ForegroundColor Yellow }
  Write-Host ''
}
Write-Host '  Fertig.' -ForegroundColor Green
Write-Host ('  Datei: ' + $zip)
Write-Host '  In RESCOOL: Notizbuch öffnen > Importieren > «OneNote-Export hochladen» und diese Datei wählen.'
try { Start-Process explorer.exe "/select,`"$zip`"" } catch { }
Ende 0
