// Instagram Kochbuch: Reels teilen oder hochladen, eine KI (Gemini, Groq oder Claude) macht daraus ein Rezept.
// Alles bleibt auf dem Handy (IndexedDB), nur die Standbilder und die Beschreibung
// gehen zum Erkennen an den gewählten Anbieter.

import * as db from './db.js';
import { standbilder } from './video.js';
import { rezeptErkennen } from './extract.js';

const APP_VERSION = '0.3.0';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const view = $('#view');
const appbar = $('#appbar');

let settings = db.loadSettings();
let objectUrls = [];
let suche = '';
let tagFilter = '';
let wakeLock = null;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function objectUrl(blob) {
  const url = URL.createObjectURL(blob);
  objectUrls.push(url);
  return url;
}

function releaseUrls() {
  objectUrls.forEach((u) => URL.revokeObjectURL(u));
  objectUrls = [];
}

let toastTimer;
function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

const ICON = {
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="19" r="1.8" fill="currentColor"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  pot: '<svg viewBox="0 0 24 24"><path d="M4 10h16v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4zM2 10h20M9 6.5c0-1 1-1.5 1-2.5M13 6.5c0-1 1-1.5 1-2.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  people: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16 4.8a3.2 3.2 0 0 1 0 6.4M18 14.8c1.9.7 3 2.6 3 5.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  video: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="13" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 10l5-3v10l-5-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  link: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  flame: '<svg viewBox="0 0 24 24"><path d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-3.5 2-5 1 1 1.5 2 1.5 3 1-2 1.5-5 1.5-8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

// ---------- Router ----------

async function route() {
  releaseUrls();
  closeMenu();
  wakeLockLoesen();
  const [pfad, query] = (location.hash.slice(1) || '/').split('?');
  const params = new URLSearchParams(query || '');
  const teile = pfad.split('/').filter(Boolean);
  let tab = 'list';
  if (teile[0] === 'neu') { tab = 'new'; await renderNeu(params); }
  else if (teile[0] === 'rezept' && teile[2] === 'bearbeiten') await renderBearbeiten(teile[1]);
  else if (teile[0] === 'rezept') await renderRezept(teile[1]);
  else if (teile[0] === 'einstellungen') { tab = 'settings'; renderEinstellungen(); }
  else await renderListe();
  $$('#tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  window.scrollTo(0, 0);
}

function kopf(titel, { zurueck = false, rechts = '', klein = false, sub = '' } = {}) {
  appbar.innerHTML = `
    ${zurueck ? `<button class="icon-btn" id="btn-back" aria-label="Zurück">${ICON.back}</button>` : ''}
    <h1 class="${klein ? 'small' : ''}">${esc(titel)}${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</h1>
    ${rechts}`;
  $('#btn-back')?.addEventListener('click', () => (history.length > 1 ? history.back() : (location.hash = '#/')));
}

// ---------- Liste ----------

function bildUrlFuer(r, bilderMap) {
  const b = r.titelbildId && bilderMap.get(r.titelbildId);
  return b ? objectUrl(b.blob) : '';
}

async function renderListe() {
  kopf('Kochbuch');
  const rezepte = await db.alleRezepte();
  if (!rezepte.length) {
    view.innerHTML = `
      <div class="empty">
        ${ICON.pot}
        <h2>Noch keine Rezepte</h2>
        <p>Teile ein Koch-Reel aus Instagram mit der App oder lade das Video hier hoch.</p>
        <a class="btn primary" href="#/neu">Erstes Rezept anlegen</a>
      </div>`;
    return;
  }

  // Titelbilder laden (nur die, die gebraucht werden)
  const bilderMap = new Map();
  await Promise.all(rezepte.filter((r) => r.titelbildId).map(async (r) => {
    const b = await db.getBild(r.titelbildId);
    if (b) bilderMap.set(b.id, b);
  }));

  const alleTags = [...new Set(rezepte.flatMap((r) => r.tags || []))].sort((a, b) => a.localeCompare(b, 'de'));
  view.innerHTML = `
    <label class="search">${ICON.search}<input id="suche" type="search" placeholder="Rezept oder Zutat suchen" value="${esc(suche)}"></label>
    ${alleTags.length ? `<div class="chips">${['', ...alleTags].map((t) => `<button class="chip ${t === tagFilter ? 'active' : ''}" data-tag="${esc(t)}">${t ? esc(t) : 'Alle'}</button>`).join('')}</div>` : ''}
    <div class="grid" id="grid"></div>`;

  const grid = $('#grid');
  const zeichnen = () => {
    const q = suche.trim().toLowerCase();
    const treffer = rezepte.filter((r) => {
      if (tagFilter && !(r.tags || []).includes(tagFilter)) return false;
      if (!q) return true;
      return [r.titel, r.beschreibung, ...(r.zutaten || []).map((z) => z.name), ...(r.tags || [])].join(' ').toLowerCase().includes(q);
    });
    grid.innerHTML = treffer.length ? treffer.map((r) => {
      const url = bildUrlFuer(r, bilderMap);
      return `
        <a class="rk" href="#/rezept/${r.id}">
          <div class="ph" ${url ? `style="background-image:url('${url}')"` : ''}>${url ? '' : ICON.pot}</div>
          <div class="tx">
            <div class="tt">${esc(r.titel || 'Ohne Titel')}</div>
            <div class="mt">${[r.zubereitungszeit, r.portionen ? `${r.portionen} Port.` : ''].filter(Boolean).map(esc).join(' · ') || '&nbsp;'}</div>
          </div>
        </a>`;
    }).join('') : '<p class="hint">Nichts gefunden.</p>';
  };
  zeichnen();
  $('#suche').addEventListener('input', (e) => { suche = e.target.value; zeichnen(); });
  $$('.chip').forEach((c) => c.addEventListener('click', () => {
    tagFilter = c.dataset.tag;
    $$('.chip').forEach((x) => x.classList.toggle('active', x === c));
    zeichnen();
  }));
}

// ---------- Mengen ----------

const BRUECHE = [[0.25, '¼'], [0.5, '½'], [0.75, '¾'], [1 / 3, '⅓'], [2 / 3, '⅔']];

function mengeText(menge, einheit, faktor) {
  if (menge == null) return einheit ? esc(einheit) : '';
  let m = menge * faktor;
  let zahl;
  if (/^(g|ml)$/i.test(einheit) && m >= 100) zahl = String(Math.round(m / 5) * 5);
  else if (m >= 10) zahl = String(Math.round(m));
  else {
    const ganz = Math.floor(m);
    const rest = m - ganz;
    const bruch = BRUECHE.find(([w]) => Math.abs(rest - w) < 0.04);
    if (bruch && !/^(g|ml|kg|l)$/i.test(einheit)) zahl = `${ganz || ''}${bruch[1]}`;
    else zahl = (Math.round(m * 10) / 10).toLocaleString('de-DE');
  }
  return esc(`${zahl} ${einheit || ''}`.trim());
}

// "200 g Mehl, gesiebt" -> { menge: 200, einheit: 'g', name: 'Mehl', hinweis: 'gesiebt' }
const EINHEITEN = ['g', 'kg', 'ml', 'l', 'cl', 'EL', 'TL', 'Stück', 'Stk.', 'Prise', 'Prisen', 'Dose', 'Dosen', 'Bund', 'Zehe', 'Zehen', 'Pck.', 'Päckchen', 'Becher', 'Tasse', 'Tassen', 'Scheibe', 'Scheiben', 'Handvoll', 'Msp.'];
function zutatParsen(zeile) {
  let rest = zeile.trim();
  let menge = null;
  const zahl = /^(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?|[½¼¾⅓⅔])\s*/.exec(rest);
  if (zahl) {
    const t = zahl[1].replace(',', '.');
    const unicode = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };
    menge = unicode[t] ?? (t.includes('/') ? t.split('/').map(Number).reduce((a, b) => a / b) : Number(t));
    rest = rest.slice(zahl[0].length);
  }
  let einheit = '';
  const e = EINHEITEN.find((x) => rest.toLowerCase().startsWith(x.toLowerCase() + ' '));
  if (e) { einheit = e; rest = rest.slice(e.length).trim(); }
  const [name, ...hinweis] = rest.split(',');
  return { gruppe: '', menge, einheit, name: name.trim(), hinweis: hinweis.join(',').trim(), geschaetzt: false };
}

function zutatAlsZeile(z) {
  const m = z.menge == null ? '' : String(Math.round(z.menge * 100) / 100).replace('.', ',');
  return [m, z.einheit, z.name].filter(Boolean).join(' ') + (z.hinweis ? `, ${z.hinweis}` : '');
}

// ---------- Rezept ansehen ----------

async function renderRezept(id) {
  const r = await db.getRezept(id);
  if (!r) { location.hash = '#/'; return; }
  const bilder = new Map((await db.bilderFuer(id)).map((b) => [b.id, b]));
  const url = (bid) => (bid && bilder.get(bid) ? objectUrl(bilder.get(bid).blob) : '');

  kopf(r.titel || 'Rezept', {
    zurueck: true,
    klein: true,
    rechts: `
      <button class="icon-btn" id="btn-koch" aria-label="Kochmodus: Bildschirm bleibt an">${ICON.flame}</button>
      <button class="icon-btn" id="btn-more" aria-label="Mehr">${ICON.more}</button>`,
  });

  let portionen = r.portionen || 0;
  const hero = url(r.titelbildId);
  const gruppen = [];
  for (const [i, z] of (r.zutaten || []).entries()) {
    let g = gruppen.find((x) => x.name === (z.gruppe || ''));
    if (!g) gruppen.push(g = { name: z.gruppe || '', liste: [] });
    g.liste.push({ ...z, i });
  }

  view.innerHTML = `
    ${hero ? `<div class="hero" style="background-image:url('${hero}')"></div>` : ''}
    <h2 class="r-title">${esc(r.titel || 'Ohne Titel')}</h2>
    ${r.beschreibung ? `<p class="r-desc">${esc(r.beschreibung)}</p>` : ''}
    <div class="r-meta">
      ${r.zubereitungszeit ? `<span class="pill2">${ICON.clock}${esc(r.zubereitungszeit)}</span>` : ''}
      ${r.portionen ? `<span class="pill2 stepper">${ICON.people}<button id="p-minus" aria-label="Weniger Portionen">−</button><b id="p-anz"></b><button id="p-plus" aria-label="Mehr Portionen">+</button></span>` : ''}
    </div>

    <section class="section">
      <h2>Zutaten</h2>
      <div id="zutaten"></div>
    </section>

    <section class="section">
      <h2>Zubereitung</h2>
      <ol class="steps">
        ${(r.schritte || []).map((s, i) => `
          <li data-i="${i}">
            <div class="st"><p>${esc(s.text)}</p></div>
            ${s.bildId && bilder.get(s.bildId) ? `<img src="${url(s.bildId)}" alt="Schritt ${i + 1}" loading="lazy">` : ''}
          </li>`).join('')}
      </ol>
    </section>

    ${r.hinweise ? `<section class="section"><h2>Tipps</h2><div class="note">${esc(r.hinweise)}</div></section>` : ''}

    <section class="section">
      <h2>Quelle</h2>
      ${r.quelle ? `<a class="src" href="${esc(r.quelle)}" target="_blank" rel="noopener">${ICON.link}${esc(r.quelle)}</a>` : '<p class="hint">Kein Link gespeichert.</p>'}
      ${(r.tags || []).length ? `<div class="tags">${r.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
    </section>`;

  const zutatenZeichnen = () => {
    const faktor = r.portionen ? portionen / r.portionen : 1;
    if ($('#p-anz')) $('#p-anz').textContent = `${portionen} Port.`;
    $('#zutaten').innerHTML = gruppen.map((g) => `
      ${g.name ? `<div class="zt-group">${esc(g.name)}</div>` : ''}
      ${g.liste.map((z) => `
        <div class="zt" data-i="${z.i}">
          <span class="m">${mengeText(z.menge, z.einheit, faktor)}${z.geschaetzt ? ' <span class="est" title="Menge geschätzt">≈</span>' : ''}</span>
          <span class="n">${esc(z.name)}${z.hinweis ? ` <small>${esc(z.hinweis)}</small>` : ''}</span>
        </div>`).join('')}`).join('') || '<p class="hint">Keine Zutaten erkannt.</p>';
  };
  zutatenZeichnen();
  $('#p-minus')?.addEventListener('click', () => { if (portionen > 1) { portionen--; zutatenZeichnen(); } });
  $('#p-plus')?.addEventListener('click', () => { portionen++; zutatenZeichnen(); });

  // Abhaken beim Kochen
  $('#zutaten').addEventListener('click', (e) => e.target.closest('.zt')?.classList.toggle('done'));
  $$('.steps li').forEach((li) => li.querySelector('.st').addEventListener('click', () => li.classList.toggle('done')));
  $$('.steps img').forEach((img) => img.addEventListener('click', () => lightbox(img.src)));

  $('#btn-koch').addEventListener('click', kochmodusUmschalten);
  $('#btn-more').addEventListener('click', () => openMenu([
    { icon: ICON.edit, label: 'Bearbeiten', run: () => { location.hash = `#/rezept/${id}/bearbeiten`; } },
    { icon: ICON.share, label: 'Als Text teilen', run: () => rezeptTeilen(r) },
    { icon: ICON.trash, label: 'Löschen', danger: true, run: async () => {
      if (!confirm(`„${r.titel}“ wirklich löschen?`)) return;
      await db.deleteRezept(id);
      toast('Rezept gelöscht');
      location.hash = '#/';
    } },
  ]));
}

async function kochmodusUmschalten() {
  const btn = $('#btn-koch');
  if (wakeLock) { wakeLockLoesen(); toast('Kochmodus aus'); return; }
  if (!('wakeLock' in navigator)) { toast('Dieses Handy unterstützt den Kochmodus nicht.'); return; }
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; $('#btn-koch')?.classList.remove('cook-on'); });
    btn.classList.add('cook-on');
    toast('Kochmodus an: der Bildschirm bleibt eingeschaltet');
  } catch {
    toast('Kochmodus konnte nicht eingeschaltet werden.');
  }
}

function wakeLockLoesen() {
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}

function rezeptAlsText(r) {
  const zeilen = [r.titel, ''];
  if (r.portionen) zeilen.push(`Für ${r.portionen} Portionen`);
  if (r.zubereitungszeit) zeilen.push(`Zeit: ${r.zubereitungszeit}`);
  zeilen.push('', 'Zutaten:');
  for (const z of r.zutaten || []) zeilen.push(`- ${zutatAlsZeile(z)}`);
  zeilen.push('', 'Zubereitung:');
  (r.schritte || []).forEach((s, i) => zeilen.push(`${i + 1}. ${s.text}`));
  if (r.hinweise) zeilen.push('', `Tipps: ${r.hinweise}`);
  if (r.quelle) zeilen.push('', r.quelle);
  return zeilen.join('\n');
}

async function rezeptTeilen(r) {
  const text = rezeptAlsText(r);
  try {
    if (navigator.share) { await navigator.share({ title: r.titel, text }); return; }
  } catch (err) {
    if (err.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Rezept in die Zwischenablage kopiert');
  } catch {
    toast('Teilen ist auf diesem Gerät nicht möglich.');
  }
}

function lightbox(src) {
  const lb = $('#lightbox');
  lb.innerHTML = `<img src="${src}" alt=""><button class="icon-btn" aria-label="Schließen">${ICON.close}</button>`;
  lb.hidden = false;
  lb.onclick = () => { lb.hidden = true; lb.innerHTML = ''; };
}

function openMenu(items) {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.innerHTML = items.map((it, i) => `<button data-i="${i}" class="${it.danger ? 'danger' : ''}">${it.icon}${esc(it.label)}</button>`).join('');
  document.body.appendChild(menu);
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    closeMenu();
    items[b.dataset.i].run();
  });
  setTimeout(() => document.addEventListener('click', closeMenu, { once: true }), 0);
}

function closeMenu() {
  $$('.menu').forEach((m) => m.remove());
}

// ---------- Neues Rezept ----------

const LINK_RE = /https?:\/\/(?:www\.)?instagram\.com\/[^\s]+/i;

async function renderNeu(params) {
  kopf('Neues Rezept', { sub: 'aus einem Instagram-Reel' });
  let video = null;
  let link = '';
  let beschreibung = '';

  if (params.get('geteilt')) {
    const e = await db.eingangHolen();
    if (e) {
      video = e.video;
      const alles = [e.url, e.text, e.title].filter(Boolean).join('\n');
      link = (LINK_RE.exec(alles) || [])[0] || e.url || '';
      beschreibung = [e.title, e.text].filter(Boolean).join('\n').replace(link, '').trim();
      await db.eingangLeeren();
    }
  }

  view.innerHTML = `
    <div id="fehler"></div>
    <section class="section">
      <h2>Video</h2>
      <label class="drop" id="drop">
        <input type="file" accept="video/*" class="file-input" id="video-input">
        <span id="drop-inhalt"></span>
      </label>
      <p class="hint">Das Video bleibt auf dem Handy. Nur einzelne Standbilder gehen zum Erkennen an die KI.</p>
    </section>

    <section class="section">
      <h2>Beschreibung</h2>
      <label class="field"><span>Text aus dem Post (Zutaten stehen oft hier)</span>
        <textarea id="beschreibung" rows="5" placeholder="Beschreibung aus Instagram hier einfügen">${esc(beschreibung)}</textarea>
      </label>
      <label class="field"><span>Link zum Reel (optional)</span>
        <input id="link" type="url" inputmode="url" placeholder="https://www.instagram.com/reel/…" value="${esc(link)}">
      </label>
    </section>

    <button class="btn primary block" id="los">Rezept erstellen</button>
    <div id="fortschritt" hidden>
      <div class="progress"><i id="balken"></i></div>
      <p class="hint" id="status"></p>
      <div class="frames" id="frames"></div>
    </div>

    <section class="section" style="margin-top:16px">
      <h2>So kommt das Reel in die App</h2>
      <ol class="howto">
        <li>In Instagram beim Reel auf <b>Teilen</b> tippen und das Video <b>herunterladen</b> (oder per Bildschirmaufnahme aufnehmen).</li>
        <li>Auf Android: das Video in der Galerie teilen und <b>Kochbuch</b> wählen. Auf dem iPhone: hier oben <b>Video auswählen</b>.</li>
        <li>Die Beschreibung des Posts kopieren und einfügen, dort stehen oft die Mengen.</li>
      </ol>
    </section>`;

  const dropInhalt = () => {
    $('#drop-inhalt').innerHTML = video
      ? `<video src="${objectUrl(video)}" controls muted playsinline></video><span>${esc(video.name || 'Geteiltes Video')} · anderes wählen</span>`
      : `${ICON.video}<b>Video auswählen</b><span>Reel aus der Galerie oder den Dateien</span>`;
    $('#drop-inhalt').style.display = 'contents';
  };
  dropInhalt();
  $('#video-input').addEventListener('change', (e) => {
    if (e.target.files[0]) { video = e.target.files[0]; dropInhalt(); }
  });
  // Klick auf die Videosteuerung soll nicht den Dateidialog öffnen
  $('#drop').addEventListener('click', (e) => { if (e.target.tagName === 'VIDEO') e.preventDefault(); });

  $('#link').addEventListener('input', (e) => {
    // Wer den ganzen geteilten Text einfügt: Link herausziehen
    const m = LINK_RE.exec(e.target.value);
    if (m && m[0] !== e.target.value.trim()) e.target.value = m[0];
  });

  $('#los').addEventListener('click', async () => {
    const btn = $('#los');
    const fehler = $('#fehler');
    fehler.innerHTML = '';
    const text = $('#beschreibung').value;
    const quelle = $('#link').value.trim();
    const hatSchluessel = settings.anbieter === 'claude' ? settings.apiKey
      : settings.anbieter === 'groq' ? settings.groqKey : (settings.geminiKey || settings.groqKey);
    if (!hatSchluessel) {
      fehler.innerHTML = '<div class="err">Bitte zuerst in den <a href="#/einstellungen">Einstellungen</a> einen API-Schlüssel eintragen.</div>';
      return;
    }
    if (!video && !text.trim()) {
      fehler.innerHTML = '<div class="err">Bitte ein Video auswählen oder die Beschreibung einfügen.</div>';
      return;
    }
    btn.disabled = true;
    $('#fortschritt').hidden = false;
    const status = (t) => { $('#status').textContent = t; };
    const balken = (p) => { $('#balken').style.width = `${Math.round(p * 100)}%`; };
    try {
      let bilder = [];
      if (video) {
        status('Standbilder aus dem Video holen …');
        const ergebnis = await standbilder(video, (p) => balken(p * 0.4));
        bilder = ergebnis.bilder;
        $('#frames').innerHTML = bilder.map((b) => `<img src="${objectUrl(b.blob)}" alt="">`).join('');
      }
      balken(0.5);
      const daten = await rezeptErkennen({ bilder, beschreibung: text, link: quelle }, settings, status);
      balken(0.95);
      status('Rezept speichern …');
      const id = await rezeptSpeichern(daten, bilder, quelle, text);
      balken(1);
      toast('Rezept gespeichert');
      location.hash = `#/rezept/${id}`;
    } catch (err) {
      fehler.innerHTML = `<div class="err">${esc(err.message || err)}</div>`;
      $('#fortschritt').hidden = true;
      btn.disabled = false;
      window.scrollTo(0, 0);
    }
  });
}

// Nur die Standbilder speichern, die das Rezept wirklich zeigt.
async function rezeptSpeichern(daten, bilder, quelle, originaltext) {
  const id = db.newId();
  const gespeichert = new Map();
  const bildId = (nr) => {
    const b = nr != null && bilder.find((x) => x.index === nr);
    if (!b) return null;
    if (!gespeichert.has(nr)) gespeichert.set(nr, { id: `${id}-${nr}`, rezeptId: id, zeit: b.zeit, blob: b.blob });
    return gespeichert.get(nr).id;
  };
  const rezept = {
    id,
    createdAt: Date.now(),
    titel: daten.titel,
    beschreibung: daten.beschreibung,
    portionen: daten.portionen,
    zubereitungszeit: daten.zubereitungszeit,
    zutaten: daten.zutaten,
    schritte: daten.schritte.map((s) => ({ text: s.text, bildId: bildId(s.bild) })),
    titelbildId: bildId(daten.titelbild) || bildId(bilder.length ? bilder[bilder.length - 1].index : null),
    tags: daten.tags,
    hinweise: daten.hinweise,
    quelle,
    originaltext,
  };
  await db.rezeptMitBildernSpeichern(rezept, [...gespeichert.values()]);
  return id;
}

// ---------- Bearbeiten ----------

async function renderBearbeiten(id) {
  const r = await db.getRezept(id);
  if (!r) { location.hash = '#/'; return; }
  const bilder = new Map((await db.bilderFuer(id)).map((b) => [b.id, b]));
  kopf('Bearbeiten', { zurueck: true, klein: true });

  const schritte = (r.schritte || []).map((s) => ({ ...s }));
  view.innerHTML = `
    <section class="section">
      <label class="field"><span>Titel</span><input id="e-titel" value="${esc(r.titel)}"></label>
      <label class="field"><span>Beschreibung</span><textarea id="e-beschreibung" rows="2">${esc(r.beschreibung)}</textarea></label>
      <div class="row">
        <label class="field"><span>Portionen</span><input id="e-portionen" type="number" inputmode="numeric" min="1" value="${r.portionen ?? ''}"></label>
        <label class="field"><span>Zeit</span><input id="e-zeit" value="${esc(r.zubereitungszeit)}"></label>
      </div>
      <label class="field"><span>Schlagworte (mit Komma getrennt)</span><input id="e-tags" value="${esc((r.tags || []).join(', '))}"></label>
    </section>
    <section class="section">
      <h2>Zutaten</h2>
      <label class="field"><span>Eine Zutat pro Zeile, z. B. „200 g Mehl, gesiebt“. Gruppen als Zeile mit „#“, z. B. „# Soße“.</span>
        <textarea id="e-zutaten" rows="10">${esc(zutatenAlsText(r.zutaten || []))}</textarea>
      </label>
    </section>
    <section class="section">
      <h2>Zubereitung</h2>
      <div id="e-schritte"></div>
      <button class="btn ghost block" id="e-schritt-neu">Schritt hinzufügen</button>
    </section>
    <section class="section">
      <label class="field"><span>Tipps</span><textarea id="e-hinweise" rows="3">${esc(r.hinweise)}</textarea></label>
      <label class="field"><span>Link</span><input id="e-quelle" type="url" value="${esc(r.quelle)}"></label>
    </section>
    <div class="actions">
      <button class="btn ghost" id="e-abbrechen">Abbrechen</button>
      <button class="btn primary" id="e-speichern">Speichern</button>
    </div>`;

  const schritteZeichnen = () => {
    $('#e-schritte').innerHTML = schritte.map((s, i) => `
      <div class="ed-step field" data-i="${i}">
        ${s.bildId && bilder.get(s.bildId) ? `<img src="${objectUrl(bilder.get(s.bildId).blob)}" alt="">` : ''}
        <textarea rows="3">${esc(s.text)}</textarea>
        <button class="icon-btn" aria-label="Schritt löschen">${ICON.trash}</button>
      </div>`).join('');
    $$('#e-schritte .ed-step').forEach((el) => {
      const i = Number(el.dataset.i);
      el.querySelector('textarea').addEventListener('input', (e) => { schritte[i].text = e.target.value; });
      el.querySelector('button').addEventListener('click', () => { schritte.splice(i, 1); schritteZeichnen(); });
    });
  };
  schritteZeichnen();
  $('#e-schritt-neu').addEventListener('click', () => { schritte.push({ text: '', bildId: null }); schritteZeichnen(); });
  $('#e-abbrechen').addEventListener('click', () => history.back());
  $('#e-speichern').addEventListener('click', async () => {
    r.titel = $('#e-titel').value.trim();
    r.beschreibung = $('#e-beschreibung').value.trim();
    r.portionen = Number($('#e-portionen').value) || null;
    r.zubereitungszeit = $('#e-zeit').value.trim();
    r.tags = $('#e-tags').value.split(',').map((t) => t.trim()).filter(Boolean);
    r.zutaten = zutatenAusText($('#e-zutaten').value, r.zutaten || []);
    r.schritte = schritte.filter((s) => s.text.trim());
    r.hinweise = $('#e-hinweise').value.trim();
    r.quelle = $('#e-quelle').value.trim();
    await db.putRezept(r);
    toast('Gespeichert');
    location.hash = `#/rezept/${id}`;
  });
}

function zutatenAlsText(zutaten) {
  const zeilen = [];
  let gruppe = '';
  for (const z of zutaten) {
    if ((z.gruppe || '') !== gruppe) { gruppe = z.gruppe || ''; if (gruppe) zeilen.push(`# ${gruppe}`); }
    zeilen.push(zutatAlsZeile(z));
  }
  return zeilen.join('\n');
}

function zutatenAusText(text, alt) {
  const liste = [];
  let gruppe = '';
  for (const zeile of text.split('\n').map((z) => z.trim()).filter(Boolean)) {
    if (zeile.startsWith('#')) { gruppe = zeile.slice(1).trim(); continue; }
    // Unveränderte Zeilen behalten ihre Angaben (z. B. „geschätzt“)
    const vorher = alt.find((z) => zutatAlsZeile(z) === zeile && (z.gruppe || '') === gruppe);
    liste.push(vorher || { ...zutatParsen(zeile), gruppe });
  }
  return liste;
}

// ---------- Einstellungen ----------

function renderEinstellungen() {
  kopf('Einstellungen');
  view.innerHTML = `
    <section class="section">
      <h2>Rezepte erkennen mit</h2>
      <label class="field"><span>Anbieter</span>
        <select id="s-anbieter">
          <option value="gemini" ${!['claude', 'groq'].includes(settings.anbieter) ? 'selected' : ''}>Google Gemini, Groq als Ersatz (kostenlos)</option>
          <option value="groq" ${settings.anbieter === 'groq' ? 'selected' : ''}>Nur Groq (kostenlos)</option>
          <option value="claude" ${settings.anbieter === 'claude' ? 'selected' : ''}>Claude (kostenpflichtig)</option>
        </select>
      </label>
      <div id="s-gemini">
        <label class="field"><span>Gemini API-Schlüssel</span>
          <input id="s-gkey" type="password" autocomplete="off" placeholder="AIza…" value="${esc(settings.geminiKey)}">
        </label>
        <p class="hint">Kostenlos unter <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> mit einem Google-Konto anlegen.
          Im kostenlosen Kontingent darf Google die Anfragen zur Verbesserung seiner Dienste nutzen. Es gibt ein Tageslimit.</p>
      </div>
      <div id="s-groq">
        <label class="field"><span>Groq API-Schlüssel</span>
          <input id="s-qkey" type="password" autocomplete="off" placeholder="gsk_…" value="${esc(settings.groqKey)}">
        </label>
        <p class="hint">Kostenlos unter <a href="https://console.groq.com/keys" target="_blank" rel="noopener">console.groq.com/keys</a> anlegen, ohne Kreditkarte.
          Springt ein, wenn Gemini am Limit oder überlastet ist.</p>
      </div>
      <div id="s-claude">
        <label class="field"><span>Claude API-Schlüssel</span>
          <input id="s-key" type="password" autocomplete="off" placeholder="sk-ant-…" value="${esc(settings.apiKey)}">
        </label>
        <label class="field"><span>Modell</span>
          <select id="s-modell">${db.MODELLE.map((m) => `<option value="${m.id}" ${m.id === settings.modell ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select>
        </label>
        <p class="hint">Den Schlüssel gibt es unter console.anthropic.com → API Keys.
          Die API wird extra abgerechnet (Guthaben unter Settings → Billing aufladen).</p>
      </div>
      <p class="hint">Schlüssel bleiben nur auf diesem Handy.</p>
      <div class="actions"><button class="btn primary" id="s-speichern">Speichern</button></div>
    </section>
    <section class="section">
      <h2>App</h2>
      <p class="hint" style="margin-top:0">Version ${APP_VERSION}. Rezepte und Bilder sind nur auf diesem Handy gespeichert.</p>
    </section>`;
  const umschalten = () => {
    const a = $('#s-anbieter').value;
    $('#s-gemini').hidden = a !== 'gemini';
    $('#s-groq').hidden = a === 'claude';
    $('#s-claude').hidden = a !== 'claude';
  };
  umschalten();
  $('#s-anbieter').addEventListener('change', umschalten);
  $('#s-speichern').addEventListener('click', () => {
    settings = {
      ...settings,
      anbieter: $('#s-anbieter').value,
      geminiKey: $('#s-gkey').value.trim(),
      groqKey: $('#s-qkey').value.trim(),
      apiKey: $('#s-key').value.trim(),
      modell: $('#s-modell').value,
    };
    db.saveSettings(settings);
    toast('Einstellungen gespeichert');
  });
}

// ---------- Start ----------

window.addEventListener('hashchange', route);
document.addEventListener('visibilitychange', () => {
  // Wake Lock geht beim Wechsel in den Hintergrund verloren
  if (document.visibilityState === 'visible') $('#btn-koch')?.classList.toggle('cook-on', Boolean(wakeLock));
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

route();
