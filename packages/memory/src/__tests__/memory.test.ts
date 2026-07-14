import { describe, it, expect } from "vitest";
import { createMemoryStorage } from "..";

describe("MemoryStorageAdapter", () => {
  it("stores and retrieves entries", async () => {
    const storage = createMemoryStorage();
    const entry = {
      data: { content: "test" },
      metadata: {
        key: "k1",
        namespace: "default",
        createdAt: Date.now(),
        expiresAt: null,
        lastAccessedAt: Date.now(),
        accessCount: 0,
        provider: "openai" as const,
        model: "gpt-4",
        version: 1,
        compressed: false,
        encrypted: false,
        semantic: false,
        tags: [],
      },
    };

    await storage.set("k1", "default", entry);
    const result = await storage.get("k1", "default");
    expect(result?.data).toEqual({ content: "test" });
    await storage.close();
  });

  it("lists keys with pattern", async () => {
    const storage = createMemoryStorage();
    const meta = {
      key: "",
      namespace: "default",
      createdAt: Date.now(),
      expiresAt: null,
      lastAccessedAt: Date.now(),
      accessCount: 0,
      provider: "openai" as const,
      model: "gpt-4",
      version: 1,
      compressed: false,
      encrypted: false,
      semantic: false,
      tags: [],
    };

    await storage.set("openai:a", "default", { data: 1, metadata: { ...meta, key: "openai:a" } });
    await storage.set("openai:b", "default", { data: 2, metadata: { ...meta, key: "openai:b" } });
    await storage.set("other:c", "default", { data: 3, metadata: { ...meta, key: "other:c" } });

    const keys = await storage.keys("default", "openai:*");
    expect(keys).toHaveLength(2);
    await storage.close();
  });
});
