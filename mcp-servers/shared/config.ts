import "dotenv/config";

/** Read a required env var (with optional fallback). Throws if missing. */
export function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing required env var: ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

/** Read an optional env var. */
export function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value === "" ? undefined : value;
}

/** Read an integer env var with a fallback. */
export function intEnv(name: string, fallback: number): number {
  const parsed = parseInt(process.env[name] ?? "", 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}
