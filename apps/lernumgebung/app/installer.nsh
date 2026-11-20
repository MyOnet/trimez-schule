; RESCOOL Lernumgebung: Ergänzungen zum Installationsprogramm (Tauri ruft diese Makros auf)

; Gleich nach der Installation die OneNote-Notizbücher dieses Computers im Hintergrund vorbereiten:
; ohne Fenster, nur lesen, nichts verlässt den Computer. In RESCOOL lassen sie sich danach mit einem Klick übernehmen.
; Ohne die OneNote-App für Windows endet das sofort.
!macro NSIS_HOOK_POSTINSTALL
  Exec '"$INSTDIR\${MAINBINARYNAME}.exe" --onenote-export'
!macroend

; Beim Deinstallieren mit «App-Daten löschen» auch die vorbereiteten OneNote-Dateien entfernen
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
    RMDir /r "$LOCALAPPDATA\trimez-lernumgebung\onenote"
  ${EndIf}
!macroend
