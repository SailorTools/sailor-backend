import "dotenv/config";
import { AuthorizationCode } from "simple-oauth2";

// Use tenant-specific OAuth endpoints when provided; otherwise default to "common"
export const tenant = process.env.OUTLOOK_TENANT ?? "common";
console.log("OUTLOOK_TENANT used by server:", tenant);

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} missing`);
  return v;
}

export const scopes = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Mail.Read",
];

export const oauthClient = new AuthorizationCode({
  client: {
    id: requireEnv("OUTLOOK_CLIENT_ID"),
    secret: requireEnv("OUTLOOK_CLIENT_SECRET"),
  },
  auth: {
    tokenHost: "https://login.microsoftonline.com",
    tokenPath: `/${tenant}/oauth2/v2.0/token`,
    authorizePath: `/${tenant}/oauth2/v2.0/authorize`,
  },
});

// IMPORTANT: We must pass through the state from the caller route so the callback
// can know whether this was a login flow or a connect-inbox flow.
export function getAuthorizeUrl(state: string) {
  const redirectUri = requireEnv("OUTLOOK_REDIRECT_URI");

  return oauthClient.authorizeURL({
    redirect_uri: redirectUri,
    scope: scopes.join(" "),
    // Force state to be included and returned by Microsoft
    state: String(state),
    // Ensure state comes back in query params alongside the code
    // (Microsoft defaults to query for auth code, but we make it explicit)
    response_mode: "query" as any,
  } as any);
}