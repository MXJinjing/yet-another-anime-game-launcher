export interface CustomEnvironmentVariable {
  enabled: boolean;
  key: string;
  value: string;
}

export function parseCustomEnvironmentVariables(
  value: unknown
): CustomEnvironmentVariable[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isCustomEnvironmentVariable).map(entry => ({ ...entry }));
}

export function serializeCustomEnvironmentVariables(
  entries: CustomEnvironmentVariable[]
): string {
  return JSON.stringify(entries);
}

export function getCustomEnvironmentVariables(config: {
  customEnvironmentVariablesEnabled?: boolean;
  customEnvironmentVariables?: CustomEnvironmentVariable[];
}): Record<string, string> {
  if (!config.customEnvironmentVariablesEnabled) return {};

  const environment: Record<string, string> = {};
  for (const entry of config.customEnvironmentVariables ?? []) {
    const key = entry.key.trim();
    if (
      entry.enabled &&
      key &&
      !Object.prototype.hasOwnProperty.call(environment, key)
    ) {
      environment[key] = entry.value;
    }
  }
  return environment;
}

function isCustomEnvironmentVariable(
  value: unknown
): value is CustomEnvironmentVariable {
  if (!value || typeof value != "object") return false;
  const entry = value as Partial<CustomEnvironmentVariable>;
  return (
    typeof entry.enabled == "boolean" &&
    typeof entry.key == "string" &&
    typeof entry.value == "string"
  );
}
