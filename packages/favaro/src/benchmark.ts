import { createMemoryStorage } from "@favaro/memory";
import { createCache } from "@favaro/core";

interface BenchmarkResult {
  name: string;
  operations: number;
  totalMs: number;
  avgMs: number;
  opsPerSecond: number;
}

async function benchmark(name: string, fn: () => Promise<void>, iterations: number): Promise<BenchmarkResult> {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    await fn();
  }
  const totalMs = performance.now() - start;

  return {
    name,
    operations: iterations,
    totalMs,
    avgMs: totalMs / iterations,
    opsPerSecond: (iterations / totalMs) * 1000,
  };
}

async function runBenchmarks(): Promise<void> {
  console.log("\n  Favaro LLM Cache Benchmarks\n");

  const storage = createMemoryStorage();
  const cache = createCache(storage, { ttl: 3600_000 });
  const iterations = 10_000;

  const setResult = await benchmark(
    "Cache SET",
    async () => {
      const key = `bench-set-${Math.random()}`;
      await cache.set(key, { content: "benchmark response", model: "gpt-4" });
    },
    iterations
  );

  const keys: string[] = [];
  for (let i = 0; i < 1000; i++) {
    const key = `bench-get-${i}`;
    keys.push(key);
    await cache.set(key, { content: `response-${i}`, model: "gpt-4" });
  }

  let getIndex = 0;
  const getResult = await benchmark(
    "Cache GET (hit)",
    async () => {
      const key = keys[getIndex % keys.length]!;
      await cache.get(key);
      getIndex++;
    },
    iterations
  );

  const missResult = await benchmark(
    "Cache GET (miss)",
    async () => {
      await cache.get(`miss-${Math.random()}`);
    },
    iterations
  );

  const wrapResult = await benchmark(
    "Cache WRAP (dedup)",
    async () => {
      await cache.wrap("dedup-key", async () => ({ value: 42 }));
    },
    iterations
  );

  const keyGenResult = await benchmark(
    "Key Generation",
    () => {
      cache.buildKey({
        provider: "openai",
        model: "gpt-4",
        messages: [{ role: "user", content: "What is the capital of France?" }],
        temperature: 0.7,
      });
      return Promise.resolve();
    },
    iterations
  );

  const results = [setResult, getResult, missResult, wrapResult, keyGenResult];

  console.log("  ┌─────────────────────┬────────────┬──────────┬──────────────┐");
  console.log("  │ Benchmark           │ Operations │ Avg (ms) │ Ops/sec      │");
  console.log("  ├─────────────────────┼────────────┼──────────┼──────────────┤");

  for (const r of results) {
    const name = r.name.padEnd(19);
    const ops = String(r.operations).padStart(10);
    const avg = r.avgMs.toFixed(4).padStart(8);
    const opsSec = Math.round(r.opsPerSecond).toLocaleString().padStart(12);
    console.log(`  │ ${name} │ ${ops} │ ${avg} │ ${opsSec} │`);
  }

  console.log("  └─────────────────────┴────────────┴──────────┴──────────────┘\n");

  const metrics = cache.getMetrics();
  if (metrics) {
    const hitRatio = metrics.hits + metrics.misses > 0
      ? ((metrics.hits / (metrics.hits + metrics.misses)) * 100).toFixed(1)
      : "0.0";
    console.log(`  Hit Ratio: ${hitRatio}%`);
    console.log(`  Total Entries: ${await cache.size()}\n`);
  }

  await cache.close();
}

runBenchmarks().catch(console.error);
