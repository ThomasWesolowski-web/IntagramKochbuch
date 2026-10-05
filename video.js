// Standbilder aus dem Reel holen. Läuft komplett im Browser: das Video wird
// in ein <video>-Element geladen und an gleichmäßig verteilten Stellen auf ein
// Canvas gezeichnet.

const MAX_EDGE = 768;        // groß genug, um auch kleinen eingeblendeten Text zu lesen
const JPEG_QUALITY = 0.75;
const MIN_FRAMES = 8;
const MAX_FRAMES = 20;       // Mengen werden oft nur kurz eingeblendet, deshalb lieber dichter
const ABSTAND_S = 2;         // etwa alle zwei Sekunden ein Bild

function warte(el, event) {
  return new Promise((resolve, reject) => {
    const ok = () => { aufraeumen(); resolve(); };
    const fehler = () => { aufraeumen(); reject(new Error('Das Video kann auf diesem Gerät nicht gelesen werden.')); };
    const aufraeumen = () => { el.removeEventListener(event, ok); el.removeEventListener('error', fehler); };
    el.addEventListener(event, ok, { once: true });
    el.addEventListener('error', fehler, { once: true });
  });
}

export function zeitLabel(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

// Öffnet das Video, ruft fn(greifen, dauer) auf und räumt danach auf.
// greifen(zeit) zeichnet das Bild an dieser Stelle und gibt es als JPEG zurück.
async function mitVideo(file, fn) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  try {
    await warte(video, 'loadedmetadata');
    const dauer = Number.isFinite(video.duration) ? video.duration : 0;
    if (!dauer || !video.videoWidth) throw new Error('Das Video hat keine lesbare Länge.');
    const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext('2d');
    const greifen = async (zeit) => {
      video.currentTime = Math.max(0, Math.min(dauer - 0.05, zeit));
      await warte(video, 'seeked');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    };
    return await fn(greifen, dauer);
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

// Gibt { dauer, bilder: [{ index, zeit, blob }] } zurück. onProgress(0..1) für die Anzeige.
export function standbilder(file, onProgress = () => {}) {
  return mitVideo(file, async (greifen, dauer) => {
    const anzahl = Math.max(MIN_FRAMES, Math.min(MAX_FRAMES, Math.round(dauer / ABSTAND_S)));
    const bilder = [];
    for (let i = 0; i < anzahl; i++) {
      // Mitte jedes Abschnitts, damit Anfang und Ende (oft schwarz) nicht dabei sind
      const zeit = Math.min(dauer - 0.05, ((i + 0.5) / anzahl) * dauer);
      const blob = await greifen(zeit);
      if (blob) bilder.push({ index: bilder.length + 1, zeit, blob });
      onProgress((i + 1) / anzahl);
    }
    return { dauer, bilder };
  });
}

// Bilder genau an den Stellen, die die KI im Video genannt hat (Sekunden).
// Gibt [{ zeit, blob }] in derselben Reihenfolge zurück, null wo es nicht ging.
export function bilderBeiZeiten(file, zeiten) {
  return mitVideo(file, async (greifen) => {
    const ergebnis = [];
    for (const zeit of zeiten) {
      const blob = Number.isFinite(zeit) ? await greifen(zeit) : null;
      ergebnis.push(blob ? { zeit, blob } : null);
    }
    return ergebnis;
  });
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
