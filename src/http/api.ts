import type { FastifyInstance } from "fastify";
import { prisma } from "../prisma";
import { getCookie } from "../lib/cookies";

export async function registerApi(app: FastifyInstance) {
  // Auth-only: identify logged-in user via bearer OR cookie
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
}