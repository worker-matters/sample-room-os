import { Router, type Request, type Response } from "express";
import type { AuthMode } from "./authMode.js";
import type { AccountSecurityService } from "./accountSecurityService.js";
import type { FormalAuthService } from "./authService.js";
import { toAuthenticatedUserDto } from "./authTypes.js";
import { authSessionCookieName, extractAuthToken } from "./sessionStore.js";
import { HttpError } from "../../shared/errors/httpError.js";
import type { LoginProtectionService } from "./loginProtectionService.js";

function requireCurrentUser(req: Request) {
  if (!req.currentUser) {
    throw new HttpError(401, "unauthenticated");
  }

  return req.currentUser;
}

export function createAuthRouter(
  authMode: AuthMode,
  authService: FormalAuthService,
  accountSecurityService: AccountSecurityService,
  loginProtectionService: LoginProtectionService
) {
  const router = Router();

  router.post("/login", async (req, res) => {
    if (authMode !== "formal") {
      throw new HttpError(400, "formal_auth_disabled");
    }

    const result = await loginProtectionService.execute(req, "web", req.body, () =>
      authService.login(req.body, {
        userAgent: req.header("user-agent"),
        appVersion: req.header("x-app-version")
      })
    );
    res.cookie(authSessionCookieName(), result.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: req.secure,
      path: "/"
    });
    res.json(result);
  });

  router.get("/me", (req, res) => {
    res.json({ user: toAuthenticatedUserDto(requireCurrentUser(req)) });
  });

  router.post("/refresh", async (req, res) => {
    const result = await authService.refresh(extractAuthToken(req));
    res.cookie(authSessionCookieName(), result.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: req.secure,
      path: "/"
    });
    res.json(result);
  });

  router.post("/android-biometric-session", async (req, res) => {
    const result = await authService.refreshAndroidBiometricSession(extractAuthToken(req));
    res.json(result);
  });

  router.get("/account-security", async (req, res) => {
    res.json({ profile: await accountSecurityService.getProfile(requireCurrentUser(req)) });
  });

  const updateAccountProfile = async (req: Request, res: Response) => {
    const currentUser = requireCurrentUser(req);
    const previousProfile = await accountSecurityService.getProfile(currentUser);
    const profile = await accountSecurityService.updateOwnProfile(currentUser, req.body);
    const signedOut =
      profile.username !== previousProfile.username ||
      profile.phoneNumber !== previousProfile.phoneNumber;
    if (signedOut) {
      await authService.logout(extractAuthToken(req));
      res.clearCookie(authSessionCookieName(), { path: "/" });
    }
    res.json({ profile, signedOut });
  };
  router.patch("/account-security/profile", updateAccountProfile);
  // WeChat wx.request does not support PATCH on all supported runtimes.
  // This POST alias executes the identical authenticated profile update.
  router.post("/account-security/profile", updateAccountProfile);

  router.post("/change-password", async (req, res) => {
    const result = await accountSecurityService.changePassword(requireCurrentUser(req), req.body);
    await authService.logout(extractAuthToken(req));
    res.clearCookie(authSessionCookieName(), { path: "/" });
    res.json(result);
  });

  router.post("/logout", async (req, res) => {
    await authService.logout(extractAuthToken(req));
    res.clearCookie(authSessionCookieName(), { path: "/" });
    res.json({ ok: true });
  });

  return router;
}
