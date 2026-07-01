import type {
  AuthRequest,
  OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import type { Env } from "./types";

type AuthEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };

const PENDING_TTL = 600; // 10 minutes for the user to submit the form

function renderForm(stateKey: string, error?: string): Response {
  const errorHtml = error
    ? `<p style="color:red;margin:0 0 12px">${error}</p>`
    : "";
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>browser-mcp</title>
  <link rel="icon" href="/favicon.ico" type="image/x-icon" />
  <style>
    body { font-family: system-ui, sans-serif; display: flex; align-items: center;
           justify-content: center; min-height: 100vh; margin: 0; background: #f5f5f5; }
    .card { background: white; padding: 32px; border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,.1); width: 320px; }
    h1 { margin: 0 0 8px; font-size: 18px; }
    p  { margin: 0 0 20px; color: #666; font-size: 14px; }
    input { width: 100%; box-sizing: border-box; padding: 8px 12px;
            border: 1px solid #ddd; border-radius: 4px; font-size: 14px; margin-bottom: 12px; }
    button { width: 100%; padding: 9px; background: #0066ff; color: white;
             border: none; border-radius: 4px; font-size: 14px; cursor: pointer; }
    button:hover { background: #0052cc; }
  </style>
</head>
<body>
  <div class="card">
    <h1>browser-mcp</h1>
    <p>Enter your token to connect.</p>
    ${errorHtml}
    <form method="post">
      <input type="hidden" name="state" value="${stateKey}" />
      <input type="password" name="password" placeholder="MCP_AUTH_TOKEN" autofocus />
      <button type="submit">Connect</button>
    </form>
  </div>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html" } });
}

export const authHandler = {
  async fetch(request: Request, env: AuthEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return new Response(
        "browser-mcp is running. Point an MCP client at /mcp.",
        {
          headers: { "Content-Type": "text/plain" },
        },
      );
    }

    if (url.pathname === "/favicon.ico") {
      const b64 =
        "AAABAAEAEBAAAAAAIACfAAAAFgAAAIlQTkcNChoKAAAADUlIRFIAAAAQAAAAEAgGAAAAH/P/YQAAAGZJREFUeJzdk0EOgCAMBGcJb9U3wWfrQUmAiMHiyT2VtLMlZBFFmxlvlCWA4IIrRi64UliBAWJ9sDQPau8MRnAZ7GXp7MX79vytGoPRtifj5Uf8gUGTRE8OPojy9atcylIohQcGOACRmB0hhRnbdAAAAABJRU5ErkJggg==";
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new Response(bytes, {
        headers: { "Content-Type": "image/x-icon" },
      });
    }

    if (url.pathname !== "/authorize") {
      return new Response("Not found", { status: 404 });
    }

    if (request.method === "GET") {
      const oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      if (!oauthReqInfo.clientId) {
        return new Response("Invalid OAuth request", { status: 400 });
      }
      const stateKey = crypto.randomUUID();
      await env.OAUTH_KV.put(
        `pending:${stateKey}`,
        JSON.stringify(oauthReqInfo),
        {
          expirationTtl: PENDING_TTL,
        },
      );
      return renderForm(stateKey);
    }

    if (request.method === "POST") {
      const formData = await request.formData();
      const password = formData.get("password") as string | null;
      const stateKey = formData.get("state") as string | null;

      if (!stateKey) return new Response("Missing state", { status: 400 });

      const stored = await env.OAUTH_KV.get<AuthRequest>(
        `pending:${stateKey}`,
        "json",
      );
      if (!stored) {
        return new Response("Session expired — please try connecting again.", {
          status: 400,
        });
      }

      if (!env.MCP_AUTH_TOKEN || password !== env.MCP_AUTH_TOKEN) {
        return renderForm(stateKey, "Incorrect token.");
      }

      await env.OAUTH_KV.delete(`pending:${stateKey}`);

      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        metadata: { label: "owner" },
        props: {},
        request: stored,
        scope: stored.scope,
        userId: "owner",
      });

      return Response.redirect(redirectTo, 302);
    }

    return new Response("Method not allowed", { status: 405 });
  },
};
