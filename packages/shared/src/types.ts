export type ProviderName =
  | "openai"
  | "anthropic"
  | "gemini"
  | "openrouter"
  | "groq"
  | "deepseek"
  | "ollama"
  | "mistral"
  | "azure-openai"
  | "custom";

export type StorageType =
  | "memory"
  | "redis"
  | "sqlite"
  | "postgresql"
  | "filesystem"
  | "cloudflare-kv"
  | "upstash"
  | "custom";

export type ExpirationMode = "ttl" | "sliding" | "absolute";

export interface CacheEntryMetadata {
  key: string;
  namespace: string;
  createdAt: number;
  expiresAt: number | null;
  lastAccessedAt: number;
  accessCount: number;
  provider: ProviderName;
  model: string;
  version: number;
  tokenCount?: number;
  cost?: number;
  compressed: boolean;
  encrypted: boolean;
  semantic: boolean;
  tags: string[];
}

export interface CacheEntry<T = unknown> {
  data: T;
  metadata: CacheEntryMetadata;
}

export interface CacheKeyInput {
  provider: ProviderName;
  model: string;
  messages?: readonly Message[];
  prompt?: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string | string[];
  tools?: readonly ToolDefinition[];
  toolChoice?: string | Record<string, unknown>;
  responseFormat?: Record<string, unknown>;
  seed?: number;
  stream?: boolean;
  [key: string]: unknown;
}

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[];
  name?: string;
  toolCallId?: string;
}

export interface ContentPart {
  type: "text" | "image_url" | "input_audio";
  text?: string;
  image_url?: { url: string; detail?: string };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface CacheMetrics {
  hits: number;
  misses: number;
  deduplicated: number;
  semanticHits: number;
  errors: number;
  totalLatencyMs: number;
  savedRequests: number;
  savedTokens: number;
  savedCost: number;
  compressionRatio: number;
  memoryUsageBytes: number;
  entryCount: number;
}

export interface MiddlewareContext<TRequest = unknown, TResponse = unknown> {
  phase: MiddlewarePhase;
  namespace: string;
  key: string;
  request: TRequest;
  response?: TResponse;
  metadata?: Partial<CacheEntryMetadata>;
  aborted: boolean;
}

export type MiddlewarePhase =
  | "before-request"
  | "after-request"
  | "before-cache"
  | "after-cache"
  | "before-invalidation"
  | "after-invalidation";

export type Middleware<TRequest = unknown, TResponse = unknown> = (
  context: MiddlewareContext<TRequest, TResponse>
) => Promise<void> | void;

export interface FavaroConfig {
  enabled?: boolean;
  namespace?: string;
  storage?: StorageType | StorageAdapterConfig;
  ttl?: number;
  slidingExpiration?: boolean;
  absoluteExpiration?: number;
  compression?: boolean | CompressionConfig;
  encryption?: boolean | EncryptionConfig;
  semantic?: boolean | SemanticConfig;
  metrics?: boolean | MetricsConfig;
  middleware?: Middleware[];
  keyBuilder?: KeyBuilder;
  ignoreFields?: string[];
  version?: number;
  maxEntries?: number;
  cleanupInterval?: number;
  sensitiveFields?: string[];
}

export interface StorageAdapterConfig {
  type: StorageType;
  options?: Record<string, unknown>;
}

export interface CompressionConfig {
  enabled: boolean;
  algorithm?: "gzip" | "deflate" | "brotli";
  threshold?: number;
}

export interface EncryptionConfig {
  enabled: boolean;
  algorithm?: "aes-256-gcm";
  key?: string | Buffer;
}

export interface SemanticConfig {
  enabled: boolean;
  threshold?: number;
  embeddingProvider?: string;
  maxCandidates?: number;
}

export interface MetricsConfig {
  enabled: boolean;
  exportOpenTelemetry?: boolean;
  prefix?: string;
}

export type KeyBuilder = (input: CacheKeyInput) => string;

export interface StreamChunk {
  index: number;
  content: string;
  delta?: Record<string, unknown>;
  finishReason?: string | null;
}

export interface CachedStreamResponse {
  chunks: StreamChunk[];
  complete: boolean;
  fullContent: string;
  usage?: TokenUsage;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LLMResponse {
  id: string;
  content: string;
  model: string;
  usage?: TokenUsage;
  finishReason?: string | null;
  raw?: unknown;
}

export interface LLMRequest {
  model: string;
  messages?: Message[];
  prompt?: string;
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;
  [key: string]: unknown;
}

export interface ProviderAdapter<TClient = unknown> {
  readonly name: ProviderName;
  createClient(config: Record<string, unknown>): TClient;
  execute(client: TClient, request: LLMRequest): Promise<LLMResponse>;
  executeStream(client: TClient, request: LLMRequest): AsyncIterable<StreamChunk>;
  estimateCost?(request: LLMRequest, response: LLMResponse): number;
  estimateTokens?(request: LLMRequest, response: LLMResponse): number;
}

export interface StorageAdapter {
  readonly type: StorageType;
  get<T>(key: string, namespace: string): Promise<CacheEntry<T> | null>;
  set<T>(key: string, namespace: string, entry: CacheEntry<T>): Promise<void>;
  delete(key: string, namespace: string): Promise<boolean>;
  has(key: string, namespace: string): Promise<boolean>;
  keys(namespace: string, pattern?: string): Promise<string[]>;
  clear(namespace?: string): Promise<number>;
  size(namespace?: string): Promise<number>;
  close(): Promise<void>;
}

export interface SerializerAdapter {
  serialize<T>(value: T): string | Buffer;
  deserialize<T>(data: string | Buffer): T;
}

export interface CompressionAdapter {
  compress(data: Buffer): Promise<Buffer>;
  decompress(data: Buffer): Promise<Buffer>;
  shouldCompress(size: number): boolean;
}

export interface EncryptionAdapter {
  encrypt(data: Buffer): Promise<Buffer>;
  decrypt(data: Buffer): Promise<Buffer>;
}

export interface EmbeddingAdapter {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  dimensions: number;
}

export interface MetricsAdapter {
  increment(name: string, value?: number, tags?: Record<string, string>): void;
  gauge(name: string, value: number, tags?: Record<string, string>): void;
  histogram(name: string, value: number, tags?: Record<string, string>): void;
  getMetrics(): CacheMetrics;
  reset(): void;
}

export interface SemanticMatch {
  key: string;
  similarity: number;
  entry: CacheEntry;
}

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type Awaitable<T> = T | Promise<T>;
