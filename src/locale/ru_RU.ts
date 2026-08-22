import { en } from "./en";
import { zh_CN } from "./zh_CN";

export const ru_RU: typeof zh_CN = {
  CONTENT_LANG_ID: "ru-ru",
  SERVER_LABEL_CN: "Китай",
  SERVER_LABEL_GLOBAL: "Международный",
  SERVER_LABEL_UNI: "Универсальный",
  BOOT_INITIALIZING: "Инициализация",
  BOOT_LOADING_LOCAL_SETTINGS: "Загрузка локальных настроек",
  BOOT_CHECKING_NETWORK: "Проверка сетевого подключения",
  BOOT_STARTING_DOWNLOAD_SERVICE: "Запуск службы загрузки",
  BOOT_CHECKING_LAUNCHER_UPDATE: "Проверка обновлений лаунчера",
  BOOT_CHECKING_WINE_ENVIRONMENT: "Проверка среды Wine",
  BOOT_PREPARING_WINE_ENVIRONMENT: "Подготовка среды Wine",
  BOOT_INITIALIZING_RUNTIME: "Инициализация среды выполнения",
  BOOT_INITIALIZING_GAME_CLIENT: "Загрузка конфигурации игрового канала",
  BOOT_COMPLETE: "Инициализация завершена",
  BOOT_ENTERING_MAIN_SCREEN: "Переход на главный экран",
  BOOT_INITIALIZATION_FAILED: "Ошибка инициализации",
  LAUNCH: "Запустить игру",
  INSTALL: "Установить игру",
  CONTINUE_INSTALL: "Продолжить установку",
  UPDATING: "Обновление",
  DOWNLOADING: "Загрузка",
  DOWNLOAD_PAUSED: "Загрузка приостановлена",
  PAUSE_DOWNLOAD: "Приостановить загрузку",
  RESUME_DOWNLOAD: "Продолжить загрузку",
  CANCEL_DOWNLOAD: "Отменить загрузку",
  DOWNLOAD_PROGRESS: "Ход загрузки",
  DOWNLOAD_FILE: "Файл",
  DOWNLOAD_FILE_INDEX: "Прогресс файла",
  DOWNLOADED: "Загружено",
  DOWNLOAD_SPEED: "Скорость",
  PROGRESS: "Прогресс",
  PROCESSING: "Обработка…",
  FORCE_QUIT_GAME: "Принудительно закрыть",
  FIXING_FILES: "Исправление игровых файлов {0}/{1}",
  PATCHING: "Патчинг игровых файлов",
  GAME_STARTING: "Запуск игры",
  GAME_CRASHED: "Обнаружено аварийное завершение игры",
  GAME_CRASHED_DESC:
    "Проверьте правильность окружения игры и параметров запуска.",
  GAME_CRASHED_IGNORE: "Игнорировать",
  GAME_CRASHED_SETTINGS: "Перейти к настройкам игры",
  RUNTIME_REPLACEMENT_ERROR: "Ошибка временного файла замены",
  RUNTIME_REPLACEMENT_ERROR_DESC:
    "Не удалось проверить временный файл замены перед запуском игры. Проверьте ошибку ниже и измените путь в настройках игры.",
  GAME_RUNNING: "Игра запущена",
  GAME_RECOVERING: "Восстановление",
  GAME_RUNNING_CLOSE_TITLE: "Игра всё ещё запущена",
  GAME_RUNNING_CLOSE_DESC:
    "Игра ещё не закрыта. Завершить игровой процесс при выходе из лаунчера?",
  GAME_RUNNING_CLOSE_EXIT: "Закрыть игру и выйти",
  DOWNLOAD_RUNNING_CLOSE_TITLE: "Идёт загрузка",
  DOWNLOAD_RUNNING_CLOSE_DESC:
    "В данный момент выполняется загрузка. Выйти из лаунчера?\n\nВыход сейчас прервёт загрузку и может повредить неполные файлы.",
  DOWNLOAD_RUNNING_CLOSE_EXIT: "Выйти",

  REVERT_PATCHING: "Откат патчей",
  SCANNING_FILES: "Проверка целостности файлов игры. Завершенные файлы {0}/{1}",
  CHECKING_GAME_INTEGRITY: "Проверка целостности файлов игры",
  DOWNLOADING_ENVIRONMENT: "Загрузка файлов окружения",
  DOWNLOADING_ENVIRONMENT_SPEED:
    "Загрузка файлов окружения ({1}/{2}, {3}, {0})",
  EXTRACT_ENVIRONMENT: "Распаковка окружения",
  CONFIGURING_ENVIRONMENT: "Настройка окружения",
  ENVIRONMENT_CONFIGURING: "Настройка окружения",
  UNINSTALLING_ENVIRONMENT: en.UNINSTALLING_ENVIRONMENT,
  RESTART_TO_INSTALL: "Перезапустить программу",
  PATH_INVALID: "Неверный путь",
  PLEASE_SELECT_A_DIR: "Пожалуйста, выберите путь",
  PATH_INVALID_ASCII_ONLY: "Убедитесь, что путь содержит только символы ASCII.",
  PATH_INVALID_FORBIDDEN_DIR:
    'Пожалуйста, выберите путь, который не находится внутри "Рабочий стол", "Загрузки" или "Документы".',
  NOT_SUPPORTED_YET: "Функция еще не поддерживается",
  PLEASE_WAIT_FOR_LAUNCHER_UPDATE:
    "В настоящее время лаунчер не поддерживает версию {0}, дождитесь обновлений",
  UNSUPPORTED_VERSION: "Не поддерживаемая версия",
  SELECT_INSTALLATION_DIR:
    "Пожалуйста, выберите каталог установки игры.\nЕсли вы уже установили игру, выберите, где находится исполняемый файл игры.",
  CANT_OPEN_GAME_FILE: "Не удалось получить доступ к файлу игры",
  CANT_OPEN_GAME_FILE_DESC:
    "Лаунчеру не удалось получить доступ к файлу игры.\nНо не волнуйтесь, вы можете снова выбрать каталог установки игры, когда это диалоговое окно закроется\n\nЕсли это диалоговое окно появляется повторно, пожалуйста, проверьте, имеет ли программа запуска правильные разрешения для доступа к каталогу установки игры",
  GAME_DIR_CHANGED: "Путь к каталогу изменен",
  GAME_DIR_CHANGED_DESC:
    "Похоже, вы выбрали другой путь, который отличается от ранее выбранного. Эта операция недопустима, но вы можете выбрать ее позже",
  GAME_VERSION: "Версия игры",

  NEW_VERSION_AVAILABLE: "Доступна новая версия",
  NEW_VERSION_AVAILABLE_DESC:
    "Хотите ли вы обновить лаунчер до версии {0}?\n Что обновлено:\n{1}",

  DOWNLOADING_UPDATE_FILE: "Загрузка файлов обновлений",

  UPGRADE_FUNCTION_TBD: "В настоящее время функция обновления не реализована",

  DECOMPRESS_FILE_PROGRESS: "Распаковка файлов",
  ALLOCATING_FILE: "Выделение места на диске",
  DOWNLOADING_FILE_PROGRESS: "Загрузка файла: {0} ({2}/{3}, {4}) {1}",

  BACKUP_USER_DATA: "Резервное копирование пользовательских данных",
  RECOVER_BACKUP_USER_DATA: "Восстановление резервной копии",

  INSTALL_DONE: "Готово",

  RELAUNCH_REQUIRED: "Требуется повторный запуск",
  RELAUNCH_REQUIRED_DESC:
    "Программа запуска перезагрузится, чтобы выполнить установку Wine.",

  SETTING: "Настройки",
  SETTING_WINE_VERSION: "Версия Wine",
  SETTING_ASYNC_DXVK: "Асинхронная компиляция шейдеров DXVK",
  SETTING_ENABLED: "Включено",
  SETTING_DXVK_HUD: "Оверлей DXVK",
  SETTING_DXVK_HUD_NONE: "Ничего",
  SETTING_DXVK_HUD_FPS: "Только FPS",
  SETTING_MTL_HUD: "Оверлей Metal",
  SETTING_DXVK_HUD_ALL: "Всё",
  SETTING_RETINA: "Режим Retina",
  SETTING_LEFT_CMD: "Назначить левый CMD как CTRL",
  SETTING_TURN_OFF_AC_PATCH: "Отключить патч АЧ",
  SETTING_CUSTOM_RESOLUTION: "Пользовательское разрешение",
  SETTING_DISPLAY_MODE: "Режим отображения",
  SETTING_DISPLAY_MODE_FULLSCREEN: "Полный экран",
  SETTING_DISPLAY_MODE_WINDOWED: "Оконный",
  SETTING_WINDOW_RESOLUTION: "Разрешение окна",
  SETTING_SAVE: "Сохранить",
  SETTING_CANCEL: "Отменить",

  SETTING_CHECK_INTEGRITY: "Проверить целостность файлов",
  SETTING_GAME_INSTALL_DIR: "Каталог установки игры",
  SETTING_CHANGE_GAME_INSTALL_DIR: "Изменить",
  SETTING_GAME_DIR_SIZE: "Размер: {0}",
  SETTING_GAME_DIR_SIZE_NOT_SET: "Не задано",
  SETTING_UNINSTALL_GAME: "Удалить игру",
  SETTING_UNINSTALL_GAME_CONFIRM:
    "Следующая папка игры будет очищена. Это действие нельзя отменить:\n{0}\n\nПродолжить?",
  SETTING_UNINSTALL_SCREENSHOTS_NOTICE:
    "Внимание: при удалении также будут удалены все скриншоты игры.",
  // 0.0.27
  SETTING_WINE_VERSION_CONFIRM: "Нажмите для подтверждения изменений",
  SETTING_WINE_VERSION_UPDATE_BUSY:
    "Wine environment updates are unavailable while a task, download, or game is running.",
  SETTING_QUICK_ACTIONS: "Быстрые действия",
  SETTING_GENERAL: "Основные",
  SETTING_DOWNLOAD: "Загрузка",
  SETTING_GAME: "Игра",
  SETTING_VIDEO: "Видео",
  SETTING_GLOBAL: "Глобальные настройки",
  SETTING_GAME_WINE: "Свой Wine",
  SETTING_GAME_WINE_SHARED: "Следовать глобальному",
  SETTING_GAME_WINE_DESC:
    "Выберите загруженную версию Wine только для этой игры; «Следовать глобальному» использует общий Wine лаунчера.",
  LANGUAGE_LOCALE_NAME: "Русский",
  SETTING_DISABLE_VIDEO_BACKGROUND: "Отключить видеофон",
  SETTING_DISABLE_VIDEO_BACKGROUND_DESC:
    "Отключает анимированный видеофон на главной странице и показывает статичное фоновое изображение.",
  SETTING_UI_LOCALE: "Язык лаунчера",
  SETTING_THEME_COLOR: "Launcher Theme Color",
  SETTING_THEME_COLOR_CUSTOM: "Custom Color",
  SETTING_RESTART_TO_TAKE_EFFECT:
    "Настройка вступит в силу после перезагрузки.",
  SETTING_OPEN_CMD: "Открыть командную строку Wine",
  SETTING_OPEN_WINE_CMD: "Открыть командную строку Wine",
  SETTING_OPEN_WINECFG: "Открыть Winecfg",
  SETTING_RESET_WINE_ENV: en.SETTING_RESET_WINE_ENV,
  SETTING_OPEN_GAME_INSTALL_DIR: "Открыть каталог игры",
  SETTING_OPEN_YAAGL_DIR: "Открыть каталог YAAGLM",
  SETTING_YAAGL_VERSION: "Версия YAAGLM",

  SETTING_VSYNC_DISABLE: en.SETTING_VSYNC_DISABLE,
  SETTING_PREFERRED_MAX_FPS: en.SETTING_PREFERRED_MAX_FPS,
  SETTING_PREFERRED_MAX_FPS_DESC: en.SETTING_PREFERRED_MAX_FPS_DESC,
  SETTING_PREFERRED_MAX_FPS_AUTO: en.SETTING_PREFERRED_MAX_FPS_AUTO,
  SETTING_PREFERRED_MAX_FPS_RESET: en.SETTING_PREFERRED_MAX_FPS_RESET,
  SETTING_METALFX_UPSCALE: en.SETTING_METALFX_UPSCALE,
  SETTING_METALFX_FACTOR: en.SETTING_METALFX_FACTOR,

  SETTING_ADVANCED: "Дополнительные",
  SETTING_ADVANCED_ALERT:
    "НИЧЕГО НЕ МЕНЯЙТЕ, если только вы не знаете, что делаете.",
  SETTING_ADVANCED_VISIBLE: "Расширенные настройки теперь доступны.",
  SETTING_ENABLE_ADVANCED: en.SETTING_ENABLE_ADVANCED,
  SETTING_OPEN_SHADERS_FOLDER: en.SETTING_OPEN_SHADERS_FOLDER,

  NO_ENOUGH_DISKSPACE: "Недостаточно свободного места на диске",
  NO_ENOUGH_DISKSPACE_DESC:
    "Требуется не менее {0}ГиБ ({1}Гб) свободного пространства.",

  UPDATE: "Обновить игру",

  LAUNCH_WITHOUT_UPDATE: "Запустить без обновления",
  GAME_VERSION_TOO_OLD_DESC:
    "Текущая версия игры ({0}) слишком устарела для постепенного обновления. Пожалуйста, переустановите игру.",

  PREDOWNLOAD_READY: "Предзагрузка {0}",

  COMMUNITY_WARNING: "Предупреждение о неофициальной версии",
  COMMUNITY_WINE_ALERT:
    "Выбрана версия сообщества. Она не поддерживается официально. Пожалуйста, не сообщайте о проблемах, связанных с этой версией.",

  SETTING_BLOCK_NET: "Временно блокировать сеть через hosts",
  SETTING_BLOCK_NET_ENABLED: "Включить",
  SETTING_BLOCK_NET_URL: "URL для блокировки",
  SETTING_BLOCK_NET_DELETE: "Удалить",
  SETTING_BLOCK_NET_ADD: "Добавить строку",
  SETTING_BLOCK_NET_DURATION: "Длительность блокировки (секунды)",
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
  SETTING_TIMEOUT_FIX: "Включить обход тайм-аутов Wine",
  SETTING_WORKAROUND4_PICK: "Выбрать файл...",
  SETTING_RUNTIME_REPLACEMENT_PICK_TOOLTIP: "Кнопка выбора",
  SETTING_RUNTIME_REPLACEMENT_TITLE: "Заменять файлы во время работы игры",
  SETTING_RUNTIME_REPLACEMENT_DESC:
    "Перед запуском выбранные файлы копируются поверх целевых файлов в папке игры и остаются на месте во время работы игры. Оригиналы восстанавливаются после выхода из игры.",
  SETTING_RUNTIME_REPLACEMENT_HEADER_ENABLED: "Включено",
  SETTING_RUNTIME_REPLACEMENT_HEADER_TARGET: "Заменяемый файл",
  SETTING_RUNTIME_REPLACEMENT_HEADER_REPLACEMENT: "Файл замены",
  SETTING_RUNTIME_REPLACEMENT_HEADER_DELETE: "Удалить",
  SETTING_RUNTIME_REPLACEMENT_ROW_ENABLED: "Включить строку {0}",
  SETTING_RUNTIME_REPLACEMENT_PICK_TARGET: "Выбрать заменяемый файл",
  SETTING_RUNTIME_REPLACEMENT_PICK_REPLACEMENT: "Выбрать файл замены",
  SETTING_RUNTIME_REPLACEMENT_DELETE_ROW: "Удалить эту строку",
  SETTING_RUNTIME_REPLACEMENT_ADD_ROW: "Добавить строку",
  SETTING_CUSTOM_ENVIRONMENT_VARIABLES_TITLE:
    "Пользовательские переменные среды",
  SETTING_CUSTOM_ENVIRONMENT_VARIABLES_DESC:
    "Добавляет пользовательские переменные среды в процесс Wine при запуске игры.",
  SETTING_CUSTOM_ENVIRONMENT_VARIABLES_HEADER_ENABLED: "Включено",
  SETTING_CUSTOM_ENVIRONMENT_VARIABLES_HEADER_KEY: "Ключ переменной среды",
  SETTING_CUSTOM_ENVIRONMENT_VARIABLES_HEADER_VALUE: "Значение",
  SETTING_CUSTOM_ENVIRONMENT_VARIABLES_HEADER_DELETE: "Удалить",
  SETTING_CUSTOM_ENVIRONMENT_VARIABLES_ROW_ENABLED:
    "Включить строку переменной {0}",
  SETTING_CUSTOM_ENVIRONMENT_VARIABLES_DELETE_ROW: "Удалить эту строку",
  SETTING_CUSTOM_ENVIRONMENT_VARIABLES_ADD_ROW: "Добавить строку",
  SETTING_RUNTIME_REPLACEMENT_RESTORE_ALL:
    "Восстановить все резервные копии сейчас",
  SETTING_LICENSES: "Лицензии",

  SETTING_ENABLE_HDR: "Включить HDR",

  SETTING_PROXY_ENABLED: "Использовать HTTP-прокси",
  SETTING_PROXY_HOST: "Хост HTTP-прокси",
  SETTING_PROXY_DESC: "Прокси действует только на игру, а не на весь лаунчер.",

  SETTING_TURN_ON_STEAM_PATCH: "Использовать патч Steam",

  UPDATE_PROMPT_IGNORE: "Пропустить обновление",
  SETTING_CHECK_UPDATE: "Проверить обновления YAAGLM",
  SETTING_CHECK_GAME_UPDATE: "Проверить обновления игры",
  SETTING_GAME_UPDATE_AVAILABLE: "Доступна новая версия игры",
  SETTING_GAME_UPDATE_AVAILABLE_DESC:
    "Доступна новая версия игры. Установить сейчас?",
  SETTING_CONFIRM_INSTALL: "Подтвердить установку",
  SETTING_CANCEL_INSTALL: "Отменить установку",
  CANCEL_UPDATE: "Отменить обновление",
  ALREADY_LATEST_VERSION: "Вы уже используете последнюю версию.",
  AHEAD_OF_LATEST_TITLE: "Новее последнего релиза",
  AHEAD_OF_LATEST_JOKE:
    "Пока официальная версия обновляется по капле 🐌, ты уже на следующем поколении 🚀. Держись скромно, без спойлеров 🤫.",
  UPDATE_LAUNCHER: "Обновить лаунчер",
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
  SETTING_WINE_PREFIX_PATH: "Путь Wine Prefix",
  SETTING_OPEN: "Открыть",
  LOG_VIEWER_TITLE: "Live Logs",
  LOG_VIEWER_EMPTY: "No logs yet",
  LOG_VIEWER_OPEN_HINT: "Click to view live logs",
  LOG_VIEWER_OPEN_ACTION: "Показать живые логи",
  LOG_VIEWER_OPEN_FILE: "Open Log File",
  LOG_VIEWER_FOLLOW_SCROLL: "Следить за прокруткой",
  LOG_VIEWER_COPY: "Копировать логи",
  LICENSE_VIEW_ONLINE: "Смотреть онлайн",
  SETTING_GITHUB_ACCELERATED_PREFIX: "Использовать ускоряющий префикс GitHub",
  SETTING_GITHUB_ACCELERATED_PREFIX_URL: "URL ускоряющего префикса GitHub",
  SETTING_GITHUB_ACCELERATED_PREFIX_TEST: "Проверить",
  SETTING_GITHUB_ACCELERATED_PREFIX_TESTING: "Проверка...",
  SETTING_GITHUB_ACCELERATED_PREFIX_CONNECTED: "Соединение установлено",
  SETTING_GITHUB_ACCELERATED_PREFIX_FAILED: "Ошибка соединения",
  SETTING_GITHUB_ACCELERATED_PREFIX_INVALID: "Недействительный URL",
  SETTING_AUTO_UPDATE: "Автоматически проверять обновления лаунчера",
  SETTING_AUTO_UPDATE_DEV_TOOLTIP:
    "Версии для разработки не поддерживают автоматические обновления",
  SETTING_DOWNLOAD_SERVER: "Download Server",
  SETTING_DOWNLOAD_PROXY: "Download server HTTP proxy",
  SETTING_DOWNLOAD_PROXY_ENABLED: "Enable download HTTP proxy",
  SETTING_DOWNLOAD_PROXY_DESC:
    "Used for launcher downloads such as Wine, environment components, game files, and updates. http:// is used when no protocol is provided.",
  SETTING_DOWNLOAD_SPEED_LIMIT: "Download speed limit",
  SETTING_DOWNLOAD_SPEED_LIMIT_ENABLED: "Enable download speed limit",
  DOWNLOAD_MANAGER: "Загрузки",
  DOWNLOAD_MANAGER_EMPTY: "Нет активных загрузок",
  DOWNLOAD_MANAGER_GLOBAL_TASK_WAITING:
    "Выполняется задача окружения; другие загрузки приостановлены",
  DOWNLOAD_TASK_ID: "ID задачи",
  DOWNLOAD_STATUS_QUEUED: "В очереди",
  DOWNLOAD_STATUS_ACTIVE: "Загрузка",
  DOWNLOAD_STATUS_VERIFYING: "Проверка",
  DOWNLOAD_STATUS_PAUSED: "Приостановлено",
  DOWNLOAD_STATUS_COMPLETED: "Завершено",
  DOWNLOAD_STATUS_ERROR: "Ошибка",
  DOWNLOAD_STATUS_CANCELLED: "Отменено",
  DOWNLOAD_PAUSE: "Пауза",
  DOWNLOAD_RESUME: "Продолжить",
  DOWNLOAD_TASK_PREDOWNLOAD_SUFFIX: "Предзагрузка",
  DOWNLOAD_TASK_EXPAND: "Показать подробности",
  DOWNLOAD_TASK_COLLAPSE: "Скрыть подробности",
  DOWNLOAD_TASK_ENGINE: "Механизм загрузки",
  DOWNLOAD_TASK_UNKNOWN_SIZE: "Неизвестно",
  SETTING_MAX_CONCURRENT_DOWNLOADS: "Ограничить параллельные загрузки",
  SETTING_GAME_VERSION_NOT_INSTALLED: "Not installed",
  NOTIFICATION_TASK_COMPLETED: "Задача успешно выполнена",
  NOTIFICATION_TASK_CANCELLED: "Задача отменена",
  NOTIFICATION_TASK_FAILED:
    "Не удалось выполнить задачу. Подробности — в журнале.",
  NOTIFICATION_TASK_FAILED_TITLE: "Сбой задачи",
  CHECK_UPDATE_FAILED: "Не удалось проверить обновления",
  CHECK_UPDATE_FAILED_DESC: "Не удалось подключиться к серверу GitHub ({0})",
  CHECK_GAME_UPDATE_FAILED: "Не удалось проверить обновления игры",
  CHECK_GAME_UPDATE_FAILED_DESC:
    "Не удается подключиться к серверу обновлений. Проверьте подключение к сети и повторите попытку.",
};
