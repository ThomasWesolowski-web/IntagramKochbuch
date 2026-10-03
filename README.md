# Instagram Kochbuch

Web-App fürs Handy, die aus Instagram-Koch-Reels ein Rezept zum Nachlesen macht:
Zutaten mit Mengen, Schritt-für-Schritt-Anleitung und Bilder aus dem Video.
Aufgebaut wie die [Tagesbericht-App](https://github.com/ThomasWesolowski-web/Tagesbericht-App):
reines HTML/CSS/JavaScript ohne Build-Schritt, läuft über GitHub Pages und auch offline.

## Was die App kann

- Reel teilen (Android: Video in der Galerie teilen → *Kochbuch*) oder hier hochladen (iPhone und Android)
- Beschreibung und Link des Posts einfügen; ein geteilter Text wird automatisch in Link und Beschreibung getrennt
- Die App holt etwa alle 1,5 Sekunden ein Standbild aus dem Video (8 bis 32 Bilder, direkt im Browser)
- Claude liest Standbilder (eingeblendeter Text, Untertitel, was man sieht) und Beschreibung und macht daraus ein Rezept:
  Titel, Portionen, Zeit, Zutaten mit Mengen (metrisch, geschätzte Mengen mit ≈ markiert), Schritte mit passendem Bild, Tipps, Schlagworte
- Portionen umrechnen, Zutaten und Schritte beim Kochen abhaken, Kochmodus (Bildschirm bleibt an)
- Suchen nach Rezept oder Zutat, Filtern nach Schlagwort
- Rezept bearbeiten und als Text teilen
- Alles bleibt auf dem Handy (IndexedDB); gespeichert werden nur die Standbilder, die das Rezept zeigt

Der Ton des Videos wird noch nicht ausgewertet. Wenn das Rezept nur gesprochen wird,
fehlen Details; dann hilft die Beschreibung.

## Einrichten

1. GitHub Pages einschalten: *Settings → Pages → Deploy from a branch → `main` / `(root)`*.
2. Die Adresse `https://thomaswesolowski-web.github.io/Instagram-Kochbuch/` auf dem Handy öffnen
   und „Zum Home-Bildschirm“ wählen. Erst danach erscheint *Kochbuch* im Teilen-Menü (Android).
3. Unter [console.anthropic.com](https://console.anthropic.com) einen API-Schlüssel anlegen und in der App
   unter *Einstellungen* eintragen. Der Schlüssel bleibt nur auf dem Handy. Ein Rezept kostet je nach
   Videolänge ein paar Cent.

## Dateien

- `app.js`: Ansichten (Liste, Neu, Rezept, Bearbeiten, Einstellungen)
- `video.js`: Standbilder aus dem Video
- `extract.js`: Anfrage an Claude mit festem JSON-Schema
- `db.js`: Speicher auf dem Gerät
- `sw.js`: Offline-Cache und Empfang geteilter Reels
- `vendor/anthropic-sdk.mjs`: Anthropic TypeScript SDK als eine Datei gebündelt

## Lokal ausprobieren

```sh
python3 -m http.server 8000
```

Dann <http://localhost:8000> öffnen.
