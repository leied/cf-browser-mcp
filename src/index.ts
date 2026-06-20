import { BrowserMcp } from "./mcp-server";
import type { Env } from "./types";

export { BrowserMcp };

const mcpHandler = BrowserMcp.serve("/mcp");

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++)
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      const authLine = env.MCP_AUTH_TOKEN
        ? "Auth: Bearer token required.\n"
        : "Auth: none configured — anyone with this URL can call your tools.\n";
      return new Response(
        `browser-mcp is running. Point an MCP client at /mcp.\n${authLine}`,
        {
          headers: { "Content-Type": "text/plain" },
        },
      );
    }

    if (env.MCP_AUTH_TOKEN) {
      const authHeader = request.headers.get("Authorization") ?? "";
      const expected = `Bearer ${env.MCP_AUTH_TOKEN}`;
      if (!timingSafeEqual(authHeader, expected)) {
        return new Response("Unauthorized", { status: 401 });
      }
    }

    return mcpHandler.fetch(request, env, ctx);
  },
};
