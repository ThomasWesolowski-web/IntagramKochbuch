// Aus dem Video (oder Standbildern daraus), der Beschreibung und dem Link ein Rezept machen.
// Anbieter: Google Gemini (kostenlos, bekommt das ganze Video mit Ton), Groq (kostenlos, Standbilder)
// oder Claude (kostenpflichtig, Standbilder).
// Der API-Schlüssel bleibt auf dem Handy; die Anfrage geht direkt vom Browser an den Anbieter.

import Anthropic from './vendor/anthropic-sdk.mjs';
import { blobToBase64, zeitLabel, bilderBeiZeiten } from './video.js';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['abschrift', 'ist_rezept', 'titel', 'beschreibung', 'portionen', 'zubereitungszeit', 'zutaten', 'schritte', 'titelbild', 'titelbild_zeit_s', 'tags', 'hinweise'],
  properties: {
    // Steht absichtlich zuerst: Die KI schreibt erst alles ab und baut dann das Rezept daraus.
    abschrift: { type: 'string', description: 'wörtlich in der Originalsprache: was gesagt wird, eingeblendeter Text und die Zutatenliste aus der Beschreibung' },
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
        required: ['gruppe', 'menge', 'menge_bis', 'einheit', 'name', 'hinweis', 'geschaetzt'],
        properties: {
          gruppe: { type: 'string', description: 'z. B. "Teig", "Soße"; leer wenn es keine Gruppen gibt' },
          menge: { type: ['number', 'null'], description: 'Zahl (½ = 0.5), null bei "nach Geschmack"' },
          menge_bis: { type: ['number', 'null'], description: 'obere Grenze bei Bereichen wie "2–3 EL", sonst null' },
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
        required: ['text', 'bild', 'zeit_s'],
        properties: {
          text: { type: 'string' },
          bild: { type: ['integer', 'null'], description: 'Nummer des Standbilds, das diesen Schritt am besten zeigt' },
          zeit_s: { type: ['number', 'null'], description: 'nur mit Video: Sekunde, in der der Schritt am besten zu sehen ist' },
        },
      },
    },
    titelbild: { type: ['integer', 'null'], description: 'Nummer des Standbilds mit dem fertigen Gericht' },
    titelbild_zeit_s: { type: ['number', 'null'], description: 'nur mit Video: Sekunde, in der das fertige Gericht am schönsten zu sehen ist' },
    tags: { type: 'array', items: { type: 'string' } },
    hinweise: { type: 'string', description: 'Tipps aus dem Video, oder was unklar war; leer wenn nichts' },
  },
};

export const SYSTEM = `Du machst aus Instagram-Koch-Reels ein vollständiges, genaues Rezept zum Nachkochen, auf Deutsch.
Du bekommst das Video selbst (mit Ton) oder nummerierte Standbilder daraus (mit Zeitstempel), dazu die Beschreibung des Posts und eventuell den Link.

Geh gründlich vor:
1. Schreib zuerst in "abschrift" alles ab, was zum Rezept gesagt, eingeblendet oder in der Beschreibung geschrieben wird: gesprochener Text, eingeblendeter Text und Untertitel (mit Zeitstempel), die Zutatenliste aus der Beschreibung. Wörtlich und in der Originalsprache, ohne Werbung und Hashtags.
2. Bau das Rezept aus dieser Abschrift und dem, was zu sehen ist. Genannte Mengen haben Vorrang vor allem, was du nur siehst. Erfinde keine Zutaten und keine Schritte.
3. Prüf zum Schluss: Jede Zutat, die in einem Schritt vorkommt, steht in der Zutatenliste, und jede Zutat der Liste wird in einem Schritt verwendet. Steht in der Beschreibung eine Zutatenliste, übernimm sie vollständig.

Zutaten:
- Mengen genau so, wie sie genannt werden. Brüche als Dezimalzahl (½ = 0.5). Bereiche wie "2–3 EL" als menge 2 und menge_bis 3.
- Umrechnen in metrische Einheiten (Cups, oz, lb, °F); Löffel als EL und TL.
- Nur wenn nirgends eine Menge genannt wird, schätz sie passend zur Portionenzahl und setz "geschaetzt" auf true.
- "name" ohne Menge; Angaben wie "gewürfelt" oder "zimmerwarm" in "hinweis".
Schritte:
- In der Reihenfolge des Videos, jeder Schritt eine Handlung, konkret mit Menge, Temperatur, Zeit und Hitzestufe, sobald sie genannt oder zu sehen sind.
- Mit Video: "zeit_s" ist die Sekunde, in der der Schritt am besten zu sehen ist, "bild" ist null. Mit Standbildern: "bild" ist die Nummer des passenden Standbilds (jedes höchstens einmal), "zeit_s" ist null. Für "titelbild" und "titelbild_zeit_s" genauso.
Übersetz alles außer der Abschrift ins Deutsche. Übergeh die Bedienelemente von Instagram (Likes, Kommentare, Benutzernamen, Uhrzeit, Musiktitel), Werbung, Hashtags und Aufrufe wie "Folgt mir".
Wenn kein Rezept erkennbar ist, setz "ist_rezept" auf false und erklär es in "hinweise".`;

export class ExtraktionsFehler extends Error {
  constructor(message, { keinRezept = false } = {}) {
    super(message);
    this.keinRezept = keinRezept;
  }
}

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
  if (!eingabe.bilder.length && !eingabe.video && !eingabe.beschreibung.trim()) {
    throw new ExtraktionsFehler('Bitte ein Video auswählen oder die Beschreibung einfügen.');
  }
}

// Groq und Claude sehen nur Standbilder; ließ sich das Video nicht lesen, bleibt nur der Text.
function standbilderPruefen(eingabe) {
  if (!eingabe.bilder.length && !eingabe.beschreibung.trim()) {
    throw new ExtraktionsFehler('Das Video lässt sich auf diesem Handy nicht lesen. Bitte die Beschreibung einfügen oder Gemini nutzen.');
  }
}

function textTeil(eingabe, { mitVideo = false } = {}) {
  const teile = [];
  if (eingabe.link) teile.push(`Link: ${eingabe.link}`);
  teile.push(eingabe.beschreibung.trim() ? `Beschreibung des Posts:\n${eingabe.beschreibung.trim()}` : 'Keine Beschreibung vorhanden.');
  if (!mitVideo && !eingabe.bilder.length) teile.push('Es gibt kein Video und keine Standbilder, nur den Text.');
  return teile.join('\n\n');
}

// Mengen kommen nicht immer als Zahl, vor allem von Groq: "1/2", "1 ½", "0,5", "2-3".
const BRUCH = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };
function zahlLesen(t) {
  const s = String(t).trim().replace(',', '.').replace(/(\d)\s*([½¼¾⅓⅔⅛])/, '$1+$2');
  let summe = 0;
  for (const teil of s.split(/\s+|\+/).filter(Boolean)) {
    if (BRUCH[teil] != null) summe += BRUCH[teil];
    else if (/^\d+\/\d+$/.test(teil)) { const [z, n] = teil.split('/').map(Number); if (!n) return null; summe += z / n; }
    else if (/^\d+(\.\d+)?$/.test(teil)) summe += Number(teil);
    else return null;
  }
  return summe > 0 ? summe : null;
}
export function mengeLesen(menge, bis) {
  let von = null;
  let obere = typeof bis === 'number' ? bis : (bis != null ? zahlLesen(bis) : null);
  if (typeof menge === 'number') von = menge;
  else if (typeof menge === 'string') {
    const [a, b] = menge.split(/\s*(?:-|–|bis)\s*/);
    von = zahlLesen(a);
    if (b != null && obere == null) obere = zahlLesen(b);
  }
  if (!(von > 0)) von = null;
  if (von == null || !(obere > von)) obere = null;
  return { menge: von, menge_bis: obere };
}

const sekunde = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

function auswerten(text) {
  let daten;
  try {
    daten = JSON.parse(text);
  } catch {
    throw new ExtraktionsFehler('Die Antwort war unvollständig. Bitte erneut versuchen.');
  }
  if (!daten.ist_rezept) throw new ExtraktionsFehler(daten.hinweise || 'In diesem Reel wurde kein Rezept gefunden.', { keinRezept: true });
  // Gemini und Groq halten sich nicht immer an jedes Feld: fehlende Teile auffüllen
  return {
    abschrift: typeof daten.abschrift === 'string' ? daten.abschrift.trim() : '',
    titel: daten.titel || 'Ohne Titel',
    beschreibung: daten.beschreibung || '',
    portionen: Number.isInteger(daten.portionen) && daten.portionen > 0 ? daten.portionen : null,
    zubereitungszeit: daten.zubereitungszeit || '',
    zutaten: (daten.zutaten || []).map((z) => ({
      gruppe: z.gruppe || '', ...mengeLesen(z.menge, z.menge_bis), einheit: z.einheit || '',
      name: z.name || '', hinweis: z.hinweis || '', geschaetzt: Boolean(z.geschaetzt),
    })).filter((z) => z.name),
    schritte: (daten.schritte || []).filter((x) => x.text).map((x) => ({
      text: x.text, bild: Number.isInteger(x.bild) ? x.bild : null, zeit_s: sekunde(x.zeit_s),
    })),
    titelbild: Number.isInteger(daten.titelbild) ? daten.titelbild : null,
    titelbild_zeit_s: sekunde(daten.titelbild_zeit_s),
    tags: Array.isArray(daten.tags) ? daten.tags.filter((t) => typeof t === 'string') : [],
    hinweise: daten.hinweise || '',
  };
}

export async function rezeptErkennen(eingabe, settings, onStatus = () => {}) {
  eingabePruefen(eingabe);
  if (settings.anbieter === 'claude') return mitClaude(eingabe, settings, onStatus);
  if (settings.anbieter === 'groq') return mitGroq(eingabe, settings, onStatus);
  // Gemini zuerst; klemmt es (Limit, Überlastung, Netz), springt Groq ein, falls ein Schlüssel da ist.
  if (!settings.geminiKey && settings.groqKey) return mitGroq(eingabe, settings, onStatus);
  try {
    return await mitGemini(eingabe, settings, onStatus);
  } catch (err) {
    if (!settings.groqKey || err.keinRezept) throw err;
    onStatus('Gemini klemmt, Groq übernimmt …');
    try {
      return await mitGroq(eingabe, settings, onStatus);
    } catch (err2) {
      throw new ExtraktionsFehler(`Gemini: ${err.message}\nGroq: ${err2.message}`, { keinRezept: err2.keinRezept });
    }
  }
}

// ---------- Claude ----------

async function mitClaude(eingabe, settings, onStatus) {
  if (!settings.apiKey) throw new ExtraktionsFehler('Bitte zuerst in den Einstellungen einen Claude API-Schlüssel eintragen.');
  standbilderPruefen(eingabe);
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
  if (res.status === 429) return 'Das kostenlose Gemini-Kontingent ist aufgebraucht, auch bei den Ausweichmodellen. Meist reicht es, eine Minute zu warten; das Tageslimit gilt bis etwa 9 Uhr morgens.';
  if (res.status === 503) return 'Gemini ist gerade überlastet, auch nach mehreren Versuchen. Bitte in ein paar Minuten erneut versuchen.';
  if (res.status >= 500) return `Gemini meldet einen Fehler (${res.status}). Bitte erneut versuchen.`;
  return `Gemini hat die Anfrage abgelehnt: ${msg || res.status}`;
}

// Ausweichmodelle, falls der Alias fehlt, überlastet oder sein Kontingent leer ist.
// Normal erst Flash, dann Flash-Lite; bei leerem Kontingent erst Flash-Lite (größeres Gratis-Kontingent).
async function geminiAusweichmodelle(key, ohne, liteZuerst) {
  try {
    const res = await fetch(`${GEMINI_API}/models?pageSize=200&key=${encodeURIComponent(key)}`);
    if (!res.ok) return [];
    const { models = [] } = await res.json();
    const namen = models
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''))
      .filter((n) => /flash/.test(n) && !/image|tts|live|audio|preview|exp|thinking/.test(n) && n !== ohne)
      .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
    const flash = namen.filter((n) => !/lite/.test(n)).slice(0, 2);
    const lite = namen.filter((n) => /lite/.test(n)).slice(0, 2);
    return liteZuerst ? [...lite, ...flash] : [...flash, ...lite];
  } catch {
    return [];
  }
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const UEBERLASTET = (status) => status === 500 || status === 503;
const WECHSELN = (status) => status === 404 || status === 429 || UEBERLASTET(status);

// Google nennt bei 429 oft, wann es wieder geht (RetryInfo, z. B. "37s").
async function wartezeit(res) {
  const data = await res.clone().json().catch(() => ({}));
  const info = (data.error?.details || []).find((d) => d.retryDelay);
  const s = info ? parseFloat(info.retryDelay) : NaN;
  return Number.isFinite(s) ? s : null;
}

// Eine Anfrage an Gemini mit allen Ausweichwegen (Wiederholen, anderes Modell, kurz warten).
// Gibt den Antworttext zurück; Fehler tragen den HTTP-Status in err.status.
async function geminiSenden(parts, key, settings, onStatus) {
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: geminiSchema(SCHEMA) },
  });

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
  if (WECHSELN(res.status)) {
    const ersatzListe = await geminiAusweichmodelle(key, modell, res.status === 429);
    for (const ersatz of ersatzListe) {
      onStatus(`Gemini versucht es mit ${ersatz} …`);
      const neu = await versuchen(ersatz, 2);
      res = neu.status === 404 && res.status !== 404 ? res : neu;
      if (!WECHSELN(neu.status)) break;
    }
  }
  // Kontingent pro Minute: kurz warten und ein letztes Mal versuchen
  if (res.status === 429) {
    const s = await wartezeit(res);
    if (s != null && s <= 45) {
      for (let rest = Math.ceil(s) + 1; rest > 0; rest--) {
        onStatus(`Gratis-Limit pro Minute erreicht, neuer Versuch in ${rest} s …`);
        await pause(1000);
      }
      res = await versuchen(modell, 1);
    }
  }
  if (!res.ok) {
    const fehler = new ExtraktionsFehler(await geminiFehler(res));
    fehler.status = res.status;
    throw fehler;
  }

  const data = await res.json();
  if (data.promptFeedback?.blockReason) throw new ExtraktionsFehler('Gemini hat die Anfrage abgelehnt.');
  const kandidat = data.candidates?.[0];
  if (kandidat?.finishReason === 'MAX_TOKENS') throw new ExtraktionsFehler('Die Antwort war zu lang und wurde abgeschnitten.');
  const text = (kandidat?.content?.parts || []).map((p) => p.text || '').join('');
  if (!text) throw new ExtraktionsFehler('Gemini hat keine Antwort geliefert. Bitte erneut versuchen.');
  return text;
}

// ---------- Video an Gemini ----------
// Gemini versteht Videos samt Ton: so landen auch gesprochene Mengen und kurz eingeblendeter Text im Rezept.
// Kleine Videos gehen direkt in die Anfrage, größere über die Datei-Schnittstelle (Dateien löscht Google nach 2 Tagen selbst).

const GEMINI_UPLOAD = 'https://generativelanguage.googleapis.com/upload/v1beta';
const INLINE_MAX = 14 * 1024 * 1024;   // Base64 macht daraus ~19 MB, die Grenze pro Anfrage liegt bei 20 MB
const UPLOAD_MAX = 300 * 1024 * 1024;

function videoTyp(file) {
  const t = file.type || '';
  if (/quicktime/.test(t)) return 'video/mov';
  return /^video\//.test(t) ? t : 'video/mp4';
}

async function geminiHochladen(file, mimeType, key, onStatus) {
  const grenze = `kochbuch${Math.random().toString(36).slice(2)}`;
  const body = new Blob([
    `--${grenze}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ file: { displayName: 'reel' } })}\r\n`,
    `--${grenze}\r\nContent-Type: ${mimeType}\r\n\r\n`, file, `\r\n--${grenze}--\r\n`,
  ]);
  const res = await fetch(`${GEMINI_UPLOAD}/files?uploadType=multipart&key=${encodeURIComponent(key)}`, {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${grenze}` }, body,
  });
  if (!res.ok) throw new Error(`Hochladen fehlgeschlagen (${res.status})`);
  let datei = (await res.json()).file;
  // Google bereitet das Video kurz auf, bevor es genutzt werden kann
  for (let i = 0; datei?.state === 'PROCESSING' && i < 40; i++) {
    onStatus('Gemini bereitet das Video vor …');
    await pause(2000);
    const r = await fetch(`${GEMINI_API}/${datei.name}?key=${encodeURIComponent(key)}`);
    if (!r.ok) break;
    datei = await r.json();
  }
  if (!datei?.uri || datei.state !== 'ACTIVE') throw new Error('Video konnte nicht vorbereitet werden');
  return datei;
}

// Die Zeitangaben der KI in echte Bilder umsetzen, die dann wie Standbilder gespeichert werden.
async function bilderAusZeiten(daten, video) {
  const zeiten = [...new Set([...daten.schritte.map((x) => x.zeit_s), daten.titelbild_zeit_s].filter((z) => z != null))];
  if (!zeiten.length) return { ...daten, titelbild: null, schritte: daten.schritte.map((x) => ({ ...x, bild: null })), bilder: [] };
  let gegriffen = [];
  try {
    gegriffen = await bilderBeiZeiten(video, zeiten);
  } catch {
    // Video lässt sich auf diesem Gerät nicht abspielen: Rezept trotzdem speichern, nur ohne Bilder
  }
  const bilder = [];
  const nummer = new Map();
  gegriffen.forEach((b, i) => {
    if (!b) return;
    bilder.push({ index: bilder.length + 1, zeit: b.zeit, blob: b.blob });
    nummer.set(zeiten[i], bilder.length);
  });
  return {
    ...daten,
    schritte: daten.schritte.map((x) => ({ ...x, bild: nummer.get(x.zeit_s) ?? null })),
    titelbild: nummer.get(daten.titelbild_zeit_s) ?? null,
    bilder,
  };
}

async function mitGemini(eingabe, settings, onStatus) {
  const key = settings.geminiKey;
  if (!key) throw new ExtraktionsFehler('Bitte zuerst in den Einstellungen einen kostenlosen Gemini-Schlüssel eintragen.');

  const video = eingabe.video;
  if (video && video.size <= UPLOAD_MAX) {
    const mimeType = videoTyp(video);
    let teil = null;
    let datei = null;
    try {
      if (video.size <= INLINE_MAX) {
        teil = { inlineData: { mimeType, data: await blobToBase64(video) } };
      } else {
        onStatus('Video zu Gemini hochladen …');
        datei = await geminiHochladen(video, mimeType, key, onStatus);
        teil = { fileData: { mimeType: datei.mimeType || mimeType, fileUri: datei.uri } };
      }
    } catch {
      onStatus('Video ließ sich nicht hochladen, Gemini liest die Standbilder …');
    }
    if (teil) {
      try {
        onStatus('Gemini schaut sich das Video an …');
        const text = await geminiSenden([{ text: 'Das Reel als Video:' }, teil, { text: textTeil(eingabe, { mitVideo: true }) }], key, settings, onStatus);
        onStatus('Bilder zu den Schritten holen …');
        return await bilderAusZeiten(auswerten(text), video);
      } catch (err) {
        // Nur wenn Gemini das Video selbst ablehnt, mit Standbildern weitermachen; sonst greift der Fallback (Groq)
        if (err.keinRezept || ![400, 413].includes(err.status) || /Schlüssel/.test(err.message)) throw err;
        onStatus('Gemini konnte das Video nicht lesen, nimmt die Standbilder …');
      } finally {
        if (datei) fetch(`${GEMINI_API}/${datei.name}?key=${encodeURIComponent(key)}`, { method: 'DELETE' }).catch(() => {});
      }
    }
  }

  if (!eingabe.bilder.length && !eingabe.beschreibung.trim()) {
    throw new ExtraktionsFehler('Das Video ließ sich weder hochladen noch auf dem Handy lesen.');
  }
  const parts = [];
  for (const b of eingabe.bilder) {
    parts.push({ text: `Standbild ${b.index} (${zeitLabel(b.zeit)})` });
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: await blobToBase64(b.blob) } });
  }
  parts.push({ text: textTeil(eingabe) });
  onStatus('Gemini liest das Rezept …');
  return auswerten(await geminiSenden(parts, key, settings, onStatus));
}

// ---------- Groq ----------
// Kostenloses Kontingent, OpenAI-kompatible Schnittstelle. Groq nimmt höchstens 5 Bilder pro Anfrage,
// deshalb werden die Standbilder zu nummerierten Kollagen (je 2 × 2) zusammengesetzt.

const GROQ_API = 'https://api.groq.com/openai/v1';
const GROQ_STANDARD = 'meta-llama/llama-4-scout-17b-16e-instruct';
const GROQ_MAX_BILDER = 5;

async function bildLaden(blob) {
  if ('createImageBitmap' in window) return createImageBitmap(blob);
  const img = new Image();
  img.src = URL.createObjectURL(blob);
  await img.decode();
  return img;
}

// Kollagen mit je bis zu 4 Standbildern; jede Kachel trägt groß ihre Nummer.
async function kollagen(bilder) {
  const proKollage = Math.max(4, Math.ceil(bilder.length / GROQ_MAX_BILDER));
  const spalten = Math.ceil(Math.sqrt(proKollage));
  const ergebnis = [];
  for (let start = 0; start < bilder.length; start += proKollage) {
    const gruppe = bilder.slice(start, start + proKollage);
    const geladen = await Promise.all(gruppe.map((b) => bildLaden(b.blob)));
    const kw = 360;
    const kh = Math.round(kw * (geladen[0].height / geladen[0].width));
    const zeilen = Math.ceil(gruppe.length / spalten);
    const canvas = document.createElement('canvas');
    canvas.width = kw * Math.min(spalten, gruppe.length);
    canvas.height = kh * zeilen;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    geladen.forEach((img, i) => {
      const x = (i % spalten) * kw;
      const y = Math.floor(i / spalten) * kh;
      ctx.drawImage(img, x, y, kw, kh);
      ctx.fillStyle = '#d4472b';
      ctx.fillRect(x, y, 64, 44);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 30px sans-serif';
      ctx.fillText(String(gruppe[i].index), x + 10, y + 33);
      if (img.close) img.close();
    });
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.75));
    ergebnis.push({ blob, nummern: gruppe.map((b) => `${b.index} (${zeitLabel(b.zeit)})`) });
  }
  return ergebnis;
}

async function groqFehler(res) {
  const data = await res.json().catch(() => ({}));
  const msg = data.error?.message || '';
  if (res.status === 401) return 'Der Groq-Schlüssel ist ungültig. Bitte in den Einstellungen prüfen.';
  if (res.status === 429) return 'Das kostenlose Groq-Kontingent ist gerade aufgebraucht. Bitte kurz warten.';
  if (res.status >= 500) return `Groq meldet einen Fehler (${res.status}). Bitte erneut versuchen.`;
  return `Groq hat die Anfrage abgelehnt: ${msg || res.status}`;
}

// Falls Groq das Standardmodell abschafft: ein anderes Bildmodell aus der Liste nehmen.
async function groqAusweichmodell(key, ohne) {
  try {
    const res = await fetch(`${GROQ_API}/models`, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) return null;
    const { data = [] } = await res.json();
    const ids = data.filter((m) => m.active !== false).map((m) => m.id).filter((id) => id !== ohne);
    return ids.find((id) => /llama-4|scout|maverick/i.test(id)) || ids.find((id) => /vision|-vl/i.test(id)) || null;
  } catch {
    return null;
  }
}

async function mitGroq(eingabe, settings, onStatus) {
  const key = settings.groqKey;
  if (!key) throw new ExtraktionsFehler('Bitte zuerst in den Einstellungen einen kostenlosen Groq-Schlüssel eintragen.');
  standbilderPruefen(eingabe);

  const content = [];
  if (eingabe.bilder.length) {
    for (const k of await kollagen(eingabe.bilder)) {
      content.push({ type: 'text', text: `Kollage mit den Standbildern ${k.nummern.join(', ')}. Die Nummer steht oben links in jeder Kachel.` });
      content.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${await blobToBase64(k.blob)}` } });
    }
  }
  content.push({ type: 'text', text: textTeil(eingabe) });
  const system = `${SYSTEM}\n\nAntworte nur mit einem JSON-Objekt nach diesem JSON-Schema, ohne weiteren Text:\n${JSON.stringify(SCHEMA)}`;

  onStatus('Groq liest das Rezept …');
  const anfrage = async (modell) => {
    try {
      return await fetch(`${GROQ_API}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: modell,
          messages: [{ role: 'system', content: system }, { role: 'user', content }],
          response_format: { type: 'json_object' },
          temperature: 0.2,
          max_completion_tokens: 8000,
        }),
      });
    } catch {
      throw new ExtraktionsFehler('Keine Verbindung zu Groq. Ist das Handy online?');
    }
  };

  let res = await anfrage(GROQ_STANDARD);
  if (res.status === 404 || res.status === 400) {
    const fehler = await res.clone().json().catch(() => ({}));
    if (res.status === 404 || /model/i.test(fehler.error?.code || fehler.error?.message || '')) {
      const ersatz = await groqAusweichmodell(key, GROQ_STANDARD);
      if (ersatz) res = await anfrage(ersatz);
    }
  }
  if (res.status === 429 || res.status === 503) {
    onStatus('Groq ist ausgelastet, neuer Versuch …');
    await pause(4000);
    res = await anfrage(GROQ_STANDARD);
  }
  if (!res.ok) throw new ExtraktionsFehler(await groqFehler(res));

  const data = await res.json();
  const wahl = data.choices?.[0];
  if (wahl?.finish_reason === 'length') throw new ExtraktionsFehler('Die Antwort war zu lang und wurde abgeschnitten.');
  const text = wahl?.message?.content || '';
  if (!text) throw new ExtraktionsFehler('Groq hat keine Antwort geliefert. Bitte erneut versuchen.');
  return auswerten(text);
}
