import { Router } from "express";
import { ROLES } from "@sample-room/shared";
import { requireRoles } from "../auth/currentUser.js";
import type { InternalAccountService } from "./internalAccountService.js";

function routeId(value: string | string[] | undefined) {
  if (typeof value !== "string") {
    throw new Error("route id is required");
  }

  return value;
}

export function createInternalAccountRouter(service: InternalAccountService) {
  const router = Router();

  router.get(
    "/internal-accounts",
    requireRoles(ROLES.boss, ROLES.systemOwner),
    async (req, res) => {
      res.json({ accounts: await service.listInternalAccounts(req.currentUser!) });
    }
  );

  router.post(
    "/internal-accounts",
    requireRoles(ROLES.boss, ROLES.systemOwner),
    async (req, res) => {
      res.status(201).json(
        await service.createInternalAccount(
          req.currentUser!,
          req.body ?? {}
        )
      );
    }
  );

  router.patch(
    "/internal-accounts/:id",
    requireRoles(ROLES.boss, ROLES.systemOwner),
    async (req, res) => {
      res.json({
        account: await service.updateInternalAccount(
          req.currentUser!,
          routeId(req.params.id),
          req.body
        )
      });
    }
  );

  router.post(
    "/internal-accounts/:id/reset-password",
    requireRoles(ROLES.boss, ROLES.systemOwner),
    async (req, res) => {
      res.json(
        await service.resetInternalAccountPassword(
          req.currentUser!,
          routeId(req.params.id),
          req.body ?? {}
        )
      );
    }
  );

  return router;
}
