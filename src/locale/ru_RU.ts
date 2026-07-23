import { en } from "./en";
import { zh_CN } from "./zh_CN";

export const ru_RU: typeof zh_CN = {
  CONTENT_LANG_ID: "ru-ru",
  LAUNCH: "Запустить игру",
  INSTALL: "Установить игру",
  UPDATING: "Обновление",
  DOWNLOADING: "Загрузка",
  PAUSE_DOWNLOAD: "Приостановить загрузку",
  RESUME_DOWNLOAD: "Продолжить загрузку",
  CANCEL_DOWNLOAD: "Отменить загрузку",
  FORCE_QUIT_GAME: "Принудительно закрыть игру",
  FIXING_FILES: "Исправление игровых файлов {0}/{1}",
  PATCHING: "Патчинг игровых файлов",
  GAME_RUNNING: "Игра запущена (НЕ ЗАКРЫВАЙТЕ ЛАУНЧЕР)",
  GAME_RUNNING_CLOSE_TITLE: "Игра всё ещё запущена",
  GAME_RUNNING_CLOSE_DESC:
    'Игра ещё не закрыта. Закрыть игровой процесс вместе с выходом из YAAgl?\n\nВыберите "Да", чтобы закрыть игру и лаунчер.\nВыберите "Нет", чтобы закрыть только лаунчер и по возможности оставить игру запущенной.\nВыберите "Отмена", чтобы вернуться в лаунчер.',
  REVERT_PATCHING: "Откат патчей",
  SCANNING_FILES: "Проверка целостности файлов игры. Завершенные файлы {0}/{1}",
  DOWNLOADING_ENVIRONMENT: "Загрузка файлов окружения",
  DOWNLOADING_ENVIRONMENT_SPEED:
    "Загрузка файлов окружения ({1}/{2}, {3}, {0})",
  EXTRACT_ENVIRONMENT: "Распаковка окружения",
  CONFIGURING_ENVIRONMENT: "Настройка окружения",
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
  SETTING_GAME: "Игра",
  SETTING_VIDEO: "Видео",
  LANGUAGE_LOCALE_NAME: "Русский",
  SETTING_UI_LOCALE: "Язык лаунчера",
  SETTING_RESTART_TO_TAKE_EFFECT:
    "Настройка вступит в силу после перезагрузки.",
  SETTING_OPEN_CMD: "Открыть командную строку Wine",
  SETTING_OPEN_GAME_INSTALL_DIR: "Открыть каталог игры",
  SETTING_OPEN_YAAGL_DIR: "Открыть каталог YAAGL",
  SETTING_YAAGL_VERSION: "Версия YAAGL",

  SETTING_FPS_UNLOCK: "Снять ограничение FPS",
  SETTING_FPS_UNLOCK_DEFAULT: "Выключено",

  SETTING_ADVANCED: "Дополнительные",
  SETTING_ADVANCED_ALERT:
    "НИЧЕГО НЕ МЕНЯЙТЕ, если только вы не знаете, что делаете.",
  SETTING_ADVANCED_VISIBLE: "Расширенные настройки теперь доступны.",

  NO_ENOUGH_DISKSPACE: "Недостаточно свободного места на диске",
  NO_ENOUGH_DISKSPACE_DESC:
    "Требуется не менее {0}ГиБ ({1}Гб) свободного пространства.",

  UPDATE: "Обновить игру",
  GAME_VERSION_TOO_OLD_DESC:
    "Текущая версия игры ({0}) слишком устарела для постепенного обновления. Пожалуйста, переустановите игру.",

  PREDOWNLOAD_READY: "Предзагрузка {0}",

  COMMUNITY_WARNING: "Предупреждение о неофициальной версии",
  COMMUNITY_WINE_ALERT:
    "Выбрана версия сообщества. Она не поддерживается официально. Пожалуйста, не сообщайте о проблемах, связанных с этой версией.",

  SETTING_BLOCK_NET: "Временно блокировать сеть через hosts",
  SETTING_BLOCK_NET_DURATION: "Длительность блокировки (секунды)",
  SETTING_HOSTS_HELPER: "Hosts permission helper",
  SETTING_HOSTS_HELPER_STATUS_RUNNING: "Status: installed and running",
  SETTING_HOSTS_HELPER_STATUS_STOPPED: "Status: installed but not running",
  SETTING_HOSTS_HELPER_STATUS_NOT_INSTALLED: "Status: not installed",
  SETTING_HOSTS_HELPER_STATUS_ERROR: "Status: needs attention",
  SETTING_HOSTS_HELPER_INSTALL: "Install",
  SETTING_HOSTS_HELPER_UNINSTALL: "Uninstall",
  SETTING_HOSTS_HELPER_REFRESH: "Refresh",
  SETTING_TIMEOUT_FIX: "Включить обход тайм-аутов Wine",
  SETTING_WORKAROUND4: "Временно заменять mhypbase.dll во время работы игры",
  SETTING_WORKAROUND4_DESC:
    "Перед запуском выбранная старая mhypbase.dll копируется в папку игры и остаётся там во время работы игры. После выхода из игры исходный файл восстанавливается. Лаунчер не включает и не распространяет эту DLL.",
  SETTING_WORKAROUND4_PICK: "Выбрать файл...",
  SETTING_WORKAROUND4_REVERT_BTN: "Восстановить исходный mhypbase.dll сейчас",
  SETTING_LICENSES: "Лицензии",

  SETTING_ENABLE_HDR: "Включить HDR",

  SETTING_PROXY_ENABLED: "Использовать HTTP-прокси",
  SETTING_PROXY_HOST: "Хост HTTP-прокси",
  SETTING_PROXY_DESC: "Прокси действует только на игру, а не на весь лаунчер.",

  SETTING_TURN_ON_STEAM_PATCH: "Использовать патч Steam",

  UPDATE_PROMPT_IGNORE: "Пропустить обновление",
  SETTING_CHECK_UPDATE: "Проверить обновления YAAGL",
  SETTING_CHECK_GAME_UPDATE: "Проверить обновления игры",
  ALREADY_LATEST_VERSION: "Вы уже используете последнюю версию.",
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
  LICENSE_COPY: "Копировать текущую лицензию",
  SETTING_DOWNLOAD_SERVER: "Download Server",
  SETTING_DOWNLOAD_PROXY: "Download server HTTP proxy",
  SETTING_DOWNLOAD_PROXY_ENABLED: "Enable download HTTP proxy",
  SETTING_DOWNLOAD_PROXY_DESC:
    "Used for launcher downloads such as Wine, environment components, game files, and updates. http:// is used when no protocol is provided.",
  SETTING_DOWNLOAD_SPEED_LIMIT: "Download speed limit",
  SETTING_DOWNLOAD_SPEED_LIMIT_ENABLED: "Enable download speed limit",
  SETTING_GAME_VERSION_NOT_INSTALLED: "Not installed",
};
