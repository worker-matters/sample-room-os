# WeChat Mini-Program Development Rules

Read `../../docs/current/CURRENT_PROJECT_RULES.md` before every task. It is the
business-rule SSOT; this file only adds mini-program implementation guardrails.

- The mini-program is a client of the existing Account authentication and Express API.
- Business Accounts log in with username/password; Worker Accounts log in with
  phoneNumber/password. The resulting `AccountSession` uses `clientType=miniapp`.
- The API is authoritative for Account role, active WorkerProfile, permissions,
  production routes, order state, `homeRoute`, and `allowedActions`.
- Never submit `accountId`, `workerProfileId`, `role`, or `allowedActions` as trusted identity.
- Do not use device binding, raw OpenID, a Worker row, or a QR scan as an independent identity.
- Customer supervisor and customer salesperson Accounts have no order-QR workflow.
- An order QR payload is `SRS2|ORDER|<opaque-token>`.
- Worker registration QR codes open the approved Web registration URL. Customer-salesperson
  registration always opens the configured public Web URL. Neither is consumed as a
  mini-program identity-binding QR.
- Do not commit an AppSecret, real domain, IP address, key, session, customer data, or token.
- Do not add WeChat Cloud Development, a new database, a separate backend, Taro, uni-app,
  or a large UI framework.
- Preserve the existing Web/H5 `/scan/:token` compatibility path.
- Release-safe preview is presentation-only: it must never create a persona AccountSession,
  read production business data, scan orders, transfer files, or call formal write APIs.
