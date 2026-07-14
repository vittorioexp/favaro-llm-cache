import type {
  CachedStreamResponse,
  StreamChunk,
  TokenUsage,
} from "@favaro/shared";

export class StreamBuffer {
  private chunks: StreamChunk[] = [];
  private fullContent = "";
  private index = 0;
  private complete = false;
  private usage: TokenUsage | undefined;

  addChunk(chunk: StreamChunk): void {
    this.chunks.push({ ...chunk, index: this.index++ });
    this.fullContent += chunk.content;
    if (chunk.finishReason) {
      this.complete = true;
    }
  }

  setUsage(usage: TokenUsage): void {
    this.usage = usage;
  }

  markComplete(): void {
    this.complete = true;
  }

  toCachedResponse(): CachedStreamResponse {
    const response: CachedStreamResponse = {
      chunks: [...this.chunks],
      complete: this.complete,
      fullContent: this.fullContent,
    };
    if (this.usage) {
      response.usage = this.usage;
    }
    return response;
  }

  get isComplete(): boolean {
    return this.complete;
  }

  get content(): string {
    return this.fullContent;
  }
}

export async function* replayStream(
  cached: CachedStreamResponse,
  delayMs = 0
): AsyncIterable<StreamChunk> {
  for (const chunk of cached.chunks) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    yield chunk;
  }
}

export async function collectStream(
  stream: AsyncIterable<StreamChunk>
): Promise<CachedStreamResponse> {
  const buffer = new StreamBuffer();

  for await (const chunk of stream) {
    buffer.addChunk(chunk);
  }

  buffer.markComplete();
  return buffer.toCachedResponse();
}

export function createStreamFromContent(content: string): AsyncIterable<StreamChunk> {
  return {
    async *[Symbol.asyncIterator]() {
      yield {
        index: 0,
        content,
        finishReason: "stop",
      };
    },
  };
}
