// Aus Standbildern, Beschreibung und Link ein Rezept machen (Claude API).
// Der API-Schlüssel bleibt auf dem Handy; die Anfrage geht direkt vom Browser an Anthropic.

import Anthropic from './vendor/anthropic-sdk.mjs';
import { blobToBase64, zeitLabel } from './video.js';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ist_rezept', 'titel', 'beschreibung', 'portionen', 'zubereitungszeit', 'zutaten', 'schritte', 'titelbild', 'tags', 'hinweise'],
  properties: {
    ist_rezept: { type: 'boolean', description: 'false, wenn im Material kein Rezept zu erkennen ist' },
    titel: { type: 'string' },
    beschreibung: { type: 'string', description: 'ein bis zwei Sätze, worum es geht' },
    portionen: { type: ['integer', 'null'] },
    zubereitungszeit: { type: 'string', description: 'z. B. "30 Min." oder leer' },
    zutaten: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['gruppe', 'menge', 'einheit', 'name', 'hinweis', 'geschaetzt'],
        properties: {
          gruppe: { type: 'string', description: 'z. B. "Teig", "Soße"; leer wenn es keine Gruppen gibt' },
          menge: { type: ['number', 'null'], description: 'Zahl, null bei "nach Geschmack"' },
          einheit: { type: 'string', description: 'g, kg, ml, l, EL, TL, Stück, Prise, Dose … oder leer' },
          name: { type: 'string' },
          hinweis: { type: 'string', description: 'z. B. "gewürfelt", leer wenn nichts' },
          geschaetzt: { type: 'boolean', description: 'true, wenn die Menge nicht genannt und von dir geschätzt wurde' },
        },
      },
    },
    schritte: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'bild'],
        properties: {
          text: { type: 'string' },
          bild: { type: ['integer', 'null'], description: 'Nummer des Standbilds, das diesen Schritt am besten zeigt' },
        },
      },
    },
    titelbild: { type: ['integer', 'null'], description: 'Nummer des Standbilds mit dem fertigen Gericht' },
    tags: { type: 'array', items: { type: 'string' } },
    hinweise: { type: 'string', description: 'Tipps aus dem Video, oder was unklar war; leer wenn nichts' },
  },
};

const SYSTEM = `Du machst aus Instagram-Koch-Reels ein Rezept zum Nachkochen, auf Deutsch.
Du bekommst Standbilder aus dem Video (nummeriert, mit Zeitstempel), die Beschreibung des Posts und eventuell den Link.
Lies eingeblendeten Text und Untertitel in den Bildern und nutze die Beschreibung. Was du siehst, hat Vorrang vor Vermutungen.
- Zutaten mit Mengen in metrischen Einheiten (Cups, oz, °F umrechnen). Fehlt eine Menge, schätze sie für die angegebene Portionenzahl und setze "geschaetzt" auf true.
- Schritte in der Reihenfolge des Videos, kurz und konkret, mit Temperatur, Zeit und Hitzestufe, wenn erkennbar.
- Zu jedem Schritt die Nummer des Standbilds, das ihn am besten zeigt, sonst null. Jedes Bild höchstens einmal.
- Werbung, Hashtags und Aufrufe wie "Folgt mir" weglassen.
Wenn kein Rezept erkennbar ist, setze "ist_rezept" auf false und erkläre es in "hinweise".`;

export class ExtraktionsFehler extends Error {}

function fehlertext(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'Der API-Schlüssel ist ungültig. Bitte in den Einstellungen prüfen.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'Der API-Schlüssel darf dieses Modell nicht nutzen.';
  if (err instanceof Anthropic.RateLimitError) return 'Zu viele Anfragen oder kein Guthaben mehr. Bitte später erneut versuchen.';
  if (err instanceof Anthropic.BadRequestError) return `Die Anfrage wurde abgelehnt: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return 'Keine Verbindung zu Claude. Ist das Handy online?';
  if (err instanceof Anthropic.APIError) return `Claude meldet einen Fehler (${err.status ?? '?'}). Bitte erneut versuchen.`;
  return err?.message || String(err);
}

// eingabe: { bilder: [{index, zeit, blob}], beschreibung, link }, settings: { apiKey, modell }
export async function rezeptErkennen(eingabe, settings, onStatus = () => {}) {
  if (!settings.apiKey) throw new ExtraktionsFehler('Bitte zuerst in den Einstellungen einen Claude API-Schlüssel eintragen.');
  if (!eingabe.bilder.length && !eingabe.beschreibung.trim()) {
    throw new ExtraktionsFehler('Bitte ein Video auswählen oder die Beschreibung einfügen.');
  }

  const client = new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });

  const content = [];
  for (const b of eingabe.bilder) {
    content.push({ type: 'text', text: `Standbild ${b.index} (${zeitLabel(b.zeit)})` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: await blobToBase64(b.blob) } });
  }
  const teile = [];
  if (eingabe.link) teile.push(`Link: ${eingabe.link}`);
  teile.push(eingabe.beschreibung.trim() ? `Beschreibung des Posts:\n${eingabe.beschreibung.trim()}` : 'Keine Beschreibung vorhanden.');
  if (!eingabe.bilder.length) teile.push('Es gibt keine Standbilder, nur den Text.');
  content.push({ type: 'text', text: teile.join('\n\n') });

  onStatus('Claude liest das Rezept …');
  let msg;
  try {
    const stream = client.beta.messages.stream({
      model: settings.modell,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: 'user', content }],
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      // Falls ein Modell ablehnt, versucht die API automatisch ein passendes anderes
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    msg = await stream.finalMessage();
  } catch (err) {
    throw new ExtraktionsFehler(fehlertext(err));
  }

  if (msg.stop_reason === 'refusal') throw new ExtraktionsFehler('Claude hat die Anfrage abgelehnt.');
  if (msg.stop_reason === 'max_tokens') throw new ExtraktionsFehler('Die Antwort war zu lang und wurde abgeschnitten.');
  const text = msg.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
  let daten;
  try {
    daten = JSON.parse(text);
  } catch {
    throw new ExtraktionsFehler('Die Antwort von Claude war unvollständig. Bitte erneut versuchen.');
  }
  if (!daten.ist_rezept) throw new ExtraktionsFehler(daten.hinweise || 'In diesem Reel wurde kein Rezept gefunden.');
  return daten;
}
