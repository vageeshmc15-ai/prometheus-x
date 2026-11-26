import { relations } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    uid: text('uid').notNull().unique(),
    email: text('email').notNull().unique(),
    displayName: text('display_name').notNull(),
    role: text('role').notNull().default('OPERATOR'), // SUPER_ADMIN | FACTORY_ADMIN | QUALITY_ENGINEER | OPERATOR
    accountStatus: text('account_status').notNull().default('PENDING_APPROVAL'), // ACTIVE | PENDING_APPROVAL | SUSPENDED
    emailVerified: boolean('email_verified').notNull().default(false),
    invitedBy: text('invited_by'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_users_role').on(table.role),
    index('idx_users_status').on(table.accountStatus),
  ]
);

export const factories = pgTable(
  'factories',
  {
    id: serial('id').primaryKey(),
    code: text('code').notNull().unique(), // FACTORY_A | FACTORY_B | FACTORY_C | custom
    name: text('name').notNull(),
    sector: text('sector').notNull(), // Electronics & Semiconductor | Automotive Components | Automotive Electronics
    location: text('location').notNull(),
    subscriptionTier: text('subscription_tier').notNull().default('ENTERPRISE'), // PILOT | GROWTH | ENTERPRISE
    status: text('status').notNull().default('ACTIVE'), // ACTIVE | MAINTENANCE | PAUSED
    isSimulated: boolean('is_simulated').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_factories_sector').on(table.sector)]
);

export const factoryMemberships = pgTable(
  'factory_memberships',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    factoryId: integer('factory_id')
      .references(() => factories.id, { onDelete: 'cascade' })
      .notNull(),
    factoryRole: text('factory_role').notNull().default('OPERATOR'), // FACTORY_ADMIN | QUALITY_ENGINEER | OPERATOR
    approved: boolean('approved').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_factory_membership_user_factory').on(table.userId, table.factoryId),
    index('idx_memberships_factory').on(table.factoryId),
  ]
);

export const invitations = pgTable(
  'invitations',
  {
    id: serial('id').primaryKey(),
    email: text('email').notNull(),
    factoryId: integer('factory_id')
      .references(() => factories.id, { onDelete: 'cascade' })
      .notNull(),
    assignedRole: text('assigned_role').notNull().default('OPERATOR'),
    invitedByUid: text('invited_by_uid').notNull(),
    status: text('status').notNull().default('PENDING'), // PENDING | ACCEPTED | REVOKED
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_invitations_email').on(table.email)]
);

export const inspections = pgTable(
  'inspections',
  {
    id: serial('id').primaryKey(),
    passportCode: text('passport_code').notNull().unique(),
    factoryId: integer('factory_id')
      .references(() => factories.id, { onDelete: 'cascade' })
      .notNull(),
    inspectorUid: text('inspector_uid').notNull(),
    sector: text('sector').notNull(),
    lineName: text('line_name').notNull(),
    batchNumber: text('batch_number').notNull(),
    componentSerial: text('component_serial').notNull(),
    imageUrl: text('image_url').notNull(),
    defectType: text('defect_type').notNull(),
    severity: text('severity').notNull(), // CRITICAL | HIGH | MEDIUM | LOW | PASS
    cvConfidence: doublePrecision('cv_confidence').notNull(),
    anomalyScore: doublePrecision('anomaly_score').notNull(),
    boundingBox: jsonb('bounding_box').$type<{
      x: number;
      y: number;
      width: number;
      height: number;
      label: string;
    }>().notNull(),
    cvMetrics: jsonb('cv_metrics').$type<{
      edgeDensity: number;
      contrastVariance: number;
      luminanceMean: number;
      anomalyEnergy: number;
      sobelPeak: number;
      engineVersion: string;
    }>().notNull(),
    reliabilityScore: doublePrecision('reliability_score').notNull(),
    reliabilityStatus: text('reliability_status').notNull(), // RELIABLE | REVIEW_REQUIRED | UNSTABLE
    perturbationResults: jsonb('perturbation_results').$type<
      Array<{
        name: string;
        type: string;
        severityParam: string;
        predictedDefect: string;
        confidence: number;
        confidenceDelta: number;
        consistent: boolean;
      }>
    >().notNull(),
    geminiReport: text('gemini_report'),
    humanReviewStatus: text('human_review_status').notNull().default('UNREVIEWED'), // UNREVIEWED | CONFIRMED | FALSE_POSITIVE | RECLASSIFIED
    humanLabel: text('human_label'),
    humanNotes: text('human_notes'),
    reviewedByUid: text('reviewed_by_uid'),
    reviewedAt: timestamp('reviewed_at'),
    isSimulated: boolean('is_simulated').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_inspections_factory').on(table.factoryId),
    index('idx_inspections_defect').on(table.defectType),
    index('idx_inspections_created').on(table.createdAt),
  ]
);

export const counterfactualScenarios = pgTable(
  'counterfactual_scenarios',
  {
    id: serial('id').primaryKey(),
    factoryId: integer('factory_id')
      .references(() => factories.id, { onDelete: 'cascade' })
      .notNull(),
    inspectionId: integer('inspection_id').references(() => inspections.id, {
      onDelete: 'set null',
    }),
    createdByUid: text('created_by_uid').notNull(),
    title: text('title').notNull(),
    targetDefect: text('target_defect').notNull(),
    baselineParams: jsonb('baseline_params').$type<Record<string, number>>().notNull(),
    counterfactualParams: jsonb('counterfactual_params').$type<Record<string, number>>().notNull(),
    baselineDefectProb: doublePrecision('baseline_defect_prob').notNull(),
    predictedDefectProb: doublePrecision('predicted_defect_prob').notNull(),
    riskDeltaPct: doublePrecision('risk_delta_pct').notNull(),
    sensitivityBreakdown: jsonb('sensitivity_breakdown').$type<
      Array<{ parameter: string; contributionPct: number; direction: string }>
    >().notNull(),
    aiInvestigationSummary: text('ai_investigation_summary'),
    isSimulated: boolean('is_simulated').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_counterfactual_factory').on(table.factoryId)]
);

export const maintenanceForecasts = pgTable(
  'maintenance_forecasts',
  {
    id: serial('id').primaryKey(),
    factoryId: integer('factory_id')
      .references(() => factories.id, { onDelete: 'cascade' })
      .notNull(),
    equipmentCode: text('equipment_code').notNull().unique(),
    equipmentName: text('equipment_name').notNull(),
    lineName: text('line_name').notNull(),
    healthScore: doublePrecision('health_score').notNull(),
    failureProb7d: doublePrecision('failure_prob_7d').notNull(),
    failureProb30d: doublePrecision('failure_prob_30d').notNull(),
    rulHours: integer('rul_hours').notNull(),
    primaryRiskFactor: text('primary_risk_factor').notNull(),
    recommendedAction: text('recommended_action').notNull(),
    status: text('status').notNull().default('NOMINAL'), // NOMINAL | WATCH | MAINTENANCE_REQUIRED | SCHEDULED
    lastServicedAt: timestamp('last_serviced_at').defaultNow().notNull(),
    isSimulated: boolean('is_simulated').notNull().default(true),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('idx_maintenance_factory').on(table.factoryId)]
);

export const billingRecords = pgTable(
  'billing_records',
  {
    id: serial('id').primaryKey(),
    factoryId: integer('factory_id')
      .references(() => factories.id, { onDelete: 'cascade' })
      .notNull(),
    tier: text('tier').notNull(),
    monthlyAmountUsd: integer('monthly_amount_usd').notNull(),
    billingPeriod: text('billing_period').notNull(),
    status: text('status').notNull().default('PAID'), // PAID | PENDING
    invoiceRef: text('invoice_ref').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_billing_factory').on(table.factoryId)]
);

export const securityAuditLogs = pgTable(
  'security_audit_logs',
  {
    id: serial('id').primaryKey(),
    requestId: text('request_id').notNull(),
    actorUid: text('actor_uid').notNull(),
    actorEmail: text('actor_email').notNull(),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    factoryId: integer('factory_id'),
    outcome: text('outcome').notNull(), // ALLOW | DENY | ERROR
    details: text('details').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_audit_created').on(table.createdAt)]
);

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(factoryMemberships),
}));

export const factoriesRelations = relations(factories, ({ many }) => ({
  memberships: many(factoryMemberships),
  inspections: many(inspections),
  counterfactualScenarios: many(counterfactualScenarios),
  maintenanceForecasts: many(maintenanceForecasts),
  billingRecords: many(billingRecords),
}));

export const factoryMembershipsRelations = relations(factoryMemberships, ({ one }) => ({
  user: one(users, {
    fields: [factoryMemberships.userId],
    references: [users.id],
  }),
  factory: one(factories, {
    fields: [factoryMemberships.factoryId],
    references: [factories.id],
  }),
}));

export const inspectionsRelations = relations(inspections, ({ one }) => ({
  factory: one(factories, {
    fields: [inspections.factoryId],
    references: [factories.id],
  }),
}));

export const counterfactualScenariosRelations = relations(counterfactualScenarios, ({ one }) => ({
  factory: one(factories, {
    fields: [counterfactualScenarios.factoryId],
    references: [factories.id],
  }),
  inspection: one(inspections, {
    fields: [counterfactualScenarios.inspectionId],
    references: [inspections.id],
  }),
}));

export const maintenanceForecastsRelations = relations(maintenanceForecasts, ({ one }) => ({
  factory: one(factories, {
    fields: [maintenanceForecasts.factoryId],
    references: [factories.id],
  }),
}));

export const billingRecordsRelations = relations(billingRecords, ({ one }) => ({
  factory: one(factories, {
    fields: [billingRecords.factoryId],
    references: [factories.id],
  }),
}));
