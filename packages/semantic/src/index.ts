import type {
  CacheEntry,
  EmbeddingAdapter,
  SemanticConfig,
  SemanticMatch,
  StorageAdapter,
} from "@favaro/shared";
import { cosineSimilarity, extractPromptText, SemanticCacheError } from "@favaro/shared";

export interface SemanticIndexEntry {
  key: string;
  namespace: string;
  embedding: number[];
  promptHash: string;
  createdAt: number;
}

export interface SemanticCacheOptions extends SemanticConfig {
  storage: StorageAdapter;
  embedding: EmbeddingAdapter;
}

export class SemanticCache {
  private readonly storage: StorageAdapter;
  private readonly embedding: EmbeddingAdapter;
  private readonly threshold: number;
  private readonly maxCandidates: number;
  private readonly index = new Map<string, SemanticIndexEntry[]>();

  constructor(options: SemanticCacheOptions) {
    if (!options.enabled) {
      throw new SemanticCacheError("Semantic cache requires enabled: true");
    }

    this.storage = options.storage;
    this.embedding = options.embedding;
    this.threshold = options.threshold ?? 0.92;
    this.maxCandidates = options.maxCandidates ?? 100;
  }

  async findSimilar<T>(
    prompt: string,
    namespace: string
  ): Promise<SemanticMatch | null> {
    const queryEmbedding = await this.embedding.embed(prompt);
    const candidates = this.index.get(namespace) ?? [];

    let bestMatch: SemanticMatch | null = null;
    let bestSimilarity = 0;

    const searchSet = candidates.slice(-this.maxCandidates);

    for (const candidate of searchSet) {
      const similarity = cosineSimilarity(queryEmbedding, candidate.embedding);

      if (similarity >= this.threshold && similarity > bestSimilarity) {
        const entry = await this.storage.get<T>(candidate.key, namespace);
        if (entry) {
          bestSimilarity = similarity;
          bestMatch = {
            key: candidate.key,
            similarity,
            entry: entry as CacheEntry,
          };
        }
      }
    }

    return bestMatch;
  }

  async indexEntry(
    key: string,
    namespace: string,
    prompt: string
  ): Promise<void> {
    const embedding = await this.embedding.embed(prompt);
    const entry: SemanticIndexEntry = {
      key,
      namespace,
      embedding,
      promptHash: prompt.slice(0, 64),
      createdAt: Date.now(),
    };

    const existing = this.index.get(namespace) ?? [];
    const filtered = existing.filter((e) => e.key !== key);
    filtered.push(entry);
    this.index.set(namespace, filtered);
  }

  async indexFromRequest(
    key: string,
    namespace: string,
    request: { messages?: readonly { content: string | { text?: string }[] }[]; prompt?: string }
  ): Promise<void> {
    const promptInput: { messages?: readonly { content: string | { text?: string }[] }[]; prompt?: string } = {};
    if (request.messages) promptInput.messages = request.messages;
    if (request.prompt) promptInput.prompt = request.prompt;

    const promptText = extractPromptText(promptInput);
    if (promptText) {
      await this.indexEntry(key, namespace, promptText);
    }
  }

  removeFromIndex(key: string, namespace: string): void {
    const existing = this.index.get(namespace);
    if (!existing) return;

    this.index.set(
      namespace,
      existing.filter((e) => e.key !== key)
    );
  }

  clearIndex(namespace?: string): void {
    if (namespace) {
      this.index.delete(namespace);
    } else {
      this.index.clear();
    }
  }

  getIndexSize(namespace?: string): number {
    if (namespace) {
      return this.index.get(namespace)?.length ?? 0;
    }

    let total = 0;
    for (const entries of this.index.values()) {
      total += entries.length;
    }
    return total;
  }
}

export class HashEmbeddingAdapter implements EmbeddingAdapter {
  readonly dimensions: number;

  constructor(dimensions = 256) {
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    const vector = new Array<number>(this.dimensions).fill(0);

    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i);
      const index = charCode % this.dimensions;
      vector[index] = (vector[index] ?? 0) + 1;
    }

    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (magnitude > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] = (vector[i] ?? 0) / magnitude;
      }
    }

    return vector;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((text) => this.embed(text)));
  }
}

export function createSemanticCache(options: SemanticCacheOptions): SemanticCache {
  return new SemanticCache(options);
}

export function createHashEmbedding(dimensions?: number): HashEmbeddingAdapter {
  return new HashEmbeddingAdapter(dimensions);
}
