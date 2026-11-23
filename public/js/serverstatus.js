// Onglet « Serveur » (administrateur) : état du serveur, temps de réponse mesuré depuis cet appareil, performances de l'appareil.
import { h, toast, fmtDate } from './util.js';
import { api } from './api.js';

const mo = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} Go` : `${Math.round(n / 1e6)} Mo`);
const dur = (s) => { const d = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d} j ${hh} h` : hh ? `${hh} h ${m} min` : `${m} min ${s % 60} s`; };
const ms1 = (n) => `${(Math.round(n * 10) / 10).toLocaleString('fr-FR')} ms`;

/** Niveau (ok / warn / bad) d'une mesure : pastille de couleur. */
const lvl = (v, warn, bad) => (v >= bad ? 'bad' : v >= warn ? 'warn' : 'ok');
const card = (label, value, sub, level = '') => h('div', { class: `st-card ${level}` }, h('div', { class: 'st-l' }, label), h('div', { class: 'st-v' }, value), sub ? h('div', { class: 'st-s muted small' }, sub) : null);

/** Mesure l'aller-retour vers le serveur : n requêtes /api/ping l'une après l'autre. */
export async function measurePing(n = 10) {
  const t = [];
  await fetch('/api/ping', { cache: 'no-store' }); // 1re requête : ouvre la connexion, non comptée
  for (let i = 0; i < n; i++) {
    const a = performance.now();
    await (await fetch(`/api/ping?x=${i}`, { cache: 'no-store' })).json();
    t.push(performance.now() - a);
  }
  const avg = t.reduce((x, y) => x + y, 0) / t.length;
  const jitter = t.slice(1).reduce((s, v, i) => s + Math.abs(v - t[i]), 0) / Math.max(1, t.length - 1);
  return { samples: t, min: Math.min(...t), max: Math.max(...t), avg, jitter };
}

/** FPS moyen pendant `ms` millisecondes (fluidité de l'affichage de cet appareil). */
function measureFps(ms = 1000) {
  return new Promise((resolve) => { let n = 0; const t0 = performance.now(); const tick = (t) => { n++; if (t - t0 < ms) requestAnimationFrame(tick); else resolve(Math.round((n * 1000) / (t - t0))); }; requestAnimationFrame(tick); });
}
/** Petit calcul pour comparer la vitesse du processeur de l'appareil (plus petit = plus rapide). */
function cpuBench() { const t0 = performance.now(); let x = 0; for (let i = 1; i < 6e6; i++) x += Math.sqrt(i) % 3; return { ms: performance.now() - t0, x }; }

const spark = (vals, w = 220, hgt = 38) => {
  if (!vals.length) return h('span');
  const mx = Math.max(...vals, 1), pts = vals.map((v, i) => `${(i / Math.max(1, vals.length - 1)) * w},${hgt - (v / mx) * (hgt - 4) - 2}`).join(' ');
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', `0 0 ${w} ${hgt}`); s.setAttribute('width', w); s.setAttribute('height', hgt); s.setAttribute('class', 'st-spark');
  const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline'); pl.setAttribute('points', pts); pl.setAttribute('fill', 'none'); pl.setAttribute('stroke', 'currentColor'); pl.setAttribute('stroke-width', '2'); s.append(pl);
  return s;
};

export async function tabServer(p, { section }) {
  const srv = h('div', { class: 'st-grid' }), net = h('div', {}), dev = h('div', {});
  p.append(
    section('État du serveur', 'Ressources et activité, relevées sur le serveur. La page se rafraîchit toute seule toutes les 5 secondes tant qu’elle est ouverte.', srv),
    section('Temps de réponse (mesuré depuis cet appareil)', 'Le « ping » est l’aller-retour jusqu’au serveur DeepWell : il dépend de votre connexion autant que du serveur.', net),
    section('Cet appareil', 'Performances de l’appareil et du navigateur que vous utilisez en ce moment (téléphone, ordinateur…).', dev));

  const drawSrv = async () => {
    const s = await api.get('/api/admin/status');
    const memPct = Math.round(((s.memory.system_total - s.memory.system_free) / s.memory.system_total) * 100);
    const diskPct = s.disk ? Math.round(((s.disk.total - s.disk.free) / s.disk.total) * 100) : null;
    const loadPct = Math.round((s.cpu.load[0] / s.cpu.cores) * 100);
    srv.replaceChildren(
      card('En ligne depuis', dur(s.uptime_s), `Node ${s.node}`),
      card('Processeur', `${s.cpu.load[0]} / ${s.cpu.cores} cœurs`, `charge 1 / 5 / 15 min : ${s.cpu.load.join(' · ')}`, lvl(loadPct, 70, 100)),
      card('Mémoire de la machine', `${memPct} % utilisée`, `${mo(s.memory.system_total - s.memory.system_free)} sur ${mo(s.memory.system_total)}`, lvl(memPct, 80, 92)),
      card('Mémoire de DeepWell', mo(s.memory.rss), `tas JavaScript ${mo(s.memory.heap_used)} / ${mo(s.memory.heap_total)}`),
      card('Disque des données', diskPct == null ? '—' : `${diskPct} % plein`, s.disk ? `${mo(s.disk.free)} libres sur ${mo(s.disk.total)}` : '', diskPct == null ? '' : lvl(diskPct, 80, 92)),
      card('Base de données', mo(s.db.size + s.db.wal), `images et fichiers : ${mo(s.db.uploads)}`),
      card('Contenu', `${s.counts.pages.toLocaleString('fr-FR')} pages`, `${s.counts.blocks.toLocaleString('fr-FR')} blocs · ${s.counts.users} comptes · ${s.counts.sessions} sessions`),
      card('Requêtes (10 dernières min)', `${s.requests.last_10min}`, `moy. ${ms1(s.requests.avg_ms)} · médiane ${ms1(s.requests.p50_ms)} · 95 % sous ${ms1(s.requests.p95_ms)} · max ${ms1(s.requests.max_ms)}${s.requests.errors_5xx ? ` · ${s.requests.errors_5xx} erreur(s) serveur` : ''}`, s.requests.errors_5xx ? 'bad' : lvl(s.requests.p95_ms, 300, 1000)),
      card('Réactivité de Node', ms1(s.event_loop_lag_ms), `pointe récente ${ms1(s.event_loop_lag_max_ms)} (bas = bon)`, lvl(s.event_loop_lag_ms, 30, 100)),
      card('Tâches en arrière-plan', `${s.jobs.pending || 0} en attente`, `${s.jobs.running || 0} en cours · ${s.jobs.failed || 0} en échec · ${s.jobs.done || 0} terminées`, s.jobs.failed ? 'warn' : ''),
      card('Dernière sauvegarde', s.backup ? fmtDate(s.backup.created_at) : 'aucune', s.backup ? `${s.backup.name} (${mo(s.backup.size)})` : 'Voir l’onglet Sauvegardes', s.backup && Date.now() - s.backup.created_at < 36 * 3600e3 ? 'ok' : 'warn'),
      card('Connexion sécurisée', s.env.cookie_secure ? 'HTTPS actif' : 'cookie non sécurisé', s.env.trust_proxy ? 'derrière un proxy (Traefik)' : 'accès direct', s.env.cookie_secure ? 'ok' : 'warn'));
  };

  let pingHist = [];
  const drawNet = async (run = true) => {
    const out = h('div', {});
    net.replaceChildren(h('button', { class: 'btn', onclick: () => drawNet(true) }, 'Mesurer à nouveau'), ' ', h('span', { class: 'muted small' }, run ? 'Mesure en cours…' : ''), out);
    if (!run) return;
    try {
      const r = await measurePing(12); pingHist = [...pingHist, r.avg].slice(-20);
      net.replaceChildren(h('button', { class: 'btn', onclick: () => drawNet(true) }, 'Mesurer à nouveau'),
        h('div', { class: 'st-grid', style: 'margin-top:10px' },
          card('Ping moyen', ms1(r.avg), `min ${ms1(r.min)} · max ${ms1(r.max)}`, lvl(r.avg, 120, 400)),
          card('Gigue', ms1(r.jitter), 'variation d’une mesure à l’autre (bas = stable)', lvl(r.jitter, 40, 150)),
        ),
        h('div', { class: 'st-sparkrow' }, spark(r.samples), h('span', { class: 'muted small' }, ' 12 mesures successives'), pingHist.length > 1 ? h('span', {}, ' · ', spark(pingHist, 120), h('span', { class: 'muted small' }, ' moyennes de cette session')) : null));
    } catch (e) { net.replaceChildren(h('div', { class: 'form-err' }, e.message)); }
  };

  const drawDev = async () => {
    dev.replaceChildren(h('span', { class: 'muted' }, 'Mesure…'));
    const nav = performance.getEntriesByType('navigation')[0], conn = navigator.connection || {};
    const fps = await measureFps(1000), b = cpuBench();
    const heap = performance.memory ? performance.memory.usedJSHeapSize : null;
    const t0 = performance.now(); try { await api.get('/api/pages/tree'); } catch { /* sans importance */ } const tree = performance.now() - t0;
    dev.replaceChildren(h('button', { class: 'btn', onclick: drawDev }, 'Mesurer à nouveau'), h('div', { class: 'st-grid', style: 'margin-top:10px' },
      card('Fluidité d’affichage', `${fps} images/s`, '60 = parfait', fps >= 50 ? 'ok' : fps >= 30 ? 'warn' : 'bad'),
      card('Vitesse du processeur', ms1(b.ms), 'petit calcul de référence (bas = rapide)', lvl(b.ms, 120, 400)),
      card('Chargement de la page', nav ? ms1(nav.loadEventEnd || nav.duration) : '—', nav ? `réponse du serveur ${ms1(nav.responseStart - nav.requestStart)} · DOM prêt ${ms1(nav.domContentLoadedEventEnd)}` : ''),
      card('Chargement de l’arborescence', ms1(tree), 'une vraie requête vers /api/pages/tree', lvl(tree, 300, 1200)),
      card('Réseau annoncé', conn.effectiveType ? conn.effectiveType.toUpperCase() : 'inconnu', conn.downlink ? `${conn.downlink} Mb/s · aller-retour ${conn.rtt} ms${conn.saveData ? ' · économie de données' : ''}` : 'non fourni par ce navigateur'),
      card('Appareil', `${navigator.hardwareConcurrency || '?'} cœurs`, `${navigator.deviceMemory ? `${navigator.deviceMemory} Go de mémoire · ` : ''}écran ${screen.width}×${screen.height} @${window.devicePixelRatio}x`),
      card('Mémoire de l’onglet', heap ? mo(heap) : 'inconnue', heap ? 'tas JavaScript utilisé' : 'non fourni par ce navigateur'),
      card('Mode affichage', document.body.classList.contains('phone') ? 'téléphone' : 'ordinateur', `fenêtre ${innerWidth}×${innerHeight} · ${matchMedia('(pointer:coarse)').matches ? 'tactile' : 'souris'}`)));
  };

  await drawSrv(); drawNet(true); drawDev();
  const timer = setInterval(() => { if (!p.isConnected) return clearInterval(timer); drawSrv().catch(() => {}); }, 5000);
}
