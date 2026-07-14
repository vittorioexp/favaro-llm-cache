import { createHash } from "node:crypto";

const DEFAULT_IGNORE_FIELDS = new Set([
  "stream",
  "requestId",
  "id",
  "created",
  "created_at",
  "timestamp",
  "_timestamp",
  "abortSignal",
  "signal",
]);

export function stableStringify(value: unknown, ignoreFields?: Set<string>): string {
  const ignore = ignoreFields ?? DEFAULT_IGNORE_FIELDS;
  return JSON.stringify(sortObject(value, ignore));
}

function sortObject(value: unknown, ignore: Set<string>): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sortObject(item, ignore));
  }

  if (typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>).sort();

    for (const key of keys) {
      if (ignore.has(key)) {
        continue;
      }
      const val = (value as Record<string, unknown>)[key];
      if (val === undefined) {
        continue;
      }
      sorted[key] = sortObject(val, ignore);
    }

    return sorted;
  }

  return value;
}

export function hashString(input: string, algorithm: "sha256" | "sha512" = "sha256"): string {
  return createHash(algorithm).update(input).digest("hex");
}

export function generateCacheKey(
  input: Record<string, unknown>,
  options?: {
    namespace?: string;
    ignoreFields?: string[];
    keyBuilder?: (serialized: string) => string;
  }
): string {
  const ignore = new Set([...DEFAULT_IGNORE_FIELDS, ...(options?.ignoreFields ?? [])]);
  const serialized = stableStringify(input, ignore);
  const hash = hashString(serialized);

  if (options?.keyBuilder) {
    return options.keyBuilder(serialized);
  }

  const namespace = options?.namespace ?? "default";
  return `${namespace}:${hash}`;
}

export function matchesPattern(key: string, pattern: string): boolean {
  if (pattern === "*") {
    return true;
  }

  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");

  return new RegExp(`^${regexPattern}$`).test(key);
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dotProduct += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0;
  }

  return dotProduct / denominator;
}
