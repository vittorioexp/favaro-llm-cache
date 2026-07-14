import { describe, it, expect } from "vitest";
import {
  stableStringify,
  hashString,
  generateCacheKey,
  matchesPattern,
  cosineSimilarity,
} from "../hash";

describe("hash", () => {
  it("produces stable serialization regardless of key order", () => {
    const a = { model: "gpt-4", temperature: 0.7, messages: [{ role: "user", content: "hi" }] };
    const b = { messages: [{ role: "user", content: "hi" }], temperature: 0.7, model: "gpt-4" };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it("ignores irrelevant fields", () => {
    const withId = { model: "gpt-4", id: "req-123", stream: true };
    const without = { model: "gpt-4" };
    expect(stableStringify(withId)).toBe(stableStringify(without));
  });

  it("generates deterministic cache keys", () => {
    const input = { provider: "openai", model: "gpt-4", prompt: "hello" };
    const key1 = generateCacheKey(input, { namespace: "test" });
    const key2 = generateCacheKey(input, { namespace: "test" });
    expect(key1).toBe(key2);
    expect(key1.startsWith("test:")).toBe(true);
  });

  it("computes sha256 hash", () => {
    const hash = hashString("hello");
    expect(hash).toHaveLength(64);
    expect(hash).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  it("matches glob patterns", () => {
    expect(matchesPattern("openai:gpt-4:abc", "openai:*")).toBe(true);
    expect(matchesPattern("openai:gpt-4:abc", "anthropic:*")).toBe(false);
    expect(matchesPattern("key-123", "key-?23")).toBe(true);
    expect(matchesPattern("anything", "*")).toBe(true);
  });

  it("computes cosine similarity", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 1], [1, 1])).toBeCloseTo(1);
  });
});
