import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMemoryStorage } from "@favaro/memory";
import { createCache } from "../cache";

describe("FavaroCache", () => {
  let cache: ReturnType<typeof createCache>;

  beforeEach(() => {
    cache = createCache(createMemoryStorage(), { ttl: 60_000 });
  });

  afterEach(async () => {
    await cache.close();
  });

  it("stores and retrieves values", async () => {
    await cache.set("key1", { content: "hello" });
    const result = await cache.get<{ content: string }>("key1");
    expect(result?.data.content).toBe("hello");
  });

  it("returns null for missing keys", async () => {
    const result = await cache.get("nonexistent");
    expect(result).toBeNull();
  });

  it("deduplicates concurrent requests", async () => {
    let callCount = 0;
    const executor = async () => {
      callCount++;
      await new Promise((r) => setTimeout(r, 50));
      return { value: 42 };
    };

    const results = await Promise.all([
      cache.wrap("dedup", executor),
      cache.wrap("dedup", executor),
      cache.wrap("dedup", executor),
    ]);

    expect(callCount).toBe(1);
    expect(results).toEqual([{ value: 42 }, { value: 42 }, { value: 42 }]);
  });

  it("invalidates by pattern", async () => {
    await cache.set("openai:gpt-4:abc", { a: 1 });
    await cache.set("openai:gpt-4:def", { b: 2 });
    await cache.set("anthropic:claude:ghi", { c: 3 });

    const deleted = await cache.invalidate({ pattern: "openai:*" });
    expect(deleted).toBe(2);
    expect(await cache.get("anthropic:claude:ghi")).not.toBeNull();
  });

  it("generates stable keys", () => {
    const key1 = cache.buildKey({
      provider: "openai",
      model: "gpt-4",
      messages: [{ role: "user", content: "hello" }],
    });
    const key2 = cache.buildKey({
      provider: "openai",
      model: "gpt-4",
      messages: [{ role: "user", content: "hello" }],
    });
    expect(key1).toBe(key2);
  });

  it("tracks metrics", async () => {
    await cache.set("m1", "data");
    await cache.get("m1");
    await cache.get("miss");

    const metrics = cache.getMetrics();
    expect(metrics?.hits).toBe(1);
    expect(metrics?.misses).toBe(1);
  });
});
