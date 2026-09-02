import type { Request } from "express";

export function miniappSessionToken(req: Request) {
  const authorization = req.header("authorization");
  if (!authorization?.startsWith("Bearer ")) return "";
  return authorization.slice(7).trim();
}
