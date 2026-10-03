// Lokaler Speicher auf dem Gerät (IndexedDB).
// "rezepte": ein Eintrag pro Rezept, "bilder": Bilder aus dem Video als Blob,
// "eingang": vom Handy geteilte Videos/Links, die noch nicht verarbeitet sind.

const DB_NAME = 'kochbuch';
const DB_VERSION = 1;

let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('rezepte')) {
          db.createObjectStore('rezepte', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('bilder')) {
          const bilder = db.createObjectStore('bilder', { keyPath: 'id' });
          bilder.createIndex('rezeptId', 'rezeptId');
        }
        if (!db.objectStoreNames.contains('eingang')) {
          db.createObjectStore('eingang', { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function done(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name, mode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function alleRezepte() {
  const list = await done((await store('rezepte')).getAll());
  return list.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getRezept(id) {
  return done((await store('rezepte')).get(id));
}

export async function putRezept(r) {
  r.updatedAt = Date.now();
  return done((await store('rezepte', 'readwrite')).put(r));
}

// Speichert Rezept und Bilder in einem Rutsch.
export async function rezeptMitBildernSpeichern(r, bilder) {
  const db = await open();
  const tx = db.transaction(['rezepte', 'bilder'], 'readwrite');
  r.updatedAt = Date.now();
  tx.objectStore('rezepte').put(r);
  for (const b of bilder) tx.objectStore('bilder').put(b);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteRezept(id) {
  const bilder = await bilderFuer(id);
  const db = await open();
  const tx = db.transaction(['rezepte', 'bilder'], 'readwrite');
  tx.objectStore('rezepte').delete(id);
  for (const b of bilder) tx.objectStore('bilder').delete(b.id);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function bilderFuer(rezeptId) {
  return done((await store('bilder')).index('rezeptId').getAll(rezeptId));
}

export async function getBild(id) {
  return done((await store('bilder')).get(id));
}

// Geteilte Inhalte (Share Target). Der Service Worker schreibt hier hinein.
export async function eingangHolen() {
  const list = await done((await store('eingang')).getAll());
  return list.sort((a, b) => b.createdAt - a.createdAt)[0] || null;
}

export async function eingangLeeren() {
  return done((await store('eingang', 'readwrite')).clear());
}

// Einstellungen bleiben nur auf diesem Handy.
const SETTINGS_KEY = 'kochbuch-einstellungen';
export const MODELLE = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (beste Qualität)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (günstiger, schneller)' },
];

export function loadSettings() {
  try {
    return { apiKey: '', modell: MODELLE[0].id, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { apiKey: '', modell: MODELLE[0].id };
  }
}

export function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}
