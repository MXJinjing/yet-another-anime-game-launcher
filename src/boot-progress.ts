import { createSignal } from "solid-js";
import type { Locale, LocaleTextKey } from "./locale";
import { zh_CN } from "./locale/zh_CN";

const INITIAL_BOOT_TEXT = zh_CN.BOOT_INITIALIZING;
let bootLocale: Locale | undefined;
let bootTextKey: LocaleTextKey = "BOOT_INITIALIZING";

export const [getBootText, setBootText] = createSignal(INITIAL_BOOT_TEXT);
export const [getBootProgress, setBootProgress] = createSignal(0);
export const [getBootDetail, setBootDetail] = createSignal("");

export function setBootProgressLocale(locale: Locale) {
  bootLocale = locale;
  setBootText(locale.get(bootTextKey));
}

export function reportBootProgress(
  text: LocaleTextKey,
  progress: number,
  detail = ""
) {
  bootTextKey = text;
  setBootText(bootLocale?.get(text) ?? zh_CN[text]);
  setBootProgress(Math.max(0, Math.min(100, progress)));
  setBootDetail(detail);
}
