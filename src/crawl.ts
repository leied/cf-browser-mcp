import type { Env } from "./types";

// /crawl is an async job and isn't exposed through quickAction() in a way
// that's documented for polling, so this calls the REST API directly with a
// scoped API token instead of the binding.
const API_BASE = "https://api.cloudflare.com/client/v4";

function requireCrawlCredentials(env: Env): {
  accountId: string;
  apiToken: string;
} {
  if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) {
    throw new Error(
      "crawl_site requires the CF_ACCOUNT_ID and CF_API_TOKEN secrets " +
        "(wrangler secret put CF_ACCOUNT_ID / CF_API_TOKEN). The token needs " +
        "the 'Browser Rendering - Edit' permission.",
    );
  }
  return { accountId: env.CF_ACCOUNT_ID, apiToken: env.CF_API_TOKEN };
}

export interface CrawlOptions {
  limit?: number;
  depth?: number;
  formats?: string[];
  render?: boolean;
  source?: "all" | "sitemaps" | "links";
  includePatterns?: string[];
  excludePatterns?: string[];
  includeExternalLinks?: boolean;
  includeSubdomains?: boolean;
}

export async function startCrawl(
  env: Env,
  url: string,
  opts: CrawlOptions = {},
): Promise<string> {
  const { accountId, apiToken } = requireCrawlCredentials(env);

  const body: Record<string, unknown> = {
    url,
    limit: opts.limit,
    depth: opts.depth,
    formats: opts.formats,
    render: opts.render,
    source: opts.source,
  };
  if (
    opts.includePatterns ||
    opts.excludePatterns ||
    opts.includeExternalLinks ||
    opts.includeSubdomains
  ) {
    body.options = {
      includePatterns: opts.includePatterns,
      excludePatterns: opts.excludePatterns,
      includeExternalLinks: opts.includeExternalLinks,
      includeSubdomains: opts.includeSubdomains,
    };
  }

  const res = await fetch(
    `${API_BASE}/accounts/${accountId}/browser-rendering/crawl`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  const data = (await res.json()) as {
    success: boolean;
    result?: string;
    errors?: { message: string }[];
  };
  if (!data.success || !data.result) {
    throw new Error(
      data.errors?.map((e) => e.message).join("; ") ||
        `Crawl initiation failed (${res.status})`,
    );
  }
  return data.result;
}

export interface CrawlRecord {
  url: string;
  status: string;
  markdown?: string;
  html?: string;
  json?: unknown;
  metadata?: { status: number; title?: string; url: string };
}

export interface CrawlJobResult {
  id: string;
  status: string;
  total: number;
  finished: number;
  browserSecondsUsed?: number;
  records: CrawlRecord[];
  cursor?: number;
}

export async function getCrawlStatus(
  env: Env,
  jobId: string,
  opts: { limit?: number; cursor?: number; status?: string } = {},
): Promise<CrawlJobResult> {
  const { accountId, apiToken } = requireCrawlCredentials(env);

  const params = new URLSearchParams();
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts.cursor !== undefined) params.set("cursor", String(opts.cursor));
  if (opts.status) params.set("status", opts.status);
  const qs = params.toString();

  const res = await fetch(
    `${API_BASE}/accounts/${accountId}/browser-rendering/crawl/${jobId}${qs ? `?${qs}` : ""}`,
    { headers: { Authorization: `Bearer ${apiToken}` } },
  );

  const data = (await res.json()) as {
    success: boolean;
    result?: CrawlJobResult;
    errors?: { message: string }[];
  };
  if (!data.success || !data.result) {
    throw new Error(
      data.errors?.map((e) => e.message).join("; ") ||
        `Crawl status check failed (${res.status})`,
    );
  }
  return data.result;
}

export async function cancelCrawl(env: Env, jobId: string): Promise<void> {
  const { accountId, apiToken } = requireCrawlCredentials(env);
  const res = await fetch(
    `${API_BASE}/accounts/${accountId}/browser-rendering/crawl/${jobId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiToken}` },
    },
  );
  if (!res.ok) {
    throw new Error(`Failed to cancel crawl job ${jobId} (${res.status})`);
  }
}

/** Initiates a crawl and polls until it finishes or `maxWaitMs` elapses. */
export async function startCrawlAndWait(
  env: Env,
  url: string,
  opts: CrawlOptions = {},
  maxWaitMs = 45_000,
  pollIntervalMs = 3_000,
): Promise<{ jobId: string; result: CrawlJobResult | null }> {
  const jobId = await startCrawl(env, url, opts);
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    const status = await getCrawlStatus(env, jobId, { limit: 1 });
    if (status.status !== "running") {
      const full = await getCrawlStatus(env, jobId);
      return { jobId, result: full };
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return { jobId, result: null }; // still running — caller polls get_crawl_status later
}
