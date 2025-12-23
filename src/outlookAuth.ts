import "dotenv/config";
import { AuthorizationCode } from "simple-oauth2";

const tenant = process.env.OUTLOOK_TENANT ?? "common";
console.log("OUTLOOK_TENANT used by server:", tenant);

export const oauthClient = new AuthorizationCode({
  client: {
    id: process.env.OUTLOOK_CLIENT_ID ?? "",
    secret: process.env.OUTLOOK_CLIENT_SECRET ?? "",
  },
  auth: {
    tokenHost: "https://login.microsoftonline.com",
    tokenPath: `/${tenant}/oauth2/v2.0/token`,
    authorizePath: `/${tenant}/oauth2/v2.0/authorize`,
  },
});

export const scopes = ["openid", "profile", "email", "offline_access", "User.Read", "Mail.Read"];

export function getAuthorizeUrl(state: string) {
  if (!process.env.OUTLOOK_REDIRECT_URI) throw new Error("OUTLOOK_REDIRECT_URI missing");
  return oauthClient.authorizeURL({
    redirect_uri: process.env.OUTLOOK_REDIRECT_URI,
    scope: scopes.join(" "),
    state,
  });
}