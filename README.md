# Favaro LLM Cache

Enterprise-grade, production-ready caching library for Large Language Models.

Favaro automatically caches, deduplicates, and optimizes AI requests without changing your application logic. Enable it once — everything else happens automatically.

## Features

- **Automatic caching** with stable, deterministic key generation
- **Request deduplication** — 50 identical concurrent requests execute only one LLM call
- **Semantic cache** — reuse responses for nearly identical prompts
- **Streaming support** — cache completed streams and replay them
- **Multiple storage backends** — Memory, Redis, SQLite
- **10+ LLM providers** — OpenAI, Anthropic, Gemini, Groq, DeepSeek, Mistral, Ollama, and more
- **TTL & expiration** — sliding, absolute, and time-based expiration
- **Compression & encryption** — optional gzip/brotli compression and AES-256-GCM encryption
- **Observability** — built-in metrics with OpenTelemetry export
- **Middleware pipeline** — hook into every cache lifecycle phase
- **Plugin SDK** — extend with custom adapters
- **Local dashboard** — monitor hits, keys, and savings in real time

## Installation

```bash
npm install favaro
# or
pnpm add favaro
# or
yarn add favaro
# or
bun add favaro
```

### Optional storage adapters

```bash
pnpm add ioredis          # Redis storage
pnpm add better-sqlite3   # SQLite storage
```

## Quick Start

```typescript
import { createAIClient } from "favaro";

const client = createAIClient({
  provider: "openai",
  apiKey: process.env.OPENAI_API_KEY,
  cache: true,
});

const response = await client.chat({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "What is the capital of France?" }],
});

console.log(response.content);
// Second identical call returns instantly from cache
const cached = await client.chat({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "What is the capital of France?" }],
});
```

## Configuration

### TypeScript

```typescript
const client = createAIClient({
  provider: "openai",
  apiKey: "sk-...",
  cache: true,
  namespace: "my-app",
  ttl: 3600,
  slidingExpiration: true,
  compression: true,
  semantic: { enabled: true, threshold: 0.92 },
  maxEntries: 100_000,
});
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FAVARO_ENABLED` | `true` | Enable/disable caching |
| `FAVARO_NAMESPACE` | `default` | Cache namespace |
| `FAVARO_TTL` | `3600` | TTL in seconds |
| `FAVARO_STORAGE` | `memory` | Storage backend |
| `FAVARO_REDIS_URL` | — | Redis connection URL |
| `FAVARO_SQLITE_PATH` | — | SQLite database path |
| `FAVARO_SEMANTIC` | `false` | Enable semantic cache |
| `FAVARO_COMPRESSION` | `false` | Enable compression |
| `FAVARO_ENCRYPTION_KEY` | — | AES-256 encryption key |

## Storage Backends

### Memory (default)

```typescript
import { createAIClient } from "favaro";
// Memory storage is used automatically
```

### Redis

```typescript
import { createAIClientWithRedis } from "favaro";

const client = await createAIClientWithRedis({
  provider: "openai",
  apiKey: "sk-...",
  redisUrl: "redis://localhost:6379",
});
```

### SQLite

```typescript
import { createAIClientWithSqlite } from "favaro";

const client = await createAIClientWithSqlite({
  provider: "openai",
  apiKey: "sk-...",
  sqlitePath: "./favaro-cache.db",
});
```

## Streaming

```typescript
for await (const chunk of client.chatStream({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "Tell me a story" }],
})) {
  process.stdout.write(chunk.content);
}
// Subsequent identical requests replay the cached stream
```

## Semantic Cache

Detect nearly identical prompts and reuse responses:

```typescript
const client = createAIClient({
  provider: "openai",
  apiKey: "sk-...",
  semantic: { enabled: true, threshold: 0.92 },
});
```

## Cache Invalidation

```typescript
// Invalidate all
await client.invalidate();

// By pattern
await client.invalidate({ pattern: "openai:gpt-4:*" });

// By namespace
await client.invalidate({ namespace: "staging" });

// Specific keys
await client.invalidate({ keys: ["key1", "key2"] });
```

## Metrics

```typescript
const metrics = client.getMetrics();
console.log(metrics);
// {
//   hits: 150,
//   misses: 30,
//   deduplicated: 12,
//   savedTokens: 45000,
//   savedCost: 0.85,
//   ...
// }
```

## Dashboard

```typescript
import { createCache } from "favaro";
import { createDashboard } from "@favaro/dashboard";
import { createMemoryStorage } from "favaro";

const cache = createCache(createMemoryStorage());
const dashboard = createDashboard({ cache, port: 3847 });
console.log(`Dashboard running at ${dashboard.url}`);
```

## CLI

```bash
npx favaro stats          # Show cache statistics
npx favaro keys           # List cache keys
npx favaro clear          # Clear all entries
```

## Middleware

```typescript
import { createAIClient, type Middleware } from "favaro";

const auditMiddleware: Middleware = async (ctx) => {
  console.log(`[${ctx.phase}] ${ctx.key}`);
};

const client = createAIClient({
  provider: "openai",
  apiKey: "sk-...",
  middleware: [auditMiddleware],
});
```

## Plugin SDK

```typescript
import { definePlugin, createPluginManager } from "@favaro/plugin-sdk";

const myPlugin = definePlugin({
  name: "my-custom-storage",
  version: "1.0.0",
  onRegister(registry) {
    registry.registerStorage("custom", () => new MyStorageAdapter());
  },
});

const manager = createPluginManager();
await manager.register(myPlugin);
```

## Architecture

```
favaro/
├── packages/
│   ├── shared/        # Types, hashing, serialization
│   ├── core/          # Cache engine, dedup, streaming
│   ├── memory/        # In-memory storage adapter
│   ├── redis/         # Redis storage adapter
│   ├── sqlite/        # SQLite storage adapter
│   ├── semantic/      # Semantic similarity cache
│   ├── providers/     # LLM provider adapters
│   ├── dashboard/     # Local monitoring dashboard
│   ├── plugin-sdk/    # Extension plugin system
│   └── favaro/        # Main package (createAIClient)
```

## Supported Providers

| Provider | Status |
|----------|--------|
| OpenAI | Supported |
| Anthropic | Supported |
| Gemini | Supported |
| Groq | Supported |
| DeepSeek | Supported |
| Mistral | Supported |
| OpenRouter | Supported |
| Ollama | Supported |
| Azure OpenAI | Supported |
| Custom | Via Plugin SDK |

## Benchmarks

```bash
pnpm benchmark
```

| Operation | Avg (ms) | Ops/sec |
|-----------|----------|---------|
| Cache SET | ~0.05 | ~20,000 |
| Cache GET (hit) | ~0.02 | ~50,000 |
| Cache GET (miss) | ~0.01 | ~100,000 |
| Key Generation | ~0.03 | ~33,000 |

## Development

```bash
git clone https://github.com/favaro-llm/favaro-llm-cache
cd favaro-llm-cache
pnpm install
pnpm build
pnpm test
```

## License

MIT
