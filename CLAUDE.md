# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install           # install dependencies
npm run dev           # wrangler dev --remote (local dev; quickAction() requires --remote)
npm run deploy        # wrangler deploy
npm run typecheck     # tsc --noEmit
npm run tail          # wrangler tail (live logs)
```

There are no tests. The only static check is `tsc --noEmit`.

## One-time setup

```bash
npx wrangler kv namespace create BLOCKLIST_KV   # paste id/preview_id into wrangler.jsonc
npx wrangler secret put MCP_AUTH_TOKEN
npx wrangler secret put CF_ACCOUNT_ID           # required for crawl_* tools only
npx wrangler secret put CF_API_TOKEN            # needs "Browser Rendering - Edit" permission

# seed the blocklist
npx wrangler kv key put --binding=BLOCKLIST_KV "config:blocklist" --path=blocklist.seed.json --remote
```

For local dev, copy `.dev.vars.example` to `.dev.vars` and fill it in (secrets aren't read from wrangler.jsonc).

## Architecture

This is a Cloudflare Worker that exposes an MCP server over Streamable HTTP at `/mcp`.

**Request flow:** `src/index.ts` handles auth (timing-safe Bearer token check against `MCP_AUTH_TOKEN`) then forwards to `BrowserMcp.serve("/mcp")` which is a Cloudflare Agents SDK `McpAgent` — each MCP client session gets its own Durable Object instance.

**Source files:**

- `src/index.ts` — Worker entry point: auth middleware + routes to McpAgent
- `src/mcp-server.ts` — `BrowserMcp extends McpAgent`: registers all MCP tools in `init()`
- `src/browser-actions.ts` — wraps `env.BROWSER.quickAction()` for markdown/content/snapshot/links/pdf
- `src/crawl.ts` — calls the Browser Run REST API directly for async crawl jobs (initiate + poll + cancel)
- `src/blocklist.ts` — KV-backed blocklist: normalize/check domains and Instagram usernames
- `src/types.ts` — `Env`, `BlocklistConfig`, `BrowserRunBinding`, `QuickActionJsonResult`

**Two browser access patterns:**

1. **`env.BROWSER.quickAction(action, options)`** — synchronous binding for markdown/content/snapshot/links/pdf. No `@cloudflare/puppeteer` needed. Returns `QuickActionJsonResult<T>`.
2. **Cloudflare REST API** (`api.cloudflare.com/client/v4/accounts/.../browser-rendering/crawl`) — used for crawl jobs because `/crawl` is async (initiate → poll → results). Requires `CF_ACCOUNT_ID` + `CF_API_TOKEN`.

**Blocklist:** stored as a single JSON object under `config:blocklist` in the `BLOCKLIST_KV` namespace. Domain matching covers subdomains. Instagram username matching covers profile and `/stories/<user>/` URLs; posts/reels (`/p/`, `/reel/`) cannot be reliably attributed to a username from the URL alone and are not covered.

**`crawl_site` behavior:** `startCrawlAndWait` polls for up to 45 seconds (3-second interval). If the job is still running at the deadline, it returns the `jobId` with a null result — the caller is expected to poll with `get_crawl_status`. The blocklist is only checked against the starting URL, not crawled sub-pages.

**Browser time / cost:** every `quickAction()` response carries an `X-Browser-Ms-Used` header; the free plan allows 10 minutes/day. `crawl_site` with `render: false` fetches static HTML without consuming browser time.
