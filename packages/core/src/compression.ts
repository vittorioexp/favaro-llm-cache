import { gzip, gunzip, deflate, inflate, brotliCompress, brotliDecompress } from "node:zlib";
import { promisify } from "node:util";
import type { CompressionAdapter, CompressionConfig } from "@favaro/shared";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const deflateAsync = promisify(deflate);
const inflateAsync = promisify(inflate);
const brotliCompressAsync = promisify(brotliCompress);
const brotliDecompressAsync = promisify(brotliDecompress);

export class NodeCompressionAdapter implements CompressionAdapter {
  readonly algorithm: "gzip" | "deflate" | "brotli";
  readonly threshold: number;

  constructor(config?: CompressionConfig) {
    this.algorithm = config?.algorithm ?? "gzip";
    this.threshold = config?.threshold ?? 1024;
  }

  shouldCompress(size: number): boolean {
    return size >= this.threshold;
  }

  async compress(data: Buffer): Promise<Buffer> {
    switch (this.algorithm) {
      case "deflate":
        return deflateAsync(data);
      case "brotli":
        return brotliCompressAsync(data);
      default:
        return gzipAsync(data);
    }
  }

  async decompress(data: Buffer): Promise<Buffer> {
    switch (this.algorithm) {
      case "deflate":
        return inflateAsync(data);
      case "brotli":
        return brotliDecompressAsync(data);
      default:
        return gunzipAsync(data);
    }
  }
}

export function createCompressionAdapter(
  config?: boolean | CompressionConfig
): CompressionAdapter | null {
  if (!config) return null;

  const resolved: CompressionConfig =
    typeof config === "boolean"
      ? { enabled: config }
      : { ...config, enabled: config.enabled ?? true };

  if (!resolved.enabled) return null;

  return new NodeCompressionAdapter(resolved);
}
