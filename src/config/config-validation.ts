const CONFIG_KEY_PATTERN = /^[a-zA-Z0-9_-]{1,50}$/;

export function validateConfigKey(key: string): void {
  if (!CONFIG_KEY_PATTERN.test(key)) {
    throw new Error(`Invalid configuration key: ${key}`);
  }
}

export function validateConfigValue(value: string | null): void {
  if (value?.includes("\0")) {
    throw new Error("Configuration values cannot contain NUL characters");
  }
}
