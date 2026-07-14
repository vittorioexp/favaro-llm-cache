import type { CacheEntry, StorageAdapter } from "@favaro/shared";
import { matchesPattern, StorageError } from "@favaro/shared";

interface MemoryStoreOptions {
  maxEntries?: number;
}

export class MemoryStorageAdapter implements StorageAdapter {
  readonly type = "memory" as const;
  private readonly stores = new Map<string, Map<string, CacheEntry>>();
  private readonly maxEntries: number;

  constructor(options?: MemoryStoreOptions) {
    this.maxEntries = options?.maxEntries ?? 100_000;
  }

  async get<T>(key: string, namespace: string): Promise<CacheEntry<T> | null> {
    const store = this.stores.get(namespace);
    if (!store) return null;

    const entry = store.get(key);
    if (!entry) return null;

    return {
      data: structuredClone(entry.data) as T,
      metadata: { ...entry.metadata },
    };
  }

  async set<T>(key: string, namespace: string, entry: CacheEntry<T>): Promise<void> {
    let store = this.stores.get(namespace);
    if (!store) {
      store = new Map();
      this.stores.set(namespace, store);
    }

    if (store.size >= this.maxEntries && !store.has(key)) {
      const firstKey = store.keys().next().value;
      if (firstKey) store.delete(firstKey);
    }

    store.set(key, {
      data: structuredClone(entry.data),
      metadata: { ...entry.metadata },
    });
  }

  async delete(key: string, namespace: string): Promise<boolean> {
    const store = this.stores.get(namespace);
    if (!store) return false;
    return store.delete(key);
  }

  async has(key: string, namespace: string): Promise<boolean> {
    const store = this.stores.get(namespace);
    if (!store) return false;
    return store.has(key);
  }

  async keys(namespace: string, pattern?: string): Promise<string[]> {
    const store = this.stores.get(namespace);
    if (!store) return [];

    const allKeys = Array.from(store.keys());
    if (!pattern) return allKeys;

    return allKeys.filter((key) => matchesPattern(key, pattern));
  }

  async clear(namespace?: string): Promise<number> {
    if (namespace) {
      const store = this.stores.get(namespace);
      if (!store) return 0;
      const count = store.size;
      this.stores.delete(namespace);
      return count;
    }

    let total = 0;
    for (const store of this.stores.values()) {
      total += store.size;
    }
    this.stores.clear();
    return total;
  }

  async size(namespace?: string): Promise<number> {
    if (namespace) {
      return this.stores.get(namespace)?.size ?? 0;
    }

    let total = 0;
    for (const store of this.stores.values()) {
      total += store.size;
    }
    return total;
  }

  async close(): Promise<void> {
    this.stores.clear();
  }

  getMemoryUsage(): number {
    let bytes = 0;
    for (const store of this.stores.values()) {
      for (const entry of store.values()) {
        try {
          bytes += JSON.stringify(entry).length;
        } catch (error) {
          throw new StorageError("Failed to estimate memory usage", error instanceof Error ? error : undefined);
        }
      }
    }
    return bytes;
  }
}

export function createMemoryStorage(options?: MemoryStoreOptions): MemoryStorageAdapter {
  return new MemoryStorageAdapter(options);
}
