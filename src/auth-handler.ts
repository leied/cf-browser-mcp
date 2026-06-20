import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { Env } from "./types";

type AuthEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };

function renderForm(encodedState: string, error?: string): Response {
	const errorHtml = error
		? `<p style="color:red;margin:0 0 12px">${error}</p>`
		: "";
	const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>browser-mcp</title>
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
      <input type="hidden" name="state" value="${encodedState}" />
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
			return new Response("browser-mcp is running. Point an MCP client at /mcp.", {
				headers: { "Content-Type": "text/plain" },
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
			return renderForm(btoa(JSON.stringify(oauthReqInfo)));
		}

		if (request.method === "POST") {
			const formData = await request.formData();
			const password = formData.get("password") as string | null;
			const stateStr = formData.get("state") as string | null;

			let oauthReqInfo: AuthRequest;
			try {
				oauthReqInfo = JSON.parse(atob(stateStr ?? ""));
			} catch {
				return new Response("Invalid state", { status: 400 });
			}

			const encodedState = btoa(JSON.stringify(oauthReqInfo));

			if (!env.MCP_AUTH_TOKEN || password !== env.MCP_AUTH_TOKEN) {
				return renderForm(encodedState, "Incorrect token.");
			}

			const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
				metadata: { label: "owner" },
				props: {},
				request: oauthReqInfo,
				scope: oauthReqInfo.scope,
				userId: "owner",
			});

			return Response.redirect(redirectTo, 302);
		}

		return new Response("Method not allowed", { status: 405 });
	},
};
