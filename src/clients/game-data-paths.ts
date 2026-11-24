import {
  HK4E_CN_USER_DATA_PATH,
  HK4E_OS_USER_DATA_PATH,
  HKRPG_CN_USER_DATA_PATH,
  HKRPG_OS_USER_DATA_PATH,
  NAP_CN_USER_DATA_PATH,
  NAP_OS_USER_DATA_PATH,
  SDK_REGISTRY_KEY,
} from "./secret";

const userDataPathsByServer = new Map([
  ["hk4e_cn", HK4E_CN_USER_DATA_PATH],
  ["hk4e_global", HK4E_OS_USER_DATA_PATH],
  ["hkrpg_cn", HKRPG_CN_USER_DATA_PATH],
  ["hkrpg_global", HKRPG_OS_USER_DATA_PATH],
  ["nap_cn", NAP_CN_USER_DATA_PATH],
  ["nap_global", NAP_OS_USER_DATA_PATH],
]);

function getRegistryPath(folder: string): string {
  return `Software\\${folder.replace("/", "\\")}`;
}

export function getGameRegistryKey(serverId: string): string | undefined {
  const folder = userDataPathsByServer.get(serverId);
  return folder && `HKEY_CURRENT_USER\\${getRegistryPath(folder)}`;
}

export function getGameUserDataFolder(serverId: string): string | undefined {
  return userDataPathsByServer.get(serverId);
}

export function getWineUserData(folder: string) {
  return {
    registryKeys: [getRegistryPath(folder), SDK_REGISTRY_KEY],
    prefixDirs: [`drive_c/users/*/AppData/LocalLow/${folder}`],
  };
}
