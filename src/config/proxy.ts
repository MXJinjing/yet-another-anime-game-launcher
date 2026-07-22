export function normalizeHttpProxy(proxy: string) {
  const value = proxy.trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `http://${value}`;
}
