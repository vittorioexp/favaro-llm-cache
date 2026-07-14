import { SerializationError } from "./errors.js";

export class JsonSerializer {
  serialize<T>(value: T): string {
    try {
      return JSON.stringify(value);
    } catch (error) {
      throw new SerializationError(
        "Failed to serialize value to JSON",
        error instanceof Error ? error : undefined
      );
    }
  }

  deserialize<T>(data: string | Buffer): T {
    try {
      const str = typeof data === "string" ? data : data.toString("utf8");
      return JSON.parse(str) as T;
    } catch (error) {
      throw new SerializationError(
        "Failed to deserialize JSON value",
        error instanceof Error ? error : undefined
      );
    }
  }
}

export function maskSensitiveFields<T extends Record<string, unknown>>(
  obj: T,
  sensitiveFields: string[]
): T {
  if (sensitiveFields.length === 0) {
    return obj;
  }

  const sensitive = new Set(sensitiveFields.map((f) => f.toLowerCase()));
  const result = { ...obj };

  for (const key of Object.keys(result)) {
    if (sensitive.has(key.toLowerCase())) {
      (result as Record<string, unknown>)[key] = "[REDACTED]";
    } else if (
      typeof result[key] === "object" &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      (result as Record<string, unknown>)[key] = maskSensitiveFields(
        result[key] as Record<string, unknown>,
        sensitiveFields
      );
    }
  }

  return result;
}

export function extractPromptText(input: {
  messages?: readonly { content: string | { text?: string }[] }[];
  prompt?: string;
}): string {
  if (input.prompt) {
    return input.prompt;
  }

  if (!input.messages) {
    return "";
  }

  return input.messages
    .map((msg) => {
      if (typeof msg.content === "string") {
        return msg.content;
      }
      return msg.content
        .map((part) => ("text" in part ? (part.text ?? "") : ""))
        .join(" ");
    })
    .join("\n");
}
