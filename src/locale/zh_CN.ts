import { SuppportedContentLangId } from "./supported-content-lang-id";

export const zh_CN = {
  CONTENT_LANG_ID: "zh-cn" as SuppportedContentLangId,
  LAUNCH: "开始游戏",
  INSTALL: "安装游戏",
  UPDATING: "正在更新",
  DOWNLOADING: "正在下载",
  PAUSE_DOWNLOAD: "暂停下载",
  RESUME_DOWNLOAD: "继续下载",
  CANCEL_DOWNLOAD: "取消下载",
  FORCE_QUIT_GAME: "强制退出游戏",
  FIXING_FILES: "正在修复第{0}个文件，共{1}个",
  PATCHING: "正在应用补丁",
  GAME_RUNNING: "游戏正在运行中（请勿关闭启动器）",
  GAME_RUNNING_CLOSE_TITLE: "游戏仍在运行",
  GAME_RUNNING_CLOSE_DESC:
    "检测到游戏还没有退出。要在关闭 YAAgl 的同时结束游戏进程吗？\n\n选择“是”会关闭游戏并退出启动器。\n选择“否”只退出启动器，游戏会尽量继续运行。\n选择“取消”返回启动器。",
  REVERT_PATCHING: "正在还原补丁",
  SCANNING_FILES: "确认游戏文件完整性中。正在扫描第{0}个文件，共{1}个",
  DOWNLOADING_ENVIRONMENT: "正在下载配置环境所需文件",
  DOWNLOADING_ENVIRONMENT_SPEED:
    "正在下载配置环境所需文件（{1}/{2}，{3}，当前速度：{0}）",
  EXTRACT_ENVIRONMENT: "正在解压配置环境所需文件",
  CONFIGURING_ENVIRONMENT: "正在配置环境",
  UNINSTALLING_ENVIRONMENT: "正在卸载 Wine",
  RESTART_TO_INSTALL: "重启以完成更新",
  PATH_INVALID: "路径无效",
  PLEASE_SELECT_A_DIR: "请选择一个路径",
  PATH_INVALID_ASCII_ONLY: "请选择只包含ASCII字符（英文+半角符号）的路径",
  PATH_INVALID_FORBIDDEN_DIR:
    "请选择不存在于「桌面」「文档」或「下载」目录之下的路径",
  NOT_SUPPORTED_YET: "尚未支持",
  PLEASE_WAIT_FOR_LAUNCHER_UPDATE:
    "当前启动器还不支持启动{0}版本。请等待后续更新。",
  UNSUPPORTED_VERSION: "不支持的版本",
  SELECT_INSTALLATION_DIR:
    "选择游戏的安装目录。\n如果你已安装游戏，请选择游戏.exe文件所在的位置",
  CANT_OPEN_GAME_FILE: "无法读取游戏文件",
  CANT_OPEN_GAME_FILE_DESC:
    '启动器无法打开游戏文件。\n但不用着急，此对话框关闭后你可以再次手动选择游戏安装目录。\n\n如果此对话框反复出现，请检查启动器是否具有足够的权限访问游戏目录（macOS部分文件夹，如"下载"，需要特殊的权限设置）。',
  GAME_DIR_CHANGED: "路径不一致",
  GAME_DIR_CHANGED_DESC:
    "似乎跟你上次设置的游戏目录不一致。本操作无效，但之后你仍可以重新设置。",
  GAME_VERSION: "游戏版本",
  NEW_VERSION_AVAILABLE: "启动器有新版本可用",
  NEW_VERSION_AVAILABLE_DESC: "你希望更新到最新{0}版本吗?\n更新内容:\n{1}",
  DOWNLOADING_UPDATE_FILE: "正在下载更新文件",

  // FIXME
  UPGRADE_FUNCTION_TBD: "启动器尚未实装升级功能。",

  DECOMPRESS_FILE_PROGRESS: "正在解压文件",
  ALLOCATING_FILE: "正在分配磁盘空间",
  DOWNLOADING_FILE_PROGRESS: "正在下载游戏文件：{0} ({2}/{3}，{4}) 速度：{1}",

  BACKUP_USER_DATA: "正在备份用户数据",
  RECOVER_BACKUP_USER_DATA: "正在还原备份用户数据",

  INSTALL_DONE: "安装成功",

  RELAUNCH_REQUIRED: "启动器需要重启",
  RELAUNCH_REQUIRED_DESC: "需要重启以更新wine版本",

  SETTING: "设置",
  SETTING_WINE_VERSION: "Wine 版本",
  SETTING_ASYNC_DXVK: "DXVK Shader异步编译",
  SETTING_ENABLED: "启用",
  SETTING_DXVK_HUD: "DXVK HUD",
  SETTING_DXVK_HUD_NONE: "不显示",
  SETTING_DXVK_HUD_FPS: "显示FPS",
  SETTING_DXVK_HUD_ALL: "显示所有信息",
  SETTING_MTL_HUD: "Metal HUD",
  SETTING_RETINA: "Retina 模式",
  SETTING_LEFT_CMD: "映射左 CMD 键为 CTRL 键",
  SETTING_TURN_OFF_AC_PATCH: "关闭 AC 补丁",
  SETTING_CUSTOM_RESOLUTION: "自定义分辨率",
  SETTING_DISPLAY_MODE: "游戏显示模式",
  SETTING_DISPLAY_MODE_FULLSCREEN: "全屏",
  SETTING_DISPLAY_MODE_WINDOWED: "窗口化",
  SETTING_WINDOW_RESOLUTION: "窗口分辨率",
  SETTING_SAVE: "保存",
  SETTING_CANCEL: "取消",

  SETTING_GAME_INSTALL_DIR: "游戏安装路径",
  SETTING_CHANGE_GAME_INSTALL_DIR: "更改",
  SETTING_GAME_DIR_SIZE: "占用：{0}",
  SETTING_GAME_DIR_SIZE_NOT_SET: "未设置",
  SETTING_UNINSTALL_GAME: "卸载游戏",
  SETTING_UNINSTALL_GAME_CONFIRM:
    "即将清空以下游戏文件夹，且无法撤销：\n{0}\n\n确认继续？",
  SETTING_UNINSTALL_SCREENSHOTS_NOTICE: "注意：卸载过程也会删除所有游戏截图。",
  SETTING_CHECK_INTEGRITY: "检查文件完整性",

  SETTING_WINE_VERSION_CONFIRM: "点击确认修改",
  SETTING_WINE_VERSION_UPDATE_BUSY:
    "当前有任务正在运行、下载正在进行或游戏仍在运行，暂时不能更新 Wine 环境。",
  SETTING_QUICK_ACTIONS: "快速操作",
  SETTING_GENERAL: "通用",
  SETTING_GAME: "游戏",
  SETTING_VIDEO: "视频",
  LANGUAGE_LOCALE_NAME: "简体中文",
  SETTING_UI_LOCALE: "启动器界面语言",
  SETTING_RESTART_TO_TAKE_EFFECT: "此设置将从下次启动生效",
  SETTING_OPEN_CMD: "打开 Wine 命令行工具",
  SETTING_OPEN_GAME_INSTALL_DIR: "打开游戏安装目录",
  SETTING_OPEN_YAAGL_DIR: "打开YAAGL数据目录",
  SETTING_YAAGL_VERSION: "YAAGL版本",

  SETTING_FPS_UNLOCK: "帧率限制解锁",
  SETTING_FPS_UNLOCK_DEFAULT: "不解锁",

  SETTING_ADVANCED: "高级设置",
  SETTING_ADVANCED_ALERT: "在不清楚作用的情况下，请不要改动任何设置。",
  SETTING_ADVANCED_VISIBLE: "高级设置已解锁。",

  NO_ENOUGH_DISKSPACE: "磁盘空间不足",
  NO_ENOUGH_DISKSPACE_DESC: "解压安装需要至少{0}GiB ({1}GB)的剩余空间",

  UPDATE: "更新游戏",
  GAME_VERSION_TOO_OLD_DESC:
    "当前游戏版本({0})太过久远，无法增量更新。请重新安装游戏。",

  PREDOWNLOAD_READY: "预载{0}版本",

  COMMUNITY_WARNING: "社区版警告",
  COMMUNITY_WINE_ALERT:
    "当前选择为社区版本，此版本不受官方支持，请不要报告任何问题",

  SETTING_BLOCK_NET: "临时写入 hosts 阻断联网",
  SETTING_BLOCK_NET_DURATION: "阻断持续时间（秒）",
  SETTING_HOSTS_HELPER: "hosts 权限助手",
  SETTING_HOSTS_HELPER_STATUS_RUNNING: "状态：已安装并运行中",
  SETTING_HOSTS_HELPER_STATUS_STOPPED: "状态：已安装但未运行",
  SETTING_HOSTS_HELPER_STATUS_NOT_INSTALLED: "状态：未安装",
  SETTING_HOSTS_HELPER_STATUS_ERROR: "状态：需要处理",
  SETTING_HOSTS_HELPER_INSTALL: "安装",
  SETTING_HOSTS_HELPER_UNINSTALL: "卸载",
  SETTING_HOSTS_HELPER_REFRESH: "刷新",
  SETTING_TIMEOUT_FIX: "启用 Wine 超时绕过",
  SETTING_WORKAROUND4: "运行期间临时替换 mhypbase.dll",
  SETTING_WORKAROUND4_DESC:
    "启动前会把用户选择的旧版 mhypbase.dll 复制到游戏目录，并在游戏运行期间保持替换；游戏退出后还原原文件。启动器不会内置或分发该 DLL。",
  SETTING_WORKAROUND4_PICK: "选择文件...",
  SETTING_WORKAROUND4_REVERT_BTN: "立即还原原始 mhypbase.dll",
  SETTING_LICENSES: "许可证",
  SETTING_ENABLE_HDR: "启用 HDR",

  SETTING_PROXY_ENABLED: "为游戏启用 HTTP 代理",
  SETTING_PROXY_HOST: "HTTP 代理地址",
  SETTING_PROXY_DESC:
    "用于游戏进程联网，不会影响启动器下载。未填写协议时默认使用 http://。",

  SETTING_TURN_ON_STEAM_PATCH: "启用 Steam 补丁",

  UPDATE_PROMPT_IGNORE: "忽略此更新",
  SETTING_CHECK_UPDATE: "检查 YAAGL 更新",
  SETTING_CHECK_GAME_UPDATE: "检查游戏更新",
  ALREADY_LATEST_VERSION: "您已在使用最新版本。",
  UPDATE_LAUNCHER: "更新启动器",
  INIT_ENVIRONMENT: "初始化环境",
  INIT_ENVIRONMENT_TITLE: "初始化运行环境",
  INIT_ENVIRONMENT_DESC:
    "需要先初始化 Wine 运行环境，才能安装或启动游戏。你也可以先跳过，稍后再初始化。",
  INIT_ENVIRONMENT_CONFIRM_DESC: "本次初始化将安装并启用以下 Wine 版本：\n{0}",
  INIT_ENVIRONMENT_USE_RECOMMENDED: "使用推荐设置",
  INIT_ENVIRONMENT_CUSTOM_WINE: "自定义 Wine 版本",
  INIT_ENVIRONMENT_WINE_VERSION: "Wine 版本",
  SKIP: "跳过",
  DONT_REMIND_AGAIN: "不再提醒",
  SETTING_WINE_STATUS: "Wine 状态",
  SETTING_WINE_ENV_INITIALIZED: "已初始化",
  SETTING_WINE_ENV_NOT_INITIALIZED: "未初始化",
  SETTING_WINE_STATUS_INSTALLED: "已安装",
  SETTING_WINE_STATUS_NOT_INSTALLED: "未安装",
  SETTING_WINE_STATUS_ENABLED: "已启用",
  SETTING_WINE_INSTALL: "安装并启用",
  SETTING_WINE_ENABLE: "启用",
  SETTING_WINE_UNINSTALL: "卸载",
  SETTING_WINE_UNINSTALL_CONFIRM_TITLE: "卸载 Wine",
  SETTING_WINE_UNINSTALL_CONFIRM_DESC:
    "即将删除 {0} 的 Wine 文件和下载残留。共享 Wine Prefix 不会被删除。确认继续？",
  SETTING_WINE_UNINSTALL_CONFIRM: "确认卸载",
  SETTING_WINE_INSTALL_INITIALIZES_ENVIRONMENT:
    "当前运行环境尚未初始化。安装此 Wine 版本的同时会初始化运行环境，并将其设为启用版本。",
  SETTING_WINE_PREFIX_PATH: "Wine Prefix 路径",
  SETTING_OPEN: "打开",
  LOG_VIEWER_TITLE: "实时日志",
  LOG_VIEWER_EMPTY: "暂无日志",
  LOG_VIEWER_OPEN_HINT: "点击查看实时日志",
  LOG_VIEWER_OPEN_ACTION: "查看实时日志",
  LOG_VIEWER_OPEN_FILE: "打开日志文件",
  LOG_VIEWER_FOLLOW_SCROLL: "跟随滚动",
  LOG_VIEWER_COPY: "复制日志",
  LICENSE_COPY: "复制当前许可证",
  SETTING_DOWNLOAD_SERVER: "下载服务器",
  SETTING_DOWNLOAD_PROXY: "为下载服务器启用 HTTP 代理",
  SETTING_DOWNLOAD_PROXY_ENABLED: "启用下载 HTTP 代理",
  SETTING_DOWNLOAD_PROXY_DESC:
    "用于启动器下载 Wine、环境组件、游戏文件和更新文件。未填写协议时默认使用 http://。",
  SETTING_DOWNLOAD_SPEED_LIMIT: "下载限速",
  SETTING_DOWNLOAD_SPEED_LIMIT_ENABLED: "启用下载限速",
  SETTING_GAME_VERSION_NOT_INSTALLED: "未安装",
};
