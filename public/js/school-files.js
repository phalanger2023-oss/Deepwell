/**
 * Fichiers d'un chapitre (mode scolaire, stockage Drive). Chargé à la demande depuis app.js, seulement pour les pages d'une base scolaire.
 * Les fichiers vont directement du navigateur vers Google Drive avec un jeton temporaire délivré par le serveur : rien n'est conservé sur le serveur
 * hormis les informations (identifiant Drive, nom, type, taille, date).
 */
import { h, toast, confirmBox, ask, fmtSize } from './util.js';
import { api } from './api.js';
import { vi } from './icons.js';
import { makeZip, uniqueNames } from './zip.js';

const GAPI = 'https://www.googleapis.com';
let tokenCache = null;
async function driveToken(force = false) {
  if (!force && tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  const r = await api.post('/api/school/token');
  tokenCache = { token: r.token, exp: Date.now() + r.expires_in * 1000 };
  return r.token;
}
const isNative = (f) => /^application\/vnd\.google-apps\./.test(f.mime) && !f.folder; // Docs, Sheets… : exportés en PDF
const driveUrl = (f) => (f.folder ? `https://drive.google.com/drive/folders/${f.drive_id}` : `https://drive.google.com/file/d/${f.drive_id}/view`);

/** Contenu d'un fichier Drive. Un jeton expiré est renouvelé une fois. */
async function fetchFile(f) {
  const url = isNative(f) ? `${GAPI}/drive/v3/files/${f.drive_id}/export?mimeType=application%2Fpdf` : `${GAPI}/drive/v3/files/${f.drive_id}?alt=media`;
  let r = await fetch(url, { headers: { Authorization: `Bearer ${await driveToken()}` } });
  if (r.status === 401) r = await fetch(url, { headers: { Authorization: `Bearer ${await driveToken(true)}` } });
  if (!r.ok) throw new Error(r.status === 403 || r.status === 404 ? `« ${f.name} » : Google n’autorise pas l’accès à ce fichier` : `« ${f.name} » : téléchargement impossible (${r.status})`);
  return new Uint8Array(await r.arrayBuffer());
}
const fileName = (f) => (isNative(f) && !/\.pdf$/i.test(f.name) ? `${f.name}.pdf` : f.name);
function saveBlob(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/** Envoi direct navigateur → Drive (reprenable), avec progression. */
async function uploadToDrive(file, folderId, token, onProgress) {
  const init = await fetch(`${GAPI}/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': file.type || 'application/octet-stream', 'X-Upload-Content-Length': String(file.size) },
    body: JSON.stringify({ name: file.name, parents: [folderId] }),
  });
  if (!init.ok) throw new Error(`Google a refusé l’envoi de « ${file.name} » (${init.status})`);
  const loc = init.headers.get('Location');
  if (!loc) throw new Error('Google n’a pas donné d’adresse d’envoi');
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', loc);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    x.onload = () => { try { x.status < 300 ? resolve(JSON.parse(x.responseText)) : reject(new Error(`L’envoi de « ${file.name} » a échoué (${x.status})`)); } catch { reject(new Error('Réponse de Google illisible')); } };
    x.onerror = () => reject(new Error(`L’envoi de « ${file.name} » a été interrompu`));
    x.send(file);
  });
}

const iconFor = (f) => (f.folder ? 'folder' : /^image\//.test(f.mime) ? 'image' : 'file-text');

export async function mountSchoolFiles(host, page) {
  let info;
  try { info = await api.get(`/api/school/pages/${page.id}`); } catch { return; }
  if (!info.applicable) return;
  const title = info.is_addendum ? 'Fichiers de l’addendum' : 'Fichiers du chapitre';
  let preview = null, busy = '';
  const previewBox = h('div', { class: 'sf-preview' });
  const status = h('span', { class: 'muted small' });
  const list = h('div', { class: 'sf-list' });
  const fileInput = h('input', { type: 'file', multiple: true, hidden: true });
  const addBtn = h('button', { class: 'btn small', onclick: () => fileInput.click() }, vi('upload', 14), 'Ajouter un fichier');
  const zipBtn = h('button', { class: 'btn small', onclick: () => downloadAll() }, vi('download', 14), 'Tout télécharger');

  function draw() {
    addBtn.disabled = !!busy || !info.drive_connected; zipBtn.disabled = !!busy;
    zipBtn.hidden = info.is_addendum || !(info.all_files || []).length;
    addBtn.hidden = !info.editable;
    status.textContent = busy;
    list.replaceChildren(...(info.files.length ? info.files.map(row) : [h('div', { class: 'muted small' }, info.drive_connected
      ? (info.folder ? 'Aucun fichier pour le moment.' : 'Aucun fichier pour le moment. Le dossier Drive est créé au premier envoi.')
      : 'Connectez Google Drive dans Réglages → Google Drive pour ajouter et ouvrir des fichiers.')]));
    previewBox.replaceChildren(...(preview ? [h('div', { class: 'sf-prev-head' }, h('b', {}, preview.name), h('a', { class: 'small', href: driveUrl(preview), target: '_blank', rel: 'noopener' }, 'Ouvrir dans Drive'),
      h('button', { class: 'icon-btn', title: 'Fermer l’aperçu', onclick: () => { preview = null; draw(); } }, '✕')),
      h('iframe', { class: 'sf-frame', src: `https://drive.google.com/file/d/${preview.drive_id}/preview`, title: `Aperçu de ${preview.name}`, allow: 'autoplay' })] : []));
  }
  const row = (f) => h('div', { class: 'sf-row' },
    vi(iconFor(f), 16),
    h('button', { class: 'sf-name', title: f.folder ? 'Ouvrir le dossier dans Drive' : 'Voir l’aperçu', onclick: () => (f.folder ? window.open(driveUrl(f), '_blank', 'noopener') : (preview = f, draw())) }, f.name),
    h('span', { class: 'muted small' }, [f.size ? fmtSize(f.size) : '', f.kind === 'link' ? 'déjà sur Drive' : ''].filter(Boolean).join(' · ')),
    h('span', { class: 'sf-actions' },
      f.folder ? null : h('button', { class: 'icon-btn', title: 'Télécharger', 'aria-label': 'Télécharger', onclick: () => downloadOne(f) }, vi('download', 15)),
      info.editable ? h('button', { class: 'icon-btn', title: 'Renommer', 'aria-label': 'Renommer', onclick: () => rename(f) }, vi('pencil', 15)) : null,
      info.editable ? h('button', { class: 'icon-btn', title: 'Retirer', 'aria-label': 'Retirer', onclick: () => remove(f) }, vi('trash-2', 15)) : null));

  const run = async (label, fn) => { busy = label; draw(); try { await fn(); } catch (e) { toast(e.message, 'error'); } busy = ''; draw(); };
  async function downloadOne(f) { await run('Téléchargement…', async () => saveBlob(new Blob([await fetchFile(f)]), fileName(f))); }
  async function downloadAll() {
    const files = (info.all_files || []).filter((f) => !f.folder);
    if (!files.length) return;
    await run('Préparation…', async () => {
      const names = uniqueNames(files.map((f) => `${f.where ? `${f.where}/` : ''}${fileName(f)}`)), entries = [], failed = [];
      for (const [i, f] of files.entries()) {
        busy = `Préparation ${i + 1}/${files.length}…`; draw();
        try { entries.push({ name: names[i], data: await fetchFile(f) }); } catch (e) { failed.push(e.message); }
      }
      if (entries.length) saveBlob(makeZip(entries), `${(page.title || 'Chapitre').replace(/[\\/:*?"<>|]/g, ' ').trim() || 'Chapitre'}.zip`);
      if (failed.length) toast(`${failed.length} fichier(s) non inclus : ${failed[0]}`, 'error');
    });
  }
  async function rename(f) {
    const name = (await ask('Renommer le fichier', 'Nom', f.name))?.trim();
    if (!name || name === f.name) return;
    await run('Renommage…', async () => { const r = await api.patch(`/api/school/files/${f.id}`, { name }); f.name = r.name; if (!r.synced) toast('Renommé dans DeepWell. Google n’a pas répondu : nouvelle tentative automatique.'); });
  }
  async function remove(f) {
    if (!(await confirmBox(f.kind === 'link' ? `Retirer « ${f.name} » de ce chapitre ? Le fichier reste sur Google Drive, à sa place.` : `Retirer « ${f.name} » ? Il sera mis dans la corbeille de Google Drive (récupérable depuis Drive).`))) return;
    await run('Suppression…', async () => {
      const r = await api.del(`/api/school/files/${f.id}`);
      info.files = info.files.filter((x) => x.id !== f.id); info.all_files = (info.all_files || []).filter((x) => x.id !== f.id);
      if (preview?.id === f.id) preview = null;
      if (!r.synced) toast('Retiré de DeepWell. Google n’a pas répondu : nouvelle tentative automatique.');
    });
  }
  fileInput.addEventListener('change', async () => {
    const files = [...fileInput.files]; fileInput.value = '';
    if (!files.length) return;
    await run('Préparation de l’envoi…', async () => {
      const s = await api.post(`/api/school/pages/${page.id}/upload-session`);
      info.folder = true;
      for (const [i, file] of files.entries()) {
        const d = await uploadToDrive(file, s.folder_id, s.token, (p) => { busy = `Envoi ${i + 1}/${files.length} : ${Math.round(p * 100)} %`; status.textContent = busy; });
        const saved = await api.post(`/api/school/pages/${page.id}/files`, { drive_id: d.id });
        info.files.push(saved); if (!info.is_addendum) (info.all_files ||= []).push({ ...saved, where: '' });
        draw();
      }
      toast(files.length > 1 ? `${files.length} fichiers ajoutés sur Drive` : 'Fichier ajouté sur Drive');
    });
  });

  host.replaceChildren(h('section', { class: 'sf' },
    h('div', { class: 'sf-head' }, h('h3', {}, vi('folder', 16), title), status, h('span', { class: 'sf-btns' }, addBtn, zipBtn), fileInput), list, previewBox));
  draw();
}
