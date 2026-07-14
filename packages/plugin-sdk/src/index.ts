import type {
  CompressionAdapter,
  EmbeddingAdapter,
  EncryptionAdapter,
  MetricsAdapter,
  ProviderAdapter,
  ProviderName,
  SerializerAdapter,
  StorageAdapter,
  StorageType,
} from "@favaro/shared";

export interface FavaroPlugin {
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  onRegister?(registry: PluginRegistry): void | Promise<void>;
  onUnregister?(): void | Promise<void>;
}

export interface PluginRegistry {
  registerStorage(type: StorageType, factory: StorageFactory): void;
  registerProvider(name: ProviderName, adapter: ProviderAdapter): void;
  registerEmbedding(name: string, adapter: EmbeddingAdapter): void;
  registerSerializer(name: string, adapter: SerializerAdapter): void;
  registerCompression(name: string, adapter: CompressionAdapter): void;
  registerEncryption(name: string, adapter: EncryptionAdapter): void;
  registerMetrics(name: string, adapter: MetricsAdapter): void;
}

export type StorageFactory = (options?: Record<string, unknown>) => StorageAdapter | Promise<StorageAdapter>;

export class PluginManager implements PluginRegistry {
  private readonly plugins = new Map<string, FavaroPlugin>();
  private readonly storageFactories = new Map<StorageType, StorageFactory>();
  private readonly providers = new Map<ProviderName, ProviderAdapter>();
  private readonly embeddings = new Map<string, EmbeddingAdapter>();
  private readonly serializers = new Map<string, SerializerAdapter>();
  private readonly compressions = new Map<string, CompressionAdapter>();
  private readonly encryptions = new Map<string, EncryptionAdapter>();
  private readonly metricsAdapters = new Map<string, MetricsAdapter>();

  async register(plugin: FavaroPlugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`);
    }

    this.plugins.set(plugin.name, plugin);
    await plugin.onRegister?.(this);
  }

  async unregister(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin) return;

    await plugin.onUnregister?.();
    this.plugins.delete(name);
  }

  getPlugin(name: string): FavaroPlugin | undefined {
    return this.plugins.get(name);
  }

  listPlugins(): FavaroPlugin[] {
    return Array.from(this.plugins.values());
  }

  registerStorage(type: StorageType, factory: StorageFactory): void {
    this.storageFactories.set(type, factory);
  }

  registerProvider(name: ProviderName, adapter: ProviderAdapter): void {
    this.providers.set(name, adapter);
  }

  registerEmbedding(name: string, adapter: EmbeddingAdapter): void {
    this.embeddings.set(name, adapter);
  }

  registerSerializer(name: string, adapter: SerializerAdapter): void {
    this.serializers.set(name, adapter);
  }

  registerCompression(name: string, adapter: CompressionAdapter): void {
    this.compressions.set(name, adapter);
  }

  registerEncryption(name: string, adapter: EncryptionAdapter): void {
    this.encryptions.set(name, adapter);
  }

  registerMetrics(name: string, adapter: MetricsAdapter): void {
    this.metricsAdapters.set(name, adapter);
  }

  async createStorage(
    type: StorageType,
    options?: Record<string, unknown>
  ): Promise<StorageAdapter | null> {
    const factory = this.storageFactories.get(type);
    if (!factory) return null;
    return factory(options);
  }

  getProvider(name: ProviderName): ProviderAdapter | undefined {
    return this.providers.get(name);
  }

  getEmbedding(name: string): EmbeddingAdapter | undefined {
    return this.embeddings.get(name);
  }
}

export function definePlugin(plugin: FavaroPlugin): FavaroPlugin {
  return plugin;
}

export function createPluginManager(): PluginManager {
  return new PluginManager();
}
