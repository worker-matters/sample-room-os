export type AuthMode = "dev" | "formal";

export function getAuthMode(env: NodeJS.ProcessEnv = process.env): AuthMode {
  const value = env.AUTH_MODE;

  if (!value || value === "formal") {
    return "formal";
  }

  if (value === "dev") {
    return "dev";
  }

  throw new Error(`Unsupported AUTH_MODE "${value}". Use "dev" or "formal".`);
}
