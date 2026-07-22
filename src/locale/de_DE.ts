import { zh_CN } from "./zh_CN";
import { en } from "@locale/en";

export const de_DE: typeof zh_CN = {
  CONTENT_LANG_ID: "de-de",
  LAUNCH: "Spiel starten",
  INSTALL: "Spiel installieren",
  UPDATING: "Aktualisieren",
  DOWNLOADING: "Herunterladen",
  PAUSE_DOWNLOAD: "Download pausieren",
  RESUME_DOWNLOAD: "Download fortsetzen",
  CANCEL_DOWNLOAD: "Download abbrechen",
  FORCE_QUIT_GAME: "Spiel sofort beenden",
  FIXING_FILES: "Spieldateien reparieren {0}/{1}",
  PATCHING: "Spieldateien patchen",
  GAME_RUNNING: "Spiel läuft (SCHLIESSEN SIE DEN LAUNCHER NICHT)",
  GAME_RUNNING_CLOSE_TITLE: "Das Spiel läuft noch",
  GAME_RUNNING_CLOSE_DESC:
    'Das Spiel wurde noch nicht beendet. Soll der Spielprozess beim Beenden von YAAgl ebenfalls geschlossen werden?\n\nWähle "Ja", um Spiel und Launcher zu schließen.\nWähle "Nein", um nur den Launcher zu schließen und das Spiel nach Möglichkeit weiterlaufen zu lassen.\nWähle "Abbrechen", um zum Launcher zurückzukehren.',
  REVERT_PATCHING: "Patches rückgängig machen",
  SCANNING_FILES:
    "Überprüfe Integrität der Spieldateien. Abgeschlossene Dateien {0}/{1}",
  DOWNLOADING_ENVIRONMENT: "Umgebungsdateien herunterladen",
  DOWNLOADING_ENVIRONMENT_SPEED:
    "Umgebungsdateien herunterladen ({1}/{2}, {3}, {0})",
  EXTRACT_ENVIRONMENT: "Umgebung entpacken",
  CONFIGURING_ENVIRONMENT: "Umgebung konfigurieren",
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
  SETTING_QUICK_ACTIONS: "Schnellaktionen",
  SETTING_GENERAL: "Allgemein",
  SETTING_GAME: "Spiel",
  SETTING_VIDEO: "Video",
  LANGUAGE_LOCALE_NAME: "Deutsch",
  SETTING_UI_LOCALE: "Launcher UI-Sprache",
  SETTING_RESTART_TO_TAKE_EFFECT: "Dies wird nach dem Neustart wirksam.",
  SETTING_OPEN_CMD: "Wine-Kommandozeilenwerkzeug starten",
  SETTING_OPEN_GAME_INSTALL_DIR: "Spiel-Installationsverzeichnis öffnen",
  SETTING_OPEN_YAAGL_DIR: "YAAGL-Datenverzeichnis öffnen",
  SETTING_YAAGL_VERSION: "YAAGL-Version",

  SETTING_FPS_UNLOCK: "FPS-Limit aufheben",
  SETTING_FPS_UNLOCK_DEFAULT: "Deaktiviert",

  SETTING_ADVANCED: "Erweitert",
  SETTING_ADVANCED_ALERT:
    "ÄNDERN SIE NICHTS, es sei denn, Sie wissen, was Sie tun.",
  SETTING_ADVANCED_VISIBLE: "Erweiterte Einstellungen sind jetzt verfügbar.",

  NO_ENOUGH_DISKSPACE:
    "Nicht genügend freier Speicherplatz auf der Festplatte.",
  NO_ENOUGH_DISKSPACE_DESC:
    "Mindestens {0}GiB ({1}GB) freier Speicherplatz ist auf Ihrer Festplatte erforderlich.",

  UPDATE: "Spiel aktualisieren",
  GAME_VERSION_TOO_OLD_DESC:
    "Ihre aktuelle Spielversion ({0}) ist zu alt, um inkrementell aktualisiert zu werden. Bitte installieren Sie das Spiel neu.",

  PREDOWNLOAD_READY: "Pre-Download {0}",

  COMMUNITY_WARNING: "Gemeiner alarm.",
  COMMUNITY_WINE_ALERT:
    "Aktuelle version als gemeindeversion, die nicht offiziell unterstützt wird. Bitte berichten sie nicht über Fragen.",

  SETTING_BLOCK_NET: "Netzwerk temporär über hosts blockieren",
  SETTING_BLOCK_NET_DURATION: "Blockierdauer (Sekunden)",
  SETTING_TIMEOUT_FIX: "Wine-Timeout-Workaround aktivieren",
  SETTING_WORKAROUND4: "mhypbase.dll während des Spiels temporär ersetzen",
  SETTING_WORKAROUND4_DESC:
    "Vor dem Start wird die ausgewählte ältere mhypbase.dll in den Spielordner kopiert und während des laufenden Spiels beibehalten. Nach dem Beenden des Spiels wird die Originaldatei wiederhergestellt. Der Launcher enthält oder verteilt diese DLL nicht.",
  SETTING_WORKAROUND4_PICK: "Datei auswählen ...",
  SETTING_WORKAROUND4_REVERT_BTN:
    "Originale mhypbase.dll jetzt wiederherstellen",
  SETTING_LICENSES: "Lizenzen",
  SETTING_ENABLE_HDR: "HDR aktivieren",

  SETTING_PROXY_ENABLED: "HTTP-Proxy aktivieren",
  SETTING_PROXY_HOST: "HTTP-Proxy-Host",
  SETTING_PROXY_DESC:
    "Der Proxy gilt nur für das Spiel, nicht für den gesamten Launcher.",

  SETTING_TURN_ON_STEAM_PATCH: "Steam-Patch aktivieren",

  UPDATE_PROMPT_IGNORE: "Update ignorieren",
  SETTING_CHECK_UPDATE: "Nach YAAGL-Updates suchen",
  SETTING_CHECK_GAME_UPDATE: "Nach Spiel-Updates suchen",
  ALREADY_LATEST_VERSION: "Sie verwenden bereits die neueste Version.",
  UPDATE_LAUNCHER: "Launcher aktualisieren",
  INIT_ENVIRONMENT: "Initialize Environment",
  INIT_ENVIRONMENT_TITLE: "Initialize Runtime Environment",
  INIT_ENVIRONMENT_DESC:
    "The Wine runtime environment must be initialized before installing or launching the game. You can skip this now and initialize it later.",
  SKIP: "Skip",
  DONT_REMIND_AGAIN: "Don't remind again",
  SETTING_WINE_STATUS: "Wine Status",
  SETTING_WINE_STATUS_INSTALLED: "Installed",
  SETTING_WINE_STATUS_NOT_INSTALLED: "Not installed",
  SETTING_WINE_PREFIX_PATH: "Wine-Prefix-Pfad",
  SETTING_OPEN: "Öffnen",
  LOG_VIEWER_TITLE: "Live Logs",
  LOG_VIEWER_EMPTY: "No logs yet",
  LOG_VIEWER_OPEN_HINT: "Click to view live logs",
  LOG_VIEWER_OPEN_ACTION: "Live-Logs anzeigen",
  LOG_VIEWER_OPEN_FILE: "Open Log File",
  LOG_VIEWER_FOLLOW_SCROLL: "Automatisch scrollen",
  SETTING_DOWNLOAD_SERVER: "Download Server",
  SETTING_DOWNLOAD_PROXY: "Download server HTTP proxy",
  SETTING_DOWNLOAD_PROXY_ENABLED: "Enable download HTTP proxy",
  SETTING_DOWNLOAD_PROXY_DESC:
    "Used for launcher downloads such as Wine, environment components, game files, and updates. http:// is used when no protocol is provided.",
  SETTING_DOWNLOAD_SPEED_LIMIT: "Download speed limit",
  SETTING_DOWNLOAD_SPEED_LIMIT_ENABLED: "Enable download speed limit",
  SETTING_GAME_VERSION_NOT_INSTALLED: "Not installed",
};
