# Instagram Kochbuch

Web-App (PWA) fürs Handy: Ein Instagram-Reel wird hochgeladen oder an die App geteilt, eine KI macht daraus ein Rezept
(Zutaten mit Mengen, Schritte mit Bild, Tipps). Gemini bekommt das ganze Video mit Ton, Groq und Claude Standbilder.
Aufgebaut wie die Tagesbericht-App desselben Besitzers (ThomasWesolowski-web/Tagesbericht-App).

## Regeln

- Mit dem Besitzer (Tomek) auf **Deutsch** sprechen, einfach und ohne Fachjargon. Er arbeitet meist vom iPhone aus.
- **Kein Build-Schritt, keine npm-Abhängigkeiten zur Laufzeit.** Reines HTML/CSS/JavaScript (ES-Module), läuft direkt über GitHub Pages
  (`https://thomaswesolowski-web.github.io/IntagramKochbuch/`, Branch `main`, Ordner `/`).
- Bezeichner, Kommentare und Texte in der App auf Deutsch (`rezeptSpeichern`, `standbilder` …), wie im bestehenden Code.
- **API-Schlüssel nie in den Code oder ins Repo.** Sie stehen nur in den Einstellungen auf dem Handy (localStorage).
- Bei jeder Änderung an einer App-Datei die Cache-Version in `sw.js` hochzählen (siehe `.claude/rules/service-worker.md`)
  und `APP_VERSION` in `app.js` anheben, damit Tomek in den Einstellungen sieht, ob er die neue Version hat.
- Kostenlose Anbieter haben Vorrang (Tomeks Wunsch): Gemini zuerst, Groq als Ersatz, Claude nur wenn er es wählt.

## Aufbau

| Datei | Inhalt |
|---|---|
| `index.html`, `app.css` | Gerüst und Aussehen (Farben als CSS-Variablen, heller und dunkler Modus) |
| `app.js` | Router (`#/`, `#/neu`, `#/rezept/<id>`, `#/rezept/<id>/bearbeiten`, `#/einstellungen`) und alle Ansichten |
| `video.js` | Standbilder aus dem Video (8–20 Bilder, 768 px) und Bilder zu bestimmten Zeitpunkten (`bilderBeiZeiten`) |
| `extract.js` | Anfragen an Gemini, Groq und Claude mit einem gemeinsamen JSON-Schema; Wiederholungen und Ausweichmodelle |
| `db.js` | IndexedDB (`rezepte`, `bilder`, `eingang`) und Einstellungen |
| `sw.js` | Offline-Cache und Empfang geteilter Reels (`share_target` in `manifest.webmanifest`, nur Android) |
| `vendor/anthropic-sdk.mjs` | Anthropic SDK als eine Datei gebündelt (esbuild), nicht von Hand ändern |
| `tests/e2e.mjs` | Browser-Test mit nachgestellten KI-Antworten |

Grenzen, die schon geklärt sind: Ein Instagram-Link allein reicht nicht (Instagram blockt das Laden von außen),
das Video muss heruntergeladen werden. Gemini: Video bis 14 MB direkt in der Anfrage, größer über die Datei-Schnittstelle
(multipart), lehnt Gemini das Video ab (400), gehen Standbilder hin; Gemini nennt Sekunden (`zeit_s`), die App holt dort die Bilder.
Ton werten nur Gemini aus. Groq nimmt höchstens 5 Bilder, daher Kollagen. Feld `abschrift` steht im Schema zuerst,
damit die KI erst alles abschreibt; die App zeigt es aufklappbar unter „Was die KI gelesen und gehört hat“.

## Testen

Vor jedem Push den Skill `app-testen` ausführen (`node tests/e2e.mjs`). Er braucht keine echten Schlüssel.
Echte Anfragen an Gemini/Groq/Claude kann nur Tomek mit seinen Schlüsseln machen; das im Bericht ehrlich sagen.
Vor dem Push außerdem den Agent `code-reviewer` über den Diff laufen lassen.
