import type {
  Middleware,
  MiddlewareContext,
  MiddlewarePhase,
} from "@favaro/shared";

export class MiddlewarePipeline {
  private readonly middleware: Middleware[];

  constructor(middleware: Middleware[] = []) {
    this.middleware = middleware;
  }

  async execute<TRequest, TResponse>(
    phase: MiddlewarePhase,
    context: Omit<MiddlewareContext<TRequest, TResponse>, "phase" | "aborted">
  ): Promise<MiddlewareContext<TRequest, TResponse>> {
    const fullContext: MiddlewareContext<TRequest, TResponse> = {
      ...context,
      phase,
      aborted: false,
    };

    const phaseMiddleware = this.middleware.filter((mw) => {
      return true;
    });

    for (const mw of phaseMiddleware) {
      if (fullContext.aborted) break;
      await mw(fullContext);
    }

    return fullContext;
  }

  add(middleware: Middleware): void {
    this.middleware.push(middleware);
  }
}

export function createLoggingMiddleware(
  logger: (message: string, data?: Record<string, unknown>) => void = console.log
): Middleware {
  return (context) => {
    logger(`[favaro] ${context.phase}`, {
      namespace: context.namespace,
      key: context.key.slice(0, 16),
    });
  };
}

export function createTimingMiddleware(
  onTiming: (phase: MiddlewarePhase, durationMs: number) => void
): Middleware {
  const starts = new Map<string, number>();

  return (context) => {
    const id = `${context.phase}:${context.key}`;
    if (!starts.has(id)) {
      starts.set(id, Date.now());
    } else {
      const start = starts.get(id)!;
      onTiming(context.phase, Date.now() - start);
      starts.delete(id);
    }
  };
}
