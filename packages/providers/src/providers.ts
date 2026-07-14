import type { ProviderName } from "@favaro/shared";
import { BaseProviderAdapter } from "./base.js";

export class OpenAIAdapter extends BaseProviderAdapter {
  readonly name: ProviderName = "openai";

  protected getDefaultBaseURL(): string {
    return "https://api.openai.com/v1";
  }

  protected getEndpoint(): string {
    return "/chat/completions";
  }

  estimateCost(request: import("@favaro/shared").LLMRequest, response: import("@favaro/shared").LLMResponse): number {
    const usage = response.usage;
    if (!usage) return 0;

    const pricing: Record<string, { input: number; output: number }> = {
      "gpt-4o": { input: 2.5, output: 10 },
      "gpt-4o-mini": { input: 0.15, output: 0.6 },
      "gpt-4-turbo": { input: 10, output: 30 },
      "gpt-3.5-turbo": { input: 0.5, output: 1.5 },
    };

    const modelPricing = pricing[request.model] ?? { input: 1, output: 3 };
    return (
      (usage.promptTokens / 1_000_000) * modelPricing.input +
      (usage.completionTokens / 1_000_000) * modelPricing.output
    );
  }
}

export class AnthropicAdapter extends BaseProviderAdapter {
  readonly name: ProviderName = "anthropic";

  protected getDefaultBaseURL(): string {
    return "https://api.anthropic.com/v1";
  }

  protected getEndpoint(): string {
    return "/messages";
  }

  protected override buildRequestBody(request: import("@favaro/shared").LLMRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: request.model,
      max_tokens: request.maxTokens ?? 1024,
    };

    if (request.messages) {
      const system = request.messages.find((m) => m.role === "system");
      const nonSystem = request.messages.filter((m) => m.role !== "system");

      if (system && typeof system.content === "string") {
        body.system = system.content;
      }
      body.messages = nonSystem;
    }

    return body;
  }

  protected override parseResponse(
    response: import("./base.js").ChatCompletionResponse,
    model: string
  ): import("@favaro/shared").LLMResponse {
    const content = (response as unknown as { content?: Array<{ text: string }> }).content;
    const text = content?.map((c) => c.text).join("") ?? "";

    const result: import("@favaro/shared").LLMResponse = {
      id: response.id,
      content: text,
      model: response.model ?? model,
      raw: response,
    };

    if (response.usage) {
      result.usage = {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      };
    }

    return result;
  }
}

export class GeminiAdapter extends BaseProviderAdapter {
  readonly name: ProviderName = "gemini";

  protected getDefaultBaseURL(): string {
    return "https://generativelanguage.googleapis.com/v1beta";
  }

  protected getEndpoint(): string {
    return "/models/gemini-pro:generateContent";
  }
}

export class GroqAdapter extends BaseProviderAdapter {
  readonly name: ProviderName = "groq";

  protected getDefaultBaseURL(): string {
    return "https://api.groq.com/openai/v1";
  }

  protected getEndpoint(): string {
    return "/chat/completions";
  }
}

export class DeepSeekAdapter extends BaseProviderAdapter {
  readonly name: ProviderName = "deepseek";

  protected getDefaultBaseURL(): string {
    return "https://api.deepseek.com/v1";
  }

  protected getEndpoint(): string {
    return "/chat/completions";
  }
}

export class MistralAdapter extends BaseProviderAdapter {
  readonly name: ProviderName = "mistral";

  protected getDefaultBaseURL(): string {
    return "https://api.mistral.ai/v1";
  }

  protected getEndpoint(): string {
    return "/chat/completions";
  }
}

export class OpenRouterAdapter extends BaseProviderAdapter {
  readonly name: ProviderName = "openrouter";

  protected getDefaultBaseURL(): string {
    return "https://openrouter.ai/api/v1";
  }

  protected getEndpoint(): string {
    return "/chat/completions";
  }
}

export class OllamaAdapter extends BaseProviderAdapter {
  readonly name: ProviderName = "ollama";

  protected getDefaultBaseURL(): string {
    return process.env["OLLAMA_HOST"] ?? "http://localhost:11434";
  }

  protected getEndpoint(): string {
    return "/api/chat";
  }
}

export class AzureOpenAIAdapter extends BaseProviderAdapter {
  readonly name: ProviderName = "azure-openai";

  private deploymentName = "gpt-4";

  override createClient(config: Record<string, unknown>) {
    this.deploymentName = (config.deploymentName as string) ?? "gpt-4";
    const baseURL =
      (config.baseURL as string) ??
      `https://${config.resourceName}.openai.azure.com/openai/deployments/${this.deploymentName}`;
    return this.createHttpClient({ ...config, baseURL } as import("./base.js").ProviderClientConfig);
  }

  protected getDefaultBaseURL(): string {
    return "https://your-resource.openai.azure.com";
  }

  protected getEndpoint(): string {
    return `/chat/completions?api-version=2024-02-01`;
  }
}

const adapters: Record<ProviderName, BaseProviderAdapter> = {
  openai: new OpenAIAdapter(),
  anthropic: new AnthropicAdapter(),
  gemini: new GeminiAdapter(),
  groq: new GroqAdapter(),
  deepseek: new DeepSeekAdapter(),
  mistral: new MistralAdapter(),
  openrouter: new OpenRouterAdapter(),
  ollama: new OllamaAdapter(),
  "azure-openai": new AzureOpenAIAdapter(),
  custom: new OpenAIAdapter(),
};

export function getProviderAdapter(name: ProviderName): BaseProviderAdapter {
  return adapters[name];
}

export function registerProviderAdapter(name: ProviderName, adapter: BaseProviderAdapter): void {
  adapters[name] = adapter;
}
