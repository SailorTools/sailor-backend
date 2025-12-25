export function requireEnv(name: string) {
    const v = process.env[name];
    if (!v) throw new Error(`${name} is missing in .env`);
    return v;
  }