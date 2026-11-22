/**
 * Formules mathématiques (LaTeX) : rendues avec KaTeX, copié dans /vendor/katex (aucun service extérieur).
 * KaTeX n'est téléchargé que si une page contient une formule. En cas d'erreur de syntaxe, la formule reste lisible en texte brut.
 * - bloc « Équation » : affiche la formule rendue ; un clic ouvre le texte LaTeX pour le modifier ;
 * - équation dans une ligne de texte : rendue automatiquement (le texte enregistré reste le LaTeX, dans data-rt).
 */
import { h } from './util.js';

let loading = null;
function loadKatex() {
  if (window.katex) return Promise.resolve(window.katex);
  return (loading ||= new Promise((resolve, reject) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/vendor/katex/katex.min.css'; document.head.append(css);
    const js = document.createElement('script'); js.src = '/vendor/katex/katex.min.js';
    js.onload = () => resolve(window.katex); js.onerror = () => { loading = null; reject(new Error('KaTeX indisponible')); };
    document.head.append(js);
  }));
}

/** Dessine `expr` dans `el` ; en cas d'échec, laisse le texte LaTeX brut. */
export function renderMath(el, expr, display = false) {
  const src = String(expr || '').trim();
  if (!src) { el.textContent = ''; return Promise.resolve(); }
  return loadKatex().then((k) => { k.render(src, el, { throwOnError: false, displayMode: display, strict: 'ignore', trust: false, output: 'htmlAndMathml' }); }).catch(() => { el.textContent = src; });
}

/** Bloc « Équation » : formule rendue + zone de saisie LaTeX (montrée au clic, ou quand le bloc est vide). */
export function equationBlock(expression, editable) {
  const src = h('div', { class: 'txt eq-block', 'data-field': 'expression', 'data-ph': 'Expression (LaTeX)', contenteditable: editable ? 'true' : null }, expression || '');
  const view = h('div', { class: 'eq-render', contenteditable: 'false', title: editable ? 'Cliquer pour modifier' : null });
  const wrap = h('div', { class: 'eq-wrap' }, view, src);
  const draw = () => { wrap.classList.toggle('empty', !src.textContent.trim()); renderMath(view, src.textContent, true); };
  draw();
  if (editable) {
    src.addEventListener('input', () => { clearTimeout(draw.t); draw.t = setTimeout(draw, 150); });
    view.addEventListener('click', () => { wrap.classList.add('editing'); src.focus(); });
    src.addEventListener('blur', () => { wrap.classList.remove('editing'); draw(); });
  }
  return wrap;
}

// Équations dans une ligne de texte : rendues dès qu'elles apparaissent dans la page (affichage seulement ; data-rt reste la source).
function renderInline(root) {
  const list = root.matches?.('.atom.eq:not([data-m])') ? [root] : root.querySelectorAll ? [...root.querySelectorAll('.atom.eq:not([data-m])')] : [];
  for (const el of list) {
    el.dataset.m = '1';
    let expr = ''; try { expr = JSON.parse(el.dataset.rt || '{}').equation?.expression || ''; } catch { /* on garde le texte */ }
    if (expr) renderMath(el, expr, false).then(() => el.classList.add('eq-done'));
  }
}
function start() {
  renderInline(document.body);
  new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) renderInline(n); }).observe(document.body, { childList: true, subtree: true });
}
if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
