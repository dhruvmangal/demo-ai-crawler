const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b-instruct';
// CPU-only inference of a 3B model is slow: allow tuning via env. Default to 180s.
const DEFAULT_REQUEST_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS) || 180000;

export interface OllamaGenerateOptions {
  numCtx?: number;
  temperature?: number;
  timeoutMs?: number;
}

export class OllamaClient {
  /**
   * Estimates an optimal num_ctx based on prompt character length and expected response size.
   * Clamped between 1024 and 8192 tokens to avoid excessive memory allocation in KV-cache.
   */
  public static estimateNumCtx(promptLength: number, expectedResponseTokens: number = 512): number {
    const estimatedInputTokens = Math.ceil(promptLength / 3.2);
    const totalTokens = estimatedInputTokens + expectedResponseTokens;
    // Power of 2 rounding or stepped bounds
    if (totalTokens <= 1024) return 1024;
    if (totalTokens <= 2048) return 2048;
    if (totalTokens <= 4096) return 4096;
    return 8192;
  }

  /**
   * Sends a prompt to Ollama and returns the parsed JSON response, or null if the
   * request fails, times out, or the model didn't return valid JSON. Includes
   * exponential backoff between retries and adaptive KV-cache allocation.
   */
  public static async generateJson(
    prompt: string,
    optionsOrTimeout?: number | OllamaGenerateOptions
  ): Promise<any | null> {
    const opts: OllamaGenerateOptions =
      typeof optionsOrTimeout === 'number'
        ? { timeoutMs: optionsOrTimeout }
        : optionsOrTimeout || {};

    const timeoutMs = opts.timeoutMs || DEFAULT_REQUEST_TIMEOUT_MS;
    const numCtx = opts.numCtx || this.estimateNumCtx(prompt.length);
    const temperature = typeof opts.temperature === 'number' ? opts.temperature : 0.2;

    for (let attempt = 1; attempt <= 2; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(`${OLLAMA_URL}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: OLLAMA_MODEL,
            prompt,
            format: 'json',
            stream: false,
            options: { num_ctx: numCtx, temperature }
          }),
          signal: controller.signal
        });

        if (!res.ok) {
          throw new Error(`Ollama request failed: ${res.status} ${res.statusText}`);
        }

        const body = await res.json();
        return JSON.parse(body.response);
      } catch (err: any) {
        console.warn(`[OllamaClient] Attempt ${attempt} failed (num_ctx: ${numCtx}): ${err?.message || err}`);
        if (attempt === 2) {
          return null;
        }
        // Exponential backoff before retry
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      } finally {
        clearTimeout(timeout);
      }
    }
    return null;
  }
}
