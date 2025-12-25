import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { request } from "undici";

import { prisma } from "../prisma";
import { getCookie } from "../lib/cookies";
import { getAuthorizeUrl, oauthClient, scopes } from "../outlookAuth";

export async function registerAuth(app: FastifyInstance) {
  // Start Outlook OAuth (CONNECT INBOX flow)
  app.get("/auth/outlook/connect", async (_req, reply) => {
    const state = `connect_${Math.random().toString(36).slice(2)}`;
    const url = getAuthorizeUrl(state);
    return reply.redirect(url);
  });

  // Start Outlook OAuth (LOGIN flow)
  app.get("/auth/outlook/start", async (_req, reply) => {
    const state = `login_${Math.random().toString(36).slice(2)}`;
    const url = getAuthorizeUrl(state);
    return reply.redirect(url);
  });

  // Logout
  app.post("/auth/logout", async (req, reply) => {
    const auth = req.headers.authorization ?? "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    const cookieToken = getCookie(req, "session");
    const token = bearer ?? cookieToken;

    if (token) {
      await prisma.session.deleteMany({ where: { token } });
    }

    return reply
      .header("Set-Cookie", "session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax")
      .send({ ok: true });
  });

  // OAuth callback
  app.get("/auth/outlook/callback", async (req, reply) => {
    const { code, state } = req.query as { code?: string; state?: string };
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
        realEmail = (body as any).mail ?? (body as any).userPrincipalName ?? "unknown@outlook";
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

    // Session token
    const sessionToken = nanoid(32);
    await prisma.session.create({
      data: {
        userId: user.id,
        token: sessionToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const frontend = process.env.FRONTEND_URL ?? "http://localhost:3000";
    const nextPath = state?.startsWith("connect_") ? "/ConnectInbox" : "/CommandCenter";
    return reply.redirect(`${frontend}${nextPath}#token=${sessionToken}`);
  });
}