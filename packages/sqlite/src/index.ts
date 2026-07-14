import type { CacheEntry, CacheEntryMetadata, StorageAdapter } from "@favaro/shared";
import { ConfigurationError, JsonSerializer, matchesPattern, StorageError } from "@favaro/shared";

export interface SqliteStorageOptions {
  path?: string;
  walMode?: boolean;
}

interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  close(): void;
}

interface SqliteStatement {
  run(...params: unknown[]): { changes: number };
  get(...params: unknown[]): Row | undefined;
  all(...params: unknown[]): Row[];
}

interface Row {
  data: string;
  metadata: string;
  expires_at: number | null;
  last_accessed_at: number;
}

interface KeyRow {
  key: string;
}

interface CountRow {
  count: number;
}

export class SqliteStorageAdapter implements StorageAdapter {
  readonly type = "sqlite" as const;
  private readonly db: SqliteDatabase;
  private readonly serializer = new JsonSerializer();

  constructor(db: SqliteDatabase) {
    this.db = db;
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS favaro_cache (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        data TEXT NOT NULL,
        metadata TEXT NOT NULL,
        expires_at INTEGER,
        last_accessed_at INTEGER NOT NULL,
        PRIMARY KEY (namespace, key)
      );
      CREATE INDEX IF NOT EXISTS idx_favaro_expires ON favaro_cache(expires_at);
      CREATE INDEX IF NOT EXISTS idx_favaro_namespace ON favaro_cache(namespace);
    `);
  }

  async get<T>(key: string, namespace: string): Promise<CacheEntry<T> | null> {
    try {
      const stmt = this.db.prepare(
        "SELECT data, metadata, expires_at FROM favaro_cache WHERE namespace = ? AND key = ?"
      );
      const row = stmt.get(namespace, key) as Row | undefined;
      if (!row) return null;

      if (row.expires_at && Date.now() > row.expires_at) {
        await this.delete(key, namespace);
        return null;
      }

      return {
        data: this.serializer.deserialize<T>(row.data),
        metadata: this.serializer.deserialize<CacheEntryMetadata>(row.metadata),
      };
    } catch (error) {
      throw new StorageError(
        `SQLite get failed for key: ${key}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async set<T>(key: string, namespace: string, entry: CacheEntry<T>): Promise<void> {
    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO favaro_cache
        (namespace, key, data, metadata, expires_at, last_accessed_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        namespace,
        key,
        this.serializer.serialize(entry.data),
        this.serializer.serialize(entry.metadata),
        entry.metadata.expiresAt,
        entry.metadata.lastAccessedAt
      );
    } catch (error) {
      throw new StorageError(
        `SQLite set failed for key: ${key}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async delete(key: string, namespace: string): Promise<boolean> {
    try {
      const stmt = this.db.prepare(
        "DELETE FROM favaro_cache WHERE namespace = ? AND key = ?"
      );
      const result = stmt.run(namespace, key);
      return result.changes > 0;
    } catch (error) {
      throw new StorageError(
        `SQLite delete failed for key: ${key}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async has(key: string, namespace: string): Promise<boolean> {
    const entry = await this.get(key, namespace);
    return entry !== null;
  }

  async keys(namespace: string, pattern?: string): Promise<string[]> {
    try {
      const stmt = this.db.prepare(
        "SELECT key FROM favaro_cache WHERE namespace = ?"
      );
      const rows = stmt.all(namespace) as unknown as KeyRow[];
      const allKeys = rows.map((r) => r.key);

      if (!pattern) return allKeys;
      return allKeys.filter((key) => matchesPattern(key, pattern));
    } catch (error) {
      throw new StorageError(
        "SQLite keys query failed",
        error instanceof Error ? error : undefined
      );
    }
  }

  async clear(namespace?: string): Promise<number> {
    try {
      if (namespace) {
        const stmt = this.db.prepare("DELETE FROM favaro_cache WHERE namespace = ?");
        const result = stmt.run(namespace);
        return result.changes;
      }

      const countStmt = this.db.prepare("SELECT COUNT(*) as count FROM favaro_cache");
      const count = (countStmt.get() as unknown as CountRow).count;

      this.db.exec("DELETE FROM favaro_cache");
      return count;
    } catch (error) {
      throw new StorageError(
        "SQLite clear failed",
        error instanceof Error ? error : undefined
      );
    }
  }

  async size(namespace?: string): Promise<number> {
    try {
      if (namespace) {
        const stmt = this.db.prepare(
          "SELECT COUNT(*) as count FROM favaro_cache WHERE namespace = ?"
        );
        return (stmt.get(namespace) as unknown as CountRow).count;
      }

      const stmt = this.db.prepare("SELECT COUNT(*) as count FROM favaro_cache");
      return (stmt.get() as unknown as CountRow).count;
    } catch (error) {
      throw new StorageError(
        "SQLite size query failed",
        error instanceof Error ? error : undefined
      );
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }

  cleanupExpired(): number {
    const stmt = this.db.prepare(
      "DELETE FROM favaro_cache WHERE expires_at IS NOT NULL AND expires_at < ?"
    );
    return stmt.run(Date.now()).changes;
  }
}

export async function createSqliteStorage(
  options?: SqliteStorageOptions
): Promise<SqliteStorageAdapter> {
  let Database: new (path: string) => SqliteDatabase & { pragma?: (s: string) => void };

  try {
    const mod = await import("better-sqlite3");
    Database = (mod.default ?? mod) as new (path: string) => SqliteDatabase & {
      pragma?: (s: string) => void;
    };
  } catch {
    throw new ConfigurationError(
      "better-sqlite3 is required for SQLite storage. Install it with: npm install better-sqlite3"
    );
  }

  const path = options?.path ?? process.env["FAVARO_SQLITE_PATH"] ?? ":memory:";
  const db = new Database(path);

  if (options?.walMode !== false && db.pragma) {
    db.pragma("journal_mode = WAL");
  }

  return new SqliteStorageAdapter(db);
}
