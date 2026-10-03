---
paths:
  - "*.html"
  - "*.js"
  - "*.css"
  - "manifest.webmanifest"
  - "icons/**"
  - "vendor/**"
---

# Service Worker und Cache

Die App kommt auf dem Handy aus dem Cache des Service Workers. Ohne neue Cache-Version sieht Tomek Änderungen nicht.

- Bei **jeder** Änderung an einer dieser Dateien in `sw.js` die Zahl in `const CACHE = 'kochbuch-vN'` um eins erhöhen.
- Neue Dateien, die die App zum Starten braucht, in die Liste `SHELL` in `sw.js` eintragen; gelöschte Dateien dort entfernen.
- `APP_VERSION` in `app.js` passend anheben (kleine Korrektur: letzte Stelle, neue Funktion: mittlere Stelle).
- Anfragen an fremde Server (Gemini, Groq, Claude) dürfen nie über den Cache laufen; der Fetch-Handler in `sw.js` lässt sie bewusst durch.
- Nach dem Push Tomek sagen: App ganz schließen und neu öffnen, notfalls zweimal; in den Einstellungen steht dann die neue Version.
