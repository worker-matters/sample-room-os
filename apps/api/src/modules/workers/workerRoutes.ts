import { Router } from "express";
import { ROLES } from "@sample-room/shared";
import { requireRoles } from "../auth/currentUser.js";
import type { WorkerIdentityService } from "./workerIdentityService.js";

function routeId(value: string | string[] | undefined) {
  if (typeof value !== "string") throw new Error("route id is required");
  return value;
}

export function createWorkerRouter(workerIdentityService: WorkerIdentityService) {
  const router = Router();
  const bossOrSystemOwner = requireRoles(ROLES.boss, ROLES.systemOwner);

  router.get("/", bossOrSystemOwner, async (req, res) => {
    res.json({ workers: await workerIdentityService.listWorkers(req.currentUser!) });
  });

  router.post("/registration-tokens", bossOrSystemOwner, async (req, res) => {
    res.status(201).json(
      await workerIdentityService.issueWorkerRegistration(req.currentUser!, req.body)
    );
  });

  router.get("/identity-tokens", bossOrSystemOwner, async (req, res) => {
    res.json({ tokens: await workerIdentityService.listIdentityTokens(req.currentUser!) });
  });

  router.delete("/identity-tokens/:tokenId", bossOrSystemOwner, async (req, res) => {
    res.json({
      token: await workerIdentityService.revokeIdentityToken(
        req.currentUser!,
        routeId(req.params.tokenId)
      )
    });
  });

  router.post("/registration/resolve", async (req, res) => {
    res.json({ registration: await workerIdentityService.registrationInfo(req.body?.payload) });
  });

  router.get("/registration/:token", async (req, res) => {
    res.json({ registration: await workerIdentityService.registrationInfo(`REGISTER|${routeId(req.params.token)}`) });
  });

  router.post("/registration/:token/complete", async (req, res) => {
    res.status(201).json(await workerIdentityService.registerWorker({ ...req.body, payload: `REGISTER|${routeId(req.params.token)}` }));
  });

  router.post("/registration/complete", async (req, res) => {
    res.status(201).json(await workerIdentityService.registerWorker(req.body));
  });

  router.post(
    "/:accountId/worker-profiles/:profileId/restore",
    bossOrSystemOwner,
    async (req, res) => {
      res.json(
        await workerIdentityService.restoreWorkerProfile(
          req.currentUser!,
          routeId(req.params.accountId),
          routeId(req.params.profileId)
        )
      );
    }
  );

  router.post("/:accountId/change-stage", bossOrSystemOwner, async (req, res) => {
    res.json(await workerIdentityService.changeWorkerStage(req.currentUser!, routeId(req.params.accountId), req.body?.workerType));
  });

  router.post("/archive", bossOrSystemOwner, async (req, res) => {
    res.json(await workerIdentityService.archiveWorkerAccounts(req.currentUser!, req.body?.accountIds));
  });

  router.patch("/:accountId", bossOrSystemOwner, async (req, res) => {
    res.json(
      await workerIdentityService.updateWorkerAccount(
        req.currentUser!,
        routeId(req.params.accountId),
        req.body
      )
    );
  });

  return router;
}
