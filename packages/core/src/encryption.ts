import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import type { EncryptionAdapter, EncryptionConfig } from "@favaro/shared";
import { EncryptionError } from "@favaro/shared";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 16;

export class Aes256GcmAdapter implements EncryptionAdapter {
  private readonly key: Buffer;

  constructor(config: EncryptionConfig) {
    const rawKey = config.key ?? process.env["FAVARO_ENCRYPTION_KEY"];
    if (!rawKey) {
      throw new EncryptionError(
        "Encryption key is required. Set FAVARO_ENCRYPTION_KEY or provide key in config."
      );
    }

    const keyBuffer = typeof rawKey === "string" ? Buffer.from(rawKey, "utf8") : rawKey;
    this.key = scryptSync(keyBuffer, "favaro-salt", 32);
  }

  async encrypt(data: Buffer): Promise<Buffer> {
    try {
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv(ALGORITHM, this.key, iv);
      const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
      const authTag = cipher.getAuthTag();

      return Buffer.concat([iv, authTag, encrypted]);
    } catch (error) {
      throw new EncryptionError(
        "Failed to encrypt data",
        error instanceof Error ? error : undefined
      );
    }
  }

  async decrypt(data: Buffer): Promise<Buffer> {
    try {
      const iv = data.subarray(0, IV_LENGTH);
      const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
      const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

      const decipher = createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAuthTag(authTag);

      return Buffer.concat([decipher.update(encrypted), decipher.final()]);
    } catch (error) {
      throw new EncryptionError(
        "Failed to decrypt data",
        error instanceof Error ? error : undefined
      );
    }
  }
}

export function createEncryptionAdapter(
  config?: boolean | EncryptionConfig
): EncryptionAdapter | null {
  if (!config) return null;

  const resolved: EncryptionConfig =
    typeof config === "boolean"
      ? { enabled: config }
      : { ...config, enabled: config.enabled ?? true };

  if (!resolved.enabled) return null;

  return new Aes256GcmAdapter(resolved);
}

export { SALT_LENGTH };
