import type {
  AccountStatus,
  Role,
  WorkerProfileStatus,
  WorkerType
} from "@sample-room/shared";

export type PerformanceStage =
  | "pattern"
  | "cutting"
  | "sewing"
  | "receiver"
  | "finishing"
  | "qc_delivery";

export type PerformanceQuery = {
  month?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  stage?: PerformanceStage | undefined;
  accountId?: string | undefined;
  workerProfileId?: string | undefined;
  q?: string | undefined;
  includeOrderDetails?: boolean | undefined;
};

export type PerformanceEmployeeRow = {
  employeeName: string;
  accountId: string;
  role: Role;
  accountStatus?: AccountStatus | undefined;
  workerProfileId?: string | undefined;
  workerType?: WorkerType | undefined;
  workerProfileStatus?: WorkerProfileStatus | undefined;
  stage: Exclude<PerformanceStage, "finishing">;
  completedStyles: number;
  completedOrders: number;
  completedPieces: number;
  totalHours: number;
  averageHoursPerStyle?: number | undefined;
  averageHoursPerOrder?: number | undefined;
  averageHoursPerPiece?: number | undefined;
  internalStageAmount: number;
  unallocatedInternalStageAmount: number;
  averageInternalAmountPerStyle?: number | undefined;
  averageInternalAmountPerOrder?: number | undefined;
  completedPatternTasks?: number | undefined;
  involvedOrders?: number | undefined;
  hourlyOutput?: number | null | undefined;
  averageQualityScore?: number | null | undefined;
  unratedOrders?: number | undefined;
  reworkRate?: number | undefined;
  formalOrders?: number | undefined;
  checkedPieces?: number | undefined;
  complaintOrders?: number | undefined;
  complaintRate?: number | undefined;
};

export type PerformanceRoleSummary = {
  pattern: { completedPatternTasks: number; involvedOrders: number };
  cutting: { completedOrders: number; completedPieces: number };
  sewing: {
    completedOrders: number;
    completedPieces: number;
    totalHours: number;
    hourlyOutput: number | null;
    averageQualityScore: number | null;
    unratedOrders: number;
    reworkRate: number;
  };
  receiver: { formalOrders: number };
  finishing: {
    completedOrders: number;
    completedPieces: number | null;
    amount: number | null;
    averageAmountPerPricedOrder: number | null;
    averageAmountPerPricedPiece: number | null;
    missingAmountOrders: number;
  };
  qcDelivery: {
    completedOrders: number;
    checkedPieces: number;
    complaintOrders: number;
    complaintRate: number;
  };
};

export type PerformancePieceCorrectionLog = {
  changedAt: string;
  changedByRole: Role;
  changedByAccountId: string;
  changedByName?: string | undefined;
  oldValue: number | null;
  newValue: number | null;
};

export type PerformanceOrderRow = {
  orderId: string;
  orderNo: string;
  folderCode: string;
  styleNo: string;
  styleName: string;
  customerName: string;
  salespersonName: string;
  stage: PerformanceStage;
  employeeName?: string | undefined;
  completedAt: string;
  pieces: number | null;
  workHours: number | null;
  pieceCorrections?: PerformancePieceCorrectionLog[] | undefined;
  qualityScore?: number | null | undefined;
  reworkCount?: number | undefined;
  complaintCount?: number | undefined;
  internalStageAmount: number | null;
  internalCost: number | null;
  costAttribution:
    | "employee"
    | "unallocated_multiple_completion_records"
    | "unallocated_missing_employee"
    | "not_applicable";
  latestCompletion: {
    source: "pattern_task" | "scan_record";
    recordId: string;
    eventTime: string;
    accountId?: string | undefined;
    role?: Role | undefined;
    workerProfileId?: string | undefined;
    workerType?: WorkerType | undefined;
    employeeName?: string | undefined;
  };
};

export type PerformanceAnomaly = {
  orderId: string;
  orderNo: string;
  stage: PerformanceStage;
  code: "multiple_completion_records" | "sewing_pieces_missing";
  recordCount?: number | undefined;
};
