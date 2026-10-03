// Aus Standbildern, Beschreibung und Link ein Rezept machen.
// Zwei Anbieter: Google Gemini (kostenloses Kontingent) oder Claude (kostenpflichtig).
// Der API-Schlüssel bleibt auf dem Handy; die Anfrage geht direkt vom Browser an den Anbieter.

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

export const SYSTEM = `Du machst aus Instagram-Koch-Reels ein Rezept zum Nachkochen, auf Deutsch.
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

function eingabePruefen(eingabe) {
  if (!eingabe.bilder.length && !eingabe.beschreibung.trim()) {
    throw new ExtraktionsFehler('Bitte ein Video auswählen oder die Beschreibung einfügen.');
  }
}

function textTeil(eingabe) {
  const teile = [];
  if (eingabe.link) teile.push(`Link: ${eingabe.link}`);
  teile.push(eingabe.beschreibung.trim() ? `Beschreibung des Posts:\n${eingabe.beschreibung.trim()}` : 'Keine Beschreibung vorhanden.');
  if (!eingabe.bilder.length) teile.push('Es gibt keine Standbilder, nur den Text.');
  return teile.join('\n\n');
}

function auswerten(text) {
  let daten;
  try {
    daten = JSON.parse(text);
  } catch {
    throw new ExtraktionsFehler('Die Antwort war unvollständig. Bitte erneut versuchen.');
  }
  if (!daten.ist_rezept) throw new ExtraktionsFehler(daten.hinweise || 'In diesem Reel wurde kein Rezept gefunden.');
  // Gemini hält sich nicht immer an jedes Feld: fehlende Teile auffüllen
  return {
    titel: daten.titel || 'Ohne Titel',
    beschreibung: daten.beschreibung || '',
    portionen: Number.isInteger(daten.portionen) ? daten.portionen : null,
    zubereitungszeit: daten.zubereitungszeit || '',
    zutaten: (daten.zutaten || []).map((z) => ({
      gruppe: z.gruppe || '', menge: typeof z.menge === 'number' ? z.menge : null, einheit: z.einheit || '',
      name: z.name || '', hinweis: z.hinweis || '', geschaetzt: Boolean(z.geschaetzt),
    })).filter((z) => z.name),
    schritte: (daten.schritte || []).filter((x) => x.text).map((x) => ({ text: x.text, bild: Number.isInteger(x.bild) ? x.bild : null })),
    titelbild: Number.isInteger(daten.titelbild) ? daten.titelbild : null,
    tags: daten.tags || [],
    hinweise: daten.hinweise || '',
  };
}

export async function rezeptErkennen(eingabe, settings, onStatus = () => {}) {
  eingabePruefen(eingabe);
  if (settings.anbieter === 'claude') return mitClaude(eingabe, settings, onStatus);
  return mitGemini(eingabe, settings, onStatus);
}

// ---------- Claude ----------

async function mitClaude(eingabe, settings, onStatus) {
  if (!settings.apiKey) throw new ExtraktionsFehler('Bitte zuerst in den Einstellungen einen Claude API-Schlüssel eintragen.');
  const client = new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });

  const content = [];
  for (const b of eingabe.bilder) {
    content.push({ type: 'text', text: `Standbild ${b.index} (${zeitLabel(b.zeit)})` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: await blobToBase64(b.blob) } });
  }
  content.push({ type: 'text', text: textTeil(eingabe) });

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
  return auswerten(msg.content.filter((c) => c.type === 'text').map((c) => c.text).join(''));
}

// ---------- Gemini ----------

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';
// Alias auf das aktuelle Flash-Modell; Flash ist im kostenlosen Kontingent enthalten
export const GEMINI_STANDARD = 'gemini-flash-latest';

// Gemini erwartet das Schema im OpenAPI-Stil: nullable statt Typ-Listen, kein additionalProperties.
function geminiSchema(s) {
  const out = {};
  let typ = s.type;
  if (Array.isArray(typ)) { out.nullable = typ.includes('null'); typ = typ.find((t) => t !== 'null'); }
  out.type = typ.toUpperCase();
  if (s.description) out.description = s.description;
  if (s.properties) {
    out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, geminiSchema(v)]));
    out.required = s.required;
    out.propertyOrdering = Object.keys(s.properties);
  }
  if (s.items) out.items = geminiSchema(s.items);
  return out;
}

async function geminiFehler(res) {
  const data = await res.json().catch(() => ({}));
  const msg = data.error?.message || '';
  if (res.status === 400 && /api key/i.test(msg)) return 'Der Gemini-Schlüssel ist ungültig. Bitte in den Einstellungen prüfen.';
  if (res.status === 403) return 'Der Gemini-Schlüssel darf diese Anfrage nicht stellen.';
  if (res.status === 429) return 'Das kostenlose Gemini-Kontingent ist für heute oder diese Minute aufgebraucht. Bitte später erneut versuchen.';
  if (res.status === 503) return 'Gemini ist gerade überlastet, auch nach mehreren Versuchen. Bitte in ein paar Minuten erneut versuchen.';
  if (res.status >= 500) return `Gemini meldet einen Fehler (${res.status}). Bitte erneut versuchen.`;
  return `Gemini hat die Anfrage abgelehnt: ${msg || res.status}`;
}

// Ausweichmodelle, falls der Alias fehlt oder überlastet ist: erst Flash, dann Flash-Lite, neueste zuerst.
async function geminiAusweichmodelle(key, ohne) {
  try {
    const res = await fetch(`${GEMINI_API}/models?pageSize=200&key=${encodeURIComponent(key)}`);
    if (!res.ok) return [];
    const { models = [] } = await res.json();
    const namen = models
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''))
      .filter((n) => /flash/.test(n) && !/image|tts|live|audio|preview|exp|thinking/.test(n) && n !== ohne)
      .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
    return [...namen.filter((n) => !/lite/.test(n)), ...namen.filter((n) => /lite/.test(n))].slice(0, 2);
  } catch {
    return [];
  }
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const UEBERLASTET = (status) => status === 500 || status === 503;

async function mitGemini(eingabe, settings, onStatus) {
  const key = settings.geminiKey;
  if (!key) throw new ExtraktionsFehler('Bitte zuerst in den Einstellungen einen kostenlosen Gemini-Schlüssel eintragen.');

  const parts = [];
  for (const b of eingabe.bilder) {
    parts.push({ text: `Standbild ${b.index} (${zeitLabel(b.zeit)})` });
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: await blobToBase64(b.blob) } });
  }
  parts.push({ text: textTeil(eingabe) });
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: geminiSchema(SCHEMA) },
  });

  onStatus('Gemini liest das Rezept …');
  const anfrage = async (modell) => {
    try {
      return await fetch(`${GEMINI_API}/models/${encodeURIComponent(modell)}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
      });
    } catch {
      throw new ExtraktionsFehler('Keine Verbindung zu Gemini. Ist das Handy online?');
    }
  };

  // Bei Überlastung (503) bis zu drei Versuche mit Pause, danach ein anderes Flash-Modell.
  const versuchen = async (modell, versuche) => {
    let res;
    for (let i = 0; i < versuche; i++) {
      if (i > 0) {
        onStatus(`Gemini ist überlastet, neuer Versuch (${i + 1}/${versuche}) …`);
        await pause(i * 3000);
      }
      res = await anfrage(modell);
      if (!UEBERLASTET(res.status)) break;
    }
    return res;
  };

  const modell = settings.geminiModell || GEMINI_STANDARD;
  let res = await versuchen(modell, 3);
  if (res.status === 404 || UEBERLASTET(res.status)) {
    for (const ersatz of await geminiAusweichmodelle(key, modell)) {
      onStatus(`Gemini versucht es mit ${ersatz} …`);
      const neu = await versuchen(ersatz, 2);
      if (neu.ok || (neu.status !== 404 && !UEBERLASTET(neu.status))) { res = neu; break; }
    }
  }
  if (!res.ok) throw new ExtraktionsFehler(await geminiFehler(res));

  const data = await res.json();
  if (data.promptFeedback?.blockReason) throw new ExtraktionsFehler('Gemini hat die Anfrage abgelehnt.');
  const kandidat = data.candidates?.[0];
  if (kandidat?.finishReason === 'MAX_TOKENS') throw new ExtraktionsFehler('Die Antwort war zu lang und wurde abgeschnitten.');
  const text = (kandidat?.content?.parts || []).map((p) => p.text || '').join('');
  if (!text) throw new ExtraktionsFehler('Gemini hat keine Antwort geliefert. Bitte erneut versuchen.');
  return auswerten(text);
}
