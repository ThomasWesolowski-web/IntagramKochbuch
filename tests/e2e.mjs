// Browser-Test der App mit Playwright. Die KI-Anbieter werden nachgestellt,
// es geht also kein Schlüssel und keine echte Anfrage raus.
//
//   node tests/e2e.mjs            alle Abläufe
//   node tests/e2e.mjs --shots    zusätzlich Screenshots nach tests/out/
//
// Braucht Node, Playwright (Chromium) und ffmpeg für das Testvideo.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'out');
const SHOTS = process.argv.includes('--shots');
fs.mkdirSync(OUT, { recursive: true });

let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright/index.mjs']) {
  try { ({ chromium } = await import(p)); break; } catch { /* nächster Pfad */ }
}
if (!chromium) { console.error('Playwright nicht gefunden.'); process.exit(2); }

// ---------- Testvideo (VP9, weil Chromium ohne H.264 kommt) ----------
const VIDEO = path.join(OUT, 'reel.webm');
if (!fs.existsSync(VIDEO)) {
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=20:size=540x960:rate=12',
    '-c:v', 'libvpx-vp9', '-b:v', '200k', VIDEO]);
}

// ---------- Statischer Server ----------
const TYPEN = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const datei = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const ziel = datei.endsWith(path.sep) ? path.join(datei, 'index.html') : datei;
  if (!ziel.startsWith(ROOT) || !fs.existsSync(ziel) || fs.statSync(ziel).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPEN[path.extname(ziel)] || 'application/octet-stream' });
  fs.createReadStream(ziel).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/`;

// ---------- Nachgestellte Antworten ----------
const REZEPT = {
  ist_rezept: true, titel: 'Cremige Tomaten-Pasta', beschreibung: 'Schnelle Pasta.', portionen: 2, zubereitungszeit: '20 Min.',
  zutaten: [
    { gruppe: '', menge: 200, einheit: 'g', name: 'Nudeln', hinweis: '', geschaetzt: false },
    { gruppe: 'Soße', menge: 1, einheit: 'Dose', name: 'Tomaten', hinweis: 'gehackt', geschaetzt: false },
    { gruppe: 'Soße', menge: 0.5, einheit: 'TL', name: 'Salz', hinweis: '', geschaetzt: true },
  ],
  schritte: [{ text: 'Nudeln kochen.', bild: 2 }, { text: 'Soße aufkochen.', bild: 4 }, { text: 'Mischen.', bild: null }],
  titelbild: 6, tags: ['Pasta'], hinweise: 'Nudelwasser aufheben.',
};
const CORS = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
const json = (status, body) => ({ status, headers: CORS, body: JSON.stringify(body) });

function claudeSse(text) {
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  return ev('message_start', { message: { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } })
    + ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
    + ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text } })
    + ev('content_block_stop', { index: 0 })
    + ev('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } })
    + ev('message_stop', {});
}

// gemini: 'ok' | 'ueberlastet' (503 beim Alias, dann Ausweichmodell) | 'kaputt' (alles 429)
async function anbieterNachstellen(page, { gemini = 'ok' } = {}) {
  const log = { gemini: [], groq: null, claude: null };
  await page.route('https://generativelanguage.googleapis.com/**', (route) => {
    const u = route.request().url();
    log.gemini.push(u.split('?')[0].split('/').pop());
    if (u.includes('/models?')) {
      return route.fulfill(json(200, { models: [
        { name: 'models/gemini-9-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-9-flash-lite', supportedGenerationMethods: ['generateContent'] }] }));
    }
    if (gemini === 'kaputt') return route.fulfill(json(429, { error: { message: 'quota' } }));
    if (gemini === 'ueberlastet' && u.includes('flash-latest')) return route.fulfill(json(503, { error: { message: 'overloaded' } }));
    return route.fulfill(json(200, { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(REZEPT) }] } }] }));
  });
  await page.route('https://api.groq.com/**', (route) => {
    log.groq = JSON.parse(route.request().postData());
    return route.fulfill(json(200, { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(REZEPT) } }] }));
  });
  await page.route('https://api.anthropic.com/**', (route) => {
    log.claude = JSON.parse(route.request().postData());
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: claudeSse(JSON.stringify(REZEPT)) });
  });
  return log;
}

// ---------- Ablauf ----------
let fehler = 0;
function pruefe(bedingung, text) {
  console.log(`${bedingung ? '✓' : '✗'} ${text}`);
  if (!bedingung) fehler++;
}

const browser = await chromium.launch();
async function neueSeite(optionen) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const seitenfehler = [];
  page.on('pageerror', (e) => seitenfehler.push(e.message));
  const log = await anbieterNachstellen(page, optionen);
  return { page, log, seitenfehler, ctx };
}

async function einstellen(page, werte) {
  await page.goto(`${BASE}#/einstellungen`);
  if (await page.isVisible('#s-entsperren')) await page.click('#s-entsperren');
  await page.selectOption('#s-anbieter', werte.anbieter);
  for (const [sel, wert] of Object.entries(werte.felder || {})) await page.fill(sel, wert);
  await page.click('#s-speichern');
}

async function rezeptAnlegen(page, { video = true } = {}) {
  await page.goto(`${BASE}#/neu`);
  if (video) await page.setInputFiles('#video-input', VIDEO);
  await page.fill('#beschreibung', 'Pasta! 200g Nudeln, 1 Dose Tomaten');
  await page.fill('#link', 'Schau https://www.instagram.com/reel/ABC/?igsh=1');
  await page.click('#los');
  await page.waitForURL(/#\/rezept\//, { timeout: 60000 }).catch(() => {});
  return /#\/rezept\//.test(page.url()) ? '' : await page.textContent('#fehler');
}

try {
  // 1. Gemini, alles klappt
  {
    const { page, log, seitenfehler, ctx } = await neueSeite();
    await page.goto(BASE);
    pruefe(await page.isVisible('.empty'), 'Leere Liste zeigt Hinweis');
    await einstellen(page, { anbieter: 'gemini', felder: { '#s-gkey': 'AIza-test' } });
    await page.reload();
    const gesperrt = await page.isDisabled('#s-gkey') && !(await page.isVisible('#s-speichern'));
    await page.click('#s-entsperren');
    pruefe(gesperrt && await page.isEnabled('#s-gkey') && await page.isVisible('#s-speichern'), 'Schlüssel gesperrt, Entsperren gibt sie frei');
    const f = await rezeptAnlegen(page);
    pruefe(!f, `Gemini: Rezept angelegt ${f ? `(Fehler: ${f})` : ''}`);
    pruefe((await page.textContent('.r-title').catch(() => '')) === 'Cremige Tomaten-Pasta', 'Rezeptansicht zeigt den Titel');
    pruefe((await page.$$('.steps img')).length === 2, 'Zwei Schritte haben ein Bild aus dem Video');
    await page.click('#p-plus'); await page.click('#p-plus');
    const mengen = await page.$$eval('.zt .m', (els) => els.map((e) => e.textContent.trim()));
    pruefe(mengen[0] === '400 g' && mengen[2].startsWith('1 TL'), `Portionen umrechnen (${mengen.join(' | ')})`);
    if (SHOTS) await page.screenshot({ path: path.join(OUT, 'rezept.png'), fullPage: true });

    const id = page.url().split('/')[5];
    await page.goto(`${BASE}#/rezept/${id}/bearbeiten`);
    await page.fill('#e-titel', 'Pasta neu');
    await page.click('#e-speichern');
    await page.waitForTimeout(300);
    pruefe((await page.textContent('.r-title')) === 'Pasta neu', 'Bearbeiten speichert den Titel');

    await page.goto(BASE);
    await page.waitForTimeout(300);
    pruefe((await page.$$('.rk')).length === 1, 'Rezept erscheint in der Liste');
    await page.fill('#suche', 'tomaten');
    pruefe((await page.$$('.rk')).length === 1, 'Suche nach Zutat findet das Rezept');
    pruefe(log.gemini.length === 1, 'Genau eine Anfrage an Gemini');
    pruefe(seitenfehler.length === 0, `Keine JavaScript-Fehler ${seitenfehler.join('; ')}`);
    await ctx.close();
  }

  // 2. Gemini überlastet → Ausweichmodell
  {
    const { page, log, ctx } = await neueSeite({ gemini: 'ueberlastet' });
    await einstellen(page, { anbieter: 'gemini', felder: { '#s-gkey': 'AIza-test' } });
    const f = await rezeptAnlegen(page, { video: false });
    pruefe(!f && log.gemini.includes('gemini-9-flash:generateContent'), `Gemini 503: weicht auf anderes Modell aus ${f}`);
    await ctx.close();
  }

  // 3. Gemini Kontingent leer → Groq springt ein (mit Kollagen, höchstens 5 Bilder)
  {
    const { page, log, ctx } = await neueSeite({ gemini: 'kaputt' });
    await einstellen(page, { anbieter: 'gemini', felder: { '#s-gkey': 'AIza-test', '#s-qkey': 'gsk-test' } });
    const f = await rezeptAnlegen(page);
    const bilder = log.groq ? log.groq.messages[1].content.filter((c) => c.type === 'image_url').length : 0;
    pruefe(!f && log.groq && bilder >= 1 && bilder <= 5, `Groq übernimmt mit ${bilder} Kollage(n) ${f}`);
    await ctx.close();
  }

  // 4. Claude
  {
    const { page, log, ctx } = await neueSeite();
    await einstellen(page, { anbieter: 'claude', felder: { '#s-key': 'sk-ant-test' } });
    const f = await rezeptAnlegen(page);
    pruefe(!f && log.claude?.output_config?.format?.type === 'json_schema', `Claude: Rezept angelegt (${log.claude?.model}) ${f}`);
    await ctx.close();
  }

  // 5. Teilen-Menü (Share Target über den Service Worker)
  {
    const { page, ctx } = await neueSeite();
    await page.goto(BASE);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.evaluate(async () => {
      const fd = new FormData();
      fd.append('text', 'Leckere Pasta https://www.instagram.com/reel/XYZ/?igsh=1');
      fd.append('video', new Blob(['x'.repeat(50)], { type: 'video/mp4' }), 'reel.mp4');
      await fetch('./teilen', { method: 'POST', body: fd });
    });
    await page.goto(`${BASE}#/neu?geteilt=1`);
    await page.waitForTimeout(400);
    pruefe((await page.inputValue('#link')).includes('/reel/XYZ/'), 'Geteilter Link landet im Feld');
    pruefe((await page.textContent('#drop-inhalt')).includes('reel.mp4'), 'Geteiltes Video wird übernommen');
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log(fehler ? `\n${fehler} Prüfung(en) fehlgeschlagen.` : '\nAlle Prüfungen bestanden.');
process.exit(fehler ? 1 : 0);
