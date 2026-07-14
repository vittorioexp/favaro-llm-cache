export class FavaroError extends Error {
  readonly code: string;
  override readonly cause?: Error;

  constructor(message: string, code: string, cause?: Error) {
    super(message);
    this.name = "FavaroError";
    this.code = code;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

export class CacheMissError extends FavaroError {
  constructor(key: string) {
    super(`Cache miss for key: ${key}`, "CACHE_MISS");
    this.name = "CacheMissError";
  }
}

export class StorageError extends FavaroError {
  constructor(message: string, cause?: Error) {
    super(message, "STORAGE_ERROR", cause);
    this.name = "StorageError";
  }
}

export class SerializationError extends FavaroError {
  constructor(message: string, cause?: Error) {
    super(message, "SERIALIZATION_ERROR", cause);
    this.name = "SerializationError";
  }
}

export class EncryptionError extends FavaroError {
  constructor(message: string, cause?: Error) {
    super(message, "ENCRYPTION_ERROR", cause);
    this.name = "EncryptionError";
  }
}

export class ProviderError extends FavaroError {
  constructor(message: string, cause?: Error) {
    super(message, "PROVIDER_ERROR", cause);
    this.name = "ProviderError";
  }
}

export class ConfigurationError extends FavaroError {
  constructor(message: string) {
    super(message, "CONFIGURATION_ERROR");
    this.name = "ConfigurationError";
  }
}

export class SemanticCacheError extends FavaroError {
  constructor(message: string, cause?: Error) {
    super(message, "SEMANTIC_CACHE_ERROR", cause);
    this.name = "SemanticCacheError";
  }
}
