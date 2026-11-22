// Génère des icônes géométriques (style Lucide : 24x24, trait 2) dans public/icons + entrées d'index. Relancer sans risque.
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'public', 'icons');
const P = (d) => `<path d="${d}" />`;
const shapes = {
  circle: ['cercle rond', '<circle cx="12" cy="12" r="9" />'],
  'circle-filled': ['cercle plein disque rond', '<circle cx="12" cy="12" r="9" fill="currentColor" />'],
  ring: ['anneau cercles concentriques', '<circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" />'],
  dot: ['point petit rond', '<circle cx="12" cy="12" r="3" fill="currentColor" />'],
  square: ['carré', '<rect x="4" y="4" width="16" height="16" rx="2" />'],
  'square-filled': ['carré plein', '<rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor" />'],
  'square-nested': ['carrés imbriqués concentriques', '<rect x="3" y="3" width="18" height="18" rx="2" /><rect x="8" y="8" width="8" height="8" rx="1" />'],
  'square-split': ['carré divisé moitié', '<rect x="4" y="4" width="16" height="16" rx="2" /><path d="M12 4v16" /><path d="M12 4h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6z" fill="currentColor" />'],
  checker: ['damier échiquier', '<rect x="3" y="3" width="18" height="18" rx="2" /><path d="M12 3v18M3 12h18" /><path d="M3 3h9v9H3zM12 12h9v9h-9z" fill="currentColor" />'],
  triangle: ['triangle', '<path d="M12 4 21 20H3z" />'],
  'triangle-filled': ['triangle plein', '<path d="M12 4 21 20H3z" fill="currentColor" />'],
  'triangle-down': ['triangle inversé', '<path d="M12 20 3 4h18z" />'],
  'triangle-right': ['triangle droite lecture', '<path d="M6 4l14 8-14 8z" fill="currentColor" />'],
  diamond: ['losange', '<path d="M12 2 22 12 12 22 2 12z" />'],
  'diamond-filled': ['losange plein', '<path d="M12 2 22 12 12 22 2 12z" fill="currentColor" />'],
  'diamond-nested': ['losanges imbriqués', '<path d="M12 2 22 12 12 22 2 12z" /><path d="M12 8l4 4-4 4-4-4z" />'],
  pentagon: ['pentagone', '<path d="M12 3l9 6.5-3.5 10.5h-11L3 9.5z" />'],
  hexagon: ['hexagone', '<path d="M12 2.5l8.5 5v9l-8.5 5-8.5-5v-9z" />'],
  'hexagon-filled': ['hexagone plein', '<path d="M12 2.5l8.5 5v9l-8.5 5-8.5-5v-9z" fill="currentColor" />'],
  'hexagon-nested': ['hexagones imbriqués alvéole', '<path d="M12 2.5l8.5 5v9l-8.5 5-8.5-5v-9z" /><path d="M12 8l4 2.3v4.4L12 17l-4-2.3v-4.4z" />'],
  octagon: ['octogone', '<path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z" />'],
  parallelogram: ['parallélogramme', '<path d="M7 5h14l-4 14H3z" />'],
  trapezoid: ['trapèze', '<path d="M7 5h10l5 14H2z" />'],
  'star-4': ['étoile quatre branches scintillement', '<path d="M12 2c1 6 4 9 10 10-6 1-9 4-10 10-1-6-4-9-10-10 6-1 9-4 10-10z" />'],
  'star-6': ['étoile six branches hexagramme', '<path d="M12 3l8 14H4z" /><path d="M12 21 4 7h16z" />'],
  cross: ['croix plus géométrique', '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" />'],
  'cross-x': ['croix x diagonale', '<path d="M5 5l14 14M19 5 5 19" />'],
  asterisk: ['astérisque étoile', '<path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9" />'],
  'half-circle': ['demi-cercle moitié', '<path d="M3 17a9 9 0 0 1 18 0z" />'],
  'half-filled': ['cercle moitié plein contraste', '<circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />'],
  quarter: ['quart de cercle', '<path d="M4 20V4a16 16 0 0 1 16 16z" />'],
  arc: ['arc courbe', '<path d="M4 18a8 8 0 0 1 16 0" />'],
  wave: ['vague ondulation', '<path d="M2 12c2.5-6 5-6 7.5 0s5 6 7.5 0c1-2.4 2-3.7 5-4" />'],
  target: ['cible objectif', '<circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.2" fill="currentColor" />'],
  'dots-grid': ['grille de points matrice', '<circle cx="6" cy="6" r="1.5" fill="currentColor" /><circle cx="12" cy="6" r="1.5" fill="currentColor" /><circle cx="18" cy="6" r="1.5" fill="currentColor" /><circle cx="6" cy="12" r="1.5" fill="currentColor" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /><circle cx="18" cy="12" r="1.5" fill="currentColor" /><circle cx="6" cy="18" r="1.5" fill="currentColor" /><circle cx="12" cy="18" r="1.5" fill="currentColor" /><circle cx="18" cy="18" r="1.5" fill="currentColor" />'],
  'bars-3': ['barres colonnes histogramme', '<path d="M6 20V12M12 20V5M18 20V9" />'],
  stairs: ['escalier marches progression', '<path d="M3 20h5v-5h5v-5h5V5h3" />'],
  pyramid: ['pyramide', '<path d="M12 3 3 19h18z" /><path d="M12 3v16" />'],
  cube: ['cube 3d boîte', '<path d="M12 2.5l8.5 5v9l-8.5 5-8.5-5v-9z" /><path d="M12 12l8.5-4.5M12 12 3.5 7.5M12 12v9.5" />'],
  cylinder: ['cylindre base de données', '<ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />'],
  layers: ['strates couches empilées', '<path d="M12 3 3 8l9 5 9-5z" /><path d="M3 13l9 5 9-5" />'],
  frame: ['cadre coins viseur', '<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" />'],
  chevrons: ['chevrons flèches doubles', '<path d="M7 6l6 6-6 6M13 6l6 6-6 6" />'],
  infinity: ['infini boucle', '<path d="M12 12c-2-3-4-5-6.5-5a5 5 0 0 0 0 10C8 17 10 15 12 12zm0 0c2 3 4 5 6.5 5a5 5 0 0 0 0-10C16 7 14 9 12 12z" />'],
  'orbit-geo': ['orbite atome', '<circle cx="12" cy="12" r="2" fill="currentColor" /><ellipse cx="12" cy="12" rx="10" ry="4" /><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)" /><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)" />'],
  venn: ['cercles qui se croisent intersection', '<circle cx="9" cy="12" r="6" /><circle cx="15" cy="12" r="6" />'],
};
const idxFile = path.join(dir, 'index.json');
const index = JSON.parse(fs.readFileSync(idxFile, 'utf8')).filter((i) => !i.n.startsWith('geo-'));
for (const [k, [tags, body]] of Object.entries(shapes)) {
  const name = `geo-${k}`;
  fs.writeFileSync(path.join(dir, `${name}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>\n`);
  index.push({ n: name, t: `geometrique forme ${tags} geo ${k.replace(/-/g, ' ')}` });
}
fs.writeFileSync(idxFile, JSON.stringify(index));
console.log(Object.keys(shapes).length, 'icônes géométriques');
