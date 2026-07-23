import { en } from "./en";
import { zh_CN } from "./zh_CN";

export const vi_VN: typeof zh_CN = {
  CONTENT_LANG_ID: "vi-vn",
  LAUNCH: "Khởi động trò chơi",
  INSTALL: "Cài đặt trò chơi",
  UPDATING: "Đang cập nhật",
  DOWNLOADING: "Đang tải",
  PAUSE_DOWNLOAD: "Tạm dừng tải xuống",
  RESUME_DOWNLOAD: "Tiếp tục tải xuống",
  CANCEL_DOWNLOAD: "Hủy tải xuống",
  FORCE_QUIT_GAME: "Buộc thoát trò chơi",
  FIXING_FILES: "Đang sửa tệp trò chơi {0}/{1}",
  PATCHING: "Đang vá tệp trò chơi",
  GAME_RUNNING: "Đang chạy trò choi (VUI LÒNG KHÔNG ĐÓNG TRÌNH KHỞI ĐỘNG)",
  GAME_RUNNING_CLOSE_TITLE: "Trò chơi vẫn đang chạy",
  GAME_RUNNING_CLOSE_DESC:
    'Trò chơi chưa thoát. Bạn có muốn đóng cả tiến trình trò chơi khi thoát YAAgl không?\n\nChọn "Có" để đóng trò chơi và thoát launcher.\nChọn "Không" để chỉ thoát launcher và giữ trò chơi chạy nếu có thể.\nChọn "Hủy" để quay lại launcher.',
  REVERT_PATCHING: "Đang hoàn tác bản vá",
  SCANNING_FILES:
    "Kiểm tra tính toàn vẹn của tệp. {0}/{1} tệp đã được hoàn thành ",
  DOWNLOADING_ENVIRONMENT: "Đang tải tệp môi trường",
  DOWNLOADING_ENVIRONMENT_SPEED:
    "Đang tải xuống tệp môi trường ({1}/{2}, {3}, {0})",
  EXTRACT_ENVIRONMENT: "Đang giải nén môi trường",
  CONFIGURING_ENVIRONMENT: "Đang tuỳ chỉnh môi trường",
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
  SETTING_GAME: "Trò chơi",
  SETTING_VIDEO: "Video",
  LANGUAGE_LOCALE_NAME: "Tiếng Việt",
  SETTING_UI_LOCALE: "Ngôn ngữ trình khởi động",
  SETTING_RESTART_TO_TAKE_EFFECT:
    "Cài đặt sẽ có hiệu lực sau khi khởi động lại",
  SETTING_OPEN_CMD: "Mở command line (cmd) của wine",
  SETTING_OPEN_GAME_INSTALL_DIR: "Mở thư mục cài đặt trò chơi",
  SETTING_OPEN_YAAGL_DIR: "Mở thư mục dữ liệu của YAAGL",
  SETTING_YAAGL_VERSION: "Phiên bản YAAGL",

  SETTING_FPS_UNLOCK: "Mở khóa giới hạn FPS",
  SETTING_FPS_UNLOCK_DEFAULT: "Tắt",

  SETTING_ADVANCED: "Nâng cao",
  SETTING_ADVANCED_ALERT:
    "VUI LÒNG KHÔNG THAY ĐỔI BẤT KỲ ĐIỀU GÌ, trừ khi bạn biết mình nên làm gì.",
  SETTING_ADVANCED_VISIBLE: "Cài đặt nâng cao hiện có thể nhìn thấy.",

  NO_ENOUGH_DISKSPACE: "Không đủ dung lượng trống trên ổ đĩa",
  NO_ENOUGH_DISKSPACE_DESC: "Cần có tối thiếu {0}GiB ({1}GB) dung lượng trống.",

  UPDATE: en.UPDATE,
  GAME_VERSION_TOO_OLD_DESC: en.GAME_VERSION_TOO_OLD_DESC,

  PREDOWNLOAD_READY: en.PREDOWNLOAD_READY,

  COMMUNITY_WARNING: "Cảnh báo phiên bản cộng đồng",
  COMMUNITY_WINE_ALERT:
    "Hiện tại được chọn là phiên bản cộng đồng, phiên bản này không được hỗ trợ chính thức, vui lòng không báo cáo bất kỳ vấn đề nào",

  SETTING_BLOCK_NET: "Tạm chặn mạng qua hosts",
  SETTING_BLOCK_NET_DURATION: "Thời lượng chặn (giây)",
  SETTING_HOSTS_HELPER: "Hosts permission helper",
  SETTING_HOSTS_HELPER_STATUS_RUNNING: "Status: installed and running",
  SETTING_HOSTS_HELPER_STATUS_STOPPED: "Status: installed but not running",
  SETTING_HOSTS_HELPER_STATUS_NOT_INSTALLED: "Status: not installed",
  SETTING_HOSTS_HELPER_STATUS_ERROR: "Status: needs attention",
  SETTING_HOSTS_HELPER_INSTALL: "Install",
  SETTING_HOSTS_HELPER_UNINSTALL: "Uninstall",
  SETTING_HOSTS_HELPER_REFRESH: "Refresh",
  SETTING_TIMEOUT_FIX: "Bật khắc phục timeout của Wine",
  SETTING_WORKAROUND4: "Tạm thay mhypbase.dll khi trò chơi đang chạy",
  SETTING_WORKAROUND4_DESC:
    "Trước khi khởi chạy, mhypbase.dll phiên bản cũ đã chọn sẽ được sao chép vào thư mục trò chơi và giữ nguyên khi trò chơi đang chạy. Tệp gốc sẽ được khôi phục sau khi thoát trò chơi. Launcher không tích hợp hoặc phân phối DLL này.",
  SETTING_WORKAROUND4_PICK: "Chọn tệp...",
  SETTING_WORKAROUND4_REVERT_BTN: "Khôi phục mhypbase.dll gốc ngay",
  SETTING_LICENSES: "Giấy phép",
  SETTING_ENABLE_HDR: "Bật HDR",

  SETTING_PROXY_ENABLED: "Bật HTTP Proxy",
  SETTING_PROXY_HOST: "Máy chủ HTTP Proxy",
  SETTING_PROXY_DESC:
    "Proxy chỉ áp dụng cho trò chơi, không áp dụng cho toàn bộ launcher.",

  SETTING_TURN_ON_STEAM_PATCH: "Bật bản vá Steam",

  UPDATE_PROMPT_IGNORE: "Bỏ qua cập nhật",
  SETTING_CHECK_UPDATE: "Kiểm tra cập nhật YAAGL",
  SETTING_CHECK_GAME_UPDATE: "Kiểm tra cập nhật trò chơi",
  ALREADY_LATEST_VERSION: "Bạn đang sử dụng phiên bản mới nhất.",
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
  LICENSE_COPY: "Sao chép license hiện tại",
  SETTING_DOWNLOAD_SERVER: "Download Server",
  SETTING_DOWNLOAD_PROXY: "Download server HTTP proxy",
  SETTING_DOWNLOAD_PROXY_ENABLED: "Enable download HTTP proxy",
  SETTING_DOWNLOAD_PROXY_DESC:
    "Used for launcher downloads such as Wine, environment components, game files, and updates. http:// is used when no protocol is provided.",
  SETTING_DOWNLOAD_SPEED_LIMIT: "Download speed limit",
  SETTING_DOWNLOAD_SPEED_LIMIT_ENABLED: "Enable download speed limit",
  SETTING_GAME_VERSION_NOT_INSTALLED: "Not installed",
};
