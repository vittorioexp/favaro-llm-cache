export { createAIClient, createAIClientWithRedis, createAIClientWithSqlite } from "./client.js";
export type { AIClientConfig, AIClient } from "./client.js";

export { createCache, FavaroCache } from "@favaro/core";
export { createMemoryStorage } from "@favaro/memory";
export { getProviderAdapter, registerProviderAdapter } from "@favaro/providers";
export { createSemanticCache, createHashEmbedding } from "@favaro/semantic";

export type {
  FavaroConfig,
  CacheEntry,
  CacheMetrics,
  LLMRequest,
  LLMResponse,
  ProviderName,
  StorageAdapter,
  StorageType,
  Middleware,
  StreamChunk,
  SemanticConfig,
} from "@favaro/shared";

export {
  FavaroError,
  CacheMissError,
  StorageError,
  ProviderError,
  ConfigurationError,
} from "@favaro/shared";
