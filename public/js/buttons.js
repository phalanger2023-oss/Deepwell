/**
 * Blocs « bouton » : une mini-automatisation. La configuration (nom + suite d'actions) est enregistrée dans le bloc
 * ({ label, color, actions: [...] }) ; un clic exécute les actions dans l'ordre.
 *
 * Actions : insert_blocks · add_page (avec modèle au choix) · add_subpage · edit_property · open_page · open_url · confirm · notify
 * Variables utilisables dans les textes : {{date}} {{date_longue}} {{heure}} {{utilisateur}} {{titre}}
 */
import { h, modal, toast, confirmBox, safeUrl, uuid } from './util.js';
import { plainRt } from './richtext.js';
import { vi } from './icons.js';

export const ACTION_TYPES = [
  ['insert_blocks', 'Ajouter des blocs à cette page', 'plus'],
  ['add_page', 'Ajouter une page à une base de données', 'file-plus'],
  ['add_subpage', 'Créer une sous-page de cette page', 'file-plus'],
  ['edit_property', 'Modifier une propriété de cette page', 'pencil'],
  ['open_page', 'Ouvrir une page', 'file-text'],
  ['open_url', 'Ouvrir un lien', 'external-link'],
  ['confirm', 'Demander confirmation', 'shield-check'],
  ['notify', 'Afficher un message', 'message-square'],
];
const TYPE_LABEL = Object.fromEntries(ACTION_TYPES.map(([k, l]) => [k, l]));
const WHERE = [['below', 'Sous le bouton'], ['end', 'À la fin de la page'], ['start', 'Au début de la page']];
export const BUTTON_COLORS = [['default', 'Gris'], ['blue', 'Bleu'], ['green', 'Vert'], ['red', 'Rouge'], ['orange', 'Orange'], ['purple', 'Violet']];

const pad = (n) => String(n).padStart(2, '0');
/** Remplace les variables {{…}} par leur valeur du moment. */
export function expandTokens(text, vars = {}) {
  const d = new Date();
  const v = { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, date_longue: d.toLocaleDateString('fr-FR', { dateStyle: 'long' }),
    heure: `${pad(d.getHours())}:${pad(d.getMinutes())}`, utilisateur: '', titre: '', ...vars };
  return String(text ?? '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k) => (k.toLowerCase() in v ? v[k.toLowerCase()] : m));
}

/** Texte « Markdown léger » → liste de [type, texte, extra]. */
export function parseBlocksText(text) {
  const out = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, ''); if (!line.trim()) continue;
    let m;
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) out.push([`heading_${m[1].length}`, m[2]]);
    else if ((m = /^[-*•]\s+(.*)$/.exec(line))) out.push(['bulleted_list_item', m[1]]);
    else if ((m = /^\d+[.)]\s+(.*)$/.exec(line))) out.push(['numbered_list_item', m[1]]);
    else if ((m = /^\[(x| ?)\]\s*(.*)$/i.exec(line))) out.push(['to_do', m[2], { checked: m[1].toLowerCase() === 'x' }]);
    else if ((m = /^>\s+(.*)$/.exec(line))) out.push(['quote', m[1]]);
    else if (/^(-{3,}|_{3,})$/.test(line.trim())) out.push(['divider', '']);
    else out.push(['paragraph', line]);
  }
  return out;
}

/** Éléments [type, texte, extra] (parseBlocksText) → blocs prêts à être enregistrés sur une page (format de l'éditeur). */
export function blocksFromItems(items) {
  return items.map(([type, text, extra]) => {
    const rich = { rich_text: plainRt(text), color: 'default' };
    const content = type === 'divider' ? {} : type.startsWith('heading_') ? { ...rich, is_toggleable: false } : type === 'to_do' ? { ...rich, checked: false, ...(extra || {}) } : type === 'paragraph' ? { ...rich, icon: null } : rich;
    return { id: uuid(), parent_id: null, type, content };
  });
}

/** Texte saisi → valeur de propriété au format Notion (selon le type de la propriété). */
export function valueFor(def, text) {
  const t = String(text ?? '').trim(), type = def.type;
  switch (type) {
    case 'title': case 'rich_text': return { type, [type]: plainRt(String(text ?? '')) };
    case 'number': { const n = t === '' ? null : Number(t.replace(',', '.')); if (Number.isNaN(n)) throw new Error(`« ${t} » n’est pas un nombre`); return { type, number: n }; }
    case 'checkbox': return { type, checkbox: /^(1|true|oui|vrai|x|✓|coché|cochée)$/i.test(t) };
    case 'select': case 'status': {
      if (!t) return { type, [type]: null };
      return { type, [type]: (def[type]?.options || []).find((o) => o.name.toLowerCase() === t.toLowerCase()) || { name: t, color: 'default' } };
    }
    case 'multi_select': {
      const opts = def.multi_select?.options || [];
      return { type, multi_select: t.split(',').map((s) => s.trim()).filter(Boolean).map((n) => opts.find((o) => o.name.toLowerCase() === n.toLowerCase()) || { name: n, color: 'default' }) };
    }
    case 'date': return { type, date: t ? { start: t, end: null, time_zone: null } : null };
    case 'url': case 'email': case 'phone_number': return { type, [type]: t || null };
    default: return undefined; // formules, relations, personnes… non modifiables par un bouton
  }
}

/** Résumé d'une action (liste, infobulle). */
export function describe(a) {
  switch (a.type) {
    case 'insert_blocks': return `Ajouter ${parseBlocksText(a.text).length} bloc(s) — ${(WHERE.find(([k]) => k === (a.where || 'below')) || WHERE[0])[1].toLowerCase()}`;
    case 'add_page': return `Ajouter une page « ${a.title || a.template_title || 'sans titre'} » dans ${a.database_title || 'une base'}${a.template_id ? ` (modèle : ${a.template_title || '…'})` : ''}`;
    case 'add_subpage': return `Créer la sous-page « ${a.title || 'sans titre'} »`;
    case 'edit_property': return `${a.prop || '?'} ← ${a.value ?? ''}`;
    case 'open_page': return `Ouvrir « ${a.title || 'une page'} »`;
    case 'open_url': return `Ouvrir ${a.url || 'un lien'}`;
    case 'confirm': return `Confirmer : ${a.message || 'Exécuter ce bouton ?'}`;
    case 'notify': return `Message : ${a.message || ''}`;
    default: return TYPE_LABEL[a.type] || a.type;
  }
}

/**
 * Exécute les actions d'un bouton dans l'ordre. `env` : { hooks, vars(), insert(blocks, where) }.
 * Une action en échec interrompt la suite ; « confirmation » refusée aussi. Renvoie true si tout s'est exécuté.
 */
export async function runButton(content, env) {
  const acts = content.actions || [];
  const vars = env.vars?.() || {};
  const ex = (a) => JSON.parse(JSON.stringify(a, (k, v) => (typeof v === 'string' && k !== 'type' ? expandTokens(v, vars) : v)));
  for (const raw of acts) {
    const a = ex(raw);
    try {
      switch (a.type) {
        case 'confirm': if (!(await confirmBox(a.message || 'Exécuter ce bouton ?'))) { toast('Bouton annulé'); return false; } break;
        case 'insert_blocks': env.insert(parseBlocksText(a.text), a.where || 'below'); break;
        case 'notify': toast(a.message || 'Fait'); break;
        case 'open_url': { const u = safeUrl(a.url); if (!u) throw new Error('adresse invalide'); window.open(u, '_blank', 'noopener'); break; }
        case 'open_page': if (!a.page_id) throw new Error('aucune page choisie'); await env.hooks.afterButton?.(); location.hash = `#/page/${a.page_id}`; return true;
        case 'add_page': case 'edit_property':
          if (!env.hooks.buttonAction) throw new Error('action indisponible ici');
          await env.hooks.buttonAction(a); break;
        case 'add_subpage': {
          if (!env.hooks.buttonAction) throw new Error('action indisponible ici');
          const p = await env.hooks.buttonAction(a);
          env.insert([['child_page', '', { title: p?.title || a.title || 'Sans titre', page_id: p.id }]], a.where || 'below'); // lien vers la sous-page dans la page du bouton
          if (a.open) { await env.hooks.saveNow?.(); location.hash = `#/page/${p.id}`; return true; }
          break;
        }
        default: throw new Error(`action inconnue (${a.type})`);
      }
    } catch (e) { toast(`Bouton interrompu — ${TYPE_LABEL[a.type] || a.type} : ${e.message}`, 'error'); return false; }
  }
  await env.hooks.afterButton?.();
  return true;
}

/** Fenêtre de configuration : nom, couleur, actions (ajout, ordre, suppression). Résout le contenu mis à jour, ou null. */
export function buttonDialog(content, hooks = {}) {
  return new Promise((resolve) => {
    const c = JSON.parse(JSON.stringify(content || {}));
    c.actions ||= [];
    let done = false;
    const finish = (v) => { if (done) return; done = true; m.close(); resolve(v); };
    const body = h('div', { class: 'btn-dlg' });
    const m = modal('Configurer le bouton', body, { wide: true, onClose: () => finish(null) });
    let dbs = null; const schemas = new Map(), tpls = new Map();
    const getDbs = async () => (dbs ||= await (hooks.listDatabases?.() ?? []).catch(() => []));
    const getSchema = async (id) => {
      if (!id) return null;
      if (!schemas.has(id)) schemas.set(id, await (hooks.loadDatabase?.(id) ?? Promise.resolve(null)).then((d) => d?.schema || null).catch(() => null));
      return schemas.get(id);
    };
    const getTemplates = async (id) => { if (!id) return []; if (!tpls.has(id)) tpls.set(id, await (hooks.listTemplates?.(id) ?? Promise.resolve([])).catch(() => [])); return tpls.get(id); };
    const field = (label, el, hint) => h('label', { class: 'btn-field' }, h('span', { class: 'btn-fl' }, label), el, hint ? h('span', { class: 'muted small' }, hint) : null);
    const input = (a, key, ph = '') => { const i = h('input', { class: 'input', value: a[key] ?? '', placeholder: ph }); i.addEventListener('input', () => { a[key] = i.value; }); return i; };
    const select = (a, key, options, onchange) => {
      const s = h('select', { class: 'input' }, options.map(([v, l]) => h('option', { value: v, selected: (a[key] ?? options[0][0]) === v }, l)));
      s.addEventListener('change', () => { a[key] = s.value; onchange?.(); }); return s;
    };
    const VARS = 'Variables : {{date}} {{date_longue}} {{heure}} {{utilisateur}} {{titre}}';

    async function draw() {
      await getDbs();
      for (const a of c.actions) if (a.type === 'add_page') { await getSchema(a.database_id); await getTemplates(a.database_id); }
      const pageSchema = hooks.pageSchema?.() || null;
      const label = h('input', { class: 'input', value: c.label ?? '', placeholder: 'Nom du bouton' });
      label.addEventListener('input', () => { c.label = label.value; });
      const color = h('div', { class: 'btn-colors' }, BUTTON_COLORS.map(([k, l]) => h('button', { type: 'button', class: `btn-sw nb-${k} ${(c.color || 'default') === k ? 'on' : ''}`, title: l, 'aria-label': l, onclick: () => { c.color = k; draw(); } })));

      const card = (a, i) => {
        const f = [];
        switch (a.type) {
          case 'insert_blocks':
            f.push(field('Contenu', (() => { const t = h('textarea', { class: 'input', rows: 5, placeholder: '## Titre\n- point\n[] à faire\nUn paragraphe…' }, a.text || ''); t.addEventListener('input', () => { a.text = t.value; }); return t; })(),
              `Une ligne = un bloc ; # titres, - puces, 1. numérotée, [] à faire, > citation, --- séparateur. ${VARS}`),
              field('Où', select(a, 'where', WHERE)));
            break;
          case 'add_page': {
            const sch = schemas.get(a.database_id), keys = sch ? Object.keys(sch).filter((k) => sch[k].type !== 'title') : [];
            f.push(field('Base de données', select(a, 'database_id', [['', '— choisir —'], ...(dbs || []).map((d) => [d.id, d.title || 'Sans titre'])], () => { a.database_title = (dbs || []).find((d) => d.id === a.database_id)?.title || ''; a.props = []; draw(); })),
              ...(a.database_id ? [field('Modèle', select(a, 'template_id', [['', 'Page vide'], ...(tpls.get(a.database_id) || []).map((t) => [t.id, t.title || 'Sans titre'])], () => { a.template_title = (tpls.get(a.database_id) || []).find((t) => t.id === a.template_id)?.title || ''; draw(); }),
                a.template_id ? 'La page reprend le contenu et les propriétés du modèle ; la date du jour remplace « @Today ».' : 'Les modèles se créent avec la flèche à côté de « Nouvelle ligne » dans la base.')] : []),
              field('Titre de la page', input(a, 'title', a.template_id ? 'laisser vide = titre du modèle' : 'ex. Entrée du {{date_longue}}'), VARS));
            a.props ||= [];
            if (a.database_id) {
              f.push(h('div', { class: 'btn-props' }, h('div', { class: 'btn-fl' }, 'Propriétés'),
                a.props.map((p, j) => h('div', { class: 'btn-prop' },
                  (() => { const s = h('select', { class: 'input' }, [h('option', { value: '' }, '— propriété —'), ...keys.map((k) => h('option', { value: k, selected: p.name === k }, k))]); s.addEventListener('change', () => { p.name = s.value; }); return s; })(),
                  input(p, 'value', 'valeur (ex. {{date}})'),
                  h('button', { type: 'button', class: 'icon-btn', title: 'Retirer', onclick: () => { a.props.splice(j, 1); draw(); } }, vi('x', 14)))),
                keys.length ? h('button', { type: 'button', class: 'btn small', onclick: () => { a.props.push({ name: keys[0], value: '' }); draw(); } }, '＋ Propriété') : h('span', { class: 'muted small' }, 'Cette base n’a pas d’autre propriété.')));
            }
            f.push(h('label', { class: 'check' }, (() => { const x = h('input', { type: 'checkbox' }); x.checked = !!a.open; x.addEventListener('change', () => { a.open = x.checked; }); return x; })(), 'Ouvrir la page créée'));
            break;
          }
          case 'add_subpage':
            f.push(field('Titre de la sous-page', input(a, 'title', 'ex. Note du {{date_longue}}'), VARS),
              field('Contenu de départ (facultatif)', (() => { const t = h('textarea', { class: 'input', rows: 4, placeholder: '## Titre\n- point\n[] à faire' }, a.text || ''); t.addEventListener('input', () => { a.text = t.value; }); return t; })(), 'Une ligne = un bloc, comme pour « Ajouter des blocs ».'),
              field('Où mettre le lien vers la sous-page', select(a, 'where', WHERE)),
              h('label', { class: 'check' }, (() => { const x = h('input', { type: 'checkbox' }); x.checked = !!a.open; x.addEventListener('change', () => { a.open = x.checked; }); return x; })(), 'Ouvrir la sous-page créée'));
            break;
          case 'edit_property': {
            const dl = h('datalist', { id: `pl-${i}` }, Object.keys(pageSchema || {}).map((k) => h('option', { value: k })));
            const p = input(a, 'prop', 'Nom de la propriété'); p.setAttribute('list', `pl-${i}`);
            f.push(field('Propriété', h('div', {}, p, dl), pageSchema ? 'Cette page est une ligne de base de données : choisissez une de ses propriétés.' : 'Ne fonctionne que sur une page qui est une ligne de base de données.'),
              field('Nouvelle valeur', input(a, 'value', 'ex. Terminé, oui, {{date}}, 42'), 'Case à cocher : oui/non. Date : {{date}} ou AAAA-MM-JJ. Liste : le nom de l’option.'));
            break;
          }
          case 'open_page':
            f.push(field('Page', h('button', { type: 'button', class: 'btn', onclick: async () => { const r = await hooks.pickPage?.(); if (r) { a.page_id = r.id; a.title = r.title; draw(); } } }, a.title || (a.page_id ? 'Page choisie' : 'Choisir une page…'))));
            break;
          case 'open_url': f.push(field('Adresse', input(a, 'url', 'https://…'))); break;
          case 'confirm': f.push(field('Question', input(a, 'message', 'Voulez-vous vraiment continuer ?'), 'Si l’utilisateur refuse, les actions suivantes ne sont pas exécutées.')); break;
          case 'notify': f.push(field('Message', input(a, 'message', 'Fait !'), VARS)); break;
        }
        const move = (d) => { const j = i + d; if (j < 0 || j >= c.actions.length) return; [c.actions[i], c.actions[j]] = [c.actions[j], c.actions[i]]; draw(); };
        return h('div', { class: 'btn-act' },
          h('div', { class: 'btn-act-head' }, h('span', { class: 'btn-act-n' }, String(i + 1)), vi((ACTION_TYPES.find(([k]) => k === a.type) || [])[2] || 'zap', 16), h('b', {}, TYPE_LABEL[a.type] || a.type), h('span', { class: 'ip-spacer' }),
            h('button', { type: 'button', class: 'icon-btn', title: 'Monter', disabled: i === 0, onclick: () => move(-1) }, vi('chevron-up', 14)),
            h('button', { type: 'button', class: 'icon-btn', title: 'Descendre', disabled: i === c.actions.length - 1, onclick: () => move(1) }, vi('chevron-down', 14)),
            h('button', { type: 'button', class: 'icon-btn', title: 'Supprimer l’action', onclick: () => { c.actions.splice(i, 1); draw(); } }, vi('trash-2', 14))),
          ...f);
      };
      const add = h('select', { class: 'input btn-add' }, h('option', { value: '' }, '＋ Ajouter une action…'), ACTION_TYPES.map(([k, l]) => h('option', { value: k }, l)));
      add.addEventListener('change', () => { if (add.value) { c.actions.push({ type: add.value, ...(add.value === 'insert_blocks' || add.value === 'add_subpage' ? { where: 'below' } : {}) }); draw(); } });
      body.replaceChildren(...[
        c.imported && !c.actions.length ? h('div', { class: 'btn-note' }, h('b', {}, 'Bouton importé de Notion. '), 'L’API de Notion ne communique ni le nom ni les actions d’un bouton : seul son emplacement a pu être conservé. Reconstituez ses actions ci-dessous ; elles seront gardées lors des prochains imports.') : null,
        field('Nom du bouton', label), h('div', { class: 'btn-field' }, h('span', { class: 'btn-fl' }, 'Couleur'), color),
        h('div', { class: 'btn-fl' }, 'Actions (exécutées dans l’ordre au clic)'),
        c.actions.length ? c.actions.map(card) : h('div', { class: 'muted pad' }, 'Aucune action : ajoutez-en une pour que le bouton fasse quelque chose.'),
        add,
        h('div', { class: 'row-end' }, h('button', { class: 'btn', onclick: () => finish(null) }, 'Annuler'),
          h('button', { class: 'btn primary', onclick: () => {
            c.label = (c.label || '').trim() || 'Bouton';
            if (c.actions.length || c.label !== 'Bouton Notion') delete c.imported;
            finish(c);
          } }, 'Enregistrer')),
      ].flat().filter(Boolean));
    }
    draw();
  });
}
