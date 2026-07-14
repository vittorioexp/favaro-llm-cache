import type {
  LLMRequest,
  LLMResponse,
  ProviderAdapter,
  ProviderName,
  StreamChunk,
} from "@favaro/shared";
import { ProviderError } from "@favaro/shared";

export interface ProviderClientConfig {
  apiKey?: string;
  baseURL?: string;
  organization?: string;
  defaultModel?: string;
  headers?: Record<string, string>;
}

export interface ChatCompletionResponse {
  id: string;
  model: string;
  choices: Array<{
    message?: { content: string };
    delta?: { content?: string };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export abstract class BaseProviderAdapter<TClient = ProviderHttpClient>
  implements ProviderAdapter<TClient>
{
  abstract readonly name: ProviderName;

  createClient(config: Record<string, unknown>): TClient {
    return this.createHttpClient(config as ProviderClientConfig) as TClient;
  }

  protected createHttpClient(config: ProviderClientConfig): ProviderHttpClient {
    const clientConfig: ProviderClientConfig = {
      baseURL: config.baseURL ?? this.getDefaultBaseURL(),
      headers: config.headers ?? {},
    };

    const apiKey = config.apiKey ?? process.env[`${this.name.toUpperCase()}_API_KEY`];
    if (apiKey) clientConfig.apiKey = apiKey;
    if (config.organization) clientConfig.organization = config.organization;

    return new ProviderHttpClient(clientConfig);
  }

  protected abstract getDefaultBaseURL(): string;
  protected abstract getEndpoint(): string;

  async execute(client: TClient, request: LLMRequest): Promise<LLMResponse> {
    const httpClient = client as ProviderHttpClient;
    const body = this.buildRequestBody(request);

    try {
      const response = await httpClient.post<ChatCompletionResponse>(
        this.getEndpoint(),
        body
      );
      return this.parseResponse(response, request.model);
    } catch (error) {
      throw new ProviderError(
        `${this.name} request failed`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async *executeStream(client: TClient, request: LLMRequest): AsyncIterable<StreamChunk> {
    const httpClient = client as ProviderHttpClient;
    const body = { ...this.buildRequestBody(request), stream: true };

    try {
      const stream = await httpClient.postStream(this.getEndpoint(), body);
      let index = 0;

      for await (const line of stream) {
        const chunk = this.parseStreamLine(line);
        if (chunk) {
          yield { ...chunk, index: index++ };
        }
      }
    } catch (error) {
      throw new ProviderError(
        `${this.name} stream request failed`,
        error instanceof Error ? error : undefined
      );
    }
  }

  protected buildRequestBody(request: LLMRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: request.model,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
    };

    if (request.messages) {
      body.messages = request.messages;
    } else if (request.prompt) {
      body.prompt = request.prompt;
    }

    return body;
  }

  protected parseResponse(response: ChatCompletionResponse, model: string): LLMResponse {
    const choice = response.choices[0];
    const result: LLMResponse = {
      id: response.id,
      content: choice?.message?.content ?? "",
      model: response.model ?? model,
      raw: response,
    };

    if (choice?.finish_reason !== undefined) {
      result.finishReason = choice.finish_reason;
    }

    if (response.usage) {
      result.usage = {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      };
    }

    return result;
  }

  protected parseStreamLine(line: string): StreamChunk | null {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "data: [DONE]") return null;

    const dataPrefix = "data: ";
    const jsonStr = trimmed.startsWith(dataPrefix) ? trimmed.slice(dataPrefix.length) : trimmed;

    try {
      const parsed = JSON.parse(jsonStr) as ChatCompletionResponse;
      const delta = parsed.choices[0]?.delta;
      const chunk: StreamChunk = {
        index: 0,
        content: delta?.content ?? "",
        delta: delta as Record<string, unknown>,
      };

      const finishReason = parsed.choices[0]?.finish_reason;
      if (finishReason !== undefined) {
        chunk.finishReason = finishReason;
      }

      return chunk;
    } catch {
      return null;
    }
  }

  estimateTokens(request: LLMRequest, response: LLMResponse): number {
    return response.usage?.totalTokens ?? this.roughTokenEstimate(request, response);
  }

  protected roughTokenEstimate(request: LLMRequest, response: LLMResponse): number {
    const promptText = request.messages
      ? request.messages.map((m) => (typeof m.content === "string" ? m.content : "")).join(" ")
      : request.prompt ?? "";
    return Math.ceil((promptText.length + response.content.length) / 4);
  }
}

export class ProviderHttpClient {
  private readonly apiKey?: string;
  private readonly baseURL: string;
  private readonly organization?: string;
  private readonly headers: Record<string, string>;

  constructor(config: ProviderClientConfig) {
    if (config.apiKey) this.apiKey = config.apiKey;
    this.baseURL = config.baseURL ?? "";
    if (config.organization) this.organization = config.organization;
    this.headers = config.headers ?? {};
  }

  async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.baseURL}${path}`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ProviderError(`HTTP ${response.status}: ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  async postStream(path: string, body: Record<string, unknown>): Promise<AsyncIterable<string>> {
    const response = await fetch(`${this.baseURL}${path}`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ProviderError(`HTTP ${response.status}: ${errorText}`);
    }

    if (!response.body) {
      throw new ProviderError("Response body is null");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    return {
      async *[Symbol.asyncIterator]() {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            yield line;
          }
        }

        if (buffer) yield buffer;
      },
    };
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.headers,
    };

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    if (this.organization) {
      headers["OpenAI-Organization"] = this.organization;
    }

    return headers;
  }
}
