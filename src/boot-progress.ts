import { createSignal } from "solid-js";

export const [getBootText, setBootText] = createSignal("正在初始化");
export const [getBootProgress, setBootProgress] = createSignal(0);
export const [getBootDetail, setBootDetail] = createSignal("");

export function reportBootProgress(
  text: string,
  progress: number,
  detail = ""
) {
  setBootText(text);
  setBootProgress(Math.max(0, Math.min(100, progress)));
  setBootDetail(detail);
}
