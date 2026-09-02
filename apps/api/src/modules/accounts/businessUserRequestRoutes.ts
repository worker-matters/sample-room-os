import { Router } from "express";
import { ROLES } from "@sample-room/shared";
import { requireRoles } from "../auth/currentUser.js";
import type { BusinessUserRequestService } from "./businessUserRequestService.js";

function routeId(value: string | string[] | undefined) {
  if (typeof value !== "string") {
    throw new Error("route id is required");
  }

  return value;
}

export function createClientBusinessUserRequestRouter(
  service: BusinessUserRequestService
) {
  const router = Router();

  router.get(
    "/business-user-requests",
    requireRoles(ROLES.clientAdmin),
    async (req, res) => {
      res.json({ requests: await service.listClientRequests(req.currentUser!) });
    }
  );

  router.post(
    "/business-user-requests",
    requireRoles(ROLES.clientAdmin),
    async (req, res) => {
      const request = await service.createClientRequest(req.currentUser!, req.body);
      res.status(201).json({ request });
    }
  );

  router.get(
    "/business-users",
    requireRoles(ROLES.clientAdmin),
    async (req, res) => {
      res.json({ clientUsers: await service.listClientManagedBusinessUsers(req.currentUser!) });
    }
  );

  router.patch(
    "/business-users/:clientUserId",
    requireRoles(ROLES.clientAdmin),
    async (req, res) => {
      res.json({
        clientUser: await service.updateClientManagedBusinessUserAccount(
          req.currentUser!,
          routeId(req.params.clientUserId),
          req.body
        )
      });
    }
  );

  router.post(
    "/business-users/:clientUserId/reset-password",
    requireRoles(ROLES.clientAdmin),
    async (req, res) => {
      res.json(
        await service.resetClientManagedBusinessUserPassword(
          req.currentUser!,
          routeId(req.params.clientUserId),
          req.body
        )
      );
    }
  );

  router.patch(
    "/business-users/:clientUserId/status",
    requireRoles(ROLES.clientAdmin),
    async (req, res) => {
      res.json({
        clientUser: await service.updateClientManagedBusinessUserStatus(
          req.currentUser!,
          routeId(req.params.clientUserId),
          req.body
        )
      });
    }
  );

  router.get(
    "/business-user-registration-code",
    requireRoles(ROLES.clientAdmin),
    async (req, res) => {
      res.json({
        registration: await service.getClientBusinessUserRegistrationCode(req.currentUser!)
      });
    }
  );

  router.post(
    "/business-user-registration-code/open",
    requireRoles(ROLES.clientAdmin),
    async (req, res) => {
      res.json({
        registration: await service.openClientBusinessUserRegistrationCode(req.currentUser!)
      });
    }
  );

  router.post(
    "/business-user-registration-code/close",
    requireRoles(ROLES.clientAdmin),
    async (req, res) => {
      res.json({
        registration: await service.closeClientBusinessUserRegistrationCode(req.currentUser!)
      });
    }
  );

  router.get(
    "/business-user-registration/:token",
    async (req, res) => {
      res.json({
        registration: await service.getPublicBusinessUserRegistrationCode(routeId(req.params.token))
      });
    }
  );

  router.post(
    "/business-user-registration/:token",
    async (req, res) => {
      const request = await service.submitPublicBusinessUserRegistration(
        routeId(req.params.token),
        req.body
      );
      res.status(201).json({ request });
    }
  );

  return router;
}

export function createSystemOwnerBusinessUserRequestRouter(
  service: BusinessUserRequestService
) {
  const router = Router();

  router.get(
    "/business-user-requests",
    requireRoles(ROLES.boss, ROLES.systemOwner),
    async (req, res) => {
      res.json({ requests: await service.listAllRequests(req.currentUser!) });
    }
  );

  router.patch(
    "/business-user-requests/:id/review",
    requireRoles(ROLES.boss, ROLES.systemOwner),
    async (req, res) => {
      res.json(await service.reviewRequest(req.currentUser!, routeId(req.params.id), req.body));
    }
  );

  router.get(
    "/customer-accounts",
    requireRoles(ROLES.boss, ROLES.systemOwner),
    async (req, res) => {
      res.json({ customers: await service.listCustomerAccounts(req.currentUser!) });
    }
  );

  router.post(
    "/customer-accounts",
    requireRoles(ROLES.boss, ROLES.systemOwner),
    async (req, res) => {
      res.status(201).json({ customer: await service.createCustomer(req.currentUser!, req.body) });
    }
  );

  router.post(
    "/customer-accounts/bulk-preview",
    requireRoles(ROLES.boss, ROLES.systemOwner),
    async (req, res) => {
      res.json({ results: await service.previewBulkCustomers(req.currentUser!, req.body) });
    }
  );

  router.post(
    "/customer-accounts/bulk",
    requireRoles(ROLES.boss, ROLES.systemOwner),
    async (req, res) => {
      res.status(207).json({ results: await service.bulkCreateCustomers(req.currentUser!, req.body) });
    }
  );

  router.post(
    "/customer-accounts/:customerId/client-users",
    requireRoles(ROLES.boss, ROLES.systemOwner),
    async (req, res) => {
      res.status(201).json({
        clientUser: await service.createClientUserProfile(
          req.currentUser!,
          routeId(req.params.customerId),
          req.body
        )
      });
    }
  );

  router.post(
    "/customer-accounts/:customerId/client-users/bulk-preview",
    requireRoles(ROLES.boss, ROLES.systemOwner),
    async (req, res) => {
      res.json({
        results: await service.previewBulkClientUsers(
          req.currentUser!,
          routeId(req.params.customerId),
          req.body
        )
      });
    }
  );

  router.post(
    "/customer-accounts/:customerId/client-users/bulk",
    requireRoles(ROLES.boss, ROLES.systemOwner),
    async (req, res) => {
      res.status(207).json({
        results: await service.bulkCreateClientUsers(
          req.currentUser!,
          routeId(req.params.customerId),
          req.body
        )
      });
    }
  );

  router.patch(
    "/customer-accounts/:customerId",
    requireRoles(ROLES.boss, ROLES.systemOwner),
    async (req, res) => {
      res.json({
        customer: await service.updateCustomerAccount(
          req.currentUser!,
          routeId(req.params.customerId),
          req.body
        )
      });
    }
  );

  router.patch(
    "/customer-accounts/:customerId/status",
    requireRoles(ROLES.boss, ROLES.systemOwner),
    async (req, res) => {
      res.json({
        customer: await service.updateCustomerStatus(
          req.currentUser!,
          routeId(req.params.customerId),
          req.body
        )
      });
    }
  );

  router.patch(
    "/client-users/:clientUserId",
    requireRoles(ROLES.boss, ROLES.systemOwner),
    async (req, res) => {
      res.json({
        clientUser: await service.updateClientUserAccount(
          req.currentUser!,
          routeId(req.params.clientUserId),
          req.body
        )
      });
    }
  );

  router.post(
    "/client-users/:clientUserId/account",
    requireRoles(ROLES.boss, ROLES.systemOwner),
    async (req, res) => {
      res.status(201).json(
        await service.createClientUserLogin(
          req.currentUser!,
          routeId(req.params.clientUserId),
          req.body
        )
      );
    }
  );

  router.patch(
    "/client-users/:clientUserId/account/role",
    requireRoles(ROLES.boss, ROLES.systemOwner),
    async (req, res) => {
      res.json({
        clientUser: await service.updateClientUserLoginRole(
          req.currentUser!,
          routeId(req.params.clientUserId),
          req.body
        )
      });
    }
  );

  router.patch(
    "/client-users/:clientUserId/account/status",
    requireRoles(ROLES.boss, ROLES.systemOwner),
    async (req, res) => {
      res.json({
        clientUser: await service.updateClientUserLoginStatus(
          req.currentUser!,
          routeId(req.params.clientUserId),
          req.body
        )
      });
    }
  );

  router.post(
    "/client-users/:clientUserId/reset-password",
    requireRoles(ROLES.boss, ROLES.systemOwner),
    async (req, res) => {
      res.json(
        await service.resetClientUserPassword(
          req.currentUser!,
          routeId(req.params.clientUserId),
          req.body
        )
      );
    }
  );

  router.patch(
    "/client-users/:clientUserId/status",
    requireRoles(ROLES.boss, ROLES.systemOwner),
    async (req, res) => {
      res.json({
        clientUser: await service.updateClientUserStatus(
          req.currentUser!,
          routeId(req.params.clientUserId),
          req.body
        )
      });
    }
  );

  return router;
}
