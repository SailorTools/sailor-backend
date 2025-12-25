import type { FastifyInstance } from "fastify";

export async function registerHealth(app: FastifyInstance) {
  app.get("/health", async () => ({ ok: true, service: "sailor-backend" }));
}