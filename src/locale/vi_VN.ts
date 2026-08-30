import { en } from "./en";
import { zh_CN } from "./zh_CN";

export const vi_VN: typeof zh_CN = {
  CONTENT_LANG_ID: "vi-vn",
  SERVER_LABEL_CN: "CN",
  SERVER_LABEL_GLOBAL: "Quốc tế",
  SERVER_LABEL_UNI: "Đa nền tảng",
  BOOT_INITIALIZING: "Đang khởi tạo",
  BOOT_LOADING_LOCAL_SETTINGS: "Đang tải cài đặt cục bộ",
  BOOT_CHECKING_NETWORK: "Đang kiểm tra kết nối mạng",
  BOOT_STARTING_DOWNLOAD_SERVICE: "Đang khởi động dịch vụ tải xuống",
  BOOT_CHECKING_LAUNCHER_UPDATE: "Đang kiểm tra cập nhật trình khởi động",
  BOOT_CHECKING_WINE_ENVIRONMENT: "Đang kiểm tra môi trường Wine",
  BOOT_PREPARING_WINE_ENVIRONMENT: "Đang chuẩn bị môi trường Wine",
  BOOT_INITIALIZING_RUNTIME: "Đang khởi tạo môi trường chạy",
  BOOT_INITIALIZING_GAME_CLIENT: "Đang tải cấu hình kênh trò chơi",
  BOOT_COMPLETE: "Khởi tạo hoàn tất",
  BOOT_ENTERING_MAIN_SCREEN: "Đang vào màn hình chính",
  BOOT_INITIALIZATION_FAILED: "Khởi tạo thất bại",
  LAUNCH: "Khởi động trò chơi",
  INSTALL: "Cài đặt trò chơi",
  CONTINUE_INSTALL: "Tiếp tục cài đặt",
  UPDATING: "Đang cập nhật",
  DOWNLOADING: "Đang tải",
  DOWNLOAD_PAUSED: "Đã tạm dừng tải",
  PAUSE_DOWNLOAD: "Tạm dừng tải xuống",
  RESUME_DOWNLOAD: "Tiếp tục tải xuống",
  CANCEL_DOWNLOAD: "Hủy tải xuống",
  DOWNLOAD_PROGRESS: "Tiến trình tải xuống",
  DOWNLOAD_FILE: "Tệp",
  DOWNLOAD_FILE_INDEX: "Tiến trình tệp",
  DOWNLOADED: "Đã tải",
  DOWNLOAD_SPEED: "Tốc độ",
  PROGRESS: "Tiến trình",
  PROCESSING: "Đang xử lý…",
  FORCE_QUIT_GAME: "Buộc thoát",
  FIXING_FILES: "Đang sửa tệp trò chơi {0}/{1}",
  PATCHING: "Đang vá tệp trò chơi",
  GAME_STARTING: "Đang khởi động trò chơi",
  GAME_CRASHED: "Đã phát hiện trò chơi bị lỗi",
  GAME_CRASHED_DESC:
    "Vui lòng kiểm tra môi trường trò chơi và cài đặt khởi chạy có chính xác không.",
  GAME_CRASHED_IGNORE: "Bỏ qua",
  GAME_CRASHED_SETTINGS: "Đi tới cài đặt trò chơi",
  RUNTIME_REPLACEMENT_ERROR: "Lỗi tệp thay thế tạm thời",
  RUNTIME_REPLACEMENT_ERROR_DESC:
    "Không thể kiểm tra tệp thay thế tạm thời trước khi khởi động trò chơi. Vui lòng kiểm tra lỗi bên dưới và cập nhật đường dẫn trong cài đặt trò chơi.",
  GAME_RUNNING: "Đang chạy trò choi",
  GAME_RECOVERING: "Đang khôi phục",
  GAME_RUNNING_CLOSE_TITLE: "Trò chơi vẫn đang chạy",
  GAME_RUNNING_CLOSE_DESC:
    "Trò chơi vẫn chưa thoát. Bạn có muốn kết thúc tiến trình trò chơi khi thoát launcher không?",
  GAME_RUNNING_CLOSE_EXIT: "Đóng trò chơi và thoát",
  DOWNLOAD_RUNNING_CLOSE_TITLE: "Đang tải xuống",
  DOWNLOAD_RUNNING_CLOSE_DESC:
    "Một tác vụ tải xuống đang diễn ra. Bạn có muốn thoát launcher không?\n\nThoát bây giờ sẽ làm gián đoạn quá trình tải và có thể làm hỏng các tệp chưa hoàn tất.",
  DOWNLOAD_RUNNING_CLOSE_EXIT: "Thoát",

  REVERT_PATCHING: "Đang hoàn tác bản vá",
  SCANNING_FILES:
    "Kiểm tra tính toàn vẹn của tệp. {0}/{1} tệp đã được hoàn thành ",
  CHECKING_GAME_INTEGRITY: "Đang kiểm tra tính toàn vẹn của tệp trò chơi",
  DOWNLOADING_ENVIRONMENT: "Đang tải tệp môi trường",
  DOWNLOADING_ENVIRONMENT_SPEED:
    "Đang tải xuống tệp môi trường ({1}/{2}, {3}, {0})",
  EXTRACT_ENVIRONMENT: "Đang giải nén môi trường",
  CONFIGURING_ENVIRONMENT: "Đang tuỳ chỉnh môi trường",
  ENVIRONMENT_CONFIGURING: "Đang cấu hình môi trường",
  UNINSTALLING_ENVIRONMENT: en.UNINSTALLING_ENVIRONMENT,
  RESTART_TO_INSTALL: "Khởi động lại chương trình",
  PATH_INVALID: "Đường dẫn không hợp lệ",
  PLEASE_SELECT_A_DIR: "Vui lòng chọn đường dẫn",
  PATH_INVALID_ASCII_ONLY:
    "Hãy chắc chắn rằng đường dẫn chỉ bao gồm ký tự ASCII",
  PATH_INVALID_FORBIDDEN_DIR:
    'Vui lòng hãy chọn đường dẫn khác ngoài "Desktop","Downloads" hoặc "Documents"',
  NOT_SUPPORTED_YET: "Chức năng chưa được hỗ trợ",
  PLEASE_WAIT_FOR_LAUNCHER_UPDATE:
    "Trình khởi động hiện tại vẫn chưa hỗ trợ phiên bản {0}, xin vui lòng hãy đợi bản cập nhật mới",
  UNSUPPORTED_VERSION: "Phiên bản không được hỗ trợ",
  SELECT_INSTALLATION_DIR:
    "Vui lòng chọn thư mục cài đặt trò chơi.\nNếu như bạn đã có sẵn game thì hãy chọn thư mục có chứa tệp thực thi (.exe) của game",
  CANT_OPEN_GAME_FILE: "Không truy cập được tệp của trò chơi",
  CANT_OPEN_GAME_FILE_DESC:
    "Trình khởi động không truy cập được tệp trò chơi\nNhưng đừng lo, bạn có thể chọn lại thư mục cài đặt trò chơi khi bảng này được đóng\n\nNếu như bảng này vẫn lặp lại liên tục, hãy kiểm tra liệu trình khởi động có được cấp quyền để truy cập thư mục cài đặt trò chơi này không",
  GAME_DIR_CHANGED: "Đường dẫn thư mục đã được thay đổi",
  GAME_DIR_CHANGED_DESC:
    "Dường như như bạn đã chọn một thư mục khác với thư mục đã được chọn trước đó. Tiến trình không hợp lệ, nhưng bạn có thể chọn lại sau",
  GAME_VERSION: "Phiên bản trò chơi",

  NEW_VERSION_AVAILABLE: "Phiên bản mới khả dụng",
  NEW_VERSION_AVAILABLE_DESC:
    "Bạn có muốn cập nhật trình khởi động lên phiên bản {0} không?\n Những thứ được cập nhật:\n{1}",

  DOWNLOADING_UPDATE_FILE: "Đang tải tệp cập nhật",

  UPGRADE_FUNCTION_TBD: "Hiện tại nâng cấp vẫn chưa được tích hợp",

  DECOMPRESS_FILE_PROGRESS: "Đang giải nén tệp",
  ALLOCATING_FILE: "Đang phân bổ tệp trên ổ đĩa",
  DOWNLOADING_FILE_PROGRESS: "Đang tải tệp: {0} ({2}/{3}, {4}) {1}",

  BACKUP_USER_DATA: "Đang sao lưu dữ liệu người dùng",
  RECOVER_BACKUP_USER_DATA: "Đang khôi phục sao lưu",

  INSTALL_DONE: "Hoàn tất",

  RELAUNCH_REQUIRED: "Yêu cầu khởi động lại",
  RELAUNCH_REQUIRED_DESC:
    "Trình khởi động sẽ khởi động lại để tiến hành quá trình cài đặt wine.",

  SETTING: "Cài đặt",
  SETTING_WINE_VERSION: "Phiên bản Wine",
  SETTING_ASYNC_DXVK: "DXVK Asynchronous Shader Compiling",
  SETTING_ENABLED: "Bật",
  SETTING_DXVK_HUD: "DXVK HUD",
  SETTING_DXVK_HUD_NONE: "Không",
  SETTING_DXVK_HUD_FPS: "Chỉ hiện FPS",
  SETTING_DXVK_HUD_ALL: "Hiện tất cả thông tin",
  SETTING_MTL_HUD: "Metal HUD",
  SETTING_RETINA: "Chế độ Retina",
  SETTING_LEFT_CMD: "Ánh xạ CMD trái sang CTRL",
  SETTING_TURN_OFF_AC_PATCH: "tắt bản vá AC",
  SETTING_CUSTOM_RESOLUTION: "Độ phân giải tùy chỉnh",
  SETTING_DISPLAY_MODE: "Chế độ hiển thị trò chơi",
  SETTING_DISPLAY_MODE_FULLSCREEN: "Toàn màn hình",
  SETTING_DISPLAY_MODE_WINDOWED: "Cửa sổ",
  SETTING_WINDOW_RESOLUTION: "Độ phân giải cửa sổ",
  SETTING_SAVE: "Lưu",
  SETTING_CANCEL: "Huỷ",

  SETTING_CHECK_INTEGRITY: "Kiểm tra tính toàn vẹn của tệp",
  SETTING_GAME_INSTALL_DIR: "Thư mục cài đặt trò chơi",
  SETTING_CHANGE_GAME_INSTALL_DIR: "Thay đổi",
  SETTING_GAME_DIR_SIZE: "Dung lượng: {0}",
  SETTING_GAME_DIR_SIZE_NOT_SET: "Chưa đặt",
  SETTING_UNINSTALL_GAME: "Gỡ cài đặt trò chơi",
  SETTING_UNINSTALL_GAME_CONFIRM:
    "Thao tác này sẽ xoá sạch thư mục trò chơi sau và không thể hoàn tác:\n{0}\n\nTiếp tục?",
  SETTING_UNINSTALL_SCREENSHOTS_NOTICE:
    "Lưu ý: quá trình gỡ cài đặt cũng sẽ xoá tất cả ảnh chụp trò chơi.",
  // 0.0.27
  SETTING_WINE_VERSION_CONFIRM: "Ấn vào để xác nhận thay đổi",
  SETTING_WINE_VERSION_UPDATE_BUSY:
    "Wine environment updates are unavailable while a task, download, or game is running.",
  SETTING_QUICK_ACTIONS: "Cài đặt nhanh",
  SETTING_GENERAL: "Cài đặt chung",
  SETTING_DOWNLOAD: "Tải xuống",
  SETTING_GAME: "Trò chơi",
  SETTING_VIDEO: "Video",
  SETTING_GLOBAL: "Cài đặt chung",
  SETTING_GAME_WINE: "Wine tùy chỉnh",
  SETTING_GAME_WINE_SHARED: "Theo toàn cục",
  SETTING_GAME_WINE_DESC:
    "Chọn một phiên bản Wine đã tải xuống chỉ cho trò chơi này; 'Theo toàn cục' dùng Wine chung của trình khởi động.",
  LANGUAGE_LOCALE_NAME: "Tiếng Việt",
  SETTING_DISABLE_VIDEO_BACKGROUND: "Tắt nền video",
  SETTING_DISABLE_VIDEO_BACKGROUND_DESC:
    "Tắt nền video động trên trang chủ và hiển thị hình nền tĩnh thay thế.",
  SETTING_UI_LOCALE: "Ngôn ngữ trình khởi động",
  SETTING_THEME_COLOR: "Launcher Theme Color",
  SETTING_THEME_COLOR_CUSTOM: "Custom Color",
  SETTING_RESTART_TO_TAKE_EFFECT:
    "Cài đặt sẽ có hiệu lực sau khi khởi động lại",
  SETTING_OPEN_CMD: "Mở command line (cmd) của wine",
  SETTING_OPEN_WINE_CMD: en.SETTING_OPEN_WINE_CMD,
  SETTING_OPEN_WINECFG: en.SETTING_OPEN_WINECFG,
  SETTING_RESET_WINE_ENV: en.SETTING_RESET_WINE_ENV,
  SETTING_OPEN_GAME_INSTALL_DIR: "Mở thư mục cài đặt trò chơi",
  SETTING_OPEN_YAAGL_DIR: "Mở thư mục dữ liệu của YAAGLM",
  SETTING_YAAGL_VERSION: "Phiên bản YAAGLM",

  SETTING_VSYNC_DISABLE: en.SETTING_VSYNC_DISABLE,
  SETTING_PREFERRED_MAX_FPS: en.SETTING_PREFERRED_MAX_FPS,
  SETTING_PREFERRED_MAX_FPS_DESC: en.SETTING_PREFERRED_MAX_FPS_DESC,
  SETTING_PREFERRED_MAX_FPS_AUTO: en.SETTING_PREFERRED_MAX_FPS_AUTO,
  SETTING_PREFERRED_MAX_FPS_RESET: en.SETTING_PREFERRED_MAX_FPS_RESET,
  SETTING_METALFX_UPSCALE: en.SETTING_METALFX_UPSCALE,
  SETTING_METALFX_FACTOR: en.SETTING_METALFX_FACTOR,

  SETTING_ADVANCED: "Nâng cao",
  SETTING_ADVANCED_ALERT:
    "VUI LÒNG KHÔNG THAY ĐỔI BẤT KỲ ĐIỀU GÌ, trừ khi bạn biết mình nên làm gì.",
  SETTING_ADVANCED_VISIBLE: "Cài đặt nâng cao hiện có thể nhìn thấy.",
  SETTING_ENABLE_ADVANCED: en.SETTING_ENABLE_ADVANCED,
  SETTING_OPEN_SHADERS_FOLDER: en.SETTING_OPEN_SHADERS_FOLDER,

  NO_ENOUGH_DISKSPACE: "Không đủ dung lượng trống trên ổ đĩa",
  NO_ENOUGH_DISKSPACE_DESC: "Cần có tối thiếu {0}GiB ({1}GB) dung lượng trống.",

  UPDATE: en.UPDATE,

  LAUNCH_WITHOUT_UPDATE: "Khởi động không cập nhật",
  GAME_VERSION_TOO_OLD_DESC: en.GAME_VERSION_TOO_OLD_DESC,

  PREDOWNLOAD_READY: en.PREDOWNLOAD_READY,

  COMMUNITY_WARNING: "Cảnh báo phiên bản cộng đồng",
  COMMUNITY_WINE_ALERT:
    "Hiện tại được chọn là phiên bản cộng đồng, phiên bản này không được hỗ trợ chính thức, vui lòng không báo cáo bất kỳ vấn đề nào",

  SETTING_BLOCK_NET: "Tạm chặn mạng qua hosts",
  SETTING_BLOCK_NET_ENABLED: "Bật",
  SETTING_BLOCK_NET_URL: "URL cần chặn",
  SETTING_BLOCK_NET_DELETE: "Xóa",
  SETTING_BLOCK_NET_ADD: "Thêm dòng",
  SETTING_BLOCK_NET_DURATION: "Thời lượng chặn (giây)",
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
  SETTING_TIMEOUT_FIX: "Bật khắc phục timeout của Wine",
  SETTING_WORKAROUND4_PICK: "Chọn tệp...",
  SETTING_RUNTIME_REPLACEMENT_PICK_TOOLTIP: "Nút chọn",
  SETTING_RUNTIME_REPLACEMENT_TITLE:
    "Thay thế tệp trong khi trò chơi đang chạy",
  SETTING_RUNTIME_REPLACEMENT_DESC:
    "Trước khi khởi chạy, các tệp đã chọn được sao chép đè lên tệp đích trong thư mục trò chơi và giữ nguyên trong khi trò chơi đang chạy. Các tệp gốc được khôi phục sau khi thoát trò chơi.",
  SETTING_RUNTIME_REPLACEMENT_HEADER_ENABLED: "Bật",
  SETTING_RUNTIME_REPLACEMENT_HEADER_TARGET: "Tệp cần thay thế",
  SETTING_RUNTIME_REPLACEMENT_HEADER_REPLACEMENT: "Tệp thay thế",
  SETTING_RUNTIME_REPLACEMENT_HEADER_DELETE: "Xóa",
  SETTING_RUNTIME_REPLACEMENT_ROW_ENABLED: "Bật hàng {0}",
  SETTING_RUNTIME_REPLACEMENT_PICK_TARGET: "Chọn tệp cần thay thế",
  SETTING_RUNTIME_REPLACEMENT_PICK_REPLACEMENT: "Chọn tệp thay thế",
  SETTING_RUNTIME_REPLACEMENT_DELETE_ROW: "Xóa hàng này",
  SETTING_RUNTIME_REPLACEMENT_ADD_ROW: "Thêm hàng",
  SETTING_CUSTOM_ENVIRONMENT_VARIABLES_TITLE: "Biến môi trường tùy chỉnh",
  SETTING_CUSTOM_ENVIRONMENT_VARIABLES_DESC:
    "Thêm biến môi trường tùy chỉnh vào tiến trình Wine khi khởi động trò chơi.",
  SETTING_CUSTOM_ENVIRONMENT_VARIABLES_HEADER_ENABLED: "Bật",
  SETTING_CUSTOM_ENVIRONMENT_VARIABLES_HEADER_KEY: "Khóa biến môi trường",
  SETTING_CUSTOM_ENVIRONMENT_VARIABLES_HEADER_VALUE: "Giá trị",
  SETTING_CUSTOM_ENVIRONMENT_VARIABLES_HEADER_DELETE: "Xóa",
  SETTING_CUSTOM_ENVIRONMENT_VARIABLES_ROW_ENABLED:
    "Bật hàng biến môi trường {0}",
  SETTING_CUSTOM_ENVIRONMENT_VARIABLES_DELETE_ROW: "Xóa hàng này",
  SETTING_CUSTOM_ENVIRONMENT_VARIABLES_ADD_ROW: "Thêm hàng",
  SETTING_RUNTIME_REPLACEMENT_RESTORE_ALL: "Khôi phục tất cả bản sao lưu ngay",
  SETTING_LICENSES: "Giấy phép",
  SETTING_ENABLE_HDR: "Bật HDR",

  SETTING_PROXY_ENABLED: "Bật HTTP Proxy",
  SETTING_PROXY_HOST: "Máy chủ HTTP Proxy",
  SETTING_PROXY_DESC:
    "Proxy chỉ áp dụng cho trò chơi, không áp dụng cho toàn bộ launcher.",

  SETTING_TURN_ON_STEAM_PATCH: "Bật bản vá Steam",

  UPDATE_PROMPT_IGNORE: "Bỏ qua cập nhật",
  SETTING_CHECK_UPDATE: "Kiểm tra cập nhật YAAGLM",
  SETTING_CHECK_GAME_UPDATE: "Kiểm tra cập nhật trò chơi",
  SETTING_GAME_UPDATE_AVAILABLE: "Có phiên bản mới của trò chơi",
  SETTING_GAME_UPDATE_AVAILABLE_DESC:
    "Có phiên bản mới của trò chơi. Cài đặt ngay?",
  SETTING_CONFIRM_INSTALL: "Xác nhận cài đặt",
  SETTING_CANCEL_INSTALL: "Hủy cài đặt",
  CANCEL_UPDATE: "Hủy cập nhật",
  ALREADY_LATEST_VERSION: "Bạn đang sử dụng phiên bản mới nhất.",
  AHEAD_OF_LATEST_TITLE: "Mới hơn bản phát hành mới nhất",
  AHEAD_OF_LATEST_JOKE:
    "Trong khi bản chính thức vẫn còn nhỏ giọt cập nhật 🐌, bạn đã ở thế hệ tiếp theo 🚀. Kín tiếng thôi, đừng spoil 🤫.",
  UPDATE_LAUNCHER: "Cập nhật Launcher",
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
  SETTING_WINE_PREFIX_PATH: "Đường dẫn Wine Prefix",
  SETTING_OPEN: "Mở",
  LOG_VIEWER_TITLE: "Live Logs",
  LOG_VIEWER_EMPTY: "No logs yet",
  LOG_VIEWER_OPEN_HINT: "Click to view live logs",
  LOG_VIEWER_OPEN_ACTION: "Xem log trực tiếp",
  LOG_VIEWER_OPEN_FILE: "Open Log File",
  LOG_VIEWER_FOLLOW_SCROLL: "Tự cuộn theo",
  LOG_VIEWER_COPY: "Sao chép log",
  LICENSE_VIEW_ONLINE: "Xem trực tuyến",
  SETTING_GITHUB_ACCELERATED_PREFIX: "Use GitHub acceleration prefix",
  SETTING_GITHUB_ACCELERATED_PREFIX_URL: "GitHub acceleration prefix URL",
  SETTING_GITHUB_ACCELERATED_PREFIX_TEST: "Test",
  SETTING_GITHUB_ACCELERATED_PREFIX_TESTING: "Testing...",
  SETTING_GITHUB_ACCELERATED_PREFIX_CONNECTED: "Connected",
  SETTING_GITHUB_ACCELERATED_PREFIX_FAILED: "Connection failed",
  SETTING_GITHUB_ACCELERATED_PREFIX_INVALID: "Invalid URL",
  SETTING_AUTO_UPDATE: "Check for launcher updates automatically",
  SETTING_AUTO_UPDATE_DEV_TOOLTIP:
    "Development versions do not support automatic updates",
  SETTING_DOWNLOAD_SERVER: "Download Server",
  SETTING_DOWNLOAD_PROXY: "Download server HTTP proxy",
  SETTING_DOWNLOAD_PROXY_ENABLED: "Enable download HTTP proxy",
  SETTING_DOWNLOAD_PROXY_DESC:
    "Used for launcher downloads such as Wine, environment components, game files, and updates. http:// is used when no protocol is provided.",
  SETTING_DOWNLOAD_SPEED_LIMIT: "Download speed limit",
  SETTING_DOWNLOAD_SPEED_LIMIT_ENABLED: "Enable download speed limit",
  DOWNLOAD_MANAGER: "Quản lý tải xuống",
  DOWNLOAD_MANAGER_EMPTY: "Không có tác vụ tải xuống",
  DOWNLOAD_MANAGER_GLOBAL_TASK_WAITING:
    "Đang chạy tác vụ môi trường; các bản tải khác đã tạm dừng",
  DOWNLOAD_TASK_ID: "ID tác vụ",
  DOWNLOAD_STATUS_QUEUED: "Đang chờ",
  DOWNLOAD_STATUS_ACTIVE: "Đang tải xuống",
  DOWNLOAD_STATUS_VERIFYING: "Đang xác minh",
  DOWNLOAD_STATUS_PAUSED: "Đã tạm dừng",
  DOWNLOAD_STATUS_COMPLETED: "Hoàn tất",
  DOWNLOAD_STATUS_ERROR: "Lỗi",
  DOWNLOAD_STATUS_CANCELLED: "Đã hủy",
  DOWNLOAD_PAUSE: "Tạm dừng",
  DOWNLOAD_RESUME: "Tiếp tục",
  DOWNLOAD_TASK_PREDOWNLOAD_SUFFIX: "Tải trước",
  DOWNLOAD_TASK_EXPAND: "Hiện chi tiết",
  DOWNLOAD_TASK_COLLAPSE: "Ẩn chi tiết",
  DOWNLOAD_TASK_ENGINE: "Công cụ tải xuống",
  DOWNLOAD_TASK_UNKNOWN_SIZE: "Không rõ",
  SETTING_MAX_CONCURRENT_DOWNLOADS: "Giới hạn lượt tải xuống song song",
  SETTING_GAME_VERSION_NOT_INSTALLED: "Not installed",
  NOTIFICATION_TASK_COMPLETED: "Hoàn tất tác vụ thành công",
  NOTIFICATION_TASK_CANCELLED: "Đã hủy tác vụ",
  NOTIFICATION_TASK_FAILED:
    "Không thể hoàn thành tác vụ. Vui lòng xem nhật ký để biết chi tiết.",
  NOTIFICATION_TASK_FAILED_TITLE: "Tác vụ thất bại",
  NOTIFICATION_AUTHORIZATION_CANCELLED:
    "Tác vụ thất bại vì quyền ủy quyền đã bị hủy.",
  CHECK_UPDATE_FAILED: "Update check failed",
  CHECK_UPDATE_FAILED_DESC: "Unable to connect to the GitHub server ({0})",
  CHECK_GAME_UPDATE_FAILED: "Kiểm tra cập nhật trò chơi thất bại",
  CHECK_GAME_UPDATE_FAILED_DESC:
    "Không thể kết nối đến máy chủ cập nhật. Vui lòng kiểm tra kết nối mạng và thử lại.",
};
