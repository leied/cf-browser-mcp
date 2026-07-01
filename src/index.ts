import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { BrowserMcp } from "./mcp-server";
import { authHandler } from "./auth-handler";

export { BrowserMcp };

export default new OAuthProvider({
  apiHandler: BrowserMcp.serve("/mcp"),
  apiRoute: "/mcp",
  authorizeEndpoint: "/authorize",
  clientRegistrationEndpoint: "/register",
  defaultHandler: authHandler,
  tokenEndpoint: "/token",
});
