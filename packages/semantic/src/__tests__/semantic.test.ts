import { describe, it, expect } from "vitest";
import { createHashEmbedding, createSemanticCache } from "..";
import { createMemoryStorage } from "@favaro/memory";

describe("SemanticCache", () => {
  it("finds similar prompts", async () => {
    const storage = createMemoryStorage();
    const embedding = createHashEmbedding(64);
    const semantic = createSemanticCache({
      enabled: true,
      threshold: 0.5,
      storage,
      embedding,
    });

    await semantic.indexEntry("key1", "default", "What is the capital of France?");
    await storage.set("key1", "default", {
      data: { content: "Paris is the capital of France." },
      metadata: {
        key: "key1",
        namespace: "default",
        createdAt: Date.now(),
        expiresAt: null,
        lastAccessedAt: Date.now(),
        accessCount: 0,
        provider: "openai",
        model: "gpt-4",
        version: 1,
        compressed: false,
        encrypted: false,
        semantic: true,
        tags: [],
      },
    });

    const match = await semantic.findSimilar(
      "What is the capital of France?",
      "default"
    );

    expect(match).not.toBeNull();
    expect(match?.similarity).toBeGreaterThan(0.5);
    await storage.close();
  });

  it("returns null for dissimilar prompts", async () => {
    const storage = createMemoryStorage();
    const semantic = createSemanticCache({
      enabled: true,
      threshold: 0.99,
      storage,
      embedding: createHashEmbedding(64),
    });

    await semantic.indexEntry("key1", "default", "What is the capital of France?");

    const match = await semantic.findSimilar(
      "How to bake a chocolate cake from scratch",
      "default"
    );

    expect(match).toBeNull();
    await storage.close();
  });
});
