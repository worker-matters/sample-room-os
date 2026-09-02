import type { AttachmentRepository } from "./attachmentRepositoryContract.js";
import type { BusinessUserRequestRepository } from "./businessUserRequestRepositoryContract.js";
import type { ClientUserRepository } from "./clientUserRepositoryContract.js";
import type { CustomerRepository } from "./customerRepositoryContract.js";
import type {
  BackupRepository,
  OperationLogRepository,
  ScanRecordRepository,
  SystemSettingRepository
} from "./futureRepositoryContracts.js";
import type { OrderCorrectionLogRepository } from "./orderCorrectionLogRepositoryContract.js";
import type { OrderRepository } from "./orderRepositoryContract.js";
import type {
  AccountRepository,
  AccountSessionRepository,
  IdentityQrTokenRepository,
  IdentityRepositorySet,
  WorkerProfileRepository
} from "./identityRepositoryContract.js";

export interface RepositoryContext {
  accounts: AccountRepository;
  workerProfiles: WorkerProfileRepository;
  accountSessions: AccountSessionRepository;
  identityQrTokens: IdentityQrTokenRepository;
  withIdentityTransaction<T>(
    operation: (repositories: IdentityRepositorySet) => Promise<T>
  ): Promise<T>;
  orders: OrderRepository;
  customers: CustomerRepository;
  clientUsers: ClientUserRepository;
  attachments: AttachmentRepository;
  businessUserRequests: BusinessUserRequestRepository;

  // Current Alpha embeds correction logs on orders. Keep this optional until a
  // dedicated persistence task extracts correction log rows.
  orderCorrectionLogs?: OrderCorrectionLogRepository | undefined;

  // Scan/backup remain optional. System settings and operation logs are wired
  // for the explicitly approved System Owner runtime-address maintenance flow.
  scanRecords?: ScanRecordRepository | undefined;
  operationLogs?: OperationLogRepository | undefined;
  systemSettings?: SystemSettingRepository | undefined;
  backups?: BackupRepository | undefined;
}
