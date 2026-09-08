import { en } from "./en";
import { zh_CN } from "./zh_CN";
import { vi_VN } from "./vi_VN";
import { es_ES } from "./es_ES";
import { fr_FR } from "./fr_FR";
import { ru_RU } from "./ru_RU";
import { ja_JP } from "./ja_JP";
import { ko_KR } from "./ko_KR";
import { de_DE } from "./de_DE";
import { th_TH } from "./th_TH";
import { formatString } from "../runtime/format";
import { getKey } from "../runtime/storage";

type AuthorizationPromptKey = Extract<
  keyof typeof zh_CN,
  `AUTHORIZATION_PROMPT_${string}`
>;

const authorizationLocales = {
  zh_cn: zh_CN,
  en,
  vi_vn: vi_VN,
  es_es: es_ES,
  fr_fr: fr_FR,
  ru_ru: ru_RU,
  ja_jp: ja_JP,
  ko_kr: ko_KR,
  de_de: de_DE,
  th_th: th_TH,
};

async function getAuthorizationLanguage() {
  try {
    return (await getKey("config_uiLocale")).toLowerCase();
  } catch {
    const language = globalThis.navigator?.language
      ?.replaceAll("-", "_")
      .toLowerCase()
      .split(".")[0];
    return language?.startsWith("en_") ? "en" : language || "en";
  }
}

export async function getAuthorizationPrompt(
  key: AuthorizationPromptKey,
  interpolation: string[] = []
) {
  const language = await getAuthorizationLanguage();
  const locale =
    authorizationLocales[language as keyof typeof authorizationLocales] ?? en;
  return formatString(locale[key], interpolation);
}
