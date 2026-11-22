/**
 * Mode scolaire : réglage propre à chaque base de données, rangé dans `props.dw_school` de la page-base
 * (même convention que `dw_open_full`). Une base sans ce réglage, ou avec `enabled: false`, se comporte comme une base ordinaire.
 * Désactiver le mode ou une option ne supprime aucune donnée : seule la configuration change.
 */
export const SCHOOL_OPTIONS = ['drive', 'search', 'progress', 'autodrop', 'archive', 'offline', 'pdf'];

/** Réglage « propre » : booléens uniquement, clés connues uniquement. Renvoie undefined si la valeur n'est pas un objet. */
export function cleanSchool(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const options = {};
  for (const k of SCHOOL_OPTIONS) options[k] = v.options?.[k] === true;
  return { enabled: v.enabled === true, options };
}

/** Normalise les props d'une page avant enregistrement (seul `dw_school` est contrôlé, le reste est inchangé). */
export function cleanProps(props) {
  if (!props || typeof props !== 'object' || !('dw_school' in props)) return props;
  const { dw_school, ...rest } = props;
  const s = cleanSchool(dw_school);
  return s ? { ...rest, dw_school: s } : rest;
}
