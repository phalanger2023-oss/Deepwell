/** Petits clins d'œil cachés (SCP, armée, aviation). Rien de fonctionnel ici : à supprimer sans conséquence. */
import { h, toast } from './util.js';

// Console du navigateur (F12)
try {
  console.log('%cDEEPWELL — procédé d’analyse complet (P.A.C.) en cours', 'font:600 12px ui-monospace,monospace;color:#c0392b');
  console.log('%cCheck-list avant vol : OK · transpondeur 1200 · « Wilco ». Tout ce qui s’affiche ici finira parmi les A.D.O.', 'font:11px ui-monospace,monospace;color:#888');
} catch { /* console indisponible */ }

// Code historique (↑ ↑ ↓ ↓ ← → ← → B A), hors zones de saisie
const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
let pos = 0;
document.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]')) { pos = 0; return; }
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  pos = k === KONAMI[pos] ? pos + 1 : (k === KONAMI[0] ? 1 : 0);
  if (pos === KONAMI.length) { pos = 0; toast('P.A.C. lancé. Résultat : W.I.P.'); }
});

/** Texte de chargement : presque toujours « Chargement… », très rarement autre chose. */
export function loadingText() {
  const r = Math.random();
  return r < 0.015 ? 'Autorisé au décollage…' : r < 0.03 ? 'Ne clignez pas des yeux…' : r < 0.045 ? 'W.I.P.…' : 'Chargement…';
}

/** Ligne « Contenu : ████ — REDACTED » pour les écrans d'accès restreint. */
export function redactedLine() {
  const w = [9, 14, 11, 18, 7][Math.floor(Math.random() * 5)];
  return h('p', { class: 'muted small redacted-line' }, 'Contenu : ', h('span', { class: 'o5-bar', style: `width:${w}ch`, 'aria-hidden': 'true' }, ' '), ' — REDACTED');
}

/** Page cachée : #/redacted */
export function o5Page() {
  const bar = (w) => h('span', { class: 'o5-bar', style: `width:${w}ch` }, ' ');
  return h('div', { class: 'scroll' }, h('div', { class: 'page o5' },
    h('h1', { class: 'title static' }, 'REDACTED'),
    h('p', { class: 'muted' }, 'Cette page est classée.'),
    h('p', {}, 'Événement narratif : ', bar(14), ' · Plan narratif : ', bar(10), ' · Procédures de confinement spéciales (P.C.S.) : ', bar(22), ', ', bar(12), ' et ', bar(9), '.'),
    h('p', { class: 'muted small' }, 'Narration : en cours.')));
}
