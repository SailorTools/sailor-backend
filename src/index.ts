import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { request } from "undici";
import { nanoid } from "nanoid";

import { prisma } from "./prisma";
import { getAuthorizeUrl, oauthClient, scopes } from "./outlookAuth";

const PORT = Number(process.env.PORT ?? 3005);


function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is missing in .env`);
  return v;
}

function getCookie(req: any, name: string) {
  const cookie = req.headers.cookie ?? "";
  const match = cookie.match(new RegExp(`${name}=([^;]+)`));
  return match?.[1];
}

async function main() {
  requireEnv("OUTLOOK_CLIENT_ID");
  requireEnv("OUTLOOK_CLIENT_SECRET");
  requireEnv("OUTLOOK_REDIRECT_URI");

  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  app.get("/health", async () => ({ ok: true, service: "sailor-backend" }));

  app.get("/debug/db", async () => {
    const accounts = await prisma.outlookAccount.count();
    return { ok: true, outlookAccounts: accounts };
  });

  // Auth-only: identify logged-in user via session cookie
  app.get("/api/me", async (req, reply) => {
    const auth = req.headers.authorization ?? "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
  
    const cookieToken = getCookie(req, "session");
    const token = bearer ?? cookieToken;
  
    if (!token) return reply.code(401).send({ ok: false, error: "Missing token" });
  
    const session = await prisma.session.findUnique({
      where: { token },
      include: { user: true },
    });
  
    if (!session) return reply.code(401).send({ ok: false, error: "Invalid session" });
    if (new Date(session.expiresAt).getTime() < Date.now())
      return reply.code(401).send({ ok: false, error: "Session expired" });
  
    return reply.send({
      ok: true,
      email: session.user.email,
      inboxConnected: false,
    });
  });

  // Optional debug: Get connected Outlook user identity (NO inbox reading)
  app.get("/debug/outlook/me", async (_req, reply) => {
    const tokenRow = await prisma.outlookToken.findFirst({
      orderBy: { updatedAt: "desc" },
      include: { outlookAccount: true },
    });

    if (!tokenRow) return reply.code(400).send({ ok: false, error: "No stored Outlook token yet" });

    const res = await request("https://graph.microsoft.com/v1.0/me", {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenRow.accessToken}` },
    });

    const body = await res.body.json();

    if (res.statusCode >= 400) {
      return reply.code(res.statusCode).send({ ok: false, error: "Graph /me failed", details: body });
    }

    const email = (body as any).mail ?? (body as any).userPrincipalName ?? null;
    const displayName = (body as any).displayName ?? null;

    // update placeholder (later we will do this during callback automatically)
    await prisma.outlookAccount.update({
      where: { id: tokenRow.outlookAccountId },
      data: { userEmail: email ?? tokenRow.outlookAccount.userEmail },
    });

    return reply.send({ ok: true, email, displayName });
  });

  // Start Outlook OAuth
  app.get("/auth/outlook/start", async (_req, reply) => {
    const state = Math.random().toString(36).slice(2);
    const url = getAuthorizeUrl(state);
    return reply.redirect(url);
  });
  
// Debug: Get frontend URL
  app.get("/debug/frontend", async () => {
    return {
      FRONTEND_URL: process.env.FRONTEND_URL ?? null,
    };
  });
// Debug: Get environment variables
  app.get("/debug/env", async () => ({
    FRONTEND_URL: process.env.FRONTEND_URL ?? null,
    OUTLOOK_REDIRECT_URI: process.env.OUTLOOK_REDIRECT_URI ?? null,
  }));

  // Outlook OAuth callback: store tokens + create session + redirect to frontend
  app.get("/auth/outlook/callback", async (req, reply) => {
    const { code } = req.query as { code?: string };

    if (!code) return reply.code(400).send({ ok: false, error: "Missing code" });

    const tokenResponse = await oauthClient.getToken({
      code,
      redirect_uri: process.env.OUTLOOK_REDIRECT_URI!,
      scope: scopes.join(" "),
    });

    const accessToken = tokenResponse.token.access_token as string;
    const refreshToken = tokenResponse.token.refresh_token as string | undefined;
    const expiresIn = Number(tokenResponse.token.expires_in ?? 3600);

    if (!accessToken || !refreshToken) {
      return reply.code(500).send({ ok: false, error: "Token exchange failed" });
    }

  // Resolve real Outlook user identity
let realEmail = "unknown@outlook";
let realName: string | null = null;

try {
  const res = await request(
    "https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName",
    {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  const body = await res.body.json();

  if (res.statusCode < 400) {
    realName = (body as any).displayName ?? null;
    realEmail =
      (body as any).mail ??
      (body as any).userPrincipalName ??
      "unknown@outlook";
  } else {
    app.log.warn({ body }, "Graph /me failed during OAuth callback");
  }
} catch (err) {
  app.log.warn({ err }, "Graph /me exception during OAuth callback");
}

    // User record
    const user = await prisma.user.upsert({
      where: { email: realEmail },
      update: {},
      create: { email: realEmail },
    });

    // Outlook account + tokens
    const account = await prisma.outlookAccount.upsert({
      where: { userEmail: realEmail },
      update: { tenantId: process.env.OUTLOOK_TENANT ?? undefined },
      create: { userEmail: realEmail, tenantId: process.env.OUTLOOK_TENANT ?? undefined },
    });

    await prisma.outlookToken.upsert({
      where: { outlookAccountId: account.id },
      update: {
        accessToken,
        refreshToken,
        expiresAt: new Date(Date.now() + expiresIn * 1000),
        scope: scopes.join(" "),
      },
      create: {
        outlookAccountId: account.id,
        accessToken,
        refreshToken,
        expiresAt: new Date(Date.now() + expiresIn * 1000),
        scope: scopes.join(" "),
      },
    });



    // Session cookie
    const sessionToken = nanoid(32);
    await prisma.session.create({
      data: {
        userId: user.id,
        token: sessionToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const frontend = process.env.FRONTEND_URL ?? "http://localhost:3000";
  return reply.redirect(`${frontend}/CommandCenter#token=${sessionToken}`);
  });

  await app.listen({ port: PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});