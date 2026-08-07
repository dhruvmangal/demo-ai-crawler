const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b-instruct';
// CPU-only inference of a 3B model is slow: a single page-summary call (6KB of HTML +
// a description per UI element) routinely runs past a minute, so 60s aborted most calls
// mid-generation and discarded the result. Default to 180s and allow tuning via env.
const DEFAULT_REQUEST_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS) || 180000;

export class OllamaClient {
  /**
   * Sends a prompt to Ollama and returns the parsed JSON response, or null if the
   * request fails, times out, or the model didn't return valid JSON. One retry on
   * failure -- local inference occasionally times out under cold-start/CPU load.
   */
  public static async generateJson(prompt: string, timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS): Promise<any | null> {
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
            options: { num_ctx: 8192, temperature: 0.2 }
          }),
          signal: controller.signal
        });

        if (!res.ok) {
          throw new Error(`Ollama request failed: ${res.status} ${res.statusText}`);
        }

        const body = await res.json();
        return JSON.parse(body.response);
      } catch (err: any) {
        console.warn(`[OllamaClient] Attempt ${attempt} failed: ${err?.message || err}`);
        if (attempt === 2) {
          return null;
        }
      } finally {
        clearTimeout(timeout);
      }
    }
    return null;
  }
}
