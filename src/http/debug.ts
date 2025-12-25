import type { FastifyInstance } from "fastify";
import { request } from "undici";
import { prisma } from "../prisma";

export async function registerDebug(app: FastifyInstance) {
  app.get("/debug/db", async () => {
    const accounts = await prisma.outlookAccount.count();
    return { ok: true, outlookAccounts: accounts };
  });

  app.get("/debug/frontend", async () => {
    return { FRONTEND_URL: process.env.FRONTEND_URL ?? null };
  });

  app.get("/debug/env", async () => ({
    FRONTEND_URL: process.env.FRONTEND_URL ?? null,
    OUTLOOK_REDIRECT_URI: process.env.OUTLOOK_REDIRECT_URI ?? null,
  }));

  // Optional debug: Get connected Outlook user identity (NO inbox reading)
  app.get("/debug/outlook/me", async (_req, reply) => {
    const tokenRow = await prisma.outlookToken.findFirst({
      orderBy: { updatedAt: "desc" },
      include: { outlookAccount: true },
    });

    if (!tokenRow)
      return reply.code(400).send({ ok: false, error: "No stored Outlook token yet" });

    const res = await request("https://graph.microsoft.com/v1.0/me", {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenRow.accessToken}` },
    });

    const body = await res.body.json();

    if (res.statusCode >= 400) {
      return reply.code(res.statusCode).send({
        ok: false,
        error: "Graph /me failed",
        details: body,
      });
    }

    const email = (body as any).mail ?? (body as any).userPrincipalName ?? null;
    const displayName = (body as any).displayName ?? null;

    await prisma.outlookAccount.update({
      where: { id: tokenRow.outlookAccountId },
      data: { userEmail: email ?? tokenRow.outlookAccount.userEmail },
    });

    return reply.send({ ok: true, email, displayName });
  });
}