/**
 * Upstream rate-limit detection. Callers throw RateLimitError so the MCP
 * layer can queue and retry instead of surfacing the error to the client.
 */

export class RateLimitError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}

const RATE_LIMIT_MESSAGE_RE = /rate.?limit|too many requests/i;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parses a Retry-After header (delta-seconds or HTTP date) into ms. */
function retryAfterMs(res: Response): number | undefined {
  const header = res.headers.get("Retry-After");
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

/**
 * Throws RateLimitError if the response is a 429, or if `message` (an error
 * string pulled from the body) looks like a rate-limit rejection.
 */
export function throwIfRateLimited(res: Response, message?: string): void {
  if (
    res.status === 429 ||
    (message !== undefined && RATE_LIMIT_MESSAGE_RE.test(message))
  ) {
    throw new RateLimitError(
      message || `Upstream rate limit exceeded (${res.status})`,
      retryAfterMs(res),
    );
  }
}
