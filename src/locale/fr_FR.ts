import { zh_CN } from "./zh_CN";
import { en } from "@locale/en";

export const fr_FR: typeof zh_CN = {
  CONTENT_LANG_ID: "fr-fr",
  SERVER_LABEL_CN: "CN",
  SERVER_LABEL_GLOBAL: "International",
  SERVER_LABEL_UNI: "Universel",
  BOOT_INITIALIZING: "Initialisation",
  BOOT_LOADING_LOCAL_SETTINGS: "Chargement des paramètres locaux",
  BOOT_CHECKING_NETWORK: "Vérification de la connexion réseau",
  BOOT_STARTING_DOWNLOAD_SERVICE: "Démarrage du service de téléchargement",
  BOOT_CHECKING_LAUNCHER_UPDATE: "Vérification des mises à jour du launcher",
  BOOT_CHECKING_WINE_ENVIRONMENT: "Vérification de l'environnement Wine",
  BOOT_PREPARING_WINE_ENVIRONMENT: "Préparation de l'environnement Wine",
  BOOT_INITIALIZING_RUNTIME: "Initialisation de l'environnement d'exécution",
  BOOT_INITIALIZING_GAME_CLIENT: "Initialisation du client du jeu",
  BOOT_COMPLETE: "Initialisation terminée",
  BOOT_ENTERING_MAIN_SCREEN: "Ouverture de l'écran principal",
  BOOT_INITIALIZATION_FAILED: "Échec de l'initialisation",
  LAUNCH: "Lancer le jeu",
  INSTALL: "Installer le jeu",
  UPDATING: "Mise à jour",
  DOWNLOADING: "Téléchargement",
  DOWNLOAD_PAUSED: "Téléchargement en pause",
  PAUSE_DOWNLOAD: "Mettre en pause",
  RESUME_DOWNLOAD: "Reprendre le téléchargement",
  CANCEL_DOWNLOAD: "Annuler le téléchargement",
  DOWNLOAD_PROGRESS: "Progression du téléchargement",
  DOWNLOAD_FILE: "Fichier",
  DOWNLOAD_FILE_INDEX: "Progression du fichier",
  DOWNLOADED: "Téléchargé",
  DOWNLOAD_SPEED: "Vitesse",
  PROGRESS: "Progression",
  PROCESSING: "Traitement en cours…",
  FORCE_QUIT_GAME: "Forcer la fermeture",
  FIXING_FILES: "Correction des fichiers de jeu {0}/{1}",
  PATCHING: "Ajout de correctifs sur les fichiers du jeu",
  GAME_RUNNING: "Le jeu est lancé",
  GAME_RECOVERING: "Restauration en cours",
  GAME_RUNNING_CLOSE_TITLE: "Le jeu est toujours en cours d’exécution",
  GAME_RUNNING_CLOSE_DESC:
    "Le jeu n’est pas encore fermé. Voulez-vous arrêter le processus du jeu en quittant le lanceur ?",
  GAME_RUNNING_CLOSE_EXIT: "Fermer le jeu et quitter",
  DOWNLOAD_RUNNING_CLOSE_TITLE: "Téléchargement en cours",
  DOWNLOAD_RUNNING_CLOSE_DESC:
    "Un téléchargement est en cours. Voulez-vous quitter le lanceur ?\n\nQuitter maintenant interrompra le téléchargement et risque d’endommager les fichiers incomplets.",
  DOWNLOAD_RUNNING_CLOSE_EXIT: "Quitter",

  REVERT_PATCHING: "Réversion des correctifs",
  SCANNING_FILES:
    "Vérification de l’intégrité des fichiers de jeu. Fichiers terminés {0}/{1}",
  CHECKING_GAME_INTEGRITY: "Vérification de l'intégrité des fichiers",
  DOWNLOADING_ENVIRONMENT: "Téléchargement des fichiers d'environnement",
  DOWNLOADING_ENVIRONMENT_SPEED:
    "Téléchargement des fichiers d'environnement ({1}/{2}, {3}, {0})",
  EXTRACT_ENVIRONMENT: "Extraction de l'environnement",
  CONFIGURING_ENVIRONMENT: "Configuration de l'environnement",
  ENVIRONMENT_CONFIGURING: "Configuration de l'environnement",
  UNINSTALLING_ENVIRONMENT: en.UNINSTALLING_ENVIRONMENT,
  RESTART_TO_INSTALL: "Redémarrer le lanceur",
  PATH_INVALID: "Le chemin est invalide",
  PLEASE_SELECT_A_DIR: "Veuillez sélectionner un chemin",
  PATH_INVALID_ASCII_ONLY:
    "Assurez-vous que le chemin d’accès ne contient que des caractères ASCII.",
  PATH_INVALID_FORBIDDEN_DIR:
    'Veuillez choisir un chemin qui n’est pas dans "Bureau", "Téléchargements" ou "Documents"',
  NOT_SUPPORTED_YET: "Fonctionnalité non prise en charge",
  PLEASE_WAIT_FOR_LAUNCHER_UPDATE:
    "Le lanceur ne prend pas en charge la version {0} actuellement. Veuillez attendre les mises à jour.",
  UNSUPPORTED_VERSION: "Version non prise en charge",
  SELECT_INSTALLATION_DIR:
    "Veuillez sélectionner le répertoire d’installation du jeu.\nSi vous avez déjà installé le jeu, sélectionnez l’emplacement du fichier exécutable du jeu.",
  CANT_OPEN_GAME_FILE: "Échec d’accès aux fichiers de jeu.",
  CANT_OPEN_GAME_FILE_DESC:
    "Le lanceur n’a pas pu accéder aux fichiers du jeu.\nVeuillez ajuster le répertoire d’installation du jeu après ce message.\n\nSi ce message apparaît plusieurs fois, veuillez vous assurer que le lanceur a l’autorisation d’accéder au répertoire du jeu.",
  GAME_DIR_CHANGED: "Le chemin d’accès au répertoire de jeu a changé.",
  GAME_DIR_CHANGED_DESC:
    "Vous avez modifié le chemin d’accès de votre jeu. Cette opération n’est pas prise en charge, mais vous pouvez modifier cela plus tard.",
  GAME_VERSION: "Version du jeu",

  NEW_VERSION_AVAILABLE: "Une nouvelle mise à jour est disponible",
  NEW_VERSION_AVAILABLE_DESC:
    "Voulez-vous mettre à jour le lanceur vers la version {0}?\n Changements:\n{1}",

  DOWNLOADING_UPDATE_FILE: "Téléchargement des fichiers de mise à jour",

  UPGRADE_FUNCTION_TBD: "Actuellement, la mise à jour n’est pas mise en œuvre.",

  DECOMPRESS_FILE_PROGRESS: "Décompression des fichiers",
  ALLOCATING_FILE: "Allocation des fichiers sur le disque",
  DOWNLOADING_FILE_PROGRESS:
    "Téléchargement du fichier: {0} ({2}/{3}, {4}) {1}",

  BACKUP_USER_DATA: "Sauvegarde des données utilisateur",
  RECOVER_BACKUP_USER_DATA: "Récupération de la sauvegarde",

  INSTALL_DONE: "Terminée",

  RELAUNCH_REQUIRED: "Redémarrage du lanceur requis",
  RELAUNCH_REQUIRED_DESC:
    "Le lanceur redémarre pour terminer l’installation de wine.",

  SETTING: "Paramètres",
  SETTING_WINE_VERSION: "Distribution de Wine",
  SETTING_ASYNC_DXVK: "Compilation de shaders asynchrones DXVK",
  SETTING_ENABLED: "Activé",
  SETTING_DXVK_HUD: "HUD DXVK",
  SETTING_DXVK_HUD_NONE: "Aucun",
  SETTING_DXVK_HUD_FPS: "FPS Seulement",
  SETTING_DXVK_HUD_ALL: "Tout",
  SETTING_MTL_HUD: "HUD Metal",
  SETTING_RETINA: "Mode Retina",
  SETTING_LEFT_CMD: "Mapper CMD gauche à CTRL",
  SETTING_TURN_OFF_AC_PATCH: "Désactiver le patch AC",
  SETTING_CUSTOM_RESOLUTION: "Résolution personnalisée",
  SETTING_DISPLAY_MODE: "Mode d’affichage du jeu",
  SETTING_DISPLAY_MODE_FULLSCREEN: "Plein écran",
  SETTING_DISPLAY_MODE_WINDOWED: "Fenêtré",
  SETTING_WINDOW_RESOLUTION: "Résolution de fenêtre",
  SETTING_SAVE: "Sauvegarder",
  SETTING_CANCEL: "Annuler",

  SETTING_CHECK_INTEGRITY: "Vérifier l'intégrité",
  SETTING_GAME_INSTALL_DIR: "Répertoire d’installation du jeu",
  SETTING_CHANGE_GAME_INSTALL_DIR: "Modifier",
  SETTING_GAME_DIR_SIZE: "Taille : {0}",
  SETTING_GAME_DIR_SIZE_NOT_SET: "Non défini",
  SETTING_UNINSTALL_GAME: "Désinstaller le jeu",
  SETTING_UNINSTALL_GAME_CONFIRM:
    "Le dossier de jeu suivant sera vidé. Cette action est irréversible :\n{0}\n\nContinuer ?",
  SETTING_UNINSTALL_SCREENSHOTS_NOTICE:
    "Remarque : la désinstallation supprimera aussi toutes les captures d’écran du jeu.",
  // 0.0.27
  SETTING_WINE_VERSION_CONFIRM: "Cliquez ici pour confirmer la modification.",
  SETTING_WINE_VERSION_UPDATE_BUSY:
    "Wine environment updates are unavailable while a task, download, or game is running.",
  SETTING_QUICK_ACTIONS: "Actions rapides",
  SETTING_GENERAL: "Général",
  SETTING_DOWNLOAD: "Téléchargement",
  SETTING_GAME: "Jeu",
  SETTING_VIDEO: "Vidéo",
  SETTING_GLOBAL: "Paramètres globaux",
  SETTING_GAME_WINE: "Wine personnalisé",
  SETTING_GAME_WINE_SHARED: "Suivre le global",
  SETTING_GAME_WINE_DESC:
    "Choisissez une version de Wine téléchargée uniquement pour ce jeu ; « Suivre le global » utilise le Wine du lanceur.",
  LANGUAGE_LOCALE_NAME: "Français",
  SETTING_DISABLE_VIDEO_BACKGROUND: "Désactiver le fond vidéo",
  SETTING_DISABLE_VIDEO_BACKGROUND_DESC:
    "Désactive le fond vidéo animé de la page d'accueil et affiche l'image de fond statique.",
  SETTING_UI_LOCALE: "Langue de l’interface utilisateur du lanceur",
  SETTING_THEME_COLOR: "Launcher Theme Color",
  SETTING_THEME_COLOR_CUSTOM: "Custom Color",
  SETTING_RESTART_TO_TAKE_EFFECT:
    "Cette action prendra effet après le redémarrage.",
  SETTING_OPEN_CMD: "Lancer l’outil de ligne de commande Wine",
  SETTING_OPEN_WINE_CMD: en.SETTING_OPEN_WINE_CMD,
  SETTING_OPEN_WINECFG: en.SETTING_OPEN_WINECFG,
  SETTING_RESET_WINE_ENV: en.SETTING_RESET_WINE_ENV,
  SETTING_OPEN_GAME_INSTALL_DIR: "Ouvrir le répertoire d’installation du jeu",
  SETTING_OPEN_YAAGL_DIR: "Ouvrir le répertoire de données de YAAGLM",
  SETTING_YAAGL_VERSION: "Version de YAAGLM",

  SETTING_VSYNC_DISABLE: en.SETTING_VSYNC_DISABLE,
  SETTING_PREFERRED_MAX_FPS: en.SETTING_PREFERRED_MAX_FPS,
  SETTING_PREFERRED_MAX_FPS_DESC: en.SETTING_PREFERRED_MAX_FPS_DESC,
  SETTING_PREFERRED_MAX_FPS_AUTO: en.SETTING_PREFERRED_MAX_FPS_AUTO,
  SETTING_PREFERRED_MAX_FPS_RESET: en.SETTING_PREFERRED_MAX_FPS_RESET,
  SETTING_METALFX_UPSCALE: en.SETTING_METALFX_UPSCALE,
  SETTING_METALFX_FACTOR: en.SETTING_METALFX_FACTOR,

  SETTING_ADVANCED: "Avancé",
  SETTING_ADVANCED_ALERT:
    "NE CHANGEZ RIEN, à moins que vous sachiez ce que vous faites.",
  SETTING_ADVANCED_VISIBLE:
    "Les paramètres avancés sont maintenant disponibles.",
  SETTING_ENABLE_ADVANCED: en.SETTING_ENABLE_ADVANCED,
  SETTING_OPEN_SHADERS_FOLDER: en.SETTING_OPEN_SHADERS_FOLDER,

  NO_ENOUGH_DISKSPACE: "Pas assez d’espace libre sur le disque.",
  NO_ENOUGH_DISKSPACE_DESC:
    "Au moins {0}GiB ({1}GB) d’espace libre est nécessaire sur votre disque.",

  UPDATE: "Mettre à jour le jeu",
  GAME_VERSION_TOO_OLD_DESC:
    "Votre version actuelle du jeu ({0}) est trop ancienne pour être mise à jour progressivement. Veuillez réinstaller le jeu.",

  PREDOWNLOAD_READY: "Prétéléchargement {0}",

  COMMUNITY_WARNING: "Avertissement Communautaire",
  COMMUNITY_WINE_ALERT:
    "La sélection actuelle est la version communautaire, cette version n’est pas officiellement prise en charge, veuillez ne pas signaler de problèmes",

  SETTING_BLOCK_NET: "Bloquer temporairement le réseau via hosts",
  SETTING_BLOCK_NET_ENABLED: "Activer",
  SETTING_BLOCK_NET_URL: "URL à bloquer",
  SETTING_BLOCK_NET_DELETE: "Supprimer",
  SETTING_BLOCK_NET_ADD: "Ajouter une ligne",
  SETTING_BLOCK_NET_DURATION: "Durée du blocage (secondes)",
  SETTING_HOSTS_HELPER: "Hosts permission helper",
  SETTING_HOSTS_HELPER_STATUS_RUNNING: "Status: installed and running",
  SETTING_HOSTS_HELPER_STATUS_STOPPED: "Status: installed but not running",
  SETTING_HOSTS_HELPER_STATUS_NOT_INSTALLED: "Status: not installed",
  SETTING_HOSTS_HELPER_STATUS_ERROR: "Status: needs attention",
  SETTING_HOSTS_HELPER_INSTALL: "Install",
  SETTING_HOSTS_HELPER_UNINSTALL: "Uninstall",
  SETTING_HOSTS_HELPER_REFRESH: "Refresh",

  SETTING_HOSTS_HELPER_STATUS_DISABLED:
    "Status: disabled for development builds",
  SETTING_HOSTS_HELPER_DEV_TOOLTIP:
    "Hosts Helper is disabled in development builds",
  SETTING_HOSTS_HELPER_TOKEN_MISSING_TITLE:
    "Hosts Helper registration needs repair",
  SETTING_HOSTS_HELPER_TOKEN_MISSING_DESC:
    "The Hosts Helper token is missing. Delete the current registration before installing Hosts Helper again. macOS administrator authorization is required.",
  SETTING_HOSTS_HELPER_DELETE_REGISTRATION: "Delete current registration",
  SETTING_HOSTS_HELPER_DELETE_REGISTRATION_BUSY:
    "Requesting administrator authorization and deleting the registration…",
  SETTING_HOSTS_HELPER_LATER: "Later",
  SETTING_HOSTS_HELPER_DELETE_REGISTRATION_SUCCESS:
    "The current Hosts Helper registration was deleted",
  SETTING_HOSTS_HELPER_DELETE_REGISTRATION_AUTH_REQUIRED:
    "Administrator authorization is required to delete the Hosts Helper registration",
  SETTING_HOSTS_HELPER_REREGISTERING: "Updating Hosts Helper registration…",
  SETTING_HOSTS_HELPER_REREGISTER_FAILED:
    "Automatic Hosts Helper re-registration failed. Reinstall it from Global Settings.",
  SETTING_TIMEOUT_FIX: "Activer le contournement des délais Wine",
  SETTING_WORKAROUND4:
    "Remplacer temporairement mhypbase.dll pendant l’exécution du jeu",
  SETTING_WORKAROUND4_DESC:
    "Avant le lancement, l’ancienne mhypbase.dll sélectionnée est copiée dans le dossier du jeu et conservée pendant l’exécution du jeu. Le fichier d’origine est restauré après la fermeture du jeu. Le lanceur n’intègre ni ne distribue cette DLL.",
  SETTING_WORKAROUND4_PICK: "Choisir un fichier...",
  SETTING_RUNTIME_REPLACEMENT_PICK_TOOLTIP: "Bouton de sélection",
  SETTING_WORKAROUND4_REVERT_BTN:
    "Restaurer maintenant la mhypbase.dll d’origine",
  SETTING_LICENSES: "Licences",
  SETTING_ENABLE_HDR: "Activer le HDR",

  SETTING_PROXY_ENABLED: "Activer le proxy HTTP",
  SETTING_PROXY_HOST: "Hôte du proxy HTTP",
  SETTING_PROXY_DESC:
    "Le proxy ne s’applique qu’au jeu, pas à tout le lanceur.",

  SETTING_TURN_ON_STEAM_PATCH: "Activer le patch Steam",

  UPDATE_PROMPT_IGNORE: "Ignorer la mise à jour",
  SETTING_CHECK_UPDATE: "Rechercher des mises à jour YAAGLM",
  SETTING_CHECK_GAME_UPDATE: "Rechercher des mises à jour du jeu",
  SETTING_GAME_UPDATE_AVAILABLE: "Nouvelle version du jeu disponible",
  SETTING_GAME_UPDATE_AVAILABLE_DESC:
    "Une nouvelle version du jeu est disponible. Installer maintenant ?",
  SETTING_CONFIRM_INSTALL: "Confirmer l'installation",
  SETTING_CANCEL_INSTALL: "Annuler l'installation",
  ALREADY_LATEST_VERSION: "Vous utilisez déjà la dernière version.",
  UPDATE_LAUNCHER: "Mettre à jour le lanceur",
  INIT_ENVIRONMENT: "Initialize Environment",
  INIT_ENVIRONMENT_TITLE: "Initialize Runtime Environment",
  INIT_ENVIRONMENT_DESC:
    "The Wine runtime environment must be initialized before installing or launching the game. You can skip this now and initialize it later.",
  INIT_ENVIRONMENT_CONFIRM_DESC: en.INIT_ENVIRONMENT_CONFIRM_DESC,
  INIT_ENVIRONMENT_USE_RECOMMENDED: en.INIT_ENVIRONMENT_USE_RECOMMENDED,
  INIT_ENVIRONMENT_CUSTOM_WINE: en.INIT_ENVIRONMENT_CUSTOM_WINE,
  INIT_ENVIRONMENT_WINE_VERSION: en.INIT_ENVIRONMENT_WINE_VERSION,
  SKIP: "Skip",
  DONT_REMIND_AGAIN: "Don't remind again",
  SETTING_WINE_STATUS: "Wine Status",
  SETTING_WINE_ENV_INITIALIZED: en.SETTING_WINE_ENV_INITIALIZED,
  SETTING_WINE_ENV_NOT_INITIALIZED: en.SETTING_WINE_ENV_NOT_INITIALIZED,
  SETTING_WINE_STATUS_INSTALLED: "Installed",
  SETTING_WINE_STATUS_NOT_INSTALLED: "Not installed",
  SETTING_WINE_STATUS_ENABLED: en.SETTING_WINE_STATUS_ENABLED,
  SETTING_WINE_INSTALL: en.SETTING_WINE_INSTALL,
  SETTING_WINE_ENABLE: en.SETTING_WINE_ENABLE,
  SETTING_WINE_UNINSTALL: en.SETTING_WINE_UNINSTALL,
  SETTING_WINE_ENABLED: en.SETTING_WINE_ENABLED,
  SETTING_WINE_UNINSTALLED: en.SETTING_WINE_UNINSTALLED,
  SETTING_WINE_UNINSTALL_CONFIRM_TITLE: en.SETTING_WINE_UNINSTALL_CONFIRM_TITLE,
  SETTING_WINE_UNINSTALL_CONFIRM_DESC: en.SETTING_WINE_UNINSTALL_CONFIRM_DESC,
  SETTING_WINE_UNINSTALL_CONFIRM: en.SETTING_WINE_UNINSTALL_CONFIRM,
  SETTING_WINE_INSTALL_INITIALIZES_ENVIRONMENT:
    en.SETTING_WINE_INSTALL_INITIALIZES_ENVIRONMENT,
  SETTING_WINE_PREFIX_PATH: "Chemin du Wine Prefix",
  SETTING_OPEN: "Ouvrir",
  LOG_VIEWER_TITLE: "Live Logs",
  LOG_VIEWER_EMPTY: "No logs yet",
  LOG_VIEWER_OPEN_HINT: "Click to view live logs",
  LOG_VIEWER_OPEN_ACTION: "Voir les logs en direct",
  LOG_VIEWER_OPEN_FILE: "Open Log File",
  LOG_VIEWER_FOLLOW_SCROLL: "Défilement automatique",
  LOG_VIEWER_COPY: "Copier les logs",
  LICENSE_COPY: "Copier la licence actuelle",
  SETTING_GITHUB_ACCELERATED_PREFIX:
    "Utiliser le préfixe d’accélération GitHub",
  SETTING_GITHUB_ACCELERATED_PREFIX_URL: "URL du préfixe d’accélération GitHub",
  SETTING_GITHUB_ACCELERATED_PREFIX_TEST: "Tester",
  SETTING_GITHUB_ACCELERATED_PREFIX_TESTING: "Test en cours...",
  SETTING_GITHUB_ACCELERATED_PREFIX_CONNECTED: "Connecté",
  SETTING_GITHUB_ACCELERATED_PREFIX_FAILED: "Échec de la connexion",
  SETTING_GITHUB_ACCELERATED_PREFIX_INVALID: "URL invalide",
  SETTING_AUTO_UPDATE: "Vérifier automatiquement les mises à jour du launcher",
  SETTING_AUTO_UPDATE_DEV_TOOLTIP:
    "Les versions de développement ne prennent pas en charge les mises à jour automatiques",
  SETTING_DOWNLOAD_SERVER: "Download Server",
  SETTING_DOWNLOAD_PROXY: "Download server HTTP proxy",
  SETTING_DOWNLOAD_PROXY_ENABLED: "Enable download HTTP proxy",
  SETTING_DOWNLOAD_PROXY_DESC:
    "Used for launcher downloads such as Wine, environment components, game files, and updates. http:// is used when no protocol is provided.",
  SETTING_DOWNLOAD_SPEED_LIMIT: "Download speed limit",
  SETTING_DOWNLOAD_SPEED_LIMIT_ENABLED: "Enable download speed limit",
  DOWNLOAD_MANAGER: "Téléchargements",
  DOWNLOAD_MANAGER_EMPTY: "Aucun téléchargement actif",
  DOWNLOAD_MANAGER_GLOBAL_TASK_WAITING:
    "Tâche d'environnement en cours ; autres téléchargements en pause",
  DOWNLOAD_TASK_ID: "ID de tâche",
  DOWNLOAD_STATUS_QUEUED: "En file d'attente",
  DOWNLOAD_STATUS_ACTIVE: "Téléchargement en cours",
  DOWNLOAD_STATUS_PAUSED: "En pause",
  DOWNLOAD_STATUS_COMPLETED: "Terminé",
  DOWNLOAD_STATUS_ERROR: "Erreur",
  DOWNLOAD_STATUS_CANCELLED: "Annulé",
  DOWNLOAD_PAUSE: "Pause",
  DOWNLOAD_RESUME: "Reprendre",
  DOWNLOAD_TASK_PREDOWNLOAD_SUFFIX: "Pré-téléchargement",
  DOWNLOAD_TASK_EXPAND: "Afficher les détails",
  DOWNLOAD_TASK_COLLAPSE: "Masquer les détails",
  DOWNLOAD_TASK_ENGINE: "Moteur de téléchargement",
  DOWNLOAD_TASK_UNKNOWN_SIZE: "Inconnu",
  SETTING_MAX_CONCURRENT_DOWNLOADS: "Limiter les téléchargements parallèles",
  SETTING_GAME_VERSION_NOT_INSTALLED: "Not installed",
  NOTIFICATION_TASK_COMPLETED: "Tâche terminée avec succès",
  NOTIFICATION_TASK_CANCELLED: "Tâche annulée",
  NOTIFICATION_TASK_FAILED:
    "Échec de la tâche. Consultez les journaux pour plus de détails.",
  NOTIFICATION_TASK_FAILED_TITLE: "Échec de la tâche",
  CHECK_UPDATE_FAILED: "Échec de la vérification des mises à jour",
  CHECK_UPDATE_FAILED_DESC:
    "Impossible de se connecter au serveur GitHub ({0})",
  CHECK_GAME_UPDATE_FAILED: "Échec de la vérification des mises à jour du jeu",
  CHECK_GAME_UPDATE_FAILED_DESC:
    "Impossible de se connecter au serveur de mise à jour. Vérifiez votre connexion réseau et réessayez.",
};
