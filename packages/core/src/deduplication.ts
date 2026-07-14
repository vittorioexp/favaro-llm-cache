import type { Awaitable } from "@favaro/shared";
import { createDeferred } from "@favaro/shared";

interface InFlightEntry<T> {
  promise: Promise<T>;
  resolvers: number;
}

export class RequestDeduplicator<T> {
  private readonly inFlight = new Map<string, InFlightEntry<T>>();

  async deduplicate(key: string, executor: () => Awaitable<T>): Promise<T> {
    const existing = this.inFlight.get(key);

    if (existing) {
      existing.resolvers++;
      return existing.promise;
    }

    const deferred = createDeferred<T>();
    const entry: InFlightEntry<T> = {
      promise: deferred.promise,
      resolvers: 1,
    };

    this.inFlight.set(key, entry);

    try {
      const result = await executor();
      deferred.resolve(result);
      return result;
    } catch (error) {
      deferred.reject(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      this.inFlight.delete(key);
    }
  }

  getInFlightCount(): number {
    return this.inFlight.size;
  }

  isInFlight(key: string): boolean {
    return this.inFlight.has(key);
  }

  clear(): void {
    this.inFlight.clear();
  }
}
