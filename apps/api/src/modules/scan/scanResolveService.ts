import { isClientRole, parseOrderQrPayload, ROLES } from "@sample-room/shared";
import { HttpError } from "../../shared/errors/httpError.js";
import type { CurrentUser } from "../auth/currentUser.js";
import type { ScanWorkflowService } from "./scanService.js";

export type ScanResolveContext = {
  currentUser?: CurrentUser | undefined;
  testIdentity?: boolean | undefined;
};

const executableWorkerActions = new Set([
  "start",
  "complete",
  "takeover"
]);

export class ScanResolveService {
  constructor(private readonly scanWorkflowService: ScanWorkflowService) {}

  async resolve(payload: unknown, context: ScanResolveContext) {
    // Client accounts are rejected before parsing or token lookup, so same-customer
    // and cross-customer scans have the same non-disclosing response.
    if (context.currentUser && isClientRole(context.currentUser.role)) {
      throw new HttpError(403, "forbidden");
    }

    let parsed;
    try {
      if (typeof payload !== "string") throw new Error("invalid_order_qr_payload");
      parsed = parseOrderQrPayload(payload);
    } catch {
      throw new HttpError(400, "invalid_order_qr_payload");
    }

    if (context.currentUser) {
      if (context.currentUser.role === ROLES.worker) {
        const workerState = await this.scanWorkflowService.getScanState(
          parsed.token,
          context.currentUser
        );
        const { thumbnailUrl: _tokenBearingThumbnailUrl, ...order } = workerState.order;
        const safeState = { ...workerState, order };
        return {
          parsed: { version: parsed.version, type: parsed.type, sourceFormat: parsed.sourceFormat },
          actor: workerState.worker
            ? {
                kind: "worker" as const,
                role: workerState.worker.stage,
                accountId: context.currentUser.accountId ?? context.currentUser.id,
                workerProfileId: workerState.worker.id
              }
            : { kind: "worker" as const },
          order,
          allowedActions: executableWorkerActions.has(workerState.allowedAction)
            ? [workerState.allowedAction]
            : [],
          state: safeState
        };
      }
      const accountState = await this.scanWorkflowService.getAccountScanState(
        parsed.token,
        context.currentUser
      );
      return {
        parsed: {
          version: parsed.version,
          type: parsed.type,
          sourceFormat: parsed.sourceFormat
        },
        actor: { kind: "account" as const, role: context.currentUser.role },
        ...accountState
      };
    }

    throw new HttpError(401, "unauthenticated");
  }

  async resolveMiniappReadOnly(input: { payload?: unknown; token?: unknown }) {
    const candidate = typeof input.payload === "string"
      ? input.payload
      : typeof input.token === "string"
        ? `SRS2|ORDER|${input.token}`
        : undefined;

    let parsed;
    try {
      if (!candidate) throw new Error("invalid_order_qr_payload");
      parsed = parseOrderQrPayload(candidate);
      if (parsed.version !== "SRS2" || parsed.sourceFormat !== "plain_text") {
        throw new Error("invalid_order_qr_payload");
      }
    } catch {
      throw new HttpError(400, "invalid_order_qr_payload");
    }

    return {
      objectType: "order" as const,
      ...(await this.scanWorkflowService.getMiniappReadOnlyState(parsed.token)),
      readOnly: true as const
    };
  }
}
