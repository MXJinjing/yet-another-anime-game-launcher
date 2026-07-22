import { en } from "./en";
import { zh_CN } from "./zh_CN";

export const es_ES: typeof zh_CN = {
  CONTENT_LANG_ID: "es-es",
  LAUNCH: "Iniciar el juego",
  INSTALL: "Instalar el juego",
  UPDATING: "Actualizando",
  DOWNLOADING: "Descargando",
  FIXING_FILES: "Arreglando archivos del juego {0}/{1}",
  PATCHING: "Parchando archivos del juego",
  GAME_RUNNING: "El juego se está ejecutando (NO CIERRE LA APLICACIÓN)",
  REVERT_PATCHING: "Revirtiendo parches",
  SCANNING_FILES:
    "Verificando integridad de archivos. Archivos revisados {0}/{1}",
  DOWNLOADING_ENVIRONMENT: "Descargando archivos de entorno",
  DOWNLOADING_ENVIRONMENT_SPEED: "Descargando archivos de entorno ({0}/s)",
  EXTRACT_ENVIRONMENT: "Extrayendo entorno",
  CONFIGURING_ENVIRONMENT: "Configurando entorno",
  RESTART_TO_INSTALL: "Reinicie el programa",
  PATH_INVALID: "Ruta inválida",
  PLEASE_SELECT_A_DIR: "Por favor seleccione una ruta",
  PATH_INVALID_ASCII_ONLY:
    "Por favor cericiórese de que la ruta solo contenga caracteres ASCII",
  PATH_INVALID_FORBIDDEN_DIR:
    'Por favor seleccione una ruta que no esté dentro de "Escritorio", "Descargas" o "Documentos"',
  NOT_SUPPORTED_YET: "Función aún no soportada",
  PLEASE_WAIT_FOR_LAUNCHER_UPDATE:
    "La aplicación no soporta la versión {0} actualmente. Manténgase atento a una nueva actualización.",
  UNSUPPORTED_VERSION: "Versión no soportada",
  SELECT_INSTALLATION_DIR:
    "Por favor seleccione el directorio de instalación del juego.\nSi el juego ya está instalado, seleccione el directorio donde se ubica el ejecutable del juego",
  CANT_OPEN_GAME_FILE: "No se pudo acceder a los archivos del juego",
  CANT_OPEN_GAME_FILE_DESC:
    "La aplicación no pudo acceder a los archivos del juego.\nNo se preocupe, aún puede seleccionar el directorio de instalación del juego después de cerrar el cuadro de diálogo.\n\nSi el mensaje aparece repetidamente, revise que la aplicación tenga los permisos adecuados para acceder al directorio de instalación del juego",
  GAME_DIR_CHANGED: "La ruta al directorio ha cambiado",
  GAME_DIR_CHANGED_DESC:
    "Parece que ha seleccionado una ruta que difiere de la escogida anteriormente. Esta operación es inválida, pero puede seleccionar nuevamente",
  GAME_VERSION: "Versión del juego: ",

  NEW_VERSION_AVAILABLE: "Nueva versión disponible",
  NEW_VERSION_AVAILABLE_DESC:
    "Desea actualizar la aplicación a la versión {0}?\n Nuevos cambios:\n{1}",

  DOWNLOADING_UPDATE_FILE: "Descargando archivos de actualización",

  UPGRADE_FUNCTION_TBD:
    "La función de actualización no se encuentra implementada actualmente",

  DECOMPRESS_FILE_PROGRESS: "Descomprimiendo archivos",
  ALLOCATING_FILE: "Asignando archivos en disco",
  DOWNLOADING_FILE_PROGRESS: "Descargando archivos: {0} ({2}/{3}) {1}/s",

  BACKUP_USER_DATA: "Respaldando datos de usuario",
  RECOVER_BACKUP_USER_DATA: "Recuperando respaldo",

  INSTALL_DONE: "Listo",

  RELAUNCH_REQUIRED: "Reinicio requerido",
  RELAUNCH_REQUIRED_DESC:
    "La aplicación se reiniciará para procesar la instalación de Wine.",

  SETTING: "Ajustes",
  SETTING_WINE_VERSION: "Distribución de Wine",
  SETTING_ASYNC_DXVK: "Compilación Asincrónica de Shaders DXVK",
  SETTING_ENABLED: "Habilitado",
  SETTING_DXVK_HUD: "HUD DXVK",
  SETTING_DXVK_HUD_NONE: "Nada",
  SETTING_DXVK_HUD_FPS: "Solo FPS",
  SETTING_MTL_HUD: "Metal HUD",
  SETTING_DXVK_HUD_ALL: "Todo",
  SETTING_RETINA: "Modo Retina",
  SETTING_LEFT_CMD: "Asignar CMD izquierdo a CTRL",
  SETTING_TURN_OFF_AC_PATCH: "Apagar el AC parche",
  SETTING_CUSTOM_RESOLUTION: "Resolución personalizada",
  SETTING_DISPLAY_MODE: "Modo de visualización del juego",
  SETTING_DISPLAY_MODE_FULLSCREEN: "Pantalla completa",
  SETTING_DISPLAY_MODE_WINDOWED: "Ventana",
  SETTING_WINDOW_RESOLUTION: "Resolución de ventana",
  SETTING_SAVE: "Guardar",
  SETTING_CANCEL: "Cancelar",

  SETTING_CHECK_INTEGRITY: "Revisar Integridad",
  SETTING_GAME_INSTALL_DIR: "Directorio de Instalación del Juego",
  SETTING_CHANGE_GAME_INSTALL_DIR: "Cambiar",
  SETTING_GAME_DIR_SIZE: "Tamaño: {0}",
  SETTING_GAME_DIR_SIZE_NOT_SET: "No configurado",
  SETTING_UNINSTALL_GAME: "Desinstalar juego",
  SETTING_UNINSTALL_GAME_CONFIRM:
    "Esto vaciará la siguiente carpeta del juego y no se puede deshacer:\n{0}\n\n¿Continuar?",
  SETTING_UNINSTALL_SCREENSHOTS_NOTICE:
    "Nota: la desinstalación también eliminará todas las capturas de pantalla del juego.",
  // 0.0.27
  SETTING_WINE_VERSION_CONFIRM: en.SETTING_WINE_VERSION_CONFIRM,
  SETTING_QUICK_ACTIONS: "Acciones rápidas",
  SETTING_GENERAL: "General",
  SETTING_GAME: "Juego",
  SETTING_VIDEO: "Video",
  LANGUAGE_LOCALE_NAME: "Español",
  SETTING_UI_LOCALE: en.SETTING_UI_LOCALE,
  SETTING_RESTART_TO_TAKE_EFFECT: en.SETTING_RESTART_TO_TAKE_EFFECT,
  SETTING_OPEN_CMD: en.SETTING_OPEN_CMD,
  SETTING_OPEN_GAME_INSTALL_DIR: en.SETTING_OPEN_GAME_INSTALL_DIR,
  SETTING_OPEN_YAAGL_DIR: en.SETTING_OPEN_YAAGL_DIR,
  SETTING_YAAGL_VERSION: en.SETTING_YAAGL_VERSION,

  SETTING_FPS_UNLOCK: en.SETTING_FPS_UNLOCK,
  SETTING_FPS_UNLOCK_DEFAULT: en.SETTING_FPS_UNLOCK_DEFAULT,

  SETTING_ADVANCED: en.SETTING_ADVANCED,
  SETTING_ADVANCED_ALERT: en.SETTING_ADVANCED_ALERT,
  SETTING_ADVANCED_VISIBLE: en.SETTING_ADVANCED_VISIBLE,

  NO_ENOUGH_DISKSPACE: en.NO_ENOUGH_DISKSPACE,
  NO_ENOUGH_DISKSPACE_DESC: en.NEW_VERSION_AVAILABLE_DESC,

  UPDATE: en.UPDATE,
  GAME_VERSION_TOO_OLD_DESC: en.GAME_VERSION_TOO_OLD_DESC,

  PREDOWNLOAD_READY: en.PREDOWNLOAD_READY,

  COMMUNITY_WARNING: en.COMMUNITY_WARNING,
  COMMUNITY_WINE_ALERT: en.COMMUNITY_WINE_ALERT,

  SETTING_BLOCK_NET: "Bloquear temporalmente la red mediante hosts",
  SETTING_BLOCK_NET_DURATION: "Duración del bloqueo (segundos)",
  SETTING_TIMEOUT_FIX: "Activar ajuste de timeout de Wine",
  SETTING_WORKAROUND4: "Reemplazar temporalmente mhypbase.dll al iniciar",
  SETTING_WORKAROUND4_DESC:
    "Antes de iniciar, la mhypbase.dll antigua seleccionada se copia temporalmente en la carpeta del juego. El archivo original se restaura cuando se cierra el juego. El launcher no incluye ni distribuye esta DLL.",
  SETTING_WORKAROUND4_PICK: "Elegir archivo...",
  SETTING_WORKAROUND4_REVERT_BTN: "Restaurar ahora la mhypbase.dll original",
  SETTING_LICENSES: "Licencias",

  SETTING_ENABLE_HDR: "Activar HDR",

  SETTING_PROXY_ENABLED: "Activar Proxy HTTP",
  SETTING_PROXY_HOST: "Host del Proxy HTTP",
  SETTING_PROXY_DESC:
    "El proxy solo se aplica al juego, y no al launcher entero",

  SETTING_TURN_ON_STEAM_PATCH: "Activar Parche de Steam",

  UPDATE_PROMPT_IGNORE: "Ignorar actualización",
  SETTING_CHECK_UPDATE: "Buscar actualizaciones de YAAGL",
  ALREADY_LATEST_VERSION: "Ya estás utilizando la última versión.",
  UPDATE_LAUNCHER: "Actualizar Launcher",
};
