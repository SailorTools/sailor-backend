import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";

const PORT = Number(process.env.PORT ?? 3005);

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is missing in .env`);
  return v;
}

import { registerHealth } from "./http/health";
import { registerDebug } from "./http/debug";
import { registerAuth } from "./http/auth";
import { registerApi } from "./http/api";

async function main() {
  requireEnv("OUTLOOK_CLIENT_ID");
  requireEnv("OUTLOOK_CLIENT_SECRET");
  requireEnv("OUTLOOK_REDIRECT_URI");

  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true, credentials: true });

  await registerHealth(app);
  await registerDebug(app);
  await registerAuth(app);
  await registerApi(app);

  await app.listen({ port: PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});