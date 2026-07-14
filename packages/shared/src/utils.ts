export function resolveConfig<T extends Record<string, unknown>>(
  defaults: T,
  ...sources: (Partial<T> | undefined | null)[]
): T {
  const result = { ...defaults };

  for (const source of sources) {
    if (!source) continue;

    for (const key of Object.keys(source) as (keyof T)[]) {
      const value = source[key];
      if (value === undefined) continue;

      const existing = result[key];
      if (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        typeof existing === "object" &&
        existing !== null &&
        !Array.isArray(existing)
      ) {
        result[key] = resolveConfig(
          existing as Record<string, unknown>,
          value as Record<string, unknown>
        ) as T[keyof T];
      } else {
        result[key] = value as T[keyof T];
      }
    }
  }

  return result;
}

export function parseEnvBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value === "true" || value === "1" || value === "yes";
}

export function parseEnvInt(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

export function parseEnvFloat(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

export function loadConfigFromEnv(prefix = "FAVARO_"): Record<string, unknown> {
  const config: Record<string, unknown> = {};

  const mappings: Record<string, (v: string) => unknown> = {
    ENABLED: (v) => parseEnvBool(v, true),
    NAMESPACE: (v) => v,
    TTL: (v) => parseEnvInt(v, 3600),
    SLIDING_EXPIRATION: (v) => parseEnvBool(v, false),
    COMPRESSION: (v) => parseEnvBool(v, false),
    ENCRYPTION: (v) => parseEnvBool(v, false),
    SEMANTIC: (v) => parseEnvBool(v, false),
    SEMANTIC_THRESHOLD: (v) => parseEnvFloat(v, 0.92),
    METRICS: (v) => parseEnvBool(v, true),
    MAX_ENTRIES: (v) => parseEnvInt(v, 100_000),
    CLEANUP_INTERVAL: (v) => parseEnvInt(v, 60_000),
    STORAGE: (v) => v,
    VERSION: (v) => parseEnvInt(v, 1),
  };

  for (const [suffix, parser] of Object.entries(mappings)) {
    const envKey = `${prefix}${suffix}`;
    const value = process.env[envKey];
    if (value !== undefined) {
      const camelKey = suffix
        .toLowerCase()
        .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      config[camelKey] = parser(value);
    }
  }

  return config;
}

export function debounce<T extends (...args: never[]) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

export function estimateObjectSize(obj: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(obj), "utf8");
  } catch {
    return 0;
  }
}

export function now(): number {
  return Date.now();
}
