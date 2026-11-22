/**
 * Icônes vectorielles (Lucide, licence ISC — public/icons/LICENSE), affichées par masque CSS : la couleur est celle du texte
 * ou une couleur choisie. Format d'une icône de page (champ `icon`) :
 *   emoji ("🚀")  |  "lucide:rocket"  |  "lucide:rocket:blue"  |  URL d'image ("/files/…", "https://…")
 */
import { h, modal, safeUrl } from './util.js';

export const ICON_COLORS = { gray: '#9b9a97', brown: '#9f6b53', orange: '#d9730d', yellow: '#cb912f', green: '#448361', blue: '#337ea9', purple: '#9065b0', pink: '#c14c8a', red: '#d44c47' };

/** Icône d'interface : <span class="vicon"> colorée par `currentColor`. */
export const vi = (name, size = 16, color = null) => {
  const el = h('span', { class: 'vicon', 'aria-hidden': 'true' });
  el.style.setProperty('--m', `url(/icons/${encodeURIComponent(name)}.svg)`);
  el.style.setProperty('--s', `${size}px`);
  if (color) el.style.color = ICON_COLORS[color] || color;
  return el;
};

export function parseIcon(s) {
  if (!s) return null;
  const m = /^lucide:([a-z0-9-]+)(?::([a-z]+|#[0-9a-f]{3,8}))?$/i.exec(s);
  if (m) return { kind: 'vector', name: m[1], color: m[2] || null };
  if (/^(\/|https?:)/.test(s)) return { kind: 'image', url: safeUrl(s) };
  return { kind: 'emoji', text: s };
}
/** Icône vectorielle par défaut d'un type de page (page, dossier, base de données). */
export const kindIcon = (kind) => ({ database: 'database', folder: 'folder' }[kind] || 'file-text');
export const makeIcon = (name, color) => `lucide:${name}${color ? `:${color}` : ''}`;

/** Nœud DOM d'une icône de page ; `fallback` = nom d'icône vectorielle utilisée quand la page n'en a pas. */
export function iconNode(icon, size = 18, fallback = 'file-text') {
  const p = parseIcon(icon);
  const box = h('span', { class: 'page-ico', style: `--s:${size}px;font-size:${Math.round(size * 0.92)}px` });
  if (!p) { box.append(vi(fallback, size)); box.classList.add('is-default'); }
  else if (p.kind === 'vector') box.append(vi(p.name, size, p.color));
  else if (p.kind === 'image') box.append(h('img', { src: p.url, alt: '', width: size, height: size }));
  else box.append(p.text);
  return box;
}

let indexPromise;
export const loadIconIndex = () => (indexPromise ||= fetch('/icons/index.json').then((r) => r.json()).catch(() => []));
const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const EMOJIS = ('😀 😃 😄 😁 😊 🙂 😉 😍 🤩 😎 🤔 😴 🥳 😇 🤓 😅 😂 🙃 😌 😬 ' +
  '👍 👏 🙌 🤝 💪 🙏 👀 🧠 ❤️ 🧡 💛 💚 💙 💜 🖤 ⭐ 🌟 ✨ 🔥 💡 🎯 🚀 ✅ ❌ ⚠️ ❓ ❗ 💬 📌 📍 🔖 🏷️ 📎 🔗 🔒 🔑 ' +
  '📄 📝 📓 📔 📚 📖 🗂️ 📁 📂 🗄️ 📊 📈 📉 📅 🗓️ ⏰ ⌛ 📧 📞 📷 🎬 🎵 🎨 🎮 🏆 🎁 🎉 🛒 💰 💳 💼 🏠 🏢 🏫 🏥 ' +
  '🌍 🌎 🌱 🌳 🌸 🍀 🍎 🍕 ☕ 🍷 🐶 🐱 🦊 🐻 🦁 🐢 🦋 🐝 ⚽ 🏀 🎾 🚗 ✈️ 🚲 ⛵ 🚂 🧪 🔬 🔭 💻 📱 ⚙️ 🛠️ 🔧 🔨 🧰 📦 🧩 ♟️ 🎲 🔔 🧭').split(' ');

/**
 * Sélecteur d'icône (Icônes / Emoji / Personnalisé). Résout la nouvelle valeur d'icône, '' pour « retirer », ou null si annulé.
 */
export function pickIcon(current, { title = 'Icône de la page' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return; done = true; m.close();
      if (v && parseIcon(v)?.kind === 'image') import('./api.js').then(({ api }) => api.post('/api/pages/icons/collection', { url: v, name: '' })).catch(() => {}); // toute image choisie est gardée dans la collection
      resolve(v);
    };
    const cur = parseIcon(current);
    let color = cur?.kind === 'vector' ? cur.color : null, tab = cur?.kind === 'emoji' ? 'emoji' : 'icons';
    const body = h('div', { class: 'icon-picker' });
    const m = modal(title, body, { wide: true, onClose: () => finish(null) });

    const draw = async () => {
      const tabs = h('div', { class: 'ip-tabs' }, [['icons', 'Icônes'], ['emoji', 'Emoji'], ['custom', 'Personnalisé']].map(([k, l]) =>
        h('button', { class: k === tab ? 'on' : '', onclick: () => { tab = k; draw(); } }, l)),
      h('span', { class: 'ip-spacer' }), current ? h('button', { class: 'btn small danger', onclick: () => finish('') }, 'Retirer') : null);
      const content = h('div', { class: 'ip-body' });
      body.replaceChildren(tabs, content);
      if (tab === 'icons') {
        const search = h('input', { class: 'input', placeholder: 'Rechercher une icône (ex. livre, étoile, fusée)…', autofocus: true });
        const swatches = h('div', { class: 'ip-colors' }, [null, ...Object.keys(ICON_COLORS)].map((c) =>
          h('button', { class: `ip-sw ${color === c ? 'on' : ''}`, title: c || 'Par défaut', style: `background:${c ? ICON_COLORS[c] : 'var(--fg)'}`,
            onclick: () => { color = c; grid(); swatches.querySelectorAll('.ip-sw').forEach((b, i) => b.classList.toggle('on', ([null, ...Object.keys(ICON_COLORS)][i]) === c)); } })));
        const gridEl = h('div', { class: 'ip-grid' });
        const index = await loadIconIndex();
        function grid() {
          const q = fold(search.value.trim()).split(/\s+/).filter(Boolean);
          const list = index.filter((i) => q.every((w) => fold(i.t).includes(w))).slice(0, 240);
          gridEl.replaceChildren(...(list.length ? list.map((i) => h('button', { class: 'ip-cell', title: i.n.replace(/-/g, ' '), onclick: () => finish(makeIcon(i.n, color)) }, vi(i.n, 22, color)))
            : [h('div', { class: 'muted pad' }, 'Aucune icône trouvée')]));
        }
        search.addEventListener('input', grid);
        content.append(search, swatches, gridEl); grid(); search.focus();
      } else if (tab === 'emoji') {
        const free = h('input', { class: 'input', placeholder: 'Coller ou taper un emoji' });
        free.addEventListener('keydown', (e) => { if (e.key === 'Enter' && free.value.trim()) finish(free.value.trim()); });
        content.append(free, h('div', { class: 'ip-grid emoji' }, EMOJIS.map((e) => h('button', { class: 'ip-cell', onclick: () => finish(e) }, e))));
      } else {
        // collection personnelle et persistante : toute image importée y est gardée pour être réutilisée sans nouvel envoi
        const { api } = await import('./api.js');
        const url = h('input', { class: 'input', placeholder: 'https://… ou /files/…' });
        const file = h('input', { type: 'file', accept: 'image/*', hidden: true });
        const saved = h('div', { class: 'ip-saved' });
        // recolorer toute l'icône : choisissez une couleur, puis cliquez sur une icône SVG (une copie recolorée est créée)
        let tint = null;
        const tintOpts = [null, ...Object.keys(ICON_COLORS)];
        const tintBar = h('div', { class: 'ip-colors' }, [
          ...tintOpts.map((c) => h('button', { class: 'ip-sw' + (c === null ? ' on' : ''), title: c ? 'Recolorer en ' + c : 'Couleur d’origine', style: `background:${c ? ICON_COLORS[c] : 'var(--fg)'}`,
            onclick: () => { tint = c; tintBar.querySelectorAll('.ip-sw').forEach((b, i) => b.classList.toggle('on', tintOpts[i] === c)); drawSaved(); } })),
          h('input', { type: 'color', class: 'ip-color-in', title: 'Autre couleur', value: '#337ea9', oninput: (e) => { tint = e.target.value; tintBar.querySelectorAll('.ip-sw').forEach((b) => b.classList.remove('on')); drawSaved(); } })]);
        const keep = (u, name) => api.post('/api/pages/icons/collection', { url: u, name }).catch(() => null);
        const drawSaved = async () => {
          let list = []; try { list = await api.get('/api/pages/icons/collection'); } catch { /* hors ligne */ }
          const tintCss = () => tint ? (ICON_COLORS[tint] || tint) : null;
          const cell = (i) => h('div', { class: 'ip-cell-wrap' },
            h('button', { class: 'ip-cell', title: i.name || 'Icône personnalisée', onclick: async () => {
              if (!(tint && i.svg)) return finish(i.url);
              try { const r = await api.post('/api/pages/icons/recolor', { url: i.url, color: tint }); finish(r.url); } catch (e) { alert(e.message); }
            } }, tint && i.svg
              ? h('span', { class: 'ip-tint', style: `background:${tintCss()};-webkit-mask:url(${i.url}) center/contain no-repeat;mask:url(${i.url}) center/contain no-repeat` })
              : h('img', { src: i.url, alt: '', width: 28, height: 28 })),
            h('button', { class: 'ip-del', title: 'Retirer de la collection', 'aria-label': 'Retirer de la collection', onclick: async () => { try { await api.del('/api/pages/icons/collection/' + i.id); drawSaved(); } catch (e) { alert(e.message); } } }, '×'));
          const imported = list.filter((i) => i.source === 'import'), mine = list.filter((i) => i.source !== 'import');
          const section = (title, items, empty) => [h('div', { class: 'ip-sub' }, title + (items.length ? ' (' + items.length + ')' : '')), items.length ? h('div', { class: 'ip-grid custom' }, items.map(cell)) : h('div', { class: 'muted small pad' }, empty)];
          saved.replaceChildren(...section('Importées (Notion et autres transferts)', imported, 'Aucune icône importée pour le moment.'), ...section('Mes images', mine, 'Aucune image envoyée : importez-en une ci-dessous, elle sera gardée ici.'));
        };
        file.addEventListener('change', async () => {
          if (!file.files[0]) return;
          try { const up = await api.upload(file.files[0]); await keep(up.url, up.name || file.files[0].name); finish(up.url); } catch (e) { alert(e.message); }
        });
        content.append(h('div', { class: 'ip-sub' }, 'Recolorer une icône SVG : choisissez une couleur, puis cliquez sur l’icône'), tintBar, saved,
          h('div', { class: 'ip-sub' }, 'Ajouter'),
          h('div', { class: 'share-row' }, h('button', { class: 'btn', onclick: () => file.click() }, 'Importer une image'), file, h('span', { class: 'muted small' }, 'carrée de préférence ; elle est enregistrée dans votre collection')),
          h('div', { class: 'ip-sub' }, 'Icône Notion par son nom'),
          (() => {
            const nm = h('input', { class: 'input', placeholder: 'ex. chevrons-vertical, folder, database…' });
            const col = h('select', { class: 'input', style: 'max-width:110px' }, ['orange', 'gray', 'lightgray', 'brown', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'].map((c) => h('option', { value: c }, c)));
            const msg = h('span', { class: 'muted small' }, 'téléchargée depuis Notion, gardée dans « Importées »');
            return h('div', { class: 'share-row' }, nm, col, h('button', { class: 'btn', onclick: async () => {
              if (!nm.value.trim()) return;
              msg.textContent = 'Téléchargement…';
              try { await api.post('/api/pages/icons/notion', { name: nm.value, color: col.value }); nm.value = ''; msg.textContent = 'Ajoutée ✓'; drawSaved(); } catch (e) { msg.textContent = e.message; }
            } }, 'Ajouter'), msg);
          })(),
          h('div', { class: 'share-row' }, url, h('button', { class: 'btn primary', onclick: async () => { const u = safeUrl(url.value); if (u) { await keep(u, ''); finish(u); } } }, 'Utiliser')));
        drawSaved();
      }
    };
    draw();
  });
}
