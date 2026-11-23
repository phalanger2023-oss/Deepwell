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

export async function tabPi(p, { section, local = false }) {
  const st = store(local);
  const MAX = 1000;
  const PI = piDigits(MAX);
  const state = { mode: 'recall', lives: 0, target: 50, chunk: 5, shown: 20 };
  const play = h('div', { class: 'pi-play' }), hist = h('div', {});
  const tabs = h('div', { class: 'pi-tabs' });
  const setMode = (m) => { state.mode = m; drawTabs(); drawPlay(); };
  const drawTabs = () => tabs.replaceChildren(...[['learn', 'Apprendre'], ['recall', 'Réciter de mémoire']].map(([k, l]) => h('button', { class: `btn${state.mode === k ? ' primary' : ''}`, onclick: () => setMode(k) }, l)));

  const save = async (r) => { try { await st.post(r); drawHist(); } catch (e) { toast(e.message, 'error'); } };

  // ---------- Apprendre : les décimales apparaissent par blocs, on en affiche davantage au fur et à mesure ----------
  const drawLearn = () => {
    const t0 = Date.now();
    const lines = h('div', { class: 'pi-digits' });
    const paint = () => {
      const g = group(PI.slice(0, state.shown), state.chunk);
      lines.replaceChildren(h('span', { class: 'pi-int' }, '3,'), ...g.map((c, i) => h('span', { class: `pi-chunk${i === g.length - 1 ? ' last' : ''}` }, c)));
    };
    paint();
    play.replaceChildren(
      h('p', { class: 'muted' }, 'Lisez à voix haute, par petits blocs. Quand un bloc est acquis, affichez-en d’autres. Passez ensuite en « Réciter » pour vous tester.'),
      h('div', { class: 'pi-row' }, h('label', {}, 'Taille des blocs ', h('select', { class: 'input', onchange: (e) => { state.chunk = Number(e.target.value); paint(); } }, [3, 4, 5, 10].map((v) => h('option', { value: v, selected: v === state.chunk }, `${v} chiffres`)))),
        h('button', { class: 'btn', onclick: () => { state.shown = Math.min(MAX, state.shown + state.chunk * 2); paint(); } }, `+ ${state.chunk * 2} décimales`),
        h('button', { class: 'btn', onclick: () => { state.shown = Math.max(state.chunk, state.shown - state.chunk * 2); paint(); } }, '− moins'),
        h('button', { class: 'btn', onclick: () => { state.shown = Math.min(MAX, 20); paint(); } }, 'Recommencer à 20')),
      lines,
      h('div', { class: 'row-end' }, h('span', { class: 'muted small' }, `${state.shown} décimales affichées`), h('button', { class: 'btn primary', onclick: async () => { await save({ mode: 'learn', digits: state.shown, target: state.shown, seconds: (Date.now() - t0) / 1000, errors: 0 }); toast('Séance d’apprentissage enregistrée'); } }, 'Terminer la séance')));
  };

  // ---------- Réciter : on tape les décimales ; la première erreur (ou la dernière vie perdue) termine la partie ----------
  const drawRecall = () => {
    let idx = 0, errs = 0, t0 = 0, over = false;
    const typed = h('div', { class: 'pi-digits pi-typed' }), msg = h('div', { class: 'pi-msg' }), stat = h('div', { class: 'muted small' });
    const input = h('input', { class: 'pi-hidden', inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'Décimales de π' });
    const paint = (miss) => {
      typed.replaceChildren(h('span', { class: 'pi-int' }, '3,'), ...group(PI.slice(0, idx), 5).map((c) => h('span', { class: 'pi-chunk ok' }, c)), miss ? h('span', { class: 'pi-chunk bad' }, miss) : h('span', { class: 'pi-cursor' }, '▍'));
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
      else { errs++; msg.textContent = ''; paint(d); play.classList.add('shake'); setTimeout(() => { play.classList.remove('shake'); if (!over) paint(); }, 350); if (errs > state.lives) { paint(d); finish(false); } }
    };
    input.addEventListener('input', () => { for (const c of input.value) if (/\d/.test(c)) press(c); input.value = ''; });
    input.addEventListener('keydown', (e) => { if (e.key === 'Backspace') e.preventDefault(); });
    const keypad = h('div', { class: 'pi-keypad' }, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', ''].map((k) => (k ? h('button', { class: 'btn', onclick: () => { press(k); input.focus({ preventScroll: true }); } }, k) : h('span'))));
    const sel = (opts, cur, fn) => h('select', { class: 'input', onchange: (e) => fn(Number(e.target.value)) }, opts.map(([v, l]) => h('option', { value: v, selected: v === cur }, l)));
    play.replaceChildren(
      h('div', { class: 'pi-row' },
        h('label', {}, 'Objectif ', sel([[10, '10'], [20, '20'], [30, '30'], [50, '50'], [100, '100'], [200, '200'], [500, '500'], [1000, '1000']].map(([v]) => [v, `${v} décimales`]), state.target, (v) => { state.target = v; drawRecall(); })),
        h('label', {}, 'Droit à l’erreur ', sel([[0, 'aucune (parfait)'], [1, '1 erreur'], [3, '3 erreurs']], state.lives, (v) => { state.lives = v; drawRecall(); }))),
      h('p', { class: 'muted' }, 'Tapez les décimales de π de mémoire (après « 3, »). Le chronomètre démarre à la première touche.'),
      typed, msg, stat, input, keypad);
    paint(); setTimeout(() => input.focus({ preventScroll: true }), 50);
    play.addEventListener('click', () => input.focus({ preventScroll: true }));
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

  p.append(section('π — apprendre et réciter', 'Entraînez-vous à mémoriser les décimales de π. ' + (local ? 'Sans compte, votre historique reste dans ce navigateur.' : 'Votre historique est gardé sur le serveur, pour votre compte : il est commun à toutes vos pages π.'), tabs, play), section('Historique', null, hist));
  drawTabs(); drawPlay(); drawHist();
}
