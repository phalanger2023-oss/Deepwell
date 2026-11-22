import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { db, uid, now, UPLOAD_DIR } from './db.js';
import { requireAuth } from './auth.js';

const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 200);

export function saveFile(ownerId, name, mime, buffer) {
  const id = uid();
  fs.writeFileSync(path.join(UPLOAD_DIR, id), buffer);
  db.prepare('INSERT INTO files(id,owner_id,name,mime,size,created_at) VALUES(?,?,?,?,?,?)')
    .run(id, ownerId, String(name || 'fichier').slice(0, 255), mime || 'application/octet-stream', buffer.length, now());
  return { id, url: `/files/${id}` };
}

export const filesRouter = express.Router();

filesRouter.post('/', requireAuth, express.raw({ type: () => true, limit: `${MAX_MB}mb` }), (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Fichier vide' });
  const name = decodeURIComponent(req.headers['x-filename'] || 'fichier');
  const f = saveFile(req.user.id, name, req.headers['content-type'], req.body);
  res.json({ ...f, name, size: req.body.length, mime: req.headers['content-type'] });
});

/** Lien « capability » : l'identifiant (UUID) est impossible à deviner, comme les fichiers Notion. */
export function serveFile(req, res) {
  const f = db.prepare('SELECT * FROM files WHERE id=?').get(req.params.id);
  const p = path.join(UPLOAD_DIR, req.params.id);
  if (!f || !/^[0-9a-f-]{36}$/.test(req.params.id) || !fs.existsSync(p)) return res.status(404).end();
  const inline = /^(image\/(?!svg)|video\/|audio\/|application\/pdf)/.test(f.mime) || req.query.inline === '1';
  res.set({
    'Content-Type': f.mime,
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    'Content-Security-Policy': "sandbox; default-src 'none'; img-src data:; media-src data:; style-src 'unsafe-inline'",
    'Cache-Control': 'private, max-age=31536000, immutable',
  });
  res.sendFile(p);
}
