import cors from "cors";
import type { Express, Request } from "express";
import helmet from "helmet";
import { HttpError } from "./errors/httpError.js";
import { configuredPublicHttpsHosts, configureTrustedProxy } from "./trustedProxy.js";

function configuredCorsOrigins(env: NodeJS.ProcessEnv) {
  const origins = new Set<string>();
  if (env.NODE_ENV !== "production") {
    origins.add("http://localhost:5173");
    origins.add("http://127.0.0.1:5173");
  }

  for (const value of (env.SAMPLE_ROOM_CORS_ORIGINS ?? "").split(",")) {
    const origin = value.trim();
    if (!origin || origin === "*") continue;
    try {
      const parsed = new URL(origin);
      if (
        (parsed.protocol === "http:" || parsed.protocol === "https:") &&
        parsed.origin === origin
      ) {
        origins.add(origin);
      }
    } catch {
      // Invalid entries fail closed instead of widening CORS access.
    }
  }

  return origins;
}

function requestOrigin(req: Request) {
  const host = req.header("host");
  return host ? `${req.protocol}://${host}` : undefined;
}

export function configureHttpSecurity(app: Express, env: NodeJS.ProcessEnv) {
  app.disable("x-powered-by");
  configureTrustedProxy(app, env);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'", "ws://127.0.0.1:37989"],
        fontSrc: ["'self'", "data:"],
        formAction: ["'self'"],
        frameSrc: ["'self'", "blob:"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", "data:", "blob:"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        // The same production build is also served over factory-LAN HTTP.
        // Public HTTPS enforcement is host-scoped below; a global CSP upgrade
        // would incorrectly redirect LAN assets to unavailable HTTPS URLs.
        upgradeInsecureRequests: null
      }
    },
    frameguard: { action: "deny" },
    hsts: false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    xContentTypeOptions: true
  }));

  const hstsHosts = configuredPublicHttpsHosts(env);
  app.use((req, res, next) => {
    if (
      env.NODE_ENV === "production" &&
      req.secure &&
      hstsHosts.has(req.hostname.toLowerCase())
    ) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000");
    }
    next();
  });

  const allowedOrigins = configuredCorsOrigins(env);
  app.use((req, res, next) => {
    cors({
      credentials: true,
      origin(origin, callback) {
        if (!origin || origin === requestOrigin(req) || allowedOrigins.has(origin)) {
          callback(null, true);
          return;
        }
        callback(new HttpError(403, "cors_origin_denied"));
      }
    })(req, res, next);
  });
}
