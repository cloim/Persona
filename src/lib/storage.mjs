import { openDB } from 'idb';
async function initDb() {
  const database = await openDB('persona-studio', 1, {
    upgrade(db) {
      db.createObjectStore('projects', { keyPath: 'id' });
      db.createObjectStore('settings');
    }
  });
  try {
    const existing = await database.getAll('projects');
    if (existing.length === 0 && typeof indexedDB !== 'undefined' && indexedDB.databases) {
      const dbs = await indexedDB.databases();
      if (dbs.some(d => d.name === 'personas-studio')) {
        const oldDb = await openDB('personas-studio', 1);
        const oldProjects = await oldDb.getAll('projects');
        for (const p of oldProjects) await database.put('projects', p);
        const oldSettings = await oldDb.get('settings', 'providers');
        if (oldSettings) await database.put('settings', oldSettings, 'providers');
        oldDb.close();
      }
    }
  } catch {}
  return database;
}
const db = initDb();
export async function loadProjects() { return (await db).getAll('projects'); }
export async function saveProject(project) { return (await db).put('projects', project); }
export async function deleteProject(id) { return (await db).delete('projects', id); }
export async function getSettings() { return (await db).get('settings', 'providers'); }
export async function saveSettings(settings) { const { apiKey, captionApiKey, ...safe } = settings; return (await db).put('settings', safe, 'providers'); }
export async function imageFromFile(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('PNG, JPG, WebP 이미지를 선택해 주세요');
  if (file.size > 25 * 1024 * 1024) throw new Error('이미지 한 장은 25MB까지 등록할 수 있어요');
  const bitmap = await createImageBitmap(file);
  let width = bitmap.width, height = bitmap.height;
  const maxDim = 1280;

  let data;
  let finalType = file.type;

  if (typeof document !== 'undefined' && (width > maxDim || height > maxDim)) {
    if (width > height) {
      height = Math.round((height * maxDim) / width);
      width = maxDim;
    } else {
      width = Math.round((width * maxDim) / height);
      height = maxDim;
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    finalType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    data = canvas.toDataURL(finalType, 0.92);
  } else {
    bitmap.close();
    data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
  }

  const bytes = new TextEncoder().encode(data);
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
  return { data, name: file.name, width, height, hash, type: finalType };
}
export async function imageFromData(data) {
  const blob = await (await fetch(data)).blob();
  return imageFromFile(new File([blob], 'generated.png', { type: blob.type }));
}
