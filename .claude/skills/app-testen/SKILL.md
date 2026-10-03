---
name: app-testen
description: Die Kochbuch-App im Browser durchtesten (Rezept anlegen mit Gemini, Ausweichmodell, Groq-Ersatz, Claude, Bearbeiten, Suche, Teilen-Menü) mit nachgestellten KI-Antworten. Vor jedem Push und wenn Tomek fragt, ob etwas funktioniert.
allowed-tools: Bash(node tests/e2e.mjs*)
---

# App testen

1. Im Repo-Ordner `node tests/e2e.mjs` ausführen (mit `--shots` zusätzlich Screenshots nach `tests/out/`).
   Das Skript startet selbst einen Server, erzeugt mit ffmpeg ein Testvideo und stellt Gemini, Groq und Claude nach.
   Es braucht keine Schlüssel und schickt keine echten Anfragen.
2. Jede Zeile beginnt mit ✓ oder ✗. Exit-Code 0 heißt alles bestanden.
3. Bei ✗: Ursache finden und beheben, nicht die Prüfung abschwächen. Danach erneut laufen lassen.
4. Für Änderungen an der Oberfläche `--shots` nutzen und die Screenshots in `tests/out/` ansehen (Handy-Breite 390 px).
5. Neue Funktion → passenden Ablauf in `tests/e2e.mjs` ergänzen (gleicher Stil: `pruefe(bedingung, 'Text')`).

Im Bericht an Tomek klar sagen, dass mit nachgestellten Antworten getestet wurde; ob die echte KI ein Reel gut liest,
zeigt nur ein Versuch auf seinem Handy.

Voraussetzungen: Node, Playwright mit Chromium (in Claude-Cloud-Sitzungen vorinstalliert), ffmpeg.
Chromium kann kein H.264, deshalb ist das Testvideo VP9/WebM.
