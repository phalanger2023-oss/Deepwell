/**
 * Notes de version : source unique de l'historique affiché dans l'application (Notes de version).
 * RÈGLE : une seule mise à jour PAR JOUR. Plusieurs modifications le même jour = même entrée (en tête) et une seule
 * incrémentation de version dans package.json, sauf demande contraire de l'utilisateur. Nouvelle entrée = nouveau jour.
 * Catégories : nouveautes, ameliorations, corrections. `date` : AAAA-MM-JJ (null si non renseignée).
 */
export const RELEASES = [
  {
    version: '3.5.0', date: '2026-11-23',
    nouveautes: [
      'Compte unique avec PDM : les comptes DeepWell servent aussi à PDM (chacun y a ses propres documents). Ouvrir PDM sans être connecté renvoie ici pour se connecter, puis ramène à PDM. Le logo du site est aussi renvoyé à PDM au démarrage et à l’ouverture des réglages PDM.',
      'Jeu de π : l’erreur qui met fin à la partie n’est plus comptée dans l’historique ni le classement ; seules les erreurs permises par le « droit à l’erreur » le sont.',
      'Lien avec PDM : l’icône du site que tu choisis dans Réglages → Apparence est envoyée automatiquement à PDM et sert de fond d’écran à son accueil (à chaque changement d’icône ou de couleur d’accent).',
      'Jeu de π : classement de tous les comptes (record, parties, victoires, vitesse, dernière partie) et, pour les administrateurs avec le mode développeur, le détail de chaque compte (taux d’erreur, jours actifs, meilleur par objectif, dernières parties).',
      'Jeu de π : les menus « Objectif » et « Droit à l’erreur » ne se referment plus tout seuls.',
      'Jeu de π en page à part : tape « /pi » dans une page pour créer une page « π — jeu de mémoire ». Scores et historique sont ceux de ton compte, communs à toutes tes pages π. Avec « Partager » → lien public, des personnes sans compte peuvent y jouer (leur historique reste alors dans leur navigateur).',
      'Menu « / » : les blocs dont un mot correspond exactement à ce que tu tapes passent en premier.',
      'Les addenda se rangent tout seuls dans l’ordre de leur numéro (… [0001/1], [0001/2]…) dès qu’on en ajoute un ou qu’on change son numéro ; les autres sous-pages ne bougent pas.',
      'Matricule des addenda comme avant : « Addendum [0001/1]-26-FR : » puis le nom (numéro du P.S.A. sur 4 chiffres, numéro de l’addendum sans zéro devant, année, abréviation de la matière — réglable dans les réglages de la base). Les anciens titres « Addendum #0001/01-… » restent comptés pour le numéro suivant.',
      'Export PDF : le titre choisi dans la fenêtre d’export devient aussi le nom du fichier proposé au téléchargement.',
      'Google Agenda : le titre de l’événement ajoute la matière de la ligne : « Nom de l’événement en Matière ».',
      'Vérifié : renommer une page, un addendum ou changer sa matière met à jour son dossier sur Google Drive (en tâche de fond ; l’addendum après environ 20 s).',
      'Drive des addenda : chaque addendum a son dossier (au nom exact de sa page) dans « Registre des addenda », avec un petit fichier texte (.txt) qui décrit son contenu. « Réorganiser les dossiers Drive… » range maintenant aussi les anciens dossiers d’addenda, renomme les descriptions, et retire les doublons réels présents sur Drive (même nom, même contenu) en plus de ceux connus de DeepWell, à la corbeille de Drive (récupérables).',
      'Les PDF des addenda sont déposés dans PDM (bouton « Éditer dans PDM »), comme les documents des matières, y compris ceux déjà présents lors de la réorganisation.',
      'Aperçu latéral et fiches de base : une ligne = une propriété, le nom à gauche et la valeur à droite, même quand l’aperçu est étroit ou en mode téléphone (avant, la valeur passait sous le nom).',
      'Calendrier : cases plus hautes, texte plus grand, titres sur plusieurs lignes au lieu d’être coupés.',
      'Mode téléphone : panneau latéral qui se glisse par-dessus, boutons plus grands, menus en bas de l’écran, colonnes empilées, texte sans zoom. Automatique sur écran étroit ou tactile ; réglable dans Réglages → Apparence → « Mode téléphone ».',
      'Aperçu invité : menu ⋯ d’une page → « Aperçu invité (lecture seule) » pour voir la page comme quelqu’un qui n’a que la lecture (sans panneau latéral ni boutons de partage), puis « Quitter l’aperçu ».',
      'Réglages → Serveur (administrateur) : état du serveur en direct (processeur, mémoire, disque, base de données, requêtes, tâches, dernière sauvegarde), ping mesuré depuis votre appareil (moyenne, gigue) et performances de l’appareil (fluidité, vitesse, réseau).',
      'Réglages → π : jeu de mémorisation des décimales de π. « Apprendre » affiche les décimales par blocs ; « Réciter de mémoire » vous fait taper les décimales (objectif et droit à l’erreur au choix, chronomètre). L’historique et le record sont gardés pour chaque compte.',
      'Export PDF : choix de la police du document, et option « Texte continu » (colonnes empilées) ; sinon les colonnes restent côte à côte comme à l’écran.',
      'Ctrl + A : une 1ʳᵉ pression sélectionne le texte du bloc, une 2ᵉ pression sélectionne tous les blocs de la page.',
      'Un texte souligné suivi de « : » : le « : » (et l’espace qui le précède) sortent automatiquement du soulignement.',
      'Propriétaires (Personnes, Créé par…) affichés en pastilles avec initiale, au lieu d’un identifiant, dans les tableaux, cartes et fiches.',
      'Mode scolaire — titre automatique des fiches : dès que la matière est choisie, le titre devient « P.S.A. #0007-26-MTH » (n° de l’entrée dans la matière, année de début d’année scolaire, abréviation de la matière). Il est recalculé si tu changes de matière, tant que tu n’as pas ajouté de nom. L’abréviation est modifiable dans Réglages de la base → « Abréviations des matières… » (par défaut : les 3 premières consonnes).',
      'Mode scolaire — nom des addenda : le bouton « ＋ Nouvel addendum » crée « Addendum #0007/02-26-MTH » (n° du P.S.A. / n° de l’addendum, année, abréviation) ; tu tapes le nom ensuite. Marche aussi avec les boutons déjà posés.',
      'Mode scolaire — Drive : nouvelle organisation « DeepWell Cours → Matière → Support → Document principal + Registre des addenda → un dossier par addendum ». Réglages de la base → « Réorganiser les dossiers Drive… » : essai à blanc, puis déplacement des supports existants et retrait des fichiers en double (la copie va à la corbeille de Drive).',
      'Mode scolaire — PDM : les PDF des addenda sont maintenant déposés dans PDM aussi (dossier …/Addenda/<addendum>), avec les liens « Éditer dans PDM » et « Original vierge » sur la page de l’addendum.',
      'Panneau latéral réordonnable : glisse les boutons du haut (Rechercher, Nouvelle page…) et les sections (Favoris, Pages, Partagé avec moi) par leur titre pour les remettre dans l’ordre voulu ; l’ordre est gardé sur cet appareil.',
      'Pages verrouillées par un code dans une base : elles gardent leur place dans le tri (le serveur ne donne que leur rang, jamais leur titre ni leurs valeurs) au lieu de tomber tout en bas.',
      'Raccourcis Markdown (# , ## , - , 1. , [] , > , ---) maintenant aussi dans les citations, cadres, listes, to-do et toggles (le texte est conservé) ; dans une cellule de tableau, « # » met en gras, « - » donne « • » et « [] » donne « ☐ ».',
      'Google Agenda : dans l’agenda seulement (pas dans tes bases), TST devient « test », DVR « devoir » et PRP « devoir côté » ; la matière de la ligne est ajoutée au titre de l’événement.',
    ],
    ameliorations: [
      'Tableaux : les titres et textes riches affichent maintenant les dates (lisibles, avec « @ ») et les mentions de page ; on peut les modifier sans perdre les mentions, et taper « @ » pour en ajouter. La date d’une colonne Date s’affiche lisiblement (jour, heure) et se choisit dans la même fenêtre que partout ailleurs.',
      'Le bouton Citation du menu « / » et de « Transformer en… » montre une barre verticale (comme le bloc) au lieu de guillemets.',
      'Mentions de page : fond gris foncé et texte blanc, pour bien les repérer (les dates restent en gris discret avec « @ »).',
      'Galerie et liste : la propriété Date est affichée sur la carte par défaut (même si c’est la date de la vue).',
      'Fermer un aperçu latéral garde la position de défilement de la base (plus de retour en haut de page).',
      'Drive : deux envois simultanés ne créent plus deux dossiers identiques, et un fichier envoyé deux fois (même nom, même taille) n’est gardé qu’une fois. Supprimer définitivement un addendum envoie aussi son dossier Drive à la corbeille de Drive (récupérable).',
    ],
    corrections: [
      'Export PDF : les couleurs sont toujours celles du thème clair (un thème sombre imprimait des cadres bleu nuit et du texte blanc), et les colonnes ne s’empilent plus à cause de la largeur de la feuille.',],
  },
  {
    version: '3.4.11', date: '2026-11-22',
    nouveautes: [
      'Exporter une page en PDF (menu « ⋯ » → « Exporter en PDF… ») : mise en page pour le papier (marges, titre, numéros de page), retours à la ligne et changements de page automatiques, blocs dépliants dépliés, choix du papier (A4 / Lettre), de l’orientation, de la taille du texte et des marges. Pour un cours ou un addendum : option « Titre simplifié » qui retire le matricule (P.S.A. #…) et l’intitulé « Addendum » pour ne garder que le nom qui suit (modifiable avant d’exporter), et option d’inclure les sous-pages (addenda) à la suite, une par page. Dans la fenêtre d’impression, choisir « Enregistrer au format PDF ».',
      'Bases de données : clic droit sur une ligne (liste, galerie, tableau, et Kanban) pour ouvrir, renommer, supprimer ou la rendre privée avec un code (modifier / retirer le code aussi), sans quitter la base.',
      'Google Agenda : dans « Réglages de la base », la case « Google Agenda » envoie chaque ligne datée de la base vers Google Agenda (journée entière sans heure, à l’heure sinon ; 1 h par défaut). Pour demander à Google Home « quels sont mes devoirs pour mardi ? ». Sens unique DeepWell → Google : créer, déplacer, renommer, supprimer ou verrouiller une ligne met l’événement à jour ; désactiver retire les événements créés par DeepWell. Agenda « DeepWell » à part ou agenda principal au choix. Nécessite d’autoriser Google Agenda une fois (Réglages → Google Drive).',
      'Rester connecté : case « Rester connecté 90 jours sur cet appareil » à la connexion (cochée par défaut ; sinon 30 jours). La durée se renouvelle à chaque visite.',
      'Réglages → Connexions (administrateur) : appareils connectés (avec bouton « Déconnecter »), consultations de pages avec le temps passé — comptes ET liens publics sans compte — et journal des connexions (réussies, échecs de mot de passe, déconnexions). Conservé 1 an.',
      'Pages verrouillées dans une base : tant que le code n’est pas saisi, la ligne apparaît « expurgée » (barres noires + mention EXPURGÉ) dans toutes les vues : ni titre, ni icône, ni propriétés, ni contenu ; elle n’apparaît pas non plus dans la recherche ni dans l’arborescence. Une ligne masquée ne peut plus être déplacée ni modifiée à l’aveugle.',
      'Un code saisi reste valable 24 h (nouvelle durée par défaut ; les verrous restés sur l’ancien défaut de 15 min passent à 24 h) et ouvre aussi toutes les autres pages qui ont le même code, quels que soient leurs autres réglages. « Verrouiller maintenant » (ou l’inactivité réglée sur la page) referme tout.',
      'Fichiers du chapitre dans l’aperçu latéral : les boutons d’une ligne de fichier passent à la ligne au lieu de dépasser du cadre.',
      'Anciennes pages du recueil (créées avant le 22/11/2026) : pastille jaune « À mettre à jour » + bouton « Mettre à jour cette page ». Une fenêtre liste les blocs de la page (l’ancienne structure « Original / Modifié » est déjà cochée), tu valides, et le bouton « Nouvel addendum » est ajouté si besoin. Une version de secours est gardée dans l’historique. Après la mise à jour, la pastille et le bouton disparaissent. Les pages récentes ne les ont jamais.',
      'Version annotée : sur un PDF du chapitre, le bouton « Ajouter une version annotée » (ex. un PDF déjà annoté sur Canva) l’envoie sur Drive à côté de l’original, qui reste vierge, sous le nom « … (annoté).pdf ». Elle est déposée dans PDM comme document à part, modifiable, dans le même dossier. Une seule version annotée par original. Le bouton n’existe que pour les documents « à mettre à jour » (pastille jaune) et disparaît dès que la carte est mise à jour.',
      'Mode développeur : menu « ⋯ » d’une carte → « Marquer comme à mettre à jour » (remet la pastille, le bouton de mise à jour et l’option de version annotée, même sur une carte récente).',
      'Mode développeur : clic droit sur la pastille → « Marquer comme modifiée » (retire pastille et bouton sans toucher à la page).',
      'Bloc « Fichiers du chapitre » : le panneau d’ajout de fichiers est maintenant un bloc déplaçable où tu veux dans la page (menu « / » → « Fichiers du chapitre »). Sur les pages existantes, le bouton « Placer dans la page » l’insère ; les nouvelles fiches P.S.A. l’ont d’office sous la ligne de date.',
      'Architecture de référence : en mode développeur, menu « ⋯ » d’une page → « Définir comme architecture de référence » (à faire sur ta fiche P.S.A. #0001-26-MTH). « Mettre à jour cette page » reconstruit ensuite les anciennes pages sur cette structure : ton contenu est recasé sous les sections du même nom (Cours, Addenda, Émanant du P.S.A.…), le reste est conservé sous « À classer ».',
      'L’architecture de référence devient aussi le modèle par défaut des prochaines cartes de la base (« Architecture de référence », date du jour dans l’encadré, sections vides). Redéfinir la référence remplace ce modèle.',
      'La pastille jaune apparaît aussi directement dans les vues de la base scolaire (tableau, Kanban, galerie, liste, calendrier), sur chaque ancienne page.',
      'Icône de l’onglet du navigateur : celle de la page affichée ; sans icône de page, l’icône du site choisie dans Réglages → Apparence ; sinon l’icône par défaut.',
    ],
    ameliorations: [
      'Architecture de référence : les blocs de texte vides qui servent d’espace (par exemple entre deux listes dépliantes) sont désormais conservés quand on met à jour une page. À refaire une fois : « Définir comme architecture de référence » sur ta page modèle.',
      'Titres de pages et de lignes de base de données : on peut maintenant y insérer des mentions avec « @ » (dates, pages), comme dans le texte.',
      'Verrouillage par code : la page se verrouille tout de suite après avoir défini le code (il faut le saisir pour la rouvrir). Une page protégée mais ouverte affiche une pastille « Déverrouillée · verrouiller » sous le titre (et un cadenas ouvert dans la liste de gauche) ; un clic la reverrouille.',
      'Bouton « Retour » du navigateur : en aperçu latéral, il ferme l’aperçu au lieu de quitter la base (Échap et la croix ne laissent pas d’entrée d’historique).',
      'Titres des lignes de base de données (liste, galerie, Kanban, tableau) : les dates s’affichent lisiblement et les mentions de date / de page gardent leur style. Les mentions portent un « @ » et un gris plus foncé, comme sur Notion.',
      'Vues de base de données : l’ordre d’affichage des propriétés se choisit (menu « Propriétés » → flèches ▲ ▼), pour le tableau comme pour les cartes (Kanban, galerie, liste, calendrier). Les propriétés masquées sont rangées en dessous.',
      'Titres (et titres dépliants) : plus d’espace au-dessus, pour mieux séparer les sections.',
      'Performances : arbre des pages et grandes bases ~5 à 6 fois plus rapides (droits d’accès préparés une fois, vérification des verrous évitée quand il n’y en a pas), index SQLite supplémentaires, réglages SQLite (cache, écriture WAL), fichiers du site compressés une seule fois et gardés en mémoire.',],
    corrections: [
      'Retour arrière dans un bloc de texte vide : le bloc est supprimé, y compris juste après un séparateur ou un bloc non textuel.',
    ],
  },
  {
    version: '3.4.10', date: '2026-11-22',
    nouveautes: [
      'Google Drive : chaque addendum a maintenant son propre dossier « Addenda / <nom de la page> », qui contient ses fichiers joints et un petit résumé écrit (<nom>.md, texte seul, très léger). Le résumé se met à jour tout seul quand tu modifies la page, et le dossier suit le renommage.',
      'Rétroactif : « Mettre à jour l’architecture… » range les addenda déjà existants (fichiers déjà envoyés déplacés dans le dossier de leur addendum, résumé créé). L’aperçu indique combien. Tous les futurs addenda sont traités automatiquement.',
    ],
    ameliorations: [
      '« Tout télécharger » classe les fichiers d’addenda dans « Addenda/<nom de l’addendum> ».',
    ],
    corrections: [],
  },
  {
    version: '3.4.9', date: '2026-11-22',
    nouveautes: [
      'Kanban : clic droit (ou appui long au doigt) sur une carte → Ouvrir, Renommer, Déplacer vers une colonne, Supprimer.',
      'Kanban : « Nouvelle carte » propose maintenant de choisir un modèle. Dans « Gérer les modèles », le bouton « Par défaut » présélectionne un modèle pour toute la base. La colonne où l’on crée la carte garde sa valeur (ex. la matière).',
    ],
    ameliorations: [],
    corrections: [
      'Chapitres : le cadre « Fichiers du chapitre » (Ajouter un fichier, PDM…) s’affiche désormais dès la première ouverture de la page, sans devoir créer un addendum puis revenir.',
    ],
  },
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
