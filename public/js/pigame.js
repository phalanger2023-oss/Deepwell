// Jeu de mémorisation des décimales de π : « Apprendre » (voir par blocs) et « Réciter » (taper de mémoire), avec historique.
import { h, toast, confirmBox, fmtDate } from './util.js';
import { api } from './api.js';

/** Décimales de π (après « 3. »), calculées avec la formule de Machin en BigInt : aucune table à recopier, donc aucune faute possible. */
export function piDigits(n) {
  const guard = 12, scale = 10n ** BigInt(n + guard);
  const arctanInv = (x) => { // arctan(1/x) * scale
    const x2 = BigInt(x * x); let term = scale / BigInt(x), sum = term, k = 1n, sign = -1n;
    while (term !== 0n) { term /= x2; k += 2n; sum += (sign * term) / k; sign = -sign; }
    return sum;
  };
  const pi = 4n * (4n * arctanInv(5) - arctanInv(239));
  return (pi / 10n ** BigInt(guard)).toString().slice(1, n + 1); // retire le « 3 »
}

/** Champ numérique libre (validé à la sortie du champ ou avec Entrée) : borné entre min et max. */
const numBox = (cur, min, max, fn) => {
  const el = h('input', { class: 'input pi-num', type: 'number', min, max, step: 1, value: cur, inputmode: 'numeric', 'aria-label': 'Nombre personnalisé' });
  el.addEventListener('change', () => { const v = Math.round(Number(el.value)); if (!Number.isFinite(v) || el.value === '') { el.value = cur; return; } fn(Math.min(max, Math.max(min, v))); });
  return el;
};
const group = (s, size = 5) => s.match(new RegExp(`.{1,${size}}`, 'g')) || [];
const fmtT = (s) => (s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.round(s * 10) / 10} s`);

// Sans compte (lien public) : l'historique reste dans ce navigateur ; avec un compte : sur le serveur, commun à toutes les pages π.
const LOCAL_KEY = 'dw_pi_runs';
const localRuns = () => { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch { return []; } };
const store = (local) => local ? {
  get: async () => { const runs = localRuns().sort((a, b) => b.at - a.at); return { runs, best: Math.max(0, ...runs.filter((r) => r.mode === 'recall').map((r) => r.digits)) }; },
  post: async (r) => { const run = { id: Math.random().toString(36).slice(2), at: Date.now(), ...r }; try { localStorage.setItem(LOCAL_KEY, JSON.stringify([run, ...localRuns()].slice(0, 200))); } catch {} return run; },
  del: async () => { try { localStorage.removeItem(LOCAL_KEY); } catch {} },
} : { get: () => api.get('/api/pi'), post: (r) => api.post('/api/pi', r), del: () => api.del('/api/pi') };

export async function tabPi(p, { section, local = false, dev = false, publicToken = '' }) {
  const st = store(local);
  const MAX = 1000;
  const PI = piDigits(MAX);
  const state = { mode: 'recall', lives: 0, target: 50, chunk: 5, shown: 20 };
  const play = h('div', { class: 'pi-play' }), hist = h('div', {});
  const tabs = h('div', { class: 'pi-tabs' });
  const setMode = (m) => { state.mode = m; drawTabs(); drawPlay(); };
  const drawTabs = () => tabs.replaceChildren(...[['learn', 'Apprendre'], ['recall', 'Réciter de mémoire']].map(([k, l]) => h('button', { class: `btn${state.mode === k ? ' primary' : ''}`, onclick: () => setMode(k) }, l)));

  const save = async (r) => { try { await st.post(r); drawHist(); drawBoard(); drawDev(); } catch (e) { toast(e.message, 'error'); } };

  /** Taille des blocs de chiffres (commune à « Apprendre » et « Réciter ») : liste + nombre précis (1 à 50). */
  const chunkPicker = (redraw) => h('label', {}, 'Taille des blocs ',
    h('select', { class: 'input', onchange: (e) => { state.chunk = Number(e.target.value); redraw(); } }, [...new Set([3, 4, 5, 10, state.chunk])].sort((a, b) => a - b).map((v) => h('option', { value: v, selected: v === state.chunk }, `${v} chiffres`))),
    ' ou ', numBox(state.chunk, 1, 50, (v) => { state.chunk = v; redraw(); }));

  // ---------- Apprendre : les décimales apparaissent par blocs, on en affiche davantage au fur et à mesure ----------
  const drawLearn = () => {
    const t0 = Date.now();
    const lines = h('div', { class: 'pi-digits' });
    const countEl = h('span', { class: 'muted small' });
    const countIn = numBox(state.shown, 1, MAX, (v) => { state.shown = v; paint(); });
    const paint = () => {
      countEl.textContent = `${state.shown} décimales affichées`; countIn.value = state.shown;
      const g = group(PI.slice(0, state.shown), state.chunk);
      lines.replaceChildren(h('span', { class: 'pi-int' }, '3,'), ...g.map((c, i) => h('span', { class: `pi-chunk${i === g.length - 1 ? ' last' : ''}` }, c)));
    };
    paint();
    play.replaceChildren(
      h('p', { class: 'muted' }, 'Lisez à voix haute, par petits blocs. Quand un bloc est acquis, affichez-en d’autres. Passez ensuite en « Réciter » pour vous tester.'),
      h('div', { class: 'pi-row' }, chunkPicker(drawLearn),
        h('button', { class: 'btn', onclick: () => { state.shown = Math.min(MAX, state.shown + state.chunk * 2); paint(); } }, `+ ${state.chunk * 2} décimales`),
        h('button', { class: 'btn', onclick: () => { state.shown = Math.max(state.chunk, state.shown - state.chunk * 2); paint(); } }, '− moins'),
        h('button', { class: 'btn', onclick: () => { state.shown = Math.min(MAX, 20); paint(); } }, 'Recommencer à 20'),
        h('label', {}, 'Nombre précis ', countIn, ` (1 à ${MAX})`)),
      lines,
      h('div', { class: 'row-end' }, countEl, h('button', { class: 'btn primary', onclick: async () => { await save({ mode: 'learn', digits: state.shown, target: state.shown, seconds: (Date.now() - t0) / 1000, errors: 0 }); toast('Séance d’apprentissage enregistrée'); } }, 'Terminer la séance')));
  };

  // ---------- Réciter : on tape les décimales ; la première erreur (ou la dernière vie perdue) termine la partie ----------
  let focusInput = null; // le clavier de saisie (champ caché) de la partie en cours
  play.addEventListener('click', (e) => { if (state.mode === 'recall' && focusInput && !e.target.closest('select, option, label, button, a, input')) focusInput(); }); // jamais en cliquant sur un menu : ça le refermait aussitôt
  const drawRecall = () => {
    let idx = 0, errs = 0, t0 = 0, over = false;
    const typed = h('div', { class: 'pi-digits pi-typed' }), msg = h('div', { class: 'pi-msg' }), stat = h('div', { class: 'muted small' });
    const input = h('input', { class: 'pi-hidden', inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'Décimales de π' });
    const paint = (miss) => {
      typed.replaceChildren(h('span', { class: 'pi-int' }, '3,'), ...group(PI.slice(0, idx), state.chunk).map((c) => h('span', { class: 'pi-chunk ok' }, c)), miss ? h('span', { class: 'pi-chunk bad' }, miss) : h('span', { class: 'pi-cursor' }, '▍'));
      stat.textContent = `${idx} / ${state.target} décimales · ${errs} erreur(s)${state.lives ? ` sur ${state.lives}` : ''}`;
    };
    const finish = async (won) => {
      over = true; const secs = t0 ? (Date.now() - t0) / 1000 : 0;
      msg.className = `pi-msg ${won ? 'win' : 'lose'}`;
      msg.replaceChildren(won ? `Bravo ! ${state.target} décimales sans faute en ${fmtT(secs)}.` : `Terminé : ${idx} décimale(s) juste(s) en ${fmtT(secs)}. La suivante était ${PI[idx]}.`, ' ', h('button', { class: 'btn', onclick: drawRecall }, 'Rejouer'));
      await save({ mode: 'recall', digits: idx, target: state.target, seconds: secs, errors: errs });
    };
    const press = (d) => {
      if (over) return;
      if (!t0) t0 = Date.now();
      if (PI[idx] === d) { idx++; paint(); if (idx >= state.target) finish(true); }
      else { // l'erreur qui met fin à la partie n'est pas comptée dans l'historique ; seules les erreurs permises (droit à l'erreur) le sont
        const fatal = errs + 1 > state.lives;
        if (!fatal) errs++;
        msg.textContent = ''; paint(d); play.classList.add('shake'); setTimeout(() => { play.classList.remove('shake'); if (!over) paint(); }, 350);
        if (fatal) finish(false);
      }
    };
    input.addEventListener('input', () => { for (const c of input.value) if (/\d/.test(c)) press(c); input.value = ''; });
    input.addEventListener('keydown', (e) => { if (e.key === 'Backspace') e.preventDefault(); });
    const keypad = h('div', { class: 'pi-keypad' }, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', ''].map((k) => (k ? h('button', { class: 'btn', onclick: () => { press(k); input.focus({ preventScroll: true }); } }, k) : h('span'))));
    const sel = (opts, cur, fn) => h('select', { class: 'input', onchange: (e) => fn(Number(e.target.value)) }, opts.map(([v, l]) => h('option', { value: v, selected: v === cur }, l)));
    play.replaceChildren(
      h('div', { class: 'pi-row' },
        h('label', {}, 'Objectif ', sel([...new Set([10, 20, 30, 50, 100, 200, 500, 1000, state.target])].sort((a, b) => a - b).map((v) => [v, `${v} décimales`]), state.target, (v) => { state.target = v; drawRecall(); }),
          ' ou ', numBox(state.target, 1, MAX, (v) => { state.target = v; drawRecall(); }), ` (1 à ${MAX})`),
        chunkPicker(drawRecall),
        h('label', {}, 'Droit à l’erreur ', sel([...new Set([0, 1, 3, state.lives])].sort((a, b) => a - b).map((v) => [v, v === 0 ? 'aucune (parfait)' : `${v} erreur${v > 1 ? 's' : ''}`]), state.lives, (v) => { state.lives = v; drawRecall(); }),
          ' ou ', numBox(state.lives, 0, 100, (v) => { state.lives = v; drawRecall(); }))),
      h('p', { class: 'muted' }, 'Tapez les décimales de π de mémoire (après « 3, »). Le chronomètre démarre à la première touche.'),
      typed, msg, stat, input, keypad);
    paint(); setTimeout(() => { if (!document.activeElement?.closest?.('select, .pi-num')) input.focus({ preventScroll: true }); }, 50);
    focusInput = () => input.focus({ preventScroll: true });
  };
  const drawPlay = () => (state.mode === 'learn' ? drawLearn() : drawRecall());

  // ---------- Historique ----------
  const drawHist = async () => {
    let d; try { d = await st.get(); } catch (e) { return hist.replaceChildren(h('div', { class: 'form-err' }, e.message)); }
    const rec = d.runs.filter((r) => r.mode === 'recall').slice().reverse();
    const bars = h('div', { class: 'pi-bars' }, rec.slice(-30).map((r) => h('div', { class: 'pi-bar', title: `${r.digits} décimales — ${fmtDate(r.at)}`, style: `height:${Math.max(4, (r.digits / Math.max(d.best, 1)) * 60)}px` })));
    hist.replaceChildren(
      h('div', { class: 'st-grid' },
        h('div', { class: 'st-card ok' }, h('div', { class: 'st-l' }, 'Record'), h('div', { class: 'st-v' }, `${d.best} décimales`), h('div', { class: 'st-s muted small' }, 'meilleure récitation')),
        h('div', { class: 'st-card' }, h('div', { class: 'st-l' }, 'Parties'), h('div', { class: 'st-v' }, String(rec.length)), h('div', { class: 'st-s muted small' }, `${d.runs.length - rec.length} séance(s) d’apprentissage`))),
      rec.length > 1 ? h('div', {}, h('div', { class: 'muted small' }, 'Progression (30 dernières récitations)'), bars) : null,
      d.runs.length ? h('table', { class: 'plain' }, h('tbody', {}, d.runs.slice(0, 40).map((r) => h('tr', {},
        h('td', { class: 'muted small' }, fmtDate(r.at)), h('td', {}, r.mode === 'recall' ? 'Récitation' : 'Apprentissage'),
        h('td', {}, r.mode === 'recall' ? `${r.digits} / ${r.target} décimales` : `${r.digits} décimales vues`), h('td', { class: 'muted small' }, fmtT(r.seconds)),
        h('td', { class: 'muted small' }, r.mode === 'recall' ? (r.errors ? `${r.errors} erreur(s)` : 'sans faute') : ''))))) : h('p', { class: 'muted' }, 'Aucune partie pour l’instant.'),
      d.runs.length ? h('button', { class: 'btn danger small', onclick: async () => { if (await confirmBox('Effacer tout l’historique du jeu ?')) { await st.del(); drawHist(); } } }, 'Effacer l’historique') : null);
  };


  // ---------- Classement : tous les comptes ----------
  const board = h('div', {}), devBox = h('div', {});
  const fmtBest = (x) => (x.best ? `${x.best}` : '—');
  const drawBoard = async () => {
    if (local && !publicToken) return;
    let d; try { d = await api.get(local ? `/api/pi/public-leaderboard?token=${encodeURIComponent(publicToken)}` : '/api/pi/leaderboard'); } catch (e) { return board.replaceChildren(h('div', { class: 'form-err' }, e.message)); }
    if (!d.players.length) return board.replaceChildren(h('p', { class: 'muted' }, 'Personne n’a encore joué.'));
    const tot = d.players.reduce((a, x) => ({ runs: a.runs + x.recall_runs + x.learn_runs, digits: a.digits + x.total_digits, secs: a.secs + x.total_seconds }), { runs: 0, digits: 0, secs: 0 });
    board.replaceChildren(
      h('div', { class: 'st-grid' },
        h('div', { class: 'st-card' }, h('div', { class: 'st-l' }, 'Joueurs'), h('div', { class: 'st-v' }, String(d.players.length))),
        h('div', { class: 'st-card' }, h('div', { class: 'st-l' }, 'Parties jouées'), h('div', { class: 'st-v' }, String(tot.runs))),
        h('div', { class: 'st-card' }, h('div', { class: 'st-l' }, 'Décimales récitées'), h('div', { class: 'st-v' }, String(tot.digits)), h('div', { class: 'st-s muted small' }, `en ${fmtT(tot.secs)} au total`))),
      h('table', { class: 'plain pi-board' }, h('thead', {}, h('tr', {}, ['#', 'Joueur', 'Record', 'Parties', 'Victoires', 'Vitesse', 'Dernière partie'].map((t) => h('th', { class: 'muted small' }, t)))),
        h('tbody', {}, d.players.map((x, i) => h('tr', { class: x.me ? 'pi-me' : '' },
          h('td', {}, i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : String(i + 1)), h('td', {}, x.name + (x.me ? ' (vous)' : '')),
          h('td', {}, h('b', {}, fmtBest(x)), x.best_seconds != null ? h('span', { class: 'muted small' }, ` en ${fmtT(x.best_seconds)}`) : null),
          h('td', {}, String(x.recall_runs + x.learn_runs)), h('td', {}, `${x.wins} / ${x.recall_runs}`), h('td', { class: 'muted' }, x.digits_per_min ? `${x.digits_per_min} déc./min` : '—'),
          h('td', { class: 'muted small' }, x.last_at ? fmtDate(x.last_at) : '—'))))));
  };
  // ---------- Mode développeur : le détail de chaque compte ----------
  const drawDev = async () => {
    if (!dev || local) return;
    let d; try { d = await api.get('/api/pi/admin'); } catch (e) { return devBox.replaceChildren(h('div', { class: 'form-err' }, e.message)); }
    devBox.replaceChildren(h('p', { class: 'muted small' }, `${d.total_runs} parties au total, ${d.users.length} compte(s). Cliquez sur un compte pour voir le détail.`),
      ...d.users.map((u) => h('details', { class: 'pi-dev' },
        h('summary', {}, h('b', {}, u.name || u.email), h('span', { class: 'muted small' }, `  ${u.email} · ${u.role} · record ${u.best} · ${u.recall_runs + u.learn_runs} partie(s)${u.last_at ? ' · dernière ' + fmtDate(u.last_at) : ''}`)),
        h('div', { class: 'st-grid' }, ...[['Victoires', `${u.wins} / ${u.recall_runs}`], ['Vitesse', u.digits_per_min ? `${u.digits_per_min} déc./min` : '—'], ['Taux d’erreur', `${u.error_rate} %`], ['Temps de récitation', fmtT(u.total_seconds)], ['Jours actifs', String(u.days_active)], ['Appris (max)', `${u.learn_best} déc.`]]
          .map(([l, v]) => h('div', { class: 'st-card' }, h('div', { class: 'st-l' }, l), h('div', { class: 'st-v' }, v)))),
        u.best_by_target.length ? h('p', { class: 'muted small' }, 'Meilleur par objectif : ' + u.best_by_target.map((t) => `${t.target} → ${t.best} (${t.n}×)`).join(' · ')) : null,
        u.runs.length ? h('table', { class: 'plain' }, h('tbody', {}, u.runs.map((r) => h('tr', {},
          h('td', { class: 'muted small' }, fmtDate(r.at)), h('td', {}, r.mode === 'recall' ? 'Récitation' : 'Apprentissage'),
          h('td', {}, r.mode === 'recall' ? `${r.digits} / ${r.target}` : `${r.digits} vues`), h('td', { class: 'muted small' }, fmtT(r.seconds)),
          h('td', { class: 'muted small' }, r.mode === 'recall' ? (r.errors ? `${r.errors} erreur(s)` : 'sans faute') : ''))))) : h('p', { class: 'muted' }, 'Aucune partie.'))));
  };

  p.append(section('π — apprendre et réciter', 'Entraînez-vous à mémoriser les décimales de π. ' + (local ? 'Sans compte, votre historique reste dans ce navigateur.' : 'Votre historique est gardé sur le serveur, pour votre compte : il est commun à toutes vos pages π.'), tabs, play), section('Historique', null, hist), ...(local && !publicToken ? [] : [section('Classement', local ? 'Les performances des comptes de ce DeepWell (votre partie, sans compte, n’y figure pas).' : 'Les performances de tous les comptes de ce DeepWell.', board)]), ...(dev && !local ? [section('Mode développeur — toutes les performances', 'Visible seulement par les administrateurs, avec le mode développeur activé.', devBox)] : []));
  drawTabs(); drawPlay(); drawHist(); drawBoard(); drawDev();
}
