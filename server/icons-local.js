import { db, keepIcon } from './db.js';
import { saveFile } from './files.js';

export const NOTION_ICON_URL = /^https:\/\/(www\.)?notion\.so\/icons\/[^/?#]+\.svg/;

/** Télécharge les icônes natives Notion encore stockées comme liens distants, les garde chez toi et les range dans la collection « Importées ». */
export async function localizeRemoteIcons() {
  const rows = db.prepare("SELECT id, owner_id, icon FROM pages WHERE icon LIKE 'https://%notion.so/icons/%'").all().filter((r) => NOTION_ICON_URL.test(r.icon));
  const cache = new Map(); let done = 0;
  for (const r of rows) {
    try {
      const key = `${r.owner_id}|${r.icon}`;
      let local = cache.get(key);
      if (!local) {
        const res = await fetch(r.icon, { headers: { 'User-Agent': 'Deepwell/3.0 (self-hosted)' } });
        if (!res.ok) continue;
        const name = decodeURIComponent(new URL(r.icon).pathname.split('/').pop());
        local = saveFile(r.owner_id, name, 'image/svg+xml', Buffer.from(await res.arrayBuffer())).url;
        cache.set(key, local);
        keepIcon(r.owner_id, local, name.replace(/\.svg$/, ''), 'import');
      }
      db.prepare('UPDATE pages SET icon=? WHERE id=?').run(local, r.id); done++;
    } catch { /* réseau indisponible : on réessaiera au prochain démarrage */ }
  }
  return done;
}

export const NOTION_COLORS = ['gray', 'lightgray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
/** Importe une icône native Notion par son nom (ex. « chevrons-vertical ») et sa couleur ; renvoie { url, name } ou lève une erreur lisible. */
export async function importNotionIcon(ownerId, rawName, color = 'gray') {
  const name = String(rawName || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (!/^[a-z0-9-]{1,60}$/.test(name)) throw Object.assign(new Error('Nom d’icône invalide (lettres, chiffres et tirets)'), { status: 400 });
  if (!NOTION_COLORS.includes(color)) throw Object.assign(new Error('Couleur inconnue'), { status: 400 });
  const label = `${name}_${color}`;
  const dup = db.prepare('SELECT url FROM custom_icons WHERE owner_id=? AND name=?').get(ownerId, label);
  if (dup) return { url: dup.url, name: label };
  const res = await fetch(`https://www.notion.so/icons/${name}_${color}.svg`, { headers: { 'User-Agent': 'Deepwell/3.0 (self-hosted)' } });
  if (!res.ok || !/svg/.test(res.headers.get('content-type') || '')) throw Object.assign(new Error(`Icône « ${name} » introuvable chez Notion`), { status: 404 });
  const url = saveFile(ownerId, label + '.svg', 'image/svg+xml', Buffer.from(await res.arrayBuffer())).url;
  keepIcon(ownerId, url, label, 'import');
  return { url, name: label };
}
