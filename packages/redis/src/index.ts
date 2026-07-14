import type { CacheEntry, StorageAdapter } from "@favaro/shared";
import { ConfigurationError, JsonSerializer, StorageError } from "@favaro/shared";

export interface RedisStorageOptions {
  url?: string;
  host?: string;
  port?: number;
  password?: string;
  db?: number;
  keyPrefix?: string;
  ttl?: number;
}

type RedisClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode?: string, duration?: number): Promise<unknown>;
  del(key: string): Promise<number>;
  exists(key: string): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  flushdb(): Promise<string>;
  dbsize(): Promise<number>;
  quit(): Promise<string>;
};

export class RedisStorageAdapter implements StorageAdapter {
  readonly type = "redis" as const;
  private readonly client: RedisClient;
  private readonly keyPrefix: string;
  private readonly defaultTtl: number;
  private readonly serializer = new JsonSerializer();

  constructor(client: RedisClient, options?: Pick<RedisStorageOptions, "keyPrefix" | "ttl">) {
    this.client = client;
    this.keyPrefix = options?.keyPrefix ?? "favaro";
    this.defaultTtl = options?.ttl ?? 3600;
  }

  private buildKey(key: string, namespace: string): string {
    return `${this.keyPrefix}:${namespace}:${key}`;
  }

  async get<T>(key: string, namespace: string): Promise<CacheEntry<T> | null> {
    try {
      const data = await this.client.get(this.buildKey(key, namespace));
      if (!data) return null;
      return this.serializer.deserialize<CacheEntry<T>>(data);
    } catch (error) {
      throw new StorageError(
        `Redis get failed for key: ${key}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async set<T>(key: string, namespace: string, entry: CacheEntry<T>): Promise<void> {
    try {
      const redisKey = this.buildKey(key, namespace);
      const serialized = this.serializer.serialize(entry);
      const ttlSeconds = entry.metadata.expiresAt
        ? Math.max(1, Math.floor((entry.metadata.expiresAt - Date.now()) / 1000))
        : this.defaultTtl;

      await this.client.set(redisKey, serialized, "EX", ttlSeconds);
    } catch (error) {
      throw new StorageError(
        `Redis set failed for key: ${key}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async delete(key: string, namespace: string): Promise<boolean> {
    try {
      const result = await this.client.del(this.buildKey(key, namespace));
      return result > 0;
    } catch (error) {
      throw new StorageError(
        `Redis delete failed for key: ${key}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async has(key: string, namespace: string): Promise<boolean> {
    try {
      const result = await this.client.exists(this.buildKey(key, namespace));
      return result > 0;
    } catch (error) {
      throw new StorageError(
        `Redis exists failed for key: ${key}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async keys(namespace: string, pattern?: string): Promise<string[]> {
    try {
      const searchPattern = `${this.keyPrefix}:${namespace}:${pattern ?? "*"}`;
      const redisKeys = await this.client.keys(searchPattern);
      const prefix = `${this.keyPrefix}:${namespace}:`;

      return redisKeys.map((k) => k.slice(prefix.length));
    } catch (error) {
      throw new StorageError(
        "Redis keys scan failed",
        error instanceof Error ? error : undefined
      );
    }
  }

  async clear(namespace?: string): Promise<number> {
    try {
      if (namespace) {
        const keys = await this.keys(namespace);
        let deleted = 0;
        for (const key of keys) {
          if (await this.delete(key, namespace)) deleted++;
        }
        return deleted;
      }

      const size = await this.client.dbsize();
      await this.client.flushdb();
      return size;
    } catch (error) {
      throw new StorageError(
        "Redis clear failed",
        error instanceof Error ? error : undefined
      );
    }
  }

  async size(namespace?: string): Promise<number> {
    if (namespace) {
      const keys = await this.keys(namespace);
      return keys.length;
    }
    return this.client.dbsize();
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}

export async function createRedisStorage(
  options?: RedisStorageOptions
): Promise<RedisStorageAdapter> {
  let Redis: new (url: string) => RedisClient;

  try {
    const mod = await import("ioredis");
    Redis = mod.default as unknown as new (url: string) => RedisClient;
  } catch {
    throw new ConfigurationError(
      "ioredis is required for Redis storage. Install it with: npm install ioredis"
    );
  }

  const url =
    options?.url ??
    process.env["FAVARO_REDIS_URL"] ??
    process.env["REDIS_URL"] ??
    `redis://${options?.password ? `:${options.password}@` : ""}${options?.host ?? "localhost"}:${options?.port ?? 6379}/${options?.db ?? 0}`;

  const client = new Redis(url);
  return new RedisStorageAdapter(client, options);
}
