import { z } from 'zod';

export type AppRole = 'SUPER_ADMIN' | 'FACTORY_ADMIN' | 'QUALITY_ENGINEER' | 'OPERATOR';

export interface UserProfile {
  id: number;
  uid: string;
  email: string;
  displayName: string;
  role: AppRole;
  accountStatus: 'ACTIVE' | 'PENDING_APPROVAL' | 'SUSPENDED';
  emailVerified: boolean;
  authorizedFactoryIds: number[];
  createdAt?: string;
}

export interface FactoryRecord {
  id: number;
  code: string;
  name: string;
  sector: string;
  location: string;
  subscriptionTier: 'PILOT' | 'GROWTH' | 'ENTERPRISE';
  status: string;
  isSimulated: boolean;
  createdAt: string;
}

export interface PerturbationResult {
  name: string;
  type: string;
  severityParam: string;
  predictedDefect: string;
  confidence: number;
  confidenceDelta: number;
  consistent: boolean;
}

export interface InspectionRecord {
  id: number;
  passportCode: string;
  factoryId: number;
  factoryName?: string;
  factoryCode?: string;
  inspectorUid: string;
  sector: string;
  lineName: string;
  batchNumber: string;
  componentSerial: string;
  imageUrl: string;
  defectType: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'PASS';
  cvConfidence: number;
  anomalyScore: number;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
    label: string;
  };
  cvMetrics: {
    edgeDensity: number;
    contrastVariance: number;
    luminanceMean: number;
    anomalyEnergy: number;
    sobelPeak: number;
    engineVersion: string;
  };
  reliabilityScore: number;
  reliabilityStatus: 'RELIABLE' | 'REVIEW_REQUIRED' | 'UNSTABLE';
  perturbationResults: PerturbationResult[];
  geminiReport: string | null;
  humanReviewStatus: 'UNREVIEWED' | 'CONFIRMED' | 'FALSE_POSITIVE' | 'RECLASSIFIED';
  humanLabel: string | null;
  humanNotes: string | null;
  reviewedByUid: string | null;
  reviewedAt: string | null;
  isSimulated: boolean;
  createdAt: string;
}

export interface CounterfactualScenarioRecord {
  id: number;
  factoryId: number;
  inspectionId: number | null;
  createdByUid: string;
  title: string;
  targetDefect: string;
  baselineParams: Record<string, number>;
  counterfactualParams: Record<string, number>;
  baselineDefectProb: number;
  predictedDefectProb: number;
  riskDeltaPct: number;
  sensitivityBreakdown: Array<{
    parameter: string;
    contributionPct: number;
    direction: string;
  }>;
  aiInvestigationSummary: string | null;
  isSimulated: boolean;
  createdAt: string;
}

export interface MaintenanceForecastRecord {
  id: number;
  factoryId: number;
  equipmentCode: string;
  equipmentName: string;
  lineName: string;
  healthScore: number;
  failureProb7d: number;
  failureProb30d: number;
  rulHours: number;
  primaryRiskFactor: string;
  recommendedAction: string;
  status: 'NOMINAL' | 'WATCH' | 'MAINTENANCE_REQUIRED' | 'SCHEDULED';
  lastServicedAt: string;
  isSimulated: boolean;
  updatedAt: string;
}

export interface BillingRecordItem {
  id: number;
  factoryId: number;
  tier: string;
  monthlyAmountUsd: number;
  billingPeriod: string;
  status: string;
  invoiceRef: string;
  createdAt: string;
}

export interface SecurityAuditRecord {
  id: number;
  requestId: string;
  actorUid: string;
  actorEmail: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  factoryId: number | null;
  outcome: 'ALLOW' | 'DENY' | 'ERROR';
  details: string;
  createdAt: string;
}

export interface ManagedUserRecord {
  id: number;
  uid: string;
  email: string;
  displayName: string;
  role: AppRole;
  accountStatus: 'ACTIVE' | 'PENDING_APPROVAL' | 'SUSPENDED';
  emailVerified: boolean;
  createdAt: string;
  factoryIds: number[];
}

export interface InvitationRecord {
  id: number;
  email: string;
  factoryId: number;
  assignedRole: AppRole;
  invitedByUid: string;
  status: string;
  expiresAt: string;
  createdAt: string;
}

// Zod validation schemas for API payloads
export const feedbackSubmissionSchema = z.object({
  humanReviewStatus: z.enum(['CONFIRMED', 'FALSE_POSITIVE', 'RECLASSIFIED']),
  humanLabel: z.string().trim().min(2).max(80).optional(),
  humanNotes: z.string().trim().max(600).optional(),
});

export const counterfactualCreateSchema = z.object({
  factoryId: z.coerce.number().int().positive(),
  inspectionId: z.coerce.number().int().positive().nullable().optional(),
  title: z.string().trim().min(3).max(120),
  targetDefect: z.string().trim().min(2).max(80),
  baselineParams: z.record(z.string(), z.number().finite()),
  counterfactualParams: z.record(z.string(), z.number().finite()),
  includeGeminiBrief: z.boolean().optional(),
});

export const createFactorySchema = z.object({
  code: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[A-Z0-9_]+$/, 'Factory code must use uppercase letters, digits, or underscores.'),
  name: z.string().trim().min(3).max(120),
  sector: z.enum([
    'Electronics & Semiconductor',
    'Automotive Components',
    'Automotive Electronics',
  ]),
  location: z.string().trim().min(2).max(120),
  subscriptionTier: z.enum(['PILOT', 'GROWTH', 'ENTERPRISE']),
  isSimulated: z.boolean().default(true),
});

export const createInvitationSchema = z.object({
  email: z.string().trim().email(),
  factoryId: z.coerce.number().int().positive(),
  assignedRole: z.enum(['FACTORY_ADMIN', 'QUALITY_ENGINEER', 'OPERATOR']),
});

export const updateUserGovernanceSchema = z.object({
  role: z.enum(['SUPER_ADMIN', 'FACTORY_ADMIN', 'QUALITY_ENGINEER', 'OPERATOR']).optional(),
  accountStatus: z.enum(['ACTIVE', 'PENDING_APPROVAL', 'SUSPENDED']).optional(),
  factoryIds: z.array(z.number().int().positive()).optional(),
});

export const updateFactoryTierSchema = z.object({
  subscriptionTier: z.enum(['PILOT', 'GROWTH', 'ENTERPRISE']),
  monthlyAmountUsd: z.coerce.number().int().min(0).max(50000),
});

export const DASHBOARD_TAB_IDS = [
  'overview',
  'inspection',
  'twin',
  'cross-factory',
  'feedback',
  'maintenance',
  'governance',
] as const;

export type DashboardTabId = (typeof DASHBOARD_TAB_IDS)[number];

export const dashboardAssistantSchema = z.object({
  activeTab: z.enum(DASHBOARD_TAB_IDS),
  factoryId: z.coerce.number().int().positive().nullable().optional(),
  mode: z.enum(['explain_dashboard', 'chat']).default('chat'),
  focusWidget: z.string().trim().max(100).optional(),
  message: z.string().trim().max(1500).optional(),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(2500),
      })
    )
    .max(12)
    .optional(),
});

export interface AssistantChatResponse {
  reply: string;
  dashboardLabel: string;
  scopeLabel: string;
  generatedAt: string;
}

