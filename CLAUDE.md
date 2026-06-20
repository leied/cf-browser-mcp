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
npx wrangler kv namespace create BLOCKLIST_KV
npx wrangler kv namespace create BLOCKLIST_KV --preview
npx wrangler kv namespace create OAUTH_KV        # binding name is hardcoded by @cloudflare/workers-oauth-provider
npx wrangler kv namespace create OAUTH_KV --preview
# Paste the four IDs into wrangler.jsonc (use wrangler.jsonc.example as a template)

npx wrangler secret put MCP_AUTH_TOKEN   # used as the OAuth login password
npx wrangler secret put CF_ACCOUNT_ID   # required for crawl_* tools only
npx wrangler secret put CF_API_TOKEN    # needs "Browser Rendering - Edit" permission

cp blocklist.seed.example.json blocklist.seed.json   # then customize
npx wrangler kv key put --binding=BLOCKLIST_KV "config:blocklist" --path=blocklist.seed.json --remote --preview false
```

For local dev, copy `.dev.vars.example` to `.dev.vars` and fill in secrets.

## Architecture

This is a Cloudflare Worker that exposes an MCP server over Streamable HTTP at `/mcp`.

**Request flow:** `src/index.ts` exports an `OAuthProvider` instance as the default handler. It intercepts all requests — validating OAuth tokens on `/mcp` and routing everything else to `authHandler` in `src/auth-handler.ts`. Authenticated `/mcp` requests are forwarded to `BrowserMcp.serve("/mcp")`, a Cloudflare Agents SDK `McpAgent` where each MCP client session gets its own Durable Object instance.

**Auth flow:** When a client connects, the OAuthProvider redirects to `/authorize`, which shows a password form. The submitted password is checked against `MCP_AUTH_TOKEN`. On success, `OAUTH_PROVIDER.completeAuthorization()` issues an OAuth token stored in `OAUTH_KV`. The parsed auth request is stored in `OAUTH_KV` (not the form) to survive the GET→POST round-trip intact.

**Source files:**
- `src/index.ts` — entry point: `OAuthProvider` wrapping `BrowserMcp.serve("/mcp")`
- `src/auth-handler.ts` — `/authorize` password form + `/` health check
- `src/mcp-server.ts` — `BrowserMcp extends McpAgent`: registers all MCP tools in `init()`
- `src/browser-actions.ts` — wraps `env.BROWSER.quickAction()` for markdown/content/snapshot/links/pdf
- `src/crawl.ts` — calls the Browser Run REST API directly for async crawl jobs (initiate + poll + cancel)
- `src/blocklist.ts` — KV-backed blocklist: normalize/check domains and Instagram usernames
- `src/types.ts` — `Env`, `BlocklistConfig`, `BrowserRunBinding`, `QuickActionJsonResult`

**Two browser access patterns:**
1. **`env.BROWSER.quickAction(action, options)`** — synchronous binding for markdown/content/snapshot/links/pdf. No `@cloudflare/puppeteer` needed.
2. **Cloudflare REST API** (`api.cloudflare.com/client/v4/accounts/.../browser-rendering/crawl`) — used for crawl jobs because `/crawl` is async (initiate → poll → results). Requires `CF_ACCOUNT_ID` + `CF_API_TOKEN`.

**Blocklist:** stored as a single JSON object under `config:blocklist` in `BLOCKLIST_KV`. Domain matching covers subdomains. Instagram username matching covers profile and `/stories/<user>/` URLs only — posts/reels (`/p/`, `/reel/`) can't be reliably attributed to a username from the URL alone. `blocklist.seed.json` is gitignored (personal); `blocklist.seed.example.json` is the committed public template.

**`crawl_site` behavior:** `startCrawlAndWait` polls for up to 45 seconds (3-second interval). If still running at the deadline, returns `jobId` with a null result — caller polls with `get_crawl_status`. Blocklist is only checked against the starting URL.

**Browser time / cost:** every `quickAction()` response carries an `X-Browser-Ms-Used` header; the free plan allows 600 seconds/day. `crawl_site` with `render: false` fetches static HTML without consuming browser time.
