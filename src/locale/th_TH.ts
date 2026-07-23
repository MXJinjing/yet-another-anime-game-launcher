import { zh_CN } from "./zh_CN";
import { en } from "@locale/en";

export const th_TH: typeof zh_CN = {
  CONTENT_LANG_ID: "th-th",
  LAUNCH: "เริ่มเกม",
  INSTALL: "ติดตั้งเกม",
  UPDATING: "กำลังอัปเดต",
  DOWNLOADING: "กำลังดาวน์โหลด",
  PAUSE_DOWNLOAD: "พักการดาวน์โหลด",
  RESUME_DOWNLOAD: "ดาวน์โหลดต่อ",
  CANCEL_DOWNLOAD: "ยกเลิกการดาวน์โหลด",
  FORCE_QUIT_GAME: "บังคับปิดเกม",
  FIXING_FILES: "กำลังซ่อมแซมไฟล์เกม {0}/{1}",
  PATCHING: "กำลังแก้ไขไฟล์เกม",
  GAME_RUNNING: "เกมกำลังทำงาน (ห้ามปิดลันเชอร์เด็ดขาด)",
  GAME_RUNNING_CLOSE_TITLE: "เกมยังทำงานอยู่",
  GAME_RUNNING_CLOSE_DESC:
    'เกมยังไม่ได้ปิด ต้องการปิดโปรเซสเกมพร้อมกับออกจาก YAAgl หรือไม่?\n\nเลือก "ใช่" เพื่อปิดเกมและออกจาก Launcher\nเลือก "ไม่" เพื่อออกจาก Launcher เท่านั้น และปล่อยให้เกมทำงานต่อถ้าเป็นไปได้\nเลือก "ยกเลิก" เพื่อกลับไปที่ Launcher',
  REVERT_PATCHING: "กำลังย้อนคืนแพตช์",
  SCANNING_FILES: "กำลังตรวจสอบความสมบูรณ์ของไฟล์เกม, สำเร็จไปแล้ว {0}/{1}",
  DOWNLOADING_ENVIRONMENT: "กำลังดาวน์โหลดไฟล์ระบบ",
  DOWNLOADING_ENVIRONMENT_SPEED: "กำลังดาวน์โหลดไฟล์ระบบ ({1}/{2}, {3}, {0})",
  EXTRACT_ENVIRONMENT: "กำลังแตกไฟล์ระบบ",
  CONFIGURING_ENVIRONMENT: "กำลังตั้งค่าไฟล์ระบบ",
  RESTART_TO_INSTALL: "รีสตาร์ทโปรแกรม",
  PATH_INVALID: "ตำแหน่งไฟล์ไม่ถูกต้อง",
  PLEASE_SELECT_A_DIR: "กรุณาเลือกตำแหน่งไฟล์",
  PATH_INVALID_ASCII_ONLY: "กรุณาเลือกตำแหน่งไฟล์ที่มีตัวอักษร ASCII เท่านั้น",
  PATH_INVALID_FORBIDDEN_DIR:
    'กรุณาเลือกตำแหน่งไฟล์ที่ไม่ได้อยู่ใน "Desktop", "Downloads" หรือ "Documents"',
  NOT_SUPPORTED_YET: "ยังไม่รองรับ",
  PLEASE_WAIT_FOR_LAUNCHER_UPDATE:
    "ขณะนี้ลันเชอร์ยังไม่รองรับเวอร์ชัน {0} โปรดรอการอัปเดตเพิ่มเติม",
  UNSUPPORTED_VERSION: "เวอร์ชันไม่รองรับ",
  SELECT_INSTALLATION_DIR:
    "กรุณาเลือกไดเรกทอรีสำหรับติดตั้งเกม\nหากคุณติดตั้งเกมเรียบร้อยแล้ว, ให้เลือกตำแหน่งของไฟล์ที่ใช้สำหรับรันเกม",
  CANT_OPEN_GAME_FILE: "ไม่สามารถเข้าถึงไฟล์เกมได้",
  CANT_OPEN_GAME_FILE_DESC:
    "ลันเชอร์ไม่สามารถเข้าถึงไฟล์เกมได้\nกรุณาปรับเปลี่ยนไดเรกทอรีติดตั้งเกมหลังจากนี้\n\nหากข้อความนี้ปรากฏขึ้นซ้ำๆ, โปรดตรวจสอบให้แน่ใจว่าลันเชอร์ได้รับสิทธิ์ในการเข้าถึงไดเรกทอรีของเกม",
  GAME_DIR_CHANGED: "ตำแหน่งไปยังไดเรกทอรีเกมมีการเปลี่ยนแปลง",
  GAME_DIR_CHANGED_DESC:
    "ตรวจพบการเปลี่ยนแปลงตำแหน่งของเกม โปรดระบุตำแหน่งใหม่ในการตั้งค่าเพื่อให้ทำงานได้อย่างถูกต้อง",
  GAME_VERSION: "เวอร์ชันเกม",

  NEW_VERSION_AVAILABLE: "มีการอัปเดตเวอร์ชันใหม่",
  NEW_VERSION_AVAILABLE_DESC:
    "ต้องการอัปเดตเป็นเวอร์ชัน {0} หรือไม่?\n\nเปลี่ยนแปลง:\n{1}",

  DOWNLOADING_UPDATE_FILE: "กำลังดาวน์โหลดไฟล์อัปเดต",

  UPGRADE_FUNCTION_TBD: "ฟังก์ชันอัปเดตยังไม่พร้อมใช้งานในขณะนี้",

  DECOMPRESS_FILE_PROGRESS: "กำลังแตกไฟล์",
  ALLOCATING_FILE: "กำลังจัดสรรพื้นที่ไฟล์บนดิสก์",
  DOWNLOADING_FILE_PROGRESS: "กำลังดาวน์โหลดไฟล์: {0} ({2}/{3}, {4}) {1}",

  BACKUP_USER_DATA: "กำลังสำรองข้อมูลผู้ใช้",
  RECOVER_BACKUP_USER_DATA: "กำลังกู้คืนข้อมูลสำรอง",

  INSTALL_DONE: "เสร็จสิ้น",

  RELAUNCH_REQUIRED: "ต้องรีสตาร์ทโปรแกรม",
  RELAUNCH_REQUIRED_DESC:
    "ลันเชอร์จะทำการรีสตาร์ทเพื่อดำเนินการติดตั้ง wine ให้เสร็จสมบูรณ์",

  SETTING: "ตั้งค่า",
  SETTING_WINE_VERSION: "ดิสทริบิวชัน Wine",
  SETTING_ASYNC_DXVK: "คอมไพล์ shader ของ DXVK แบบอะซิงโครนัส",
  SETTING_ENABLED: "เปิดใช้งาน",
  SETTING_DXVK_HUD: "DXVK HUD",
  SETTING_DXVK_HUD_NONE: "ไม่แสดง",
  SETTING_DXVK_HUD_FPS: "แสดงเฉพาะ FPS",
  SETTING_DXVK_HUD_ALL: "แสดงทั้งหมด",
  SETTING_MTL_HUD: "Metal HUD",
  SETTING_RETINA: "โหมด Retina",
  SETTING_LEFT_CMD: "แมปปุ่ม CMD ซ้ายเป็น CTRL",
  SETTING_TURN_OFF_AC_PATCH: "ปิดการใช้งานแพตช์ AC",
  SETTING_CUSTOM_RESOLUTION: "ความละเอียดแบบกำหนดเอง",
  SETTING_DISPLAY_MODE: "โหมดแสดงผลของเกม",
  SETTING_DISPLAY_MODE_FULLSCREEN: "เต็มหน้าจอ",
  SETTING_DISPLAY_MODE_WINDOWED: "หน้าต่าง",
  SETTING_WINDOW_RESOLUTION: "ความละเอียดหน้าต่าง",
  SETTING_SAVE: "บันทึก",
  SETTING_CANCEL: "ยกเลิก",

  SETTING_CHECK_INTEGRITY: "ตรวจสอบความสมบูรณ์ของไฟล์",
  SETTING_GAME_INSTALL_DIR: "ไดเรกทอรีติดตั้งเกม",
  SETTING_CHANGE_GAME_INSTALL_DIR: "เปลี่ยน",
  SETTING_GAME_DIR_SIZE: "ขนาด: {0}",
  SETTING_GAME_DIR_SIZE_NOT_SET: "ยังไม่ได้ตั้งค่า",
  SETTING_UNINSTALL_GAME: "ถอนการติดตั้งเกม",
  SETTING_UNINSTALL_GAME_CONFIRM:
    "การดำเนินการนี้จะล้างโฟลเดอร์เกมต่อไปนี้ และไม่สามารถย้อนกลับได้:\n{0}\n\nดำเนินการต่อหรือไม่?",
  SETTING_UNINSTALL_SCREENSHOTS_NOTICE:
    "หมายเหตุ: การถอนการติดตั้งจะลบภาพหน้าจอเกมทั้งหมดด้วย",
  // 0.0.27
  SETTING_WINE_VERSION_CONFIRM: "ยืนยัน",
  SETTING_QUICK_ACTIONS: "การทำงานด่วน",
  SETTING_GENERAL: "ทั่วไป",
  SETTING_GAME: "เกม",
  SETTING_VIDEO: "วิดีโอ",
  LANGUAGE_LOCALE_NAME: "ไทย",
  SETTING_UI_LOCALE: "ภาษาของลันเชอร์",
  SETTING_RESTART_TO_TAKE_EFFECT: "การตั้งค่านี้จะมีผลหลังจากรีสตาร์ท",
  SETTING_OPEN_CMD: "เปิด Wine Command Line Tool",
  SETTING_OPEN_GAME_INSTALL_DIR: "เปิดไดเรกทอรีติดตั้งเกม",
  SETTING_OPEN_YAAGL_DIR: "เปิดไดเรกทอรีข้อมูล YAAGL",
  SETTING_YAAGL_VERSION: "เวอร์ชัน YAAGL",

  SETTING_FPS_UNLOCK: "ปลดล็อกจำกัด FPS",
  SETTING_FPS_UNLOCK_DEFAULT: "ปิดใช้งาน",

  SETTING_ADVANCED: "ขั้นสูง",
  SETTING_ADVANCED_ALERT:
    "อย่าเปลี่ยนแปลงอะไรเด็ดขาด, เว้นแต่คุณจะรู้ว่ากำลังทำอะไรอยู่",
  SETTING_ADVANCED_VISIBLE: "การตั้งค่าขั้นสูงพร้อมใช้งานแล้ว",

  NO_ENOUGH_DISKSPACE: "มีพื้นที่บนดิสก์ไม่เพียงพอ",
  NO_ENOUGH_DISKSPACE_DESC: "ต้องการพื้นที่ว่างบนดิสก์อย่างน้อย {0}GiB ({1}GB)",

  UPDATE: "อัปเดตเกม",
  GAME_VERSION_TOO_OLD_DESC:
    "เนื่องจากเวอร์ชันเกม ({0}) เก่าเกินไป จึงไม่สามารถอัปเดตแพตช์ได้ กรุณาติดตั้งเกมใหม่ทั้งหมด",

  PREDOWNLOAD_READY: "ดาวน์โหลดล่วงหน้า {0}",

  COMMUNITY_WARNING: "คำเตือนจากชุมชน",
  COMMUNITY_WINE_ALERT:
    "เวอร์ชันที่เลือกคือเวอร์ชันจากชุมชน ซึ่งไม่ได้รับการสนับสนุนอย่างเป็นทางการ กรุณาอย่ารายงานปัญหาใดๆ มา",

  SETTING_BLOCK_NET: "บล็อกเครือข่ายชั่วคราวผ่าน hosts",
  SETTING_BLOCK_NET_DURATION: "ระยะเวลาบล็อก (วินาที)",
  SETTING_HOSTS_HELPER: "Hosts permission helper",
  SETTING_HOSTS_HELPER_STATUS_RUNNING: "Status: installed and running",
  SETTING_HOSTS_HELPER_STATUS_STOPPED: "Status: installed but not running",
  SETTING_HOSTS_HELPER_STATUS_NOT_INSTALLED: "Status: not installed",
  SETTING_HOSTS_HELPER_STATUS_ERROR: "Status: needs attention",
  SETTING_HOSTS_HELPER_INSTALL: "Install",
  SETTING_HOSTS_HELPER_UNINSTALL: "Uninstall",
  SETTING_HOSTS_HELPER_REFRESH: "Refresh",
  SETTING_TIMEOUT_FIX: "เปิดใช้การเลี่ยง timeout ของ Wine",
  SETTING_WORKAROUND4: "แทนที่ mhypbase.dll ชั่วคราวระหว่างที่เกมทำงาน",
  SETTING_WORKAROUND4_DESC:
    "ก่อนเริ่มเกม ไฟล์ mhypbase.dll เวอร์ชันเก่าที่เลือกไว้จะถูกคัดลอกไปยังโฟลเดอร์เกมและคงไว้ระหว่างที่เกมทำงาน หลังจากออกจากเกมแล้ว ไฟล์เดิมจะถูกกู้คืน Launcher จะไม่รวมไฟล์ DLL นี้ไว้ในแอปหรือแจกจ่ายไฟล์นี้",
  SETTING_WORKAROUND4_PICK: "เลือกไฟล์...",
  SETTING_WORKAROUND4_REVERT_BTN: "กู้คืน mhypbase.dll เดิมทันที",
  SETTING_LICENSES: "สัญญาอนุญาต",
  SETTING_ENABLE_HDR: "เปิดใช้ HDR",

  SETTING_PROXY_ENABLED: "เปิดใช้ HTTP Proxy",
  SETTING_PROXY_HOST: "โฮสต์ HTTP Proxy",
  SETTING_PROXY_DESC: "Proxy จะมีผลกับเกมเท่านั้น ไม่ใช่ทั้ง Launcher",

  SETTING_TURN_ON_STEAM_PATCH: "เปิดใช้แพตช์ Steam",

  UPDATE_PROMPT_IGNORE: "ละเว้นการอัปเดต",
  SETTING_CHECK_UPDATE: "ตรวจสอบการอัปเดต YAAGL",
  SETTING_CHECK_GAME_UPDATE: "ตรวจสอบอัปเดตเกม",
  ALREADY_LATEST_VERSION: "คุณใช้เวอร์ชันล่าสุดอยู่แล้ว",
  UPDATE_LAUNCHER: "อัปเดต Launcher",
  INIT_ENVIRONMENT: "Initialize Environment",
  INIT_ENVIRONMENT_TITLE: "Initialize Runtime Environment",
  INIT_ENVIRONMENT_DESC:
    "The Wine runtime environment must be initialized before installing or launching the game. You can skip this now and initialize it later.",
  SKIP: "Skip",
  DONT_REMIND_AGAIN: "Don't remind again",
  SETTING_WINE_STATUS: "Wine Status",
  SETTING_WINE_STATUS_INSTALLED: "Installed",
  SETTING_WINE_STATUS_NOT_INSTALLED: "Not installed",
  SETTING_WINE_PREFIX_PATH: "พาธ Wine Prefix",
  SETTING_OPEN: "เปิด",
  LOG_VIEWER_TITLE: "Live Logs",
  LOG_VIEWER_EMPTY: "No logs yet",
  LOG_VIEWER_OPEN_HINT: "Click to view live logs",
  LOG_VIEWER_OPEN_ACTION: "ดูบันทึกสด",
  LOG_VIEWER_OPEN_FILE: "Open Log File",
  LOG_VIEWER_FOLLOW_SCROLL: "เลื่อนตามอัตโนมัติ",
  LOG_VIEWER_COPY: "คัดลอกบันทึก",
  LICENSE_COPY: "คัดลอก License ปัจจุบัน",
  SETTING_DOWNLOAD_SERVER: "Download Server",
  SETTING_DOWNLOAD_PROXY: "Download server HTTP proxy",
  SETTING_DOWNLOAD_PROXY_ENABLED: "Enable download HTTP proxy",
  SETTING_DOWNLOAD_PROXY_DESC:
    "Used for launcher downloads such as Wine, environment components, game files, and updates. http:// is used when no protocol is provided.",
  SETTING_DOWNLOAD_SPEED_LIMIT: "Download speed limit",
  SETTING_DOWNLOAD_SPEED_LIMIT_ENABLED: "Enable download speed limit",
  SETTING_GAME_VERSION_NOT_INSTALLED: "Not installed",
};
