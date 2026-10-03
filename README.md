# Instagram Kochbuch

Web-App fürs Handy, die aus Instagram-Koch-Reels ein Rezept zum Nachlesen macht:
Zutaten mit Mengen, Schritt-für-Schritt-Anleitung und Bilder aus dem Video.
Aufgebaut wie die [Tagesbericht-App](https://github.com/ThomasWesolowski-web/Tagesbericht-App):
reines HTML/CSS/JavaScript ohne Build-Schritt, läuft über GitHub Pages und auch offline.

## Was die App kann

- Reel teilen (Android: Video in der Galerie teilen → *Kochbuch*) oder hier hochladen (iPhone und Android)
- Beschreibung und Link des Posts einfügen; ein geteilter Text wird automatisch in Link und Beschreibung getrennt
- Die App holt etwa alle 3 Sekunden ein Standbild aus dem Video (6 bis 12 Bilder, direkt im Browser)
- Eine KI (Google Gemini oder Groq kostenlos, oder Claude) liest Standbilder (eingeblendeter Text, Untertitel, was man sieht) und Beschreibung und macht daraus ein Rezept:
  Titel, Portionen, Zeit, Zutaten mit Mengen (metrisch, geschätzte Mengen mit ≈ markiert), Schritte mit passendem Bild, Tipps, Schlagworte
- Portionen umrechnen, Zutaten und Schritte beim Kochen abhaken, Kochmodus (Bildschirm bleibt an)
- Suchen nach Rezept oder Zutat, Filtern nach Schlagwort
- Rezept bearbeiten und als Text teilen
- Alles bleibt auf dem Handy (IndexedDB); gespeichert werden nur die Standbilder, die das Rezept zeigt

Der Ton des Videos wird noch nicht ausgewertet. Wenn das Rezept nur gesprochen wird,
fehlen Details; dann hilft die Beschreibung.

## Einrichten

1. GitHub Pages einschalten: *Settings → Pages → Deploy from a branch → `main` / `(root)`*.
2. Die Adresse `https://thomaswesolowski-web.github.io/IntagramKochbuch/` auf dem Handy öffnen
   und „Zum Home-Bildschirm“ wählen. Erst danach erscheint *Kochbuch* im Teilen-Menü (Android).
3. Einen API-Schlüssel in der App unter *Einstellungen* eintragen. Er bleibt nur auf dem Handy.
   - **Google Gemini (Standard, kostenlos):** Schlüssel unter [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
     anlegen. Es gibt ein Tageslimit, und im kostenlosen Kontingent darf Google die Anfragen zur Verbesserung nutzen.
     Die App nimmt das aktuelle Flash-Modell (`gemini-flash-latest`, sonst das neueste verfügbare Flash-Modell).
   - **Groq (kostenlos, Ersatz):** Schlüssel unter [console.groq.com/keys](https://console.groq.com/keys) anlegen.
     Springt automatisch ein, wenn Gemini am Limit oder überlastet ist. Groq nimmt höchstens 5 Bilder pro Anfrage,
     deshalb setzt die App die Standbilder zu nummerierten Kollagen zusammen (Modell Llama 4 Scout).
   - **Claude (kostenpflichtig):** Schlüssel unter [console.anthropic.com](https://console.anthropic.com) anlegen und
     Guthaben aufladen. Mit Sonnet 5.5 kostet ein Rezept etwa 3 bis 5 Cent, mit Opus 5.5 etwa 10 bis 20 Cent.

## Dateien

- `app.js`: Ansichten (Liste, Neu, Rezept, Bearbeiten, Einstellungen)
- `video.js`: Standbilder aus dem Video
- `extract.js`: Anfrage an Gemini, Groq oder Claude mit festem JSON-Schema
- `db.js`: Speicher auf dem Gerät
- `sw.js`: Offline-Cache und Empfang geteilter Reels
- `vendor/anthropic-sdk.mjs`: Anthropic TypeScript SDK als eine Datei gebündelt

## Lokal ausprobieren

```sh
python3 -m http.server 8000
```

Dann <http://localhost:8000> öffnen.

## Testen

```sh
node tests/e2e.mjs
```

Spielt die App im Browser durch (Playwright, Chromium, ffmpeg nötig). Gemini, Groq und Claude werden nachgestellt,
es braucht also keine Schlüssel. Für Claude Code liegen in `.claude/` eine Projektregel für den Service Worker,
der Skill `app-testen` und der Agent `code-reviewer`; die Projektbeschreibung steht in `CLAUDE.md`.
