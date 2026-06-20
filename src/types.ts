/**
 * Shared types for the Browser MCP worker.
 */

export interface BlocklistConfig {
  domains: string[];
  instagramUsers: string[];
}

/**
 * Loose shape of the `browser` binding's quickAction() method. quickAction()
 * is provided by the Workers runtime directly on the binding — it does NOT
 * require installing @cloudflare/puppeteer. If you later add full
 * Puppeteer/Playwright browser sessions (clicking, scrolling, login flows),
 * install @cloudflare/puppeteer and swap this for its official `BrowserWorker`
 * type instead.
 */
export interface BrowserRunBinding {
  quickAction(
    action: string,
    options: Record<string, unknown>,
  ): Promise<Response>;
}

export interface Env {
  BROWSER: BrowserRunBinding;
  BLOCKLIST_KV: KVNamespace;
  OAUTH_KV: KVNamespace; // name is hardcoded by @cloudflare/workers-oauth-provider
  MCP_OBJECT: DurableObjectNamespace;

  // Secrets — set with `wrangler secret put <NAME>` (or .dev.vars locally).
  MCP_AUTH_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
}

export interface QuickActionJsonResult<T = unknown> {
  success: boolean;
  result?: T;
  errors?: { code: number; message: string }[];
}
