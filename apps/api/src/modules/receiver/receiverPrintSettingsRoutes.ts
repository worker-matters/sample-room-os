import { Router } from "express";
import { ROLES } from "@sample-room/shared";
import { requireRoles } from "../auth/currentUser.js";
import type { ReceiverPrintSettingsService } from "./receiverPrintSettingsService.js";

export function createReceiverPrintSettingsRouter(service: ReceiverPrintSettingsService) {
  const router = Router();
  const receiverOnly = requireRoles(ROLES.receiver);

  router.get("/print-settings", receiverOnly, async (req, res) => {
    res.json({ settings: await service.get(req.currentUser!) });
  });

  router.put("/print-settings", receiverOnly, async (req, res) => {
    res.json({ settings: await service.save(req.currentUser!, req.body) });
  });

  return router;
}
