import type { NextFunction, Request, Response } from "express";
import type { FormalAuthService } from "./authService.js";
import { extractAuthToken } from "./sessionStore.js";

export function createFormalCurrentUserMiddleware(authService: FormalAuthService) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const currentUser = await authService.authenticate(extractAuthToken(req));
      if (currentUser) req.currentUser = currentUser;
      next();
    } catch (error) {
      next(error);
    }
  };
}
