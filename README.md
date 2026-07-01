# cf-browser-mcp

An MCP server, deployed as a Cloudflare Worker, that gives an MCP client (Claude)
a headless browser via [Browser Run](https://developers.cloudflare.com/browser-run/)
(formerly Browser Rendering). It can pull a page as Markdown, a full snapshot
(content + screenshot + a11y tree), a PDF, its outbound links, or crawl a whole
site — and it refuses to touch anything on a configurable blocklist of domains
and Instagram usernames before it ever makes a request.

## What it uses

- **Quick Actions** (`/markdown`, `/content`, `/snapshot`, `/links`, `/pdf`) via
  the `browser` binding's `quickAction()` method — synchronous, no API token needed.
- **`/crawl`** via the REST API directly (it's an async job — initiate, poll,
  cancel — which doesn't fit the synchronous `quickAction()` shape), so this
  needs a scoped API token.
- **Workers KV** for the blocklist, so you can edit it without redeploying.
- **`agents/mcp`** (`McpAgent`) for the MCP server itself — Durable Object per
  session, Streamable HTTP transport.
- **`@cloudflare/workers-oauth-provider`** for OAuth 2.0 auth — required by
  claude.ai's connector UI. A simple password form gates access; the password
  is your `MCP_AUTH_TOKEN`.

No `@cloudflare/puppeteer` dependency — `quickAction()` is available on the
binding directly. Add it later if you want full scripted browser sessions
(clicking, scrolling, login flows).

## Tools

| Tool               | Does                                                  |
| ------------------ | ----------------------------------------------------- |
| `fetch_markdown`   | Page → Markdown                                       |
| `fetch_content`    | Page → rendered HTML                                  |
| `fetch_snapshot`   | Page → markdown/HTML/screenshot/a11y tree in one call |
| `fetch_pdf`        | Page → PDF                                            |
| `get_links`        | Page → list of links                                  |
| `crawl_site`       | Crawl a site, return Markdown per page                |
| `get_crawl_status` | Poll/fetch results of a crawl job                     |
| `cancel_crawl`     | Cancel a running crawl job                            |
| `list_blocklist`   | Show the current blocklist                            |

Every page-reading tool and `crawl_site` checks the blocklist **before** making
any request — a blocked URL never reaches Browser Run.

### Blocklist scope, honestly

- **Domains**: hostname match, subdomains included (blocking `example.com`
  also blocks `m.example.com`).
- **Instagram usernames**: matches `instagram.com/<user>` and
  `instagram.com/stories/<user>/...`. Posts and reels (`/p/<id>`, `/reel/<id>`)
  can't be reliably attributed to a user from the URL alone, so those aren't
  covered by username blocking — only the domain blocklist would catch those
  if you block `instagram.com` outright.
- **`crawl_site`** only checks the _starting_ URL against the blocklist. If you
  pass `includeExternalLinks: true`, the crawler can reach other domains —
  use `excludePatterns` for that case.

## Setup

```bash
npm install
npx wrangler login

# KV namespace for the blocklist
npx wrangler kv namespace create BLOCKLIST_KV
npx wrangler kv namespace create BLOCKLIST_KV --preview

# KV namespace for OAuth token storage (binding name is hardcoded by the library)
npx wrangler kv namespace create OAUTH_KV
npx wrangler kv namespace create OAUTH_KV --preview

# Paste all four IDs into wrangler.jsonc (use wrangler.jsonc.example as a template)

# Secrets
npx wrangler secret put MCP_AUTH_TOKEN   # used as the OAuth login password
npx wrangler secret put CF_ACCOUNT_ID   # only needed for crawl_*
npx wrangler secret put CF_API_TOKEN    # token needs "Browser Rendering - Edit"

# Seed the blocklist — copy the example and customize
cp blocklist.seed.example.json blocklist.seed.json
npx wrangler kv key put --binding=BLOCKLIST_KV "config:blocklist" --path=blocklist.seed.json --remote

npx wrangler deploy
```

For local dev, copy `.dev.vars.example` to `.dev.vars` and fill it in.
`quickAction()` isn't supported in plain local mode, so run:

```bash
npm run dev   # already runs `wrangler dev --remote`
```

## Connecting to Claude

Auth uses OAuth 2.0 (`@cloudflare/workers-oauth-provider`). When connecting,
a browser popup asks for a password — enter your `MCP_AUTH_TOKEN` value.

**claude.ai (web UI):** add a connector pointing at
`https://<your-worker>.workers.dev/mcp`. The OAuth popup will appear
automatically.

**Claude Code:**

```bash
claude mcp add --transport http browser-mcp https://<your-worker>.workers.dev/mcp
```

Claude Code will open a browser for the OAuth flow on first use.

**Claude Desktop**, via [`mcp-remote`](https://www.npmjs.com/package/mcp-remote):

```json
{
  "mcpServers": {
    "browser-mcp": {
      "command": "npx",
      "args": ["mcp-remote", "https://<your-worker>.workers.dev/mcp"]
    }
  }
}
```

## Cost awareness

Every Quick Actions response includes an `X-Browser-Ms-Used` header (surfaced
in `fetch_markdown`'s output as `[browser time: Xms]`) and crawl results
include `browserSecondsUsed`. Free plan accounts are capped at 10 minutes of
browser use/day — `crawl_site` with `render: false` (fast HTML fetch, no
JS execution) avoids consuming browser time entirely for static pages.
