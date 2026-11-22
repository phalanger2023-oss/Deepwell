/**
 * Notes de version : source unique de l'historique affiché dans l'application (Notes de version).
 * RÈGLE : une seule mise à jour PAR JOUR. Plusieurs modifications le même jour = même entrée (en tête) et une seule
 * incrémentation de version dans package.json, sauf demande contraire de l'utilisateur. Nouvelle entrée = nouveau jour.
 * Catégories : nouveautes, ameliorations, corrections. `date` : AAAA-MM-JJ (null si non renseignée).
 */
export const RELEASES = [
  {
    version: '3.4.8', date: '2026-11-22',
    nouveautes: [
      'Liaison avec PDM (éditeur de PDF) : quand le PDF de référence d’un chapitre est ajouté, il est déposé automatiquement dans PDM, dans un vrai dossier année / matière / chapitre. La page du chapitre affiche alors « Éditer dans PDM » (version annotée) et « Original vierge » (PDF d’origine jamais modifié). Les addenda ne sont pas envoyés.',
      'Réglages → Google Drive (administrateur) : adresse de PDM + clé de liaison, avec vérification de la connexion avant enregistrement. Option de base « Intégration de l’éditeur de PDF » à activer.',
      '« Mettre à jour l’architecture… » envoie aussi à PDM les PDF de cours déjà présents (l’aperçu indique combien).',
    ],
    ameliorations: [],
    corrections: [],
  },
  {
    version: '3.4.7', date: '2026-11-22',
    nouveautes: [
      'Mode scolaire : Réglages de la base → « Mettre à jour l’architecture… ». Un aperçu montre d’abord tout ce qui va changer, puis : les boutons sans aucune action sont retirés (pages et modèles), le bouton « ＋ Nouvel addendum » est ajouté dans la section « Addenda », et la matière « TBD » devient la valeur par défaut des nouvelles lignes (option créée si besoin ; une ligne créée depuis la colonne d’une matière garde cette matière). Si Drive est activé, une seconde fenêtre propose ensuite de ranger les cours existants dans Drive. Chaque page modifiée garde sa version d’avant dans l’historique.',
    ],
    ameliorations: [],
    corrections: [],
  },
  {
    version: '3.4.6', date: '2026-11-22',
    nouveautes: [],
    ameliorations: [
      'Google Drive (mode scolaire) : les fichiers de la page d’un chapitre vont maintenant dans un sous-dossier « Document principal » (créé au premier envoi), à côté du sous-dossier « Addenda » : année / matière / chapitre / Document principal ou Addenda. Les fichiers déjà envoyés restent où ils sont ; rien n’est déplacé sur Drive.',
    ],
    corrections: [],
  },
  {
    version: '3.4.5', date: '2026-11-22',
    nouveautes: [
      'Boutons → action « Créer une sous-page » : on peut maintenant choisir une page modèle existante dont tout le contenu (mise en forme, encadrés, séparateurs, boutons…) est copié dans la sous-page ; « @Today » dans le modèle devient la date du jour. Le contenu écrit à la main gagne aussi un encadré (ligne commençant par « !> ») et la vraie date du jour (« @Today »), et un bouton « ＋ En-tête d’addendum » met la date du jour dans un encadré entre deux séparateurs.',
      'Mode scolaire : un aperçu indique les pages concernées, puis le bouton est ajouté dans chaque bloc déroulant de la section « Addenda » (créant un addendum avec la date du jour dans un encadré entre deux séparateurs). Les pages qui ont déjà un tel bouton ou pas de section « Addenda » ne sont pas touchées ; chaque page garde sa version d’avant dans l’historique. Le modèle « P.S.A. » de départ contient désormais ces boutons.',
    ],
    ameliorations: [
      'Un séparateur ajouté par « / » est toujours suivi d’un bloc de texte prêt à écrire (comme pour « --- »). Une sous-page créée par un bouton ne se termine jamais par un séparateur.',
    ],
    corrections: [],
  },
  {
    version: '3.4.4', date: '2026-11-22',
    nouveautes: [
      'Base de données dans une page : clic droit sur son lien (ou appui long) → « Masquer l’aperçu (garder le lien) » / « Afficher l’aperçu de la base ». Le choix se fait base par base, et seul le lien reste quand l’aperçu est masqué.',
    ],
    ameliorations: [],
    corrections: [
      'Kanban d’une base affichée dans une page : les cartes ne se déplaçaient pas à la souris (l’éditeur de la page bloquait le glisser). C’est corrigé, à la souris comme au doigt.',
    ],
  },
  {
    version: '3.4.3', date: '2026-11-22',
    nouveautes: [],
    ameliorations: [
      'Écran tactile (Chromebook, tablette) : dans le Kanban, on déplace une carte d’une colonne à l’autre en la gardant appuyée un instant (une courte vibration confirme), puis en la glissant avec le doigt ; le tableau défile tout seul quand on approche du bord. Un simple glissement du doigt fait toujours défiler le tableau, et un appui court ouvre la fiche.',
    ],
    corrections: [
      'Kanban : le déplacement des cartes ne fonctionnait pas au doigt (le glisser-déposer du navigateur n’existe pas sur écran tactile).',
    ],
  },
  {
    version: '3.4.2', date: '2026-11-22',
    nouveautes: [
      'Valeurs par défaut : le bouton « Par défaut » d’une base permet de choisir, pour chaque propriété (sélection, statut, multi-sélection, case à cocher, nombre, texte, URL, e-mail, téléphone), la valeur que reçoit toute nouvelle ligne. Par exemple « Statut » = « À faire » : chaque nouvelle ligne arrive dans cette colonne du Kanban. Ça marche pour « Nouvelle ligne », les modèles (la valeur du modèle passe avant) et les boutons d’automatisation ; « Nouvelle carte » dans une colonne du Kanban garde la colonne choisie.',
    ],
    ameliorations: [
      'Kanban : en maintenant le clic gauche sur le fond, le tableau défile au lieu de sélectionner du texte (la sélection de texte est désactivée dans le Kanban, hors champs de saisie).',
      'Kanban : une barre de navigation en haut du tableau (visible dès que les colonnes débordent) : on tire son curseur ou on clique dessus pour aller directement à l’endroit voulu. On peut aussi attraper une carte pour faire défiler en maintenant Maj, ou avec un clic molette (un glisser normal déplace toujours la carte).',
    ],
    corrections: [],
  },
  {
    version: '3.4.1', date: '2026-11-22',
    nouveautes: [
      'Modèles de base de données : une petite flèche à côté de « Nouvelle ligne » ouvre la liste des modèles. Un clic sur un modèle crée une nouvelle ligne avec ses propriétés déjà remplies et son contenu prêt à annoter ; la date du jour remplace automatiquement « @Today ». On peut créer ses propres modèles, les modifier comme une page normale (la bannière en haut rappelle qu’on est dans un modèle), les dupliquer ou les supprimer depuis « Gérer les modèles ». Les modèles n’apparaissent ni dans le tableau, ni dans le Kanban, ni dans la recherche, et ne créent pas de dossier Drive.',
      'Mode scolaire : trois modèles de départ sont proposés une seule fois — « P.S.A. #00-26- » (Cours, Original, Modifié, Addenda avec « Émanant du P.S.A. » et « Lié à la P.S.A. »), « Fiche de révision » et « Exercices ». Ils se modifient et se suppriment librement, et ne reviennent pas une fois supprimés.',
    ],
    ameliorations: [
      'Boutons : l’action « Ajouter une page à une base de données » propose maintenant un « Modèle » (page vide par défaut). La page créée reprend le contenu et les propriétés du modèle choisi, la date du jour remplace « @Today », et un titre saisi remplace celui du modèle. Dans une base en mode scolaire avec Drive, le dossier du chapitre est créé aussi.',
      'Boutons : nouvelle action « Créer une sous-page de cette page », avec un titre, un contenu de départ facultatif (même écriture que « Ajouter des blocs »), l’endroit où placer le lien vers la sous-page, et l’option de l’ouvrir tout de suite.',
      'Bases de données : on peut « attraper » le fond d’une vue avec la souris pour la faire défiler (tableau, Kanban, galerie, liste, calendrier). Les champs, les liens et les cartes du Kanban gardent leur comportement habituel, et un simple clic sur une carte de la galerie ou une ligne de la liste ouvre toujours la fiche.',
      'Kanban : en glissant une carte près du bord gauche ou droit, le tableau défile tout seul vers les colonnes cachées (et la page défile en haut ou en bas de l’écran).',
      'Kanban : la vue tient maintenant dans l’écran. Chaque colonne a sa propre barre de défilement verticale, et la barre de défilement horizontale reste toujours visible en bas au lieu de se perdre sous la page.',
      'Kanban : deux flèches (gauche et droite) apparaissent sur les côtés pour passer d’un groupe de colonnes à l’autre. On peut aussi faire défiler avec la molette de la souris au-dessus du fond ou de l’en-tête d’une colonne, ou « attraper » le fond du tableau avec la souris pour le faire glisser.',
    ],
    corrections: [
      'Panneau latéral des bases de données : sur le site en ligne, il s’affichait comme une page blanche avec une icône triste, car le serveur interdisait l’affichage d’une page dans une autre. C’est maintenant autorisé pour DeepWell.',
    ],
  },
  {
    version: '3.4.0', date: '2026-11-19',
    nouveautes: [
      'Formules mathématiques : les blocs « Équation » et les équations placées dans une ligne de texte sont maintenant dessinées en vraies formules (fractions, indices, exposants, lettres grecques comme ϱ ou ϖ, accents…) au lieu de s’afficher en code LaTeX brut. Un clic sur un bloc ouvre le texte LaTeX pour le modifier. La bibliothèque (KaTeX) est incluse dans Deepwell, sans service extérieur, et ne se charge que sur les pages qui contiennent une formule. Une formule mal écrite reste affichée en texte brut.',
    ],
    ameliorations: [
      'Caractères spéciaux mathématiques : la liste des polices de secours inclut maintenant des polices de symboles mathématiques, pour mieux afficher ∑, ∫, ≈, ≠, √, ∞… dans le texte normal.',
      'Toutes les versions portent maintenant le nom « Alpha » (Alpha 3.4.0, Alpha 3.3.7…), dans la barre latérale et dans les notes de version, y compris les anciennes.',
      'Quelques petits détails cachés ont été ajoutés ici et là, en lien avec ta terminologie. À toi de les trouver.',
      'Quand la connexion est coupée, le message d’erreur explique maintenant clairement que la liaison est perdue.',
      'Écrans d’accès restreint (page verrouillée, page introuvable, lien indisponible) : une ligne de contenu masqué est ajoutée.',
    ],
    corrections: [],
  },
  {
    version: '3.3.7', date: '2026-11-19',
    nouveautes: [],
    ameliorations: [
      'Mentions de date : l’icône de calendrier est retirée (la date s’affiche seule, comme avant), et elle est mieux alignée avec le texte qui l’entoure au lieu de descendre un peu trop bas.',
    ],
    corrections: [],
  },
  {
    version: '3.3.6', date: '2026-11-19',
    nouveautes: [],
    ameliorations: [
      'Cadres : encore un peu plus de vide au-dessus et en dessous du texte.',
    ],
    corrections: [],
  },
  {
    version: '3.3.5', date: '2026-11-19',
    nouveautes: [],
    ameliorations: [
      'Page avec une image de couverture : l’icône de la page chevauche maintenant le bas de la couverture, le bas de l’image arrivant à peu près à la moitié de l’icône, comme dans Notion.',
    ],
    corrections: [],
  },
  {
    version: '3.3.4', date: '2026-11-19',
    nouveautes: [],
    ameliorations: [
      'Cadres : un peu de vide est ajouté au-dessus et en dessous du texte, à peu près comme dans Notion.',
    ],
    corrections: [],
  },
  {
    version: '3.3.3', date: '2026-11-19',
    nouveautes: [],
    ameliorations: [
      'Séparateurs : l’espace entre les blocs de part et d’autre est un peu élargi, à peu près comme dans Notion.',
    ],
    corrections: [],
  },
  {
    version: '3.3.2', date: '2026-11-19',
    nouveautes: [],
    ameliorations: [
      'Cadres : le texte a maintenant la même taille que le texte normal, l’icône est plus petite et le cadre est moins haut.',
      'Séparateurs : ils ne prennent plus de hauteur superflue autour de leur ligne.',
    ],
    corrections: [],
  },
  {
    version: '3.3.1', date: '2026-11-19',
    nouveautes: [
      'Nouveau thème « Noir profond » (Mon affichage → Thème) : fond d’un noir pur, avec un menu, des cartes et des menus contextuels qui restent bien distincts grâce à des gris étagés et de fins contours clairs. Il peut aussi être choisi comme thème par défaut dans Réglages → Apparence.',
    ],
    ameliorations: [],
    corrections: [],
  },
  {
    version: '3.3.0', date: '2026-11-19',
    nouveautes: [
      'Calendrier : chaque élément affiche maintenant ses propriétés (choisies avec le bouton « Propriétés ») et le début du texte de sa page, directement dans la case du jour.',
      'Tri disponible dans toutes les vues (Kanban et Calendrier compris) : le tri est appliqué aux cartes d’une colonne et aux éléments d’un même jour.',
      'Une base de données placée dans une page s’affiche directement dans la page, sans cliquer sur un lien. Elle ne se charge que lorsqu’on approche de son emplacement, pour garder la page rapide. Son titre reste un lien vers la base seule.',
    ],
    ameliorations: [
      'Notes de version : la dernière version et les nouveautés depuis ta dernière visite sont dépliées, les anciennes sont repliées. Chaque version indique son nombre d’entrées, et des filtres Nouveautés / Améliorations / Corrections permettent de ne voir qu’un type.',
    ],
    corrections: [],
  },
  {
    version: '3.2.1', date: '2026-11-19',
    nouveautes: [],
    ameliorations: [
      'Séparateurs et encadrés (appels) : l’espace autour d’eux est réduit, les pages sont plus compactes.',
      'Aperçu latéral d’une entrée : un peu plus d’espace vide à gauche et à droite du contenu.',
    ],
    corrections: [
      'Menus (propriétés affichées, nouvelle vue, menu d’une vue, menu d’une page) : ils se ferment maintenant au clic à l’extérieur, avec Échap, au défilement et au changement de page. Avant, un seul clic à l’intérieur suffisait à les rendre « collants ».',
      'Sélecteur d’options (Sélection, Statut, Multi-sélection) : il se ferme aussi quand on change de page.',
      'Menu « Propriétés » : les cases cochées correspondent maintenant à ce qui est réellement affiché dans la vue (galerie, liste, Kanban). Il n’est plus nécessaire de décocher puis recocher une propriété pour la voir apparaître.',
    ],
  },
  {
    version: '3.2.0', date: '2026-11-19',
    nouveautes: [
      'Stockage Google Drive pour les cours (Mode scolaire → option « Stockage Drive ») : le bouton « Nouveau chapitre » crée la page et son dossier Drive, rangé par année, matière et support (DeepWell Cours / Année / Matière / Support).',
      'Bouton « Ajouter un fichier » sur la page d’un chapitre : le fichier part directement de ton navigateur vers Drive, sans passer par le serveur. Les fichiers des addendums vont dans un sous-dossier « Addenda ».',
      'Sur la page d’un chapitre : aperçu Drive intégré (chargé au clic), téléchargement par fichier et « Tout télécharger » en une archive ZIP (chapitre et addendums), préparée dans ton navigateur.',
      'Renommer un chapitre ou changer sa matière déplace et renomme son dossier sur Drive. Renommer ou retirer un fichier est répercuté sur Drive (corbeille de Drive, récupérable). Si Google ne répond pas, DeepWell réessaie tout seul.',
      '« Rattacher mes cours existants » (Réglages de la base) : aperçu de ce qui sera fait, puis rangement de tes cours déjà présents. Les fichiers du serveur sont envoyés sur Drive (les copies du serveur sont conservées), les liens Drive existants sont rattachés au bon chapitre sans être déplacés, les liens Canva restent des liens.',
    ],
    ameliorations: [],
    corrections: [],
  },
  {
    version: '3.1.0', date: '2026-11-19',
    nouveautes: [
      'Page « Notes de version » : l’historique des versions de Deepwell, avec une pastille discrète sur le numéro de version tant que la dernière n’a pas été consultée.',
      'Réglage « Mode scolaire » dans les bases de données (bouton « Réglages » au-dessus de la base) : il regroupe les options scolaires à venir. Une base où il est désactivé se comporte comme une base ordinaire.',
    ],
    ameliorations: [
      'File de tâches interne avec nouvelles tentatives espacées, pour les opérations qui peuvent échouer temporairement (préparation des prochaines étapes Google Drive).',
    ],
    corrections: [],
  },
  { version: '3.0.6', date: null, nouveautes: ['Bases de données : colonne « Numéro automatique », tri croissant / décroissant avec comparaison numérique.'], ameliorations: [], corrections: [] },
  { version: '3.0.5', date: null, nouveautes: [], ameliorations: ['Aperçu latéral plus aéré ; vue liste des bases sans lignes de séparation.'], corrections: [] },
  { version: '3.0.4', date: null, nouveautes: ['Propriétés d’une ligne de base : listes « à la Notion » pour Sélection, Statut et Multi-sélection.'], ameliorations: [], corrections: [] },
  { version: '3.0.3', date: null, nouveautes: [], ameliorations: [], corrections: ['Aperçu latéral d’une ligne de base décalé vers la droite avec une barre de défilement horizontale.'] },
  { version: '3.0.2', date: null, nouveautes: [], ameliorations: [], corrections: ['Supprimer une mention ou tout le contenu d’un bloc avec Retour arrière ne bloque plus la saisie dans le bloc.'] },
];
