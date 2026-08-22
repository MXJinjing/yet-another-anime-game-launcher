import { zh_CN } from "./zh_CN";
import { en } from "@locale/en";

export const de_DE: typeof zh_CN = {
  CONTENT_LANG_ID: "de-de",
  SERVER_LABEL_CN: "CN",
  SERVER_LABEL_GLOBAL: "Global",
  SERVER_LABEL_UNI: "Universal",
  BOOT_INITIALIZING: "Initialisierung",
  BOOT_LOADING_LOCAL_SETTINGS: "Lokale Einstellungen werden geladen",
  BOOT_CHECKING_NETWORK: "Netzwerkverbindung wird geprüft",
  BOOT_STARTING_DOWNLOAD_SERVICE: "Download-Dienst wird gestartet",
  BOOT_CHECKING_LAUNCHER_UPDATE: "Launcher-Updates werden geprüft",
  BOOT_CHECKING_WINE_ENVIRONMENT: "Wine-Umgebung wird geprüft",
  BOOT_PREPARING_WINE_ENVIRONMENT: "Wine-Umgebung wird vorbereitet",
  BOOT_INITIALIZING_RUNTIME: "Laufzeitumgebung wird initialisiert",
  BOOT_INITIALIZING_GAME_CLIENT: "Spielkanal-Konfiguration wird geladen",
  BOOT_COMPLETE: "Initialisierung abgeschlossen",
  BOOT_ENTERING_MAIN_SCREEN: "Hauptbildschirm wird geöffnet",
  BOOT_INITIALIZATION_FAILED: "Initialisierung fehlgeschlagen",
  LAUNCH: "Spiel starten",
  INSTALL: "Spiel installieren",
  CONTINUE_INSTALL: "Installation fortsetzen",
  UPDATING: "Aktualisieren",
  DOWNLOADING: "Herunterladen",
  DOWNLOAD_PAUSED: "Download pausiert",
  PAUSE_DOWNLOAD: "Download pausieren",
  RESUME_DOWNLOAD: "Download fortsetzen",
  CANCEL_DOWNLOAD: "Download abbrechen",
  DOWNLOAD_PROGRESS: "Download-Fortschritt",
  DOWNLOAD_FILE: "Datei",
  DOWNLOAD_FILE_INDEX: "Dateifortschritt",
  DOWNLOADED: "Heruntergeladen",
  DOWNLOAD_SPEED: "Geschwindigkeit",
  PROGRESS: "Fortschritt",
  PROCESSING: "Wird verarbeitet…",
  FORCE_QUIT_GAME: "Sofort beenden",
  FIXING_FILES: "Spieldateien reparieren {0}/{1}",
  PATCHING: "Spieldateien patchen",
  GAME_STARTING: "Spiel wird gestartet",
  GAME_CRASHED: "Spielabsturz erkannt",
  GAME_CRASHED_DESC:
    "Bitte prüfe, ob die Spielumgebung und die Starteinstellungen korrekt sind.",
  GAME_CRASHED_IGNORE: "Ignorieren",
  GAME_CRASHED_SETTINGS: "Zu den Spieleinstellungen",
  RUNTIME_REPLACEMENT_ERROR: "Fehler bei der temporären Ersatzdatei",
  RUNTIME_REPLACEMENT_ERROR_DESC:
    "Eine temporäre Ersatzdatei konnte vor dem Spielstart nicht überprüft werden. Prüfen Sie den Fehler unten und aktualisieren Sie den Pfad in den Spieleinstellungen.",
  GAME_RUNNING: "Spiel läuft",
  GAME_RECOVERING: "Wird wiederhergestellt",
  GAME_RUNNING_CLOSE_TITLE: "Das Spiel läuft noch",
  GAME_RUNNING_CLOSE_DESC:
    "Das Spiel wurde noch nicht beendet. Soll der Spielprozess beim Beenden des Launchers ebenfalls beendet werden?",
  GAME_RUNNING_CLOSE_EXIT: "Spiel schließen und beenden",
  DOWNLOAD_RUNNING_CLOSE_TITLE: "Download läuft",
  DOWNLOAD_RUNNING_CLOSE_DESC:
    "Derzeit läuft ein Download. Möchten Sie den Launcher beenden?\n\nEin Beenden jetzt unterbricht den Download und kann unvollständige Dateien beschädigen.",
  DOWNLOAD_RUNNING_CLOSE_EXIT: "Beenden",

  REVERT_PATCHING: "Patches rückgängig machen",
  SCANNING_FILES:
    "Überprüfe Integrität der Spieldateien. Abgeschlossene Dateien {0}/{1}",
  CHECKING_GAME_INTEGRITY: "Integrität der Spieldateien wird geprüft",
  DOWNLOADING_ENVIRONMENT: "Umgebungsdateien herunterladen",
  DOWNLOADING_ENVIRONMENT_SPEED:
    "Umgebungsdateien herunterladen ({1}/{2}, {3}, {0})",
  EXTRACT_ENVIRONMENT: "Umgebung entpacken",
  CONFIGURING_ENVIRONMENT: "Umgebung konfigurieren",
  ENVIRONMENT_CONFIGURING: "Umgebung wird konfiguriert",
  UNINSTALLING_ENVIRONMENT: en.UNINSTALLING_ENVIRONMENT,
  RESTART_TO_INSTALL: "Programm neu starten",
  PATH_INVALID: "Pfad ist ungültig",
  PLEASE_SELECT_A_DIR: "Bitte wählen Sie einen Pfad",
  PATH_INVALID_ASCII_ONLY:
    "Bitte stellen Sie sicher, dass der Pfad nur ASCII-Zeichen enthält.",
  PATH_INVALID_FORBIDDEN_DIR:
    'Bitte wählen Sie einen Pfad, der nicht in "Desktop", "Downloads" oder "Dokumente" liegt',
  NOT_SUPPORTED_YET: "Nicht unterstützte Funktion",
  PLEASE_WAIT_FOR_LAUNCHER_UPDATE:
    "Der Launcher unterstützt derzeit Version {0} nicht. Bitte warten Sie auf weitere Updates.",
  UNSUPPORTED_VERSION: "Nicht unterstützte Version",
  SELECT_INSTALLATION_DIR:
    "Bitte wählen Sie das Installationsverzeichnis des Spiels.\nWenn Sie das Spiel bereits installiert haben, wählen Sie das Verzeichnis, in dem sich die ausführbare Spieldatei befindet.",
  CANT_OPEN_GAME_FILE: "Zugriff auf Spieldateien fehlgeschlagen.",
  CANT_OPEN_GAME_FILE_DESC:
    "Der Launcher konnte nicht auf die Spieldateien zugreifen.\nBitte passen Sie das Installationsverzeichnis des Spiels nach diesem Dialog an.\n\nWenn dieser Dialog wiederholt angezeigt wird, stellen Sie bitte sicher, dass der Launcher die Berechtigung hat, auf das Spielverzeichnis zuzugreifen.",
  GAME_DIR_CHANGED: "Der Pfad zum Spielverzeichnis wurde geändert.",
  GAME_DIR_CHANGED_DESC:
    "Sie haben Ihren Spielpfad geändert. Diese Operation wird nicht unterstützt, kann jedoch später angepasst werden.",
  GAME_VERSION: "Spielversion",

  NEW_VERSION_AVAILABLE: "Ein neues Update ist verfügbar",
  NEW_VERSION_AVAILABLE_DESC:
    "Möchten Sie den Launcher auf Version {0} aktualisieren?\n Änderungen:\n{1}",

  DOWNLOADING_UPDATE_FILE: "Update-Dateien herunterladen",

  UPGRADE_FUNCTION_TBD: "Aktualisierung ist derzeit nicht implementiert.",

  DECOMPRESS_FILE_PROGRESS: "Dateien entpacken",
  ALLOCATING_FILE: "Dateien auf der Festplatte zuweisen",
  DOWNLOADING_FILE_PROGRESS: "Datei herunterladen: {0} ({2}/{3}, {4}) {1}",

  BACKUP_USER_DATA: "Benutzerdaten sichern",
  RECOVER_BACKUP_USER_DATA: "Sicherung wiederherstellen",

  INSTALL_DONE: "Fertig",

  RELAUNCH_REQUIRED: "Neustart des Launchers erforderlich",
  RELAUNCH_REQUIRED_DESC:
    "Der Launcher wird neu gestartet, um die Wine-Installation abzuschließen.",

  SETTING: "Einstellungen",
  SETTING_WINE_VERSION: "Wine-Distribution",
  SETTING_ASYNC_DXVK: "DXVK Asynchrones Shader-Kompilieren",
  SETTING_ENABLED: "Aktiviert",
  SETTING_DXVK_HUD: "DXVK HUD",
  SETTING_DXVK_HUD_NONE: "Keine",
  SETTING_DXVK_HUD_FPS: "Nur FPS",
  SETTING_DXVK_HUD_ALL: "Alles",
  SETTING_MTL_HUD: "Metal HUD",
  SETTING_RETINA: "Retina-Modus",
  SETTING_LEFT_CMD: "Linke CMD zu CTRL zuordnen",
  SETTING_TURN_OFF_AC_PATCH: "AC-Patch deaktivieren",
  SETTING_CUSTOM_RESOLUTION: "Benutzerdefinierte Auflösung",
  SETTING_DISPLAY_MODE: "Anzeigemodus",
  SETTING_DISPLAY_MODE_FULLSCREEN: "Vollbild",
  SETTING_DISPLAY_MODE_WINDOWED: "Fenster",
  SETTING_WINDOW_RESOLUTION: "Fensterauflösung",
  SETTING_SAVE: "Speichern",
  SETTING_CANCEL: "Abbrechen",

  SETTING_CHECK_INTEGRITY: "Integrität prüfen",
  SETTING_GAME_INSTALL_DIR: "Spiel-Installationsverzeichnis",
  SETTING_CHANGE_GAME_INSTALL_DIR: "Ändern",
  SETTING_GAME_DIR_SIZE: "Größe: {0}",
  SETTING_GAME_DIR_SIZE_NOT_SET: "Nicht festgelegt",
  SETTING_UNINSTALL_GAME: "Spiel deinstallieren",
  SETTING_UNINSTALL_GAME_CONFIRM:
    "Der folgende Spielordner wird geleert. Dies kann nicht rückgängig gemacht werden:\n{0}\n\nFortfahren?",
  SETTING_UNINSTALL_SCREENSHOTS_NOTICE:
    "Hinweis: Beim Deinstallieren werden auch alle Spiel-Screenshots gelöscht.",
  // 0.0.27
  SETTING_WINE_VERSION_CONFIRM: "Hier klicken, um die Änderung zu bestätigen.",
  SETTING_WINE_VERSION_UPDATE_BUSY:
    "Wine environment updates are unavailable while a task, download, or game is running.",
  SETTING_QUICK_ACTIONS: "Schnellaktionen",
  SETTING_GENERAL: "Allgemein",
  SETTING_DOWNLOAD: "Download",
  SETTING_GAME: "Spiel",
  SETTING_VIDEO: "Video",
  SETTING_GLOBAL: "Globale Einstellungen",
  SETTING_GAME_WINE: "Benutzerdefiniertes Wine",
  SETTING_GAME_WINE_SHARED: "Global folgen",
  SETTING_GAME_WINE_DESC:
    "Wählen Sie eine heruntergeladene Wine-Version nur für dieses Spiel; „Global folgen“ verwendet das Wine des Launchers.",
  LANGUAGE_LOCALE_NAME: "Deutsch",
  SETTING_DISABLE_VIDEO_BACKGROUND: "Video-Hintergrund deaktivieren",
  SETTING_DISABLE_VIDEO_BACKGROUND_DESC:
    "Deaktiviert den animierten Video-Hintergrund der Startseite und zeigt stattdessen das statische Hintergrundbild.",
  SETTING_UI_LOCALE: "Launcher UI-Sprache",
  SETTING_THEME_COLOR: "Launcher Theme Color",
  SETTING_THEME_COLOR_CUSTOM: "Custom Color",
  SETTING_RESTART_TO_TAKE_EFFECT: "Dies wird nach dem Neustart wirksam.",
  SETTING_OPEN_CMD: "Wine-Kommandozeilenwerkzeug starten",
  SETTING_OPEN_WINE_CMD: en.SETTING_OPEN_WINE_CMD,
  SETTING_OPEN_WINECFG: en.SETTING_OPEN_WINECFG,
  SETTING_RESET_WINE_ENV: en.SETTING_RESET_WINE_ENV,
  SETTING_OPEN_GAME_INSTALL_DIR: "Spiel-Installationsverzeichnis öffnen",
  SETTING_OPEN_YAAGL_DIR: "YAAGLM-Datenverzeichnis öffnen",
  SETTING_YAAGL_VERSION: "YAAGLM-Version",

  SETTING_VSYNC_DISABLE: en.SETTING_VSYNC_DISABLE,
  SETTING_PREFERRED_MAX_FPS: en.SETTING_PREFERRED_MAX_FPS,
  SETTING_PREFERRED_MAX_FPS_DESC: en.SETTING_PREFERRED_MAX_FPS_DESC,
  SETTING_PREFERRED_MAX_FPS_AUTO: en.SETTING_PREFERRED_MAX_FPS_AUTO,
  SETTING_PREFERRED_MAX_FPS_RESET: en.SETTING_PREFERRED_MAX_FPS_RESET,
  SETTING_METALFX_UPSCALE: en.SETTING_METALFX_UPSCALE,
  SETTING_METALFX_FACTOR: en.SETTING_METALFX_FACTOR,

  SETTING_ADVANCED: "Erweitert",
  SETTING_ADVANCED_ALERT:
    "ÄNDERN SIE NICHTS, es sei denn, Sie wissen, was Sie tun.",
  SETTING_ADVANCED_VISIBLE: "Erweiterte Einstellungen sind jetzt verfügbar.",
  SETTING_ENABLE_ADVANCED: en.SETTING_ENABLE_ADVANCED,
  SETTING_OPEN_SHADERS_FOLDER: en.SETTING_OPEN_SHADERS_FOLDER,

  NO_ENOUGH_DISKSPACE:
    "Nicht genügend freier Speicherplatz auf der Festplatte.",
  NO_ENOUGH_DISKSPACE_DESC:
    "Mindestens {0}GiB ({1}GB) freier Speicherplatz ist auf Ihrer Festplatte erforderlich.",

  UPDATE: "Spiel aktualisieren",

  LAUNCH_WITHOUT_UPDATE: "Ohne Update starten",
  GAME_VERSION_TOO_OLD_DESC:
    "Ihre aktuelle Spielversion ({0}) ist zu alt, um inkrementell aktualisiert zu werden. Bitte installieren Sie das Spiel neu.",

  PREDOWNLOAD_READY: "Pre-Download {0}",

  COMMUNITY_WARNING: "Gemeiner alarm.",
  COMMUNITY_WINE_ALERT:
    "Aktuelle version als gemeindeversion, die nicht offiziell unterstützt wird. Bitte berichten sie nicht über Fragen.",

  SETTING_BLOCK_NET: "Netzwerk temporär über hosts blockieren",
  SETTING_BLOCK_NET_ENABLED: "Aktiv",
  SETTING_BLOCK_NET_URL: "Zu blockierende URL",
  SETTING_BLOCK_NET_DELETE: "Löschen",
  SETTING_BLOCK_NET_ADD: "Zeile hinzufügen",
  SETTING_BLOCK_NET_DURATION: "Blockierdauer (Sekunden)",
  SETTING_HOSTS_HELPER: "Hosts permission helper",
  SETTING_HOSTS_HELPER_STATUS_RUNNING: "Status: installed and running",
  SETTING_HOSTS_HELPER_STATUS_STOPPED: "Status: installed but not running",
  SETTING_HOSTS_HELPER_STATUS_REGISTRATION_CONFLICT:
    "Status: installed but registration conflict",
  SETTING_HOSTS_HELPER_REREGISTER: "Re-register",
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
    "The Hosts Helper is installed but the current launcher cannot authenticate it. Re-registering replaces only this bundle's registration and rotates its token, without affecting other registrations. macOS administrator authorization is required.",
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
    "Hosts Helper re-registration failed. Try again, or uninstall and reinstall it from Global Settings.",
  SETTING_HOSTS_HELPER_REPAIR_DESC:
    "The Hosts Helper is installed but the current launcher cannot authenticate it. Re-registering replaces only this bundle's registration and rotates its token, without affecting other registrations. macOS administrator authorization is required.",
  SETTING_HOSTS_HELPER_REREGISTER_SUCCESS:
    "The Hosts Helper registration was repaired",
  SETTING_TIMEOUT_FIX: "Wine-Timeout-Workaround aktivieren",
  SETTING_WORKAROUND4_PICK: "Datei auswählen ...",
  SETTING_RUNTIME_REPLACEMENT_PICK_TOOLTIP: "Auswahltaste",
  SETTING_RUNTIME_REPLACEMENT_TITLE: "Dateien während des Spiels ersetzen",
  SETTING_RUNTIME_REPLACEMENT_DESC:
    "Vor dem Start werden die ausgewählten Dateien über die Zieldateien im Spielordner kopiert und während des laufenden Spiels beibehalten. Nach dem Beenden des Spiels werden die Originale wiederhergestellt.",
  SETTING_RUNTIME_REPLACEMENT_HEADER_ENABLED: "Aktiviert",
  SETTING_RUNTIME_REPLACEMENT_HEADER_TARGET: "Zu ersetzende Datei",
  SETTING_RUNTIME_REPLACEMENT_HEADER_REPLACEMENT: "Ersatzdatei",
  SETTING_RUNTIME_REPLACEMENT_HEADER_DELETE: "Löschen",
  SETTING_RUNTIME_REPLACEMENT_ROW_ENABLED: "Zeile {0} aktivieren",
  SETTING_RUNTIME_REPLACEMENT_PICK_TARGET: "Zu ersetzende Datei auswählen",
  SETTING_RUNTIME_REPLACEMENT_PICK_REPLACEMENT: "Ersatzdatei auswählen",
  SETTING_RUNTIME_REPLACEMENT_DELETE_ROW: "Diese Zeile löschen",
  SETTING_RUNTIME_REPLACEMENT_ADD_ROW: "Zeile hinzufügen",
  SETTING_CUSTOM_ENVIRONMENT_VARIABLES_TITLE:
    "Benutzerdefinierte Umgebungsvariablen",
  SETTING_CUSTOM_ENVIRONMENT_VARIABLES_DESC:
    "Fügt dem Wine-Prozess beim Start des Spiels benutzerdefinierte Umgebungsvariablen hinzu.",
  SETTING_CUSTOM_ENVIRONMENT_VARIABLES_HEADER_ENABLED: "Aktiv",
  SETTING_CUSTOM_ENVIRONMENT_VARIABLES_HEADER_KEY:
    "Umgebungsvariablen-Schlüssel",
  SETTING_CUSTOM_ENVIRONMENT_VARIABLES_HEADER_VALUE: "Wert",
  SETTING_CUSTOM_ENVIRONMENT_VARIABLES_HEADER_DELETE: "Löschen",
  SETTING_CUSTOM_ENVIRONMENT_VARIABLES_ROW_ENABLED:
    "Umgebungsvariablen-Zeile {0} aktivieren",
  SETTING_CUSTOM_ENVIRONMENT_VARIABLES_DELETE_ROW: "Diese Zeile löschen",
  SETTING_CUSTOM_ENVIRONMENT_VARIABLES_ADD_ROW: "Zeile hinzufügen",
  SETTING_RUNTIME_REPLACEMENT_RESTORE_ALL:
    "Alle Sicherungen jetzt wiederherstellen",
  SETTING_LICENSES: "Lizenzen",
  SETTING_ENABLE_HDR: "HDR aktivieren",

  SETTING_PROXY_ENABLED: "HTTP-Proxy aktivieren",
  SETTING_PROXY_HOST: "HTTP-Proxy-Host",
  SETTING_PROXY_DESC:
    "Der Proxy gilt nur für das Spiel, nicht für den gesamten Launcher.",

  SETTING_TURN_ON_STEAM_PATCH: "Steam-Patch aktivieren",

  UPDATE_PROMPT_IGNORE: "Update ignorieren",
  SETTING_CHECK_UPDATE: "Nach YAAGLM-Updates suchen",
  SETTING_CHECK_GAME_UPDATE: "Nach Spiel-Updates suchen",
  SETTING_GAME_UPDATE_AVAILABLE: "Neue Spielversion verfügbar",
  SETTING_GAME_UPDATE_AVAILABLE_DESC:
    "Eine neue Version des Spiels ist verfügbar. Jetzt installieren?",
  SETTING_CONFIRM_INSTALL: "Installation bestätigen",
  SETTING_CANCEL_INSTALL: "Installation abbrechen",
  CANCEL_UPDATE: "Update abbrechen",
  ALREADY_LATEST_VERSION: "Sie verwenden bereits die neueste Version.",
  AHEAD_OF_LATEST_TITLE: "Neuer als die neueste Version",
  AHEAD_OF_LATEST_JOKE:
    "Während die offizielle Version noch im Schneckentempo aktualisiert 🐌, bist du schon in der nächsten Generation 🚀. Bleib unauffällig \u2013 nicht spoilern 🤫.",
  UPDATE_LAUNCHER: "Launcher aktualisieren",
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
  SETTING_WINE_PREFIX_PATH: "Wine-Prefix-Pfad",
  SETTING_OPEN: "Öffnen",
  LOG_VIEWER_TITLE: "Live Logs",
  LOG_VIEWER_EMPTY: "No logs yet",
  LOG_VIEWER_OPEN_HINT: "Click to view live logs",
  LOG_VIEWER_OPEN_ACTION: "Live-Logs anzeigen",
  LOG_VIEWER_OPEN_FILE: "Open Log File",
  LOG_VIEWER_FOLLOW_SCROLL: "Automatisch scrollen",
  LOG_VIEWER_COPY: "Logs kopieren",
  LICENSE_VIEW_ONLINE: "Online ansehen",
  SETTING_GITHUB_ACCELERATED_PREFIX: "GitHub-Beschleunigungspräfix verwenden",
  SETTING_GITHUB_ACCELERATED_PREFIX_URL:
    "URL des GitHub-Beschleunigungspräfixes",
  SETTING_GITHUB_ACCELERATED_PREFIX_TEST: "Testen",
  SETTING_GITHUB_ACCELERATED_PREFIX_TESTING: "Wird getestet...",
  SETTING_GITHUB_ACCELERATED_PREFIX_CONNECTED: "Verbunden",
  SETTING_GITHUB_ACCELERATED_PREFIX_FAILED: "Verbindung fehlgeschlagen",
  SETTING_GITHUB_ACCELERATED_PREFIX_INVALID: "Ungültige URL",
  SETTING_AUTO_UPDATE: "Launcher-Updates automatisch prüfen",
  SETTING_AUTO_UPDATE_DEV_TOOLTIP:
    "Entwicklungsversionen unterstützen keine automatischen Updates",
  SETTING_DOWNLOAD_SERVER: "Download Server",
  SETTING_DOWNLOAD_PROXY: "Download server HTTP proxy",
  SETTING_DOWNLOAD_PROXY_ENABLED: "Enable download HTTP proxy",
  SETTING_DOWNLOAD_PROXY_DESC:
    "Used for launcher downloads such as Wine, environment components, game files, and updates. http:// is used when no protocol is provided.",
  SETTING_DOWNLOAD_SPEED_LIMIT: "Download speed limit",
  SETTING_DOWNLOAD_SPEED_LIMIT_ENABLED: "Enable download speed limit",
  DOWNLOAD_MANAGER: "Downloads",
  DOWNLOAD_MANAGER_EMPTY: "Keine aktiven Downloads",
  DOWNLOAD_MANAGER_GLOBAL_TASK_WAITING:
    "Umgebungstask läuft; andere Downloads pausiert",
  DOWNLOAD_TASK_ID: "Aufgaben-ID",
  DOWNLOAD_STATUS_QUEUED: "In der Warteschlange",
  DOWNLOAD_STATUS_ACTIVE: "Wird heruntergeladen",
  DOWNLOAD_STATUS_VERIFYING: "Wird überprüft",
  DOWNLOAD_STATUS_PAUSED: "Angehalten",
  DOWNLOAD_STATUS_COMPLETED: "Abgeschlossen",
  DOWNLOAD_STATUS_ERROR: "Fehler",
  DOWNLOAD_STATUS_CANCELLED: "Abgebrochen",
  DOWNLOAD_PAUSE: "Anhalten",
  DOWNLOAD_RESUME: "Fortsetzen",
  DOWNLOAD_TASK_PREDOWNLOAD_SUFFIX: "Vorabdownload",
  DOWNLOAD_TASK_EXPAND: "Details anzeigen",
  DOWNLOAD_TASK_COLLAPSE: "Details ausblenden",
  DOWNLOAD_TASK_ENGINE: "Download-Engine",
  DOWNLOAD_TASK_UNKNOWN_SIZE: "Unbekannt",
  SETTING_MAX_CONCURRENT_DOWNLOADS: "Parallele Downloads begrenzen",
  SETTING_GAME_VERSION_NOT_INSTALLED: "Not installed",
  NOTIFICATION_TASK_COMPLETED: "Aufgabe erfolgreich abgeschlossen",
  NOTIFICATION_TASK_CANCELLED: "Aufgabe abgebrochen",
  NOTIFICATION_TASK_FAILED:
    "Die Aufgabe ist fehlgeschlagen. Details finden Sie im Live-Log.",
  NOTIFICATION_TASK_FAILED_TITLE: "Aufgabe fehlgeschlagen",
  CHECK_UPDATE_FAILED: "Updateprüfung fehlgeschlagen",
  CHECK_UPDATE_FAILED_DESC: "Keine Verbindung zum GitHub-Server möglich ({0})",
  CHECK_GAME_UPDATE_FAILED: "Spielupdate-Prüfung fehlgeschlagen",
  CHECK_GAME_UPDATE_FAILED_DESC:
    "Der Updateserver ist nicht erreichbar. Bitte prüfen Sie Ihre Netzwerkverbindung und versuchen Sie es erneut.",
};
