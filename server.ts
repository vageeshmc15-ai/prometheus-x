import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { db } from './src/db/index.ts';
import {
  billingRecords,
  counterfactualScenarios,
  factories,
  factoryMemberships,
  inspections,
  invitations,
  maintenanceForecasts,
  securityAuditLogs,
  users,
} from './src/db/schema.ts';
import { ensureSimulatedDataSeeded } from './src/db/seed.ts';
import {
  assertFactoryAccess,
  createSimpleSessionToken,
  requireActiveVerifiedAccount,
  requireAuth,
  requireRoles,
  syncSimpleWorkspaceUser,
  type AppRole,
  type AuthRequest,
} from './src/middleware/auth.ts';
import {
  attachRequestId,
  inspectionImageUpload,
  logSecurityEvent,
  verifyImageMagicBytes,
} from './src/middleware/security.ts';
import { runDeterministicCVInspection, SIMULATED_SAMPLES } from './src/lib/cv-engine.ts';
import { evaluateCounterfactualTwin, FACTORY_TWIN_PROFILES } from './src/lib/counterfactual-engine.ts';
import {
  generateCounterfactualBrief,
  generateCrossFactoryDigest,
  generateDashboardAssistantReply,
  generateDefectExplanation,
} from './src/lib/gemini.ts';
import {
  counterfactualCreateSchema,
  createFactorySchema,
  createInvitationSchema,
  dashboardAssistantSchema,
  feedbackSubmissionSchema,
  updateFactoryTierSchema,
  updateUserGovernanceSchema,
  type DashboardTabId,
} from './src/types/prometheus.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);

  // Security headers (iframe-compatible for AI Studio preview)
  app.use(
    helmet({
      frameguard: false,
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-origin' },
    })
  );

  // Strict CORS origin allowlist (never wildcard on authenticated routes)
  let appOrigin: string | null = null;
  if (process.env.APP_URL) {
    try {
      appOrigin = new URL(process.env.APP_URL).origin;
    } catch {
      appOrigin = null;
    }
  }
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) {
          callback(null, true);
          return;
        }
        try {
          const parsed = new URL(origin);
          const isLocal =
            parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
          const isAllowedHost =
            (appOrigin && origin === appOrigin) ||
            parsed.hostname.endsWith('.run.app') ||
            isLocal;
          if (isAllowedHost) {
            callback(null, true);
          } else {
            callback(new Error('Origin not allowed by CORS policy'));
          }
        } catch {
          callback(new Error('Invalid Origin header'));
        }
      },
      credentials: false,
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    })
  );

  app.use(attachRequestId);
  app.use(express.json({ limit: '2mb' }));

  // =========================================================================
  // SIMPLE WORKSPACE LOGIN (NO PERSONAL DATA REQUIRED) & PROFILE ROUTES
  // =========================================================================
  app.post('/api/auth/simple-login', async (req: Request, res: Response) => {
    try {
      const rawName = typeof req.body?.displayName === 'string' ? req.body.displayName : 'Shift Commander';
      const rawRole = typeof req.body?.role === 'string' ? req.body.role : 'SUPER_ADMIN';
      const allowedRoles: AppRole[] = [
        'SUPER_ADMIN',
        'FACTORY_ADMIN',
        'QUALITY_ENGINEER',
        'OPERATOR',
      ];
      const role: AppRole = allowedRoles.includes(rawRole as AppRole)
        ? (rawRole as AppRole)
        : 'SUPER_ADMIN';

      const { token, payload } = createSimpleSessionToken({
        displayName: rawName,
        role,
      });

      const dbUser = await syncSimpleWorkspaceUser(payload);
      const accessibleFactories =
        dbUser.authorizedFactoryIds.length > 0
          ? await db
              .select()
              .from(factories)
              .where(inArray(factories.id, dbUser.authorizedFactoryIds))
              .orderBy(factories.code)
          : [];

      await logSecurityEvent({
        requestId: (req as AuthRequest).requestId,
        actorUid: dbUser.uid,
        actorEmail: dbUser.email,
        action: 'SIMPLE_WORKSPACE_LOGIN',
        resourceType: 'SESSION',
        outcome: 'ALLOW',
        details: `Issued simulated workspace session for role ${dbUser.role}.`,
      });

      res.json({
        token,
        user: dbUser,
        factories: accessibleFactories,
        twinProfiles: FACTORY_TWIN_PROFILES,
      });
    } catch (error) {
      console.error('Simple login failed:', error);
      res.status(500).json({ error: 'Unable to start workspace session.' });
    }
  });

  app.get('/api/health', async (_req: Request, res: Response) => {
    try {
      const [[factoryCount], [inspectionCount], [maintenanceCount], [scenarioCount]] =
        await Promise.all([
          db.select({ value: count() }).from(factories),
          db.select({ value: count() }).from(inspections),
          db.select({ value: count() }).from(maintenanceForecasts),
          db.select({ value: count() }).from(counterfactualScenarios),
        ]);

      res.json({
        status: 'ok',
        service: 'PROMETHEUS-X Backend API',
        database: 'connected',
        timestamp: new Date().toISOString(),
        counts: {
          factories: Number(factoryCount?.value ?? 0),
          inspections: Number(inspectionCount?.value ?? 0),
          maintenanceForecasts: Number(maintenanceCount?.value ?? 0),
          counterfactualScenarios: Number(scenarioCount?.value ?? 0),
        },
        protectedEndpoints: [
          'POST /api/auth/simple-login',
          'GET /api/me',
          'GET /api/factories',
          'GET /api/samples',
          'GET /api/inspections',
          'POST /api/inspections/analyze',
          'POST /api/inspections/:id/explain',
          'PATCH /api/inspections/:id/feedback',
          'GET /api/counterfactuals',
          'POST /api/counterfactuals',
          'GET /api/maintenance',
          'POST /api/maintenance/:id/schedule',
          'GET /api/cross-factory/analytics',
          'POST /api/cross-factory/digest',
          'GET /api/admin/overview',
          'POST /api/assistant/chat',
          'GET /api/dataset/export?format=json|csv',
        ],
      });
    } catch (error) {
      console.error('Health check failed:', error);
      res.status(503).json({
        status: 'error',
        service: 'PROMETHEUS-X Backend API',
        database: 'disconnected',
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.get('/api/me', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const user = req.dbUser!;
      let accessibleFactories: Array<typeof factories.$inferSelect> = [];
      if (user.authorizedFactoryIds.length > 0) {
        accessibleFactories = await db
          .select()
          .from(factories)
          .where(inArray(factories.id, user.authorizedFactoryIds))
          .orderBy(factories.code);
      }

      res.json({
        user,
        factories: accessibleFactories,
        twinProfiles: FACTORY_TWIN_PROFILES,
      });
    } catch (error) {
      console.error('Failed to load profile:', error);
      res.status(500).json({ error: 'Unable to load authenticated user profile.' });
    }
  });

  app.get(
    '/api/dataset/export',
    requireAuth,
    requireActiveVerifiedAccount,
    async (req: AuthRequest, res: Response) => {
      try {
        const user = req.dbUser!;
        const format = req.query.format === 'csv' ? 'csv' : 'json';

        let targetFactoryIds = user.authorizedFactoryIds;
        if (req.query.factoryId !== undefined) {
          const parsedFactoryId = Number(req.query.factoryId);
          if (!Number.isInteger(parsedFactoryId) || parsedFactoryId <= 0) {
            res.status(400).json({ error: 'Invalid factoryId parameter.' });
            return;
          }
          if (!assertFactoryAccess(user, parsedFactoryId)) {
            res.status(403).json({ error: 'Access denied for this factory.' });
            return;
          }
          targetFactoryIds = [parsedFactoryId];
        }

        const [factoryRows, inspectionRows, maintRows, scenarioRows] =
          targetFactoryIds.length === 0
            ? [[], [], [], []]
            : await Promise.all([
                db
                  .select()
                  .from(factories)
                  .where(inArray(factories.id, targetFactoryIds))
                  .orderBy(factories.code),
                db
                  .select()
                  .from(inspections)
                  .where(inArray(inspections.factoryId, targetFactoryIds))
                  .orderBy(desc(inspections.createdAt)),
                db
                  .select()
                  .from(maintenanceForecasts)
                  .where(inArray(maintenanceForecasts.factoryId, targetFactoryIds))
                  .orderBy(desc(maintenanceForecasts.failureProb30d)),
                db
                  .select()
                  .from(counterfactualScenarios)
                  .where(inArray(counterfactualScenarios.factoryId, targetFactoryIds))
                  .orderBy(desc(counterfactualScenarios.createdAt)),
              ]);

        const factoryMap = new Map(factoryRows.map((f) => [f.id, f]));
        const enrichedInspections = inspectionRows.map((row) => {
          const f = factoryMap.get(row.factoryId);
          return {
            ...row,
            factoryCode: f?.code ?? 'UNKNOWN',
            factoryName: f?.name ?? 'Unknown Factory',
          };
        });

        const dateStamp = new Date().toISOString().slice(0, 10);

        if (format === 'csv') {
          const csvCell = (val: unknown): string => {
            if (val === null || val === undefined) return '';
            let str = String(val);
            if (/^[=+\-@\t\r]/.test(str)) {
              str = `'${str}`;
            }
            if (/[",\n\r]/.test(str)) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          };

          const headers = [
            'id',
            'passportCode',
            'factoryCode',
            'factoryName',
            'lineName',
            'batchNumber',
            'componentSerial',
            'defectType',
            'severity',
            'cvConfidence',
            'anomalyScore',
            'reliabilityScore',
            'reliabilityStatus',
            'humanReviewStatus',
            'humanLabel',
            'humanNotes',
            'edgeDensity',
            'contrastVariance',
            'luminanceMean',
            'anomalyEnergy',
            'sobelPeak',
            'isSimulated',
            'createdAt',
          ];

          const lines = [
            headers.join(','),
            ...enrichedInspections.map((r) =>
              [
                r.id,
                r.passportCode,
                r.factoryCode,
                r.factoryName,
                r.lineName,
                r.batchNumber,
                r.componentSerial,
                r.defectType,
                r.severity,
                r.cvConfidence,
                r.anomalyScore,
                r.reliabilityScore,
                r.reliabilityStatus,
                r.humanReviewStatus,
                r.humanLabel,
                r.humanNotes,
                r.cvMetrics?.edgeDensity,
                r.cvMetrics?.contrastVariance,
                r.cvMetrics?.luminanceMean,
                r.cvMetrics?.anomalyEnergy,
                r.cvMetrics?.sobelPeak,
                r.isSimulated,
                r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
              ]
                .map(csvCell)
                .join(',')
            ),
          ];

          res.setHeader('Content-Type', 'text/csv; charset=utf-8');
          res.setHeader(
            'Content-Disposition',
            `attachment; filename="prometheus-x-inspections-${dateStamp}.csv"`
          );
          res.send(lines.join('\n'));
          return;
        }

        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="prometheus-x-dataset-${dateStamp}.json"`
        );
        res.send(
          JSON.stringify(
            {
              dataset: 'PROMETHEUS-X Industrial Quality & Reliability Dataset',
              exportedAt: new Date().toISOString(),
              counts: {
                factories: factoryRows.length,
                inspections: enrichedInspections.length,
                maintenanceForecasts: maintRows.length,
                counterfactualScenarios: scenarioRows.length,
                simulatedSamples: SIMULATED_SAMPLES.length,
              },
              factories: factoryRows,
              inspections: enrichedInspections,
              maintenanceForecasts: maintRows,
              counterfactualScenarios: scenarioRows,
              simulatedSamples: SIMULATED_SAMPLES,
            },
            null,
            2
          )
        );
      } catch (error) {
        console.error('Dataset export failed:', error);
        res.status(500).json({ error: 'Unable to export dataset.' });
      }
    }
  );

  // =========================================================================
  // FACTORIES & SIMULATED SAMPLE CATALOG
  // =========================================================================
  app.get(
    '/api/factories',
    requireAuth,
    requireActiveVerifiedAccount,
    async (req: AuthRequest, res: Response) => {
      try {
        const user = req.dbUser!;
        if (user.authorizedFactoryIds.length === 0) {
          res.json([]);
          return;
        }
        const rows = await db
          .select()
          .from(factories)
          .where(inArray(factories.id, user.authorizedFactoryIds))
          .orderBy(factories.code);
        res.json(rows);
      } catch (error) {
        console.error('Failed to list factories:', error);
        res.status(500).json({ error: 'Unable to load factories.' });
      }
    }
  );

  app.get(
    '/api/samples',
    requireAuth,
    requireActiveVerifiedAccount,
    (_req: AuthRequest, res: Response) => {
      res.json(SIMULATED_SAMPLES);
    }
  );

  // =========================================================================
  // COMPUTER VISION INSPECTION ENGINE & DIGITAL DEFECT PASSPORTS
  // =========================================================================
  app.get(
    '/api/inspections',
    requireAuth,
    requireActiveVerifiedAccount,
    async (req: AuthRequest, res: Response) => {
      try {
        const user = req.dbUser!;
        if (user.authorizedFactoryIds.length === 0) {
          res.json([]);
          return;
        }

        let requestedFactoryId: number | null = null;
        if (req.query.factoryId !== undefined && req.query.factoryId !== '') {
          const parsedId = Number(req.query.factoryId);
          if (!Number.isInteger(parsedId) || parsedId <= 0) {
            res.status(400).json({ error: 'Invalid factoryId query parameter.' });
            return;
          }
          requestedFactoryId = parsedId;
        }
        if (requestedFactoryId && !assertFactoryAccess(user, requestedFactoryId)) {
          await logSecurityEvent({
            requestId: req.requestId,
            actorUid: user.uid,
            actorEmail: user.email,
            action: 'GET /api/inspections',
            resourceType: 'INSPECTION',
            factoryId: requestedFactoryId,
            outcome: 'DENY',
            details: 'Attempted cross-factory read outside authorized membership.',
          });
          res.status(403).json({ error: 'You do not have access to this factory.' });
          return;
        }

        const targetFactoryIds = requestedFactoryId
          ? [requestedFactoryId]
          : user.authorizedFactoryIds;

        const [factoryRows, inspectionRows] = await Promise.all([
          db.select().from(factories).where(inArray(factories.id, targetFactoryIds)),
          db
            .select()
            .from(inspections)
            .where(inArray(inspections.factoryId, targetFactoryIds))
            .orderBy(desc(inspections.createdAt))
            .limit(100),
        ]);

        const factoryMap = new Map(factoryRows.map((f) => [f.id, f]));
        const enriched = inspectionRows.map((row) => ({
          ...row,
          factoryName: factoryMap.get(row.factoryId)?.name ?? 'Unknown Factory',
          factoryCode: factoryMap.get(row.factoryId)?.code ?? 'UNKNOWN',
        }));

        res.json(enriched);
      } catch (error) {
        console.error('Failed to query inspections:', error);
        res.status(500).json({ error: 'Unable to retrieve inspection passports.' });
      }
    }
  );

  app.post(
    '/api/inspections/analyze',
    requireAuth,
    requireActiveVerifiedAccount,
    (req: AuthRequest, res: Response, next: NextFunction) => {
      inspectionImageUpload.single('image')(req, res, (err) => {
        if (err) {
          res.status(400).json({ error: err.message || 'Invalid inspection image upload.' });
          return;
        }
        next();
      });
    },
    async (req: AuthRequest, res: Response) => {
      try {
        const user = req.dbUser!;
        const factoryId = Number(req.body.factoryId);
        if (!Number.isInteger(factoryId) || factoryId <= 0) {
          res.status(400).json({ error: 'A valid target factory must be selected.' });
          return;
        }
        if (!assertFactoryAccess(user, factoryId)) {
          await logSecurityEvent({
            requestId: req.requestId,
            actorUid: user.uid,
            actorEmail: user.email,
            action: 'POST /api/inspections/analyze',
            resourceType: 'INSPECTION',
            factoryId,
            outcome: 'DENY',
            details: 'Blocked inspection submission for unauthorized factory.',
          });
          res.status(403).json({ error: 'Access denied for the specified factory.' });
          return;
        }

        const factoryRows = await db.select().from(factories).where(eq(factories.id, factoryId));
        const factory = factoryRows[0];
        if (!factory) {
          res.status(404).json({ error: 'Target factory not found.' });
          return;
        }

        const sampleId = typeof req.body.sampleId === 'string' ? req.body.sampleId.trim() : undefined;
        const matchedSample = sampleId
          ? SIMULATED_SAMPLES.find((s) => s.id === sampleId)
          : undefined;

        let imageUrl = matchedSample?.imageUrl ?? '';
        let imageBuffer: Buffer | undefined;
        let isSimulated = true;

        if (req.file) {
          if (!verifyImageMagicBytes(req.file.buffer, req.file.mimetype)) {
            res.status(400).json({ error: 'Uploaded file signature does not match declared image format.' });
            return;
          }
          imageBuffer = req.file.buffer;
          imageUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
          isSimulated = false;
        } else if (!matchedSample) {
          res.status(400).json({ error: 'Provide either a validated inspection image upload or a simulated AOI sample.' });
          return;
        }

        // Optional client-computed pixel stats from Canvas Sobel pre-pass
        let clientSignalStats:
          | { edgeDensity?: number; contrastVariance?: number; luminanceMean?: number }
          | undefined;
        if (typeof req.body.clientSignalStats === 'string') {
          try {
            const parsed = JSON.parse(req.body.clientSignalStats);
            clientSignalStats = {
              edgeDensity:
                typeof parsed.edgeDensity === 'number' && Number.isFinite(parsed.edgeDensity)
                  ? Math.max(0.01, Math.min(0.99, parsed.edgeDensity))
                  : undefined,
              contrastVariance:
                typeof parsed.contrastVariance === 'number' && Number.isFinite(parsed.contrastVariance)
                  ? Math.max(1, Math.min(120, parsed.contrastVariance))
                  : undefined,
              luminanceMean:
                typeof parsed.luminanceMean === 'number' && Number.isFinite(parsed.luminanceMean)
                  ? Math.max(0, Math.min(255, parsed.luminanceMean))
                  : undefined,
            };
          } catch {
            // Ignore malformed optional stats
          }
        }

        const analysis = runDeterministicCVInspection({
          sector: factory.sector,
          sampleId: matchedSample?.id,
          imageBuffer,
          clientSignalStats,
        });

        const lineName =
          (typeof req.body.lineName === 'string' && req.body.lineName.trim().slice(0, 80)) ||
          matchedSample?.lineName ||
          `${factory.code} Inspection Cell 1`;

        const batchNumber =
          (typeof req.body.batchNumber === 'string' && req.body.batchNumber.trim().slice(0, 48)) ||
          `LOT-${factory.code.slice(-1)}-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}`;

        const componentSerial =
          (typeof req.body.componentSerial === 'string' &&
            req.body.componentSerial.trim().slice(0, 48)) ||
          `${matchedSample?.componentPrefix ?? 'PART'}-${crypto.randomInt(10000, 99999)}`;

        const shortCode = factory.code.replace('FACTORY_', 'F').slice(0, 3);
        const passportCode = `PX-${shortCode}-${new Date().getFullYear()}-${crypto
          .randomBytes(3)
          .toString('hex')
          .toUpperCase()}`;

        const inserted = await db
          .insert(inspections)
          .values({
            passportCode,
            factoryId: factory.id,
            inspectorUid: user.uid,
            sector: factory.sector,
            lineName,
            batchNumber,
            componentSerial,
            imageUrl,
            defectType: analysis.defectType,
            severity: analysis.severity,
            cvConfidence: analysis.cvConfidence,
            anomalyScore: analysis.anomalyScore,
            boundingBox: analysis.boundingBox,
            cvMetrics: analysis.cvMetrics,
            reliabilityScore: analysis.reliabilityScore,
            reliabilityStatus: analysis.reliabilityStatus,
            perturbationResults: analysis.perturbationResults,
            geminiReport: null,
            humanReviewStatus: 'UNREVIEWED',
            isSimulated,
          })
          .returning();

        const created = inserted[0];

        await logSecurityEvent({
          requestId: req.requestId,
          actorUid: user.uid,
          actorEmail: user.email,
          action: 'CREATE_INSPECTION_PASSPORT',
          resourceType: 'INSPECTION',
          resourceId: created.passportCode,
          factoryId: factory.id,
          outcome: 'ALLOW',
          details: `CV engine detected ${created.defectType} (${created.reliabilityStatus}).`,
        });

        res.status(201).json({
          ...created,
          factoryName: factory.name,
          factoryCode: factory.code,
        });
      } catch (error) {
        console.error('Inspection analysis failed:', error);
        res.status(500).json({ error: 'Unable to complete computer-vision inspection.' });
      }
    }
  );

  // =========================================================================
  // GEMINI AI INVESTIGATION REPORT (NEVER SUBSTITUTES FOR CV ENGINE)
  // =========================================================================
  app.post(
    '/api/inspections/:id/explain',
    requireAuth,
    requireActiveVerifiedAccount,
    async (req: AuthRequest, res: Response) => {
      try {
        const user = req.dbUser!;
        const inspectionId = Number(req.params.id);
        if (!Number.isInteger(inspectionId) || inspectionId <= 0) {
          res.status(400).json({ error: 'Invalid inspection identifier.' });
          return;
        }

        const rows = await db
          .select()
          .from(inspections)
          .where(eq(inspections.id, inspectionId));
        const record = rows[0];
        if (!record) {
          res.status(404).json({ error: 'Digital Defect Passport not found.' });
          return;
        }
        if (!assertFactoryAccess(user, record.factoryId)) {
          res.status(403).json({ error: 'Access denied for this inspection passport.' });
          return;
        }

        const factoryRows = await db
          .select()
          .from(factories)
          .where(eq(factories.id, record.factoryId));
        const factory = factoryRows[0];

        const perturbationSummary = record.perturbationResults
          .map(
            (p) =>
              `${p.name} (${p.severityParam}): ${p.consistent ? 'Consistent' : 'Drifted'} (${(
                p.confidence * 100
              ).toFixed(1)}%)`
          )
          .join('; ');

        const report = await generateDefectExplanation({
          passportCode: record.passportCode,
          factoryName: factory?.name ?? 'Manufacturing Facility',
          sector: record.sector,
          lineName: record.lineName,
          defectType: record.defectType,
          severity: record.severity,
          cvConfidence: record.cvConfidence,
          anomalyScore: record.anomalyScore,
          reliabilityScore: record.reliabilityScore,
          reliabilityStatus: record.reliabilityStatus,
          cvMetrics: record.cvMetrics,
          perturbationSummary,
        });

        const updated = await db
          .update(inspections)
          .set({ geminiReport: report })
          .where(eq(inspections.id, record.id))
          .returning();

        res.json({
          ...updated[0],
          factoryName: factory?.name ?? 'Unknown Factory',
          factoryCode: factory?.code ?? 'UNKNOWN',
        });
      } catch (error) {
        console.error('Gemini defect explanation failed:', error);
        const msg =
          error instanceof Error ? error.message : 'Unable to generate AI investigation report.';
        res.status(502).json({ error: msg });
      }
    }
  );

  // =========================================================================
  // HUMAN FEEDBACK LEARNING LOOP
  // =========================================================================
  app.patch(
    '/api/inspections/:id/feedback',
    requireAuth,
    requireActiveVerifiedAccount,
    requireRoles(['SUPER_ADMIN', 'FACTORY_ADMIN', 'QUALITY_ENGINEER']),
    async (req: AuthRequest, res: Response) => {
      try {
        const user = req.dbUser!;
        const inspectionId = Number(req.params.id);
        if (!Number.isInteger(inspectionId) || inspectionId <= 0) {
          res.status(400).json({ error: 'Invalid inspection ID.' });
          return;
        }

        const parsed = feedbackSubmissionSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid feedback payload.' });
          return;
        }

        const rows = await db
          .select()
          .from(inspections)
          .where(eq(inspections.id, inspectionId));
        const record = rows[0];
        if (!record) {
          res.status(404).json({ error: 'Inspection record not found.' });
          return;
        }
        if (!assertFactoryAccess(user, record.factoryId)) {
          res.status(403).json({ error: 'Access denied for this factory.' });
          return;
        }

        const updated = await db
          .update(inspections)
          .set({
            humanReviewStatus: parsed.data.humanReviewStatus,
            humanLabel:
              parsed.data.humanReviewStatus === 'FALSE_POSITIVE'
                ? 'No Defect'
                : parsed.data.humanLabel || record.defectType,
            humanNotes: parsed.data.humanNotes || null,
            reviewedByUid: user.uid,
            reviewedAt: new Date(),
          })
          .where(eq(inspections.id, record.id))
          .returning();

        await logSecurityEvent({
          requestId: req.requestId,
          actorUid: user.uid,
          actorEmail: user.email,
          action: 'SUBMIT_HUMAN_FEEDBACK',
          resourceType: 'INSPECTION',
          resourceId: record.passportCode,
          factoryId: record.factoryId,
          outcome: 'ALLOW',
          details: `Marked ${record.passportCode} as ${parsed.data.humanReviewStatus}.`,
        });

        const factoryRows = await db
          .select()
          .from(factories)
          .where(eq(factories.id, record.factoryId));
        const factory = factoryRows[0];

        res.json({
          ...updated[0],
          factoryName: factory?.name ?? 'Unknown Factory',
          factoryCode: factory?.code ?? 'UNKNOWN',
        });
      } catch (error) {
        console.error('Feedback update failed:', error);
        res.status(500).json({ error: 'Unable to record engineering feedback.' });
      }
    }
  );

  // =========================================================================
  // COUNTERFACTUAL FACTORY TWIN
  // =========================================================================
  app.get(
    '/api/counterfactuals',
    requireAuth,
    requireActiveVerifiedAccount,
    async (req: AuthRequest, res: Response) => {
      try {
        const user = req.dbUser!;
        if (user.authorizedFactoryIds.length === 0) {
          res.json([]);
          return;
        }
        const rows = await db
          .select()
          .from(counterfactualScenarios)
          .where(inArray(counterfactualScenarios.factoryId, user.authorizedFactoryIds))
          .orderBy(desc(counterfactualScenarios.createdAt))
          .limit(50);
        res.json(rows);
      } catch (error) {
        console.error('Failed to fetch counterfactual scenarios:', error);
        res.status(500).json({ error: 'Unable to load counterfactual twin scenarios.' });
      }
    }
  );

  app.post(
    '/api/counterfactuals',
    requireAuth,
    requireActiveVerifiedAccount,
    async (req: AuthRequest, res: Response) => {
      try {
        const user = req.dbUser!;
        const parsed = counterfactualCreateSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid scenario parameters.' });
          return;
        }

        const { factoryId, inspectionId, title, targetDefect, baselineParams, counterfactualParams, includeGeminiBrief } =
          parsed.data;

        if (!assertFactoryAccess(user, factoryId)) {
          res.status(403).json({ error: 'Access denied for this factory.' });
          return;
        }

        const factoryRows = await db.select().from(factories).where(eq(factories.id, factoryId));
        const factory = factoryRows[0];
        if (!factory) {
          res.status(404).json({ error: 'Factory not found.' });
          return;
        }

        const sim = evaluateCounterfactualTwin(factory.code, baselineParams, counterfactualParams);

        let aiSummary: string | null = null;
        if (includeGeminiBrief) {
          aiSummary = await generateCounterfactualBrief({
            factoryName: factory.name,
            sector: factory.sector,
            targetDefect,
            baselineProb: sim.baselineDefectProb,
            predictedProb: sim.predictedDefectProb,
            riskDeltaPct: sim.riskDeltaPct,
            baselineParams,
            counterfactualParams,
            topDrivers: sim.sensitivityBreakdown,
          });
        }

        const inserted = await db
          .insert(counterfactualScenarios)
          .values({
            factoryId,
            inspectionId: inspectionId ?? null,
            createdByUid: user.uid,
            title,
            targetDefect,
            baselineParams,
            counterfactualParams,
            baselineDefectProb: sim.baselineDefectProb,
            predictedDefectProb: sim.predictedDefectProb,
            riskDeltaPct: sim.riskDeltaPct,
            sensitivityBreakdown: sim.sensitivityBreakdown,
            aiInvestigationSummary: aiSummary,
            isSimulated: true,
          })
          .returning();

        res.status(201).json(inserted[0]);
      } catch (error) {
        console.error('Counterfactual twin run failed:', error);
        const msg =
          error instanceof Error ? error.message : 'Unable to save counterfactual scenario.';
        res.status(500).json({ error: msg });
      }
    }
  );

  // =========================================================================
  // PREDICTIVE MAINTENANCE INTELLIGENCE
  // =========================================================================
  app.get(
    '/api/maintenance',
    requireAuth,
    requireActiveVerifiedAccount,
    async (req: AuthRequest, res: Response) => {
      try {
        const user = req.dbUser!;
        if (user.authorizedFactoryIds.length === 0) {
          res.json([]);
          return;
        }
        const rows = await db
          .select()
          .from(maintenanceForecasts)
          .where(inArray(maintenanceForecasts.factoryId, user.authorizedFactoryIds))
          .orderBy(maintenanceForecasts.healthScore);
        res.json(rows);
      } catch (error) {
        console.error('Failed to load maintenance forecasts:', error);
        res.status(500).json({ error: 'Unable to load predictive maintenance forecasts.' });
      }
    }
  );

  app.post(
    '/api/maintenance/:id/schedule',
    requireAuth,
    requireActiveVerifiedAccount,
    requireRoles(['SUPER_ADMIN', 'FACTORY_ADMIN', 'QUALITY_ENGINEER']),
    async (req: AuthRequest, res: Response) => {
      try {
        const user = req.dbUser!;
        const equipmentId = Number(req.params.id);
        if (!Number.isInteger(equipmentId) || equipmentId <= 0) {
          res.status(400).json({ error: 'Invalid equipment ID.' });
          return;
        }

        const rows = await db
          .select()
          .from(maintenanceForecasts)
          .where(eq(maintenanceForecasts.id, equipmentId));
        const eqRecord = rows[0];
        if (!eqRecord) {
          res.status(404).json({ error: 'Equipment record not found.' });
          return;
        }
        if (!assertFactoryAccess(user, eqRecord.factoryId)) {
          res.status(403).json({ error: 'Access denied for this factory.' });
          return;
        }

        const mode = req.body.action === 'complete' ? 'complete' : 'schedule';
        const updatedValues =
          mode === 'complete'
            ? {
                status: 'NOMINAL',
                healthScore: 95.0,
                failureProb7d: 0.03,
                failureProb30d: 0.09,
                rulHours: 1440,
                lastServicedAt: new Date(),
                updatedAt: new Date(),
              }
            : {
                status: 'SCHEDULED',
                updatedAt: new Date(),
              };

        const updated = await db
          .update(maintenanceForecasts)
          .set(updatedValues)
          .where(eq(maintenanceForecasts.id, eqRecord.id))
          .returning();

        await logSecurityEvent({
          requestId: req.requestId,
          actorUid: user.uid,
          actorEmail: user.email,
          action: mode === 'complete' ? 'COMPLETE_MAINTENANCE' : 'SCHEDULE_MAINTENANCE',
          resourceType: 'EQUIPMENT',
          resourceId: eqRecord.equipmentCode,
          factoryId: eqRecord.factoryId,
          outcome: 'ALLOW',
          details: `${mode === 'complete' ? 'Completed service on' : 'Scheduled preventive maintenance for'} ${eqRecord.equipmentName}.`,
        });

        res.json(updated[0]);
      } catch (error) {
        console.error('Maintenance update failed:', error);
        res.status(500).json({ error: 'Unable to update maintenance schedule.' });
      }
    }
  );

  // =========================================================================
  // CROSS-FACTORY INTELLIGENCE & GEMINI EXECUTIVE DIGEST
  // =========================================================================
  app.get(
    '/api/cross-factory/analytics',
    requireAuth,
    requireActiveVerifiedAccount,
    async (req: AuthRequest, res: Response) => {
      try {
        const user = req.dbUser!;
        if (user.authorizedFactoryIds.length === 0) {
          res.json({
            factories: [],
            defectDistribution: [],
            feedbackSummary: {
              totalInspections: 0,
              reviewedCount: 0,
              pendingReviewCount: 0,
              confirmedCount: 0,
              falsePositiveCount: 0,
              reclassifiedCount: 0,
              agreementRatePct: 100,
            },
          });
          return;
        }

        const [factoryRows, inspectionRows, maintRows] = await Promise.all([
          db
            .select()
            .from(factories)
            .where(inArray(factories.id, user.authorizedFactoryIds))
            .orderBy(factories.code),
          db
            .select()
            .from(inspections)
            .where(inArray(inspections.factoryId, user.authorizedFactoryIds)),
          db
            .select()
            .from(maintenanceForecasts)
            .where(inArray(maintenanceForecasts.factoryId, user.authorizedFactoryIds)),
        ]);

        const factorySummaries = factoryRows.map((f) => {
          const fIns = inspectionRows.filter((i) => i.factoryId === f.id);
          const defects = fIns.filter((i) => i.severity !== 'PASS');
          const avgRel =
            fIns.length > 0
              ? fIns.reduce((acc, i) => acc + i.reliabilityScore, 0) / fIns.length
              : 0;
          const defectCounts = new Map<string, number>();
          for (const d of defects) {
            defectCounts.set(d.defectType, (defectCounts.get(d.defectType) ?? 0) + 1);
          }
          const topDefect =
            [...defectCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'None';
          const criticalEquipment = maintRows.filter(
            (m) => m.factoryId === f.id && m.status === 'MAINTENANCE_REQUIRED'
          ).length;

          return {
            id: f.id,
            code: f.code,
            name: f.name,
            sector: f.sector,
            location: f.location,
            isSimulated: f.isSimulated,
            totalInspections: fIns.length,
            defectCount: defects.length,
            defectRatePct: fIns.length > 0 ? Math.round((defects.length / fIns.length) * 1000) / 10 : 0,
            avgReliability: Math.round(avgRel * 10) / 10,
            reviewFlaggedCount: fIns.filter((i) => i.reliabilityStatus !== 'RELIABLE').length,
            topDefect,
            criticalEquipment,
          };
        });

        const defectCountsAll = new Map<string, { defectType: string; count: number; avgConfidence: number }>();
        for (const ins of inspectionRows) {
          if (ins.severity === 'PASS') continue;
          const cur = defectCountsAll.get(ins.defectType) ?? {
            defectType: ins.defectType,
            count: 0,
            avgConfidence: 0,
          };
          cur.avgConfidence = (cur.avgConfidence * cur.count + ins.cvConfidence * 100) / (cur.count + 1);
          cur.count += 1;
          defectCountsAll.set(ins.defectType, cur);
        }

        const reviewed = inspectionRows.filter((i) => i.humanReviewStatus !== 'UNREVIEWED');
        const confirmed = reviewed.filter((i) => i.humanReviewStatus === 'CONFIRMED').length;
        const falsePositives = reviewed.filter((i) => i.humanReviewStatus === 'FALSE_POSITIVE').length;
        const reclassified = reviewed.filter((i) => i.humanReviewStatus === 'RECLASSIFIED').length;

        res.json({
          factories: factorySummaries,
          defectDistribution: [...defectCountsAll.values()].map((d) => ({
            ...d,
            avgConfidence: Math.round(d.avgConfidence * 10) / 10,
          })),
          feedbackSummary: {
            totalInspections: inspectionRows.length,
            reviewedCount: reviewed.length,
            pendingReviewCount: inspectionRows.length - reviewed.length,
            confirmedCount: confirmed,
            falsePositiveCount: falsePositives,
            reclassifiedCount: reclassified,
            agreementRatePct:
              reviewed.length > 0 ? Math.round((confirmed / reviewed.length) * 1000) / 10 : 100,
          },
        });
      } catch (error) {
        console.error('Cross-factory analytics query failed:', error);
        res.status(500).json({ error: 'Unable to aggregate cross-factory analytics.' });
      }
    }
  );

  app.post(
    '/api/cross-factory/digest',
    requireAuth,
    requireActiveVerifiedAccount,
    async (req: AuthRequest, res: Response) => {
      try {
        const user = req.dbUser!;
        if (user.authorizedFactoryIds.length === 0) {
          res.status(400).json({ error: 'No authorized factories available for synthesis.' });
          return;
        }
        const [factoryRows, inspectionRows] = await Promise.all([
          db
            .select()
            .from(factories)
            .where(inArray(factories.id, user.authorizedFactoryIds)),
          db
            .select()
            .from(inspections)
            .where(inArray(inspections.factoryId, user.authorizedFactoryIds)),
        ]);

        const summaries = factoryRows.map((f) => {
          const fIns = inspectionRows.filter((i) => i.factoryId === f.id);
          const defects = fIns.filter((i) => i.severity !== 'PASS');
          const avgReliability =
            fIns.length > 0
              ? fIns.reduce((s, i) => s + i.reliabilityScore, 0) / fIns.length
              : 0;
          const counts = new Map<string, number>();
          for (const d of defects) counts.set(d.defectType, (counts.get(d.defectType) ?? 0) + 1);
          const topDefect = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'None';
          return {
            name: f.name,
            sector: f.sector,
            totalInspections: fIns.length,
            defectRatePct: fIns.length > 0 ? (defects.length / fIns.length) * 100 : 0,
            avgReliability,
            topDefect,
          };
        });

        const digest = await generateCrossFactoryDigest({ factorySummaries: summaries });
        res.json({ digest, generatedAt: new Date().toISOString() });
      } catch (error) {
        console.error('Gemini cross-factory digest failed:', error);
        const msg =
          error instanceof Error ? error.message : 'Unable to generate cross-factory digest.';
        res.status(502).json({ error: msg });
      }
    }
  );

  // =========================================================================
  // SUPER_ADMIN & FACTORY_ADMIN GOVERNANCE, RBAC, INVITES, BILLING & AUDIT
  // =========================================================================
  app.get(
    '/api/admin/overview',
    requireAuth,
    requireActiveVerifiedAccount,
    requireRoles(['SUPER_ADMIN', 'FACTORY_ADMIN']),
    async (req: AuthRequest, res: Response) => {
      try {
        const actor = req.dbUser!;
        const isSuper = actor.role === 'SUPER_ADMIN';

        const [allUsers, allMemberships, allFactories, allInvites, allBilling, recentAudits] =
          await Promise.all([
            db.select().from(users).orderBy(desc(users.createdAt)),
            db.select().from(factoryMemberships),
            isSuper
              ? db.select().from(factories).orderBy(factories.code)
              : actor.authorizedFactoryIds.length > 0
                ? db
                    .select()
                    .from(factories)
                    .where(inArray(factories.id, actor.authorizedFactoryIds))
                    .orderBy(factories.code)
                : Promise.resolve([]),
            isSuper
              ? db.select().from(invitations).orderBy(desc(invitations.createdAt))
              : actor.authorizedFactoryIds.length > 0
                ? db
                    .select()
                    .from(invitations)
                    .where(inArray(invitations.factoryId, actor.authorizedFactoryIds))
                    .orderBy(desc(invitations.createdAt))
                : Promise.resolve([]),
            isSuper
              ? db.select().from(billingRecords).orderBy(desc(billingRecords.createdAt))
              : Promise.resolve([]),
            isSuper
              ? db
                  .select()
                  .from(securityAuditLogs)
                  .orderBy(desc(securityAuditLogs.createdAt))
                  .limit(40)
              : Promise.resolve([]),
          ]);

        const membershipByUser = new Map<number, number[]>();
        for (const m of allMemberships) {
          const list = membershipByUser.get(m.userId) ?? [];
          list.push(m.factoryId);
          membershipByUser.set(m.userId, list);
        }

        const managedUsers = allUsers
          .map((u) => ({
            id: u.id,
            uid: u.uid,
            email: u.email,
            displayName: u.displayName,
            role: u.role,
            accountStatus: u.accountStatus,
            emailVerified: u.emailVerified,
            createdAt: u.createdAt,
            factoryIds: membershipByUser.get(u.id) ?? [],
          }))
          .filter(
            (u) =>
              isSuper ||
              u.factoryIds.some((fid) => actor.authorizedFactoryIds.includes(fid)) ||
              u.accountStatus === 'PENDING_APPROVAL'
          );

        res.json({
          users: managedUsers,
          factories: allFactories,
          invitations: allInvites,
          billing: allBilling,
          auditLogs: recentAudits,
        });
      } catch (error) {
        console.error('Admin overview failed:', error);
        res.status(500).json({ error: 'Unable to load governance records.' });
      }
    }
  );

  app.post(
    '/api/admin/factories',
    requireAuth,
    requireActiveVerifiedAccount,
    requireRoles(['SUPER_ADMIN']),
    async (req: AuthRequest, res: Response) => {
      try {
        const actor = req.dbUser!;
        const parsed = createFactorySchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid factory data.' });
          return;
        }

        const inserted = await db
          .insert(factories)
          .values({
            code: parsed.data.code,
            name: parsed.data.name,
            sector: parsed.data.sector,
            location: parsed.data.location,
            subscriptionTier: parsed.data.subscriptionTier,
            status: 'ACTIVE',
            isSimulated: parsed.data.isSimulated,
          })
          .returning();

        const created = inserted[0];

        const tierPrice =
          created.subscriptionTier === 'ENTERPRISE'
            ? 4800
            : created.subscriptionTier === 'GROWTH'
              ? 2400
              : 900;

        await db.insert(billingRecords).values({
          factoryId: created.id,
          tier: created.subscriptionTier,
          monthlyAmountUsd: tierPrice,
          billingPeriod: new Date().toISOString().slice(0, 7),
          status: 'PAID',
          invoiceRef: `INV-PX-${Date.now().toString().slice(-6)}`,
        });

        await logSecurityEvent({
          requestId: req.requestId,
          actorUid: actor.uid,
          actorEmail: actor.email,
          action: 'REGISTER_FACTORY',
          resourceType: 'FACTORY',
          resourceId: created.code,
          factoryId: created.id,
          outcome: 'ALLOW',
          details: `Registered ${created.name} on ${created.subscriptionTier} tier.`,
        });

        res.status(201).json(created);
      } catch (error) {
        console.error('Factory registration failed:', error);
        res.status(400).json({ error: 'Unable to register factory. Ensure the factory code is unique.' });
      }
    }
  );

  app.patch(
    '/api/admin/factories/:id/tier',
    requireAuth,
    requireActiveVerifiedAccount,
    requireRoles(['SUPER_ADMIN']),
    async (req: AuthRequest, res: Response) => {
      try {
        const actor = req.dbUser!;
        const factoryId = Number(req.params.id);
        const parsed = updateFactoryTierSchema.safeParse(req.body);
        if (!Number.isInteger(factoryId) || !parsed.success) {
          res.status(400).json({ error: 'Invalid subscription update payload.' });
          return;
        }

        const updated = await db
          .update(factories)
          .set({ subscriptionTier: parsed.data.subscriptionTier })
          .where(eq(factories.id, factoryId))
          .returning();

        if (!updated[0]) {
          res.status(404).json({ error: 'Factory not found.' });
          return;
        }

        await db.insert(billingRecords).values({
          factoryId,
          tier: parsed.data.subscriptionTier,
          monthlyAmountUsd: parsed.data.monthlyAmountUsd,
          billingPeriod: new Date().toISOString().slice(0, 7),
          status: 'PAID',
          invoiceRef: `INV-PX-UPG-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
        });

        await logSecurityEvent({
          requestId: req.requestId,
          actorUid: actor.uid,
          actorEmail: actor.email,
          action: 'UPDATE_SUBSCRIPTION_TIER',
          resourceType: 'BILLING',
          resourceId: updated[0].code,
          factoryId,
          outcome: 'ALLOW',
          details: `Updated ${updated[0].code} to ${parsed.data.subscriptionTier} ($${parsed.data.monthlyAmountUsd}/mo).`,
        });

        res.json(updated[0]);
      } catch (error) {
        console.error('Subscription update failed:', error);
        res.status(500).json({ error: 'Unable to update subscription tier.' });
      }
    }
  );

  app.post(
    '/api/admin/invitations',
    requireAuth,
    requireActiveVerifiedAccount,
    requireRoles(['SUPER_ADMIN', 'FACTORY_ADMIN']),
    async (req: AuthRequest, res: Response) => {
      try {
        const actor = req.dbUser!;
        const parsed = createInvitationSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid invitation payload.' });
          return;
        }
        if (!assertFactoryAccess(actor, parsed.data.factoryId)) {
          res.status(403).json({ error: 'Cannot issue invitations for an unassigned factory.' });
          return;
        }
        if (actor.role !== 'SUPER_ADMIN' && parsed.data.assignedRole === 'FACTORY_ADMIN') {
          res.status(403).json({ error: 'Only SUPER_ADMIN may assign Factory Administrators.' });
          return;
        }

        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const inserted = await db
          .insert(invitations)
          .values({
            email: parsed.data.email.toLowerCase(),
            factoryId: parsed.data.factoryId,
            assignedRole: parsed.data.assignedRole,
            invitedByUid: actor.uid,
            status: 'PENDING',
            expiresAt,
          })
          .returning();

        await logSecurityEvent({
          requestId: req.requestId,
          actorUid: actor.uid,
          actorEmail: actor.email,
          action: 'CREATE_INVITATION',
          resourceType: 'INVITATION',
          resourceId: String(inserted[0].id),
          factoryId: parsed.data.factoryId,
          outcome: 'ALLOW',
          details: `Invited ${parsed.data.email} as ${parsed.data.assignedRole}.`,
        });

        res.status(201).json(inserted[0]);
      } catch (error) {
        console.error('Invitation creation failed:', error);
        res.status(500).json({ error: 'Unable to issue invitation.' });
      }
    }
  );

  app.patch(
    '/api/admin/users/:id',
    requireAuth,
    requireActiveVerifiedAccount,
    requireRoles(['SUPER_ADMIN', 'FACTORY_ADMIN']),
    async (req: AuthRequest, res: Response) => {
      try {
        const actor = req.dbUser!;
        const targetUserId = Number(req.params.id);
        const parsed = updateUserGovernanceSchema.safeParse(req.body);
        if (!Number.isInteger(targetUserId) || !parsed.success) {
          res.status(400).json({ error: 'Invalid user governance update.' });
          return;
        }

        if (actor.role !== 'SUPER_ADMIN' && (parsed.data.role === 'SUPER_ADMIN' || parsed.data.role === 'FACTORY_ADMIN')) {
          res.status(403).json({ error: 'Only SUPER_ADMIN can assign administrator roles.' });
          return;
        }

        const existingRows = await db.select().from(users).where(eq(users.id, targetUserId));
        const targetUser = existingRows[0];
        if (!targetUser) {
          res.status(404).json({ error: 'User not found.' });
          return;
        }
        if (
          actor.role !== 'SUPER_ADMIN' &&
          (targetUser.role === 'SUPER_ADMIN' || targetUser.role === 'FACTORY_ADMIN')
        ) {
          await logSecurityEvent({
            requestId: req.requestId,
            actorUid: actor.uid,
            actorEmail: actor.email,
            action: 'UPDATE_USER_RBAC',
            resourceType: 'USER',
            resourceId: String(targetUserId),
            outcome: 'DENY',
            details: `Blocked ${actor.role} from modifying ${targetUser.role} account ${targetUser.email}.`,
          });
          res.status(403).json({ error: 'Only SUPER_ADMIN may modify administrator accounts.' });
          return;
        }

        const updatePayload: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
        if (parsed.data.role) updatePayload.role = parsed.data.role;
        if (parsed.data.accountStatus) updatePayload.accountStatus = parsed.data.accountStatus;

        const updatedRows = await db
          .update(users)
          .set(updatePayload)
          .where(eq(users.id, targetUserId))
          .returning();

        if (parsed.data.factoryIds) {
          const allowedSet =
            actor.role === 'SUPER_ADMIN'
              ? parsed.data.factoryIds
              : parsed.data.factoryIds.filter((fid) => actor.authorizedFactoryIds.includes(fid));

          await db.delete(factoryMemberships).where(eq(factoryMemberships.userId, targetUserId));
          for (const fid of allowedSet) {
            await db
              .insert(factoryMemberships)
              .values({
                userId: targetUserId,
                factoryId: fid,
                factoryRole:
                  (parsed.data.role || targetUser.role) === 'SUPER_ADMIN'
                    ? 'FACTORY_ADMIN'
                    : parsed.data.role || targetUser.role,
                approved: true,
              })
              .onConflictDoNothing();
          }
        }

        await logSecurityEvent({
          requestId: req.requestId,
          actorUid: actor.uid,
          actorEmail: actor.email,
          action: 'UPDATE_USER_RBAC',
          resourceType: 'USER',
          resourceId: String(targetUserId),
          outcome: 'ALLOW',
          details: `Updated ${targetUser.email} role=${parsed.data.role ?? targetUser.role} status=${parsed.data.accountStatus ?? targetUser.accountStatus}.`,
        });

        res.json(updatedRows[0]);
      } catch (error) {
        console.error('User RBAC update failed:', error);
        res.status(500).json({ error: 'Unable to update user permissions.' });
      }
    }
  );

  // =========================================================================
  // CONTEXT-AWARE DASHBOARD INTELLIGENCE CHATBOT
  // =========================================================================
  const DASHBOARD_META: Record<DashboardTabId, { label: string; inventory: string }> = {
    overview: {
      label: 'Executive Command Centre',
      inventory: [
        '- 6 Executive KPI Cards: Total Inspected Passports, Defects Detected, Flagged Reliability (Self-Challenging AI alerts), Awaiting Review (pending QA verdicts), False Positive Rate, and Model Reliability Average.',
        '- Inspection Trend Line Chart: Compares Total Inspected vs. Defects Detected over recent production shifts.',
        '- Defect Distribution Donut Chart: Shows share of every CV defect class with total defect count centered.',
        '- Line Status Panel: Live health/running/alert status of each production line with shortcut into the 3D Factory Twin.',
        '- Defect Intensity & Spatial Heat Map: Interactive Line × Defect matrix, Shift Hours temporal grid, and Spatial Surface Gaussian density heat map with Thermal/Viridis/Amber scales linked to defect passports.',
        '- System Alerts Panel: Equipment degradation alerts sorted by urgency with shortcut to Predictive Maintenance.',
        '- Throughput Bar Sparkline & Recent Defect Evidence Thumbnails (clickable to open Digital Defect Passports).',
        '- Searchable Digital Defect Passport Ledger table at the bottom.',
      ].join('\n'),
    },
    inspection: {
      label: 'Live Optical Inspection & Self-Challenging AI',
      inventory: [
        '- Computer-Vision Inspection Workbench: Target factory selector, Simulated AOI Frame selector or Upload Image (JPEG/PNG/WebP), Production Line & Batch inputs.',
        '- Live Optical Canvas Viewport: Real-time deterministic Sobel edge-gradient + Gaussian thermal anomaly heat map with adjustable opacity, bounding box localization overlay, and 6-mode Perturbation Stress Viewport (Baseline, Exposure -35%, Glare +30%, Blur σ2.2, ISO Noise, Rotate +7°).',
        '- Self-Challenging AI Reliability Audit Panel: Detected defect class, severity, reliability score, CV confidence, anomaly energy, Sobel peak, 5-perturbation stability table, and Gemini root-cause brief generator.',
      ].join('\n'),
    },
    twin: {
      label: '3D Counterfactual Factory Twin',
      inventory: [
        '- Interactive Three.js 3D Factory Floor: Animated composite machinery for Factory A (10-Zone Reflow Oven, Pick-and-Place Gantry, AOI Bridge), Factory B (5-Axis CNC Cell, 800T Stamping Press, AOI Bridge), and Factory C (Flux Washer, Conformal Coating Cell, AOI Bridge) with live conveyor workpieces mapped to real defective inspection passports.',
        '- Explicit Line Status & Telemetry Source Indicator: Displays Running/Watch/Alert line state and whether active inspection records are Live, Simulated, or Mixed.',
        '- Clickable 3D Production Stations & Alert Highlights: Stations automatically glow with alert rings when linked inspections or equipment generate alerts; clicking any station opens its persisted inspection history and focuses the station camera preset.',
        '- 3D Dock Controls: Camera presets (Overview, Station 01–03, AOI Lens, Workpieces, Top Plan), 3D Floor Thermal Heat Map toggle, Before/After Process Simulation switch, Cutaway hood elevation toggle, Pause/Resume, and 3D Optical Defect Scanner.',
        '- Before / After Process Simulation Panel & Counterfactual Sliders: Compares observed baseline drift against counterfactual interventions with First-Pass Yield gain, parameter-by-parameter diff table, sensitivity breakdown chart, Gemini brief, and saved scenarios.',
      ].join('\n'),
    },
    'cross-factory': {
      label: 'Cross-Factory Intelligence',
      inventory: [
        '- Three Simulated Factories Comparison Cards (Factory A Electronics, Factory B Automotive Components, Factory C Automotive ECU) showing passport counts, defect rates, AI reliability, leading defects, and equipment alerts.',
        '- Interactive React Flow Cross-Factory Defect Signature Transfer Graph linking thermal/flux and mechanical stress signatures across plants.',
        '- Cross-Plant Defect Distribution Horizontal Bar Chart and Gemini Cross-Factory Executive Digest.',
      ].join('\n'),
    },
    feedback: {
      label: 'Human Feedback Learning Loop',
      inventory: [
        '- 4 Calibration KPI Cards: Model-Engineer Agreement %, Pending Review Queue, False Positives Caught, and Reclassified Defects.',
        '- Human-in-the-Loop Verification Queue Table filterable by Pending, Low Reliability, or All Passports.',
        '- Engineering Ground-Truth Verdict Panel: Evidence plate with bounding box, verdict selector (Confirmed / False Positive / Reclassified), corrected defect label input, and calibration notes persisted to PostgreSQL.',
      ].join('\n'),
    },
    maintenance: {
      label: 'Predictive Maintenance Intelligence',
      inventory: [
        '- Equipment Degradation & Failure Probability Horizon Bar Chart comparing 7-Day vs. 30-Day failure risk (%) per machine.',
        '- Asset Health, Remaining Useful Life (RUL hours) & Service Dispatch Table sorted by lowest health score first, listing primary degradation drivers, recommended actions, and Schedule / Complete PM dispatch controls.',
      ].join('\n'),
    },
    governance: {
      label: 'Platform Governance & Billing',
      inventory: [
        '- Segmented Governance Sections: Users & RBAC Matrix, Registered Factories & Subscription Tiers + Billing History Ledger, Invite-Only Onboarding Authorizations, and Sanitized Security & Authorization Audit Log (SUPER_ADMIN only).',
      ].join('\n'),
    },
  };

  app.post(
    '/api/assistant/chat',
    requireAuth,
    requireActiveVerifiedAccount,
    async (req: AuthRequest, res: Response) => {
      try {
        const user = req.dbUser!;
        const parsed = dashboardAssistantSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid assistant request.' });
          return;
        }

        const { activeTab, factoryId, mode, focusWidget, message, history } = parsed.data;
        if (factoryId && !assertFactoryAccess(user, factoryId)) {
          res.status(403).json({ error: 'Access denied for the requested factory scope.' });
          return;
        }

        const targetFactoryIds = factoryId ? [factoryId] : user.authorizedFactoryIds;
        const meta = DASHBOARD_META[activeTab];

        const [factoryRows, inspectionRows, maintRows, scenarioRows] =
          targetFactoryIds.length > 0
            ? await Promise.all([
                db
                  .select()
                  .from(factories)
                  .where(inArray(factories.id, targetFactoryIds))
                  .orderBy(factories.code),
                db
                  .select()
                  .from(inspections)
                  .where(inArray(inspections.factoryId, targetFactoryIds))
                  .orderBy(desc(inspections.createdAt))
                  .limit(60),
                db
                  .select()
                  .from(maintenanceForecasts)
                  .where(inArray(maintenanceForecasts.factoryId, targetFactoryIds))
                  .orderBy(maintenanceForecasts.healthScore),
                db
                  .select()
                  .from(counterfactualScenarios)
                  .where(inArray(counterfactualScenarios.factoryId, targetFactoryIds))
                  .orderBy(desc(counterfactualScenarios.createdAt))
                  .limit(10),
              ])
            : [[], [], [], []];

        const factoryNameById = new Map(factoryRows.map((f) => [f.id, `${f.code} (${f.name})`]));
        const scopeLabel = factoryId
          ? factoryNameById.get(factoryId) || `Factory #${factoryId}`
          : `All Authorized Factories (${factoryRows.length} sites)`;

        // Aggregate live telemetry summary for grounded Gemini reasoning
        const totalInspections = inspectionRows.length;
        const defects = inspectionRows.filter((i) => i.severity !== 'PASS');
        const criticalOrHigh = defects.filter((i) => i.severity === 'CRITICAL' || i.severity === 'HIGH');
        const avgReliability =
          totalInspections > 0
            ? inspectionRows.reduce((s, i) => s + i.reliabilityScore, 0) / totalInspections
            : 0;
        const flaggedReliability = inspectionRows.filter((i) => i.reliabilityStatus !== 'RELIABLE');
        const unreviewedCount = inspectionRows.filter((i) => i.humanReviewStatus === 'UNREVIEWED').length;
        const reviewedRows = inspectionRows.filter((i) => i.humanReviewStatus !== 'UNREVIEWED');
        const confirmedCount = reviewedRows.filter((i) => i.humanReviewStatus === 'CONFIRMED').length;
        const falsePositiveCount = reviewedRows.filter((i) => i.humanReviewStatus === 'FALSE_POSITIVE').length;
        const reclassifiedCount = reviewedRows.filter((i) => i.humanReviewStatus === 'RECLASSIFIED').length;

        const defectCounts = new Map<string, number>();
        for (const d of defects) {
          defectCounts.set(d.defectType, (defectCounts.get(d.defectType) ?? 0) + 1);
        }
        const topDefectsText =
          [...defectCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([name, cnt]) => `${name}: ${cnt}`)
            .join(', ') || 'No defects recorded';

        const recentPassportsText = inspectionRows
          .slice(0, 6)
          .map(
            (i) =>
              `  * ${i.passportCode} | ${factoryNameById.get(i.factoryId) ?? `F#${i.factoryId}`} | ${i.lineName} | ${i.defectType} (${i.severity}) | CV Conf ${(i.cvConfidence * 100).toFixed(1)}% | Reliability ${i.reliabilityScore.toFixed(1)}% (${i.reliabilityStatus}) | Review: ${i.humanReviewStatus}`
          )
          .join('\n');

        const maintText = maintRows
          .slice(0, 6)
          .map(
            (m) =>
              `  * ${m.equipmentCode} (${m.equipmentName}, ${m.lineName}): Health ${m.healthScore.toFixed(1)}%, RUL ${m.rulHours}h, 7d Risk ${(m.failureProb7d * 100).toFixed(0)}%, 30d Risk ${(m.failureProb30d * 100).toFixed(0)}%, Status ${m.status} — Driver: ${m.primaryRiskFactor} | Action: ${m.recommendedAction}`
          )
          .join('\n');

        const scenariosText =
          scenarioRows.length > 0
            ? scenarioRows
                .slice(0, 4)
                .map(
                  (s) =>
                    `  * "${s.title}" (${s.targetDefect}): Baseline ${(s.baselineDefectProb * 100).toFixed(1)}% -> Counterfactual ${(s.predictedDefectProb * 100).toFixed(1)}% (Delta ${s.riskDeltaPct > 0 ? '+' : ''}${s.riskDeltaPct.toFixed(1)} pts)`
                )
                .join('\n')
            : '  * No counterfactual scenarios saved yet; live 3D twin profiles ready for Factory A (Reflow/Solder Bridge), Factory B (CNC/Hairline Crack), and Factory C (Flux Wash/Contamination).';

        let governanceExtra = '';
        if (activeTab === 'governance' && (user.role === 'SUPER_ADMIN' || user.role === 'FACTORY_ADMIN')) {
          const [uRows, invRows, billRows] = await Promise.all([
            db.select().from(users),
            db.select().from(invitations),
            user.role === 'SUPER_ADMIN' ? db.select().from(billingRecords) : Promise.resolve([]),
          ]);
          const pendingUsers = uRows.filter((u) => u.accountStatus === 'PENDING_APPROVAL').length;
          const totalMonthlyUsd = billRows.reduce((s, b) => s + b.monthlyAmountUsd, 0);
          governanceExtra = `\nGovernance Summary:\n- Total Accounts: ${uRows.length} (Pending Approval: ${pendingUsers})\n- Active Invitations: ${invRows.length}\n- Billing Ledger Total Recorded: $${totalMonthlyUsd.toLocaleString()} across ${billRows.length} records`;
        }

        const telemetrySnapshot = [
          `Authorized Factories in Scope: ${factoryRows.map((f) => `${f.code} (${f.name} - ${f.sector}, Tier ${f.subscriptionTier})`).join('; ') || 'None'}`,
          `Inspection Totals: ${totalInspections} passports | ${defects.length} defects (${criticalOrHigh.length} CRITICAL/HIGH) | Avg Self-Challenging Reliability: ${avgReliability.toFixed(1)}% | Flagged for Reliability Review: ${flaggedReliability.length}`,
          `Human Review Loop: ${reviewedRows.length} reviewed, ${unreviewedCount} pending | Confirmed: ${confirmedCount}, False Positives: ${falsePositiveCount}, Reclassified: ${reclassifiedCount}`,
          `Defect Class Distribution: ${topDefectsText}`,
          `Recent Digital Defect Passports:\n${recentPassportsText || '  * None'}`,
          `Predictive Maintenance Equipment Health (Lowest Health First):\n${maintText || '  * None'}`,
          `Counterfactual 3D Twin Scenarios:\n${scenariosText}`,
          governanceExtra,
        ]
          .filter(Boolean)
          .join('\n\n');

        const reply = await generateDashboardAssistantReply({
          dashboardLabel: meta.label,
          dashboardInventory: meta.inventory,
          scopeLabel,
          userRole: user.role,
          telemetrySnapshot,
          mode,
          focusWidget,
          message,
          history,
        });

        await logSecurityEvent({
          requestId: req.requestId,
          actorUid: user.uid,
          actorEmail: user.email,
          action: 'DASHBOARD_ASSISTANT_QUERY',
          resourceType: 'ASSISTANT',
          resourceId: activeTab,
          factoryId: factoryId ?? null,
          outcome: 'ALLOW',
          details: `Mode=${mode}${focusWidget ? ` focus=${focusWidget}` : ''} on ${meta.label}.`,
        });

        res.json({
          reply,
          dashboardLabel: meta.label,
          scopeLabel,
          generatedAt: new Date().toISOString(),
        });
      } catch (error) {
        console.error('Dashboard assistant failed:', error);
        const msg =
          error instanceof Error ? error.message : 'Unable to generate dashboard explanation.';
        res.status(502).json({ error: msg });
      }
    }
  );

  // API 404 fallback
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  // Frontend serving (Vite dev middleware in dev, dist/ static in production)
  if (!IS_PRODUCTION) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  // Ensure simulated seed check is non-blocking on first authenticated request
  void ensureSimulatedDataSeeded;

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PROMETHEUS-X server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to launch PROMETHEUS-X server:', err);
  process.exit(1);
});
