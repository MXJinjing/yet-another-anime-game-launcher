export async function sha256_16(str: string) {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(str)
  );
  return Array.prototype.map
    .call(new Uint8Array(buf), x => ("00" + x.toString(16)).slice(-2))
    .slice(0, 8)
    .join("");
}

export function binaryPatternSearch(view: Uint8Array, pattern: number[]) {
  retry: for (let i = 0; i < view.byteLength - pattern.length; i++) {
    for (let j = 0; j < pattern.length; j++) {
      if (view[i + j] != pattern[j]) continue retry;
    }
    return i;
  }
  return -1;
}

export function generateRandomString(n: number) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < n; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function utf16le(text: string) {
  const buffer = new ArrayBuffer(text.length * 2 + 2);
  const view = new DataView(buffer);
  view.setUint16(0, 0xfeff, true);
  for (let i = 1; i <= text.length; i++) {
    view.setUint16(i * 2, text.charCodeAt(i - 1), true);
  }
  return buffer;
}

export const sha1sum = async (message: string) => {
  const hashBuffer = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(message)
  );
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
};
