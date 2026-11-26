import { eq } from 'drizzle-orm';
import { db } from './index.ts';
import {
  billingRecords,
  counterfactualScenarios,
  factories,
  inspections,
  maintenanceForecasts,
} from './schema.ts';
import { runDeterministicCVInspection, SIMULATED_SAMPLES } from '../lib/cv-engine.ts';
import { evaluateCounterfactualTwin, FACTORY_TWIN_PROFILES } from '../lib/counterfactual-engine.ts';

let seedCompleted = false;

export async function ensureSimulatedDataSeeded(): Promise<void> {
  if (seedCompleted) return;
  try {
    const existingFactories = await db.select().from(factories);
    if (existingFactories.length >= 3) {
      seedCompleted = true;
      return;
    }

    const factorySeeds = [
      {
        code: 'FACTORY_A',
        name: 'Factory A — Electronics Manufacturing',
        sector: 'Electronics & Semiconductor',
        location: 'Penang SMT Campus (Simulated)',
        subscriptionTier: 'ENTERPRISE',
        status: 'ACTIVE',
        isSimulated: true,
      },
      {
        code: 'FACTORY_B',
        name: 'Factory B — Automotive Components',
        sector: 'Automotive Components',
        location: 'Stuttgart Precision Works (Simulated)',
        subscriptionTier: 'ENTERPRISE',
        status: 'ACTIVE',
        isSimulated: true,
      },
      {
        code: 'FACTORY_C',
        name: 'Factory C — Automotive Electronics',
        sector: 'Automotive Electronics',
        location: 'Nagoya ECU Assembly (Simulated)',
        subscriptionTier: 'GROWTH',
        status: 'ACTIVE',
        isSimulated: true,
      },
    ];

    for (const f of factorySeeds) {
      await db.insert(factories).values(f).onConflictDoNothing({ target: factories.code });
    }

    const allFactories = await db.select().from(factories);
    const factoryByCode = new Map(allFactories.map((f) => [f.code, f]));

    // Seed initial simulated inspections with Digital Defect Passports
    const existingInspections = await db.select().from(inspections);
    if (existingInspections.length === 0) {
      const inspectionSeedDefs = [
        {
          passportCode: 'PX-FA-2026-1001',
          sample: SIMULATED_SAMPLES[0],
          batchNumber: 'LOT-SMT-2611A',
          componentSerial: 'PCB-IC14-88412',
          reviewStatus: 'CONFIRMED',
          humanLabel: 'Solder Bridge',
          humanNotes: 'Confirmed bridged pins 14-15 after reflow peak drift (+11°C).',
          geminiReport:
            '1. Root-Cause Engineering Diagnosis: Excessive solder paste volume combined with a +11°C reflow peak excursion on SMT Line A2 reduced paste viscosity, promoting bridging across fine-pitch QFP leads.\n\n2. Model Reliability Assessment: Self-Challenging stress perturbations confirmed stable localization under exposure and sensor noise shifts; optical blur marginally reduced boundary contrast.\n\n3. Immediate Containment & Preventive Action: Quarantine Lot LOT-SMT-2611A for automated X-ray verification, tighten stencil wipe frequency to every 5 boards, and recalibrate Zone 4 reflow profile to 245°C.',
        },
        {
          passportCode: 'PX-FA-2026-1002',
          sample: SIMULATED_SAMPLES[1],
          batchNumber: 'LOT-SMT-2611B',
          componentSerial: 'SMD-R103-44907',
          reviewStatus: 'UNREVIEWED',
          humanLabel: null,
          humanNotes: null,
          geminiReport:
            '1. Root-Cause Engineering Diagnosis: Asymmetric solder wetting and placement nozzle vacuum drift on Pick-and-Place Line A4 induced a 9-degree rotational skew on resistor R103.\n\n2. Model Reliability Assessment: High confidence on baseline frame; rotational perturbation indicates moderate sensitivity near small pad geometries.\n\n3. Immediate Containment & Preventive Action: Inspect feeder bank #3 nozzle alignment and verify pad coplanarity across the next 20 panels.',
        },
        {
          passportCode: 'PX-FB-2026-2001',
          sample: SIMULATED_SAMPLES[2],
          batchNumber: 'LOT-CNC-2611C',
          componentSerial: 'TRN-FLG-31094',
          reviewStatus: 'CONFIRMED',
          humanLabel: 'Hairline Crack',
          humanNotes: 'Verified via dye-penetrant check; spindle tool #7 exceeded 72% wear threshold.',
          geminiReport:
            '1. Root-Cause Engineering Diagnosis: Elevated spindle speed (11,400 RPM) paired with 72% carbide cutter wear and low coolant pressure generated thermal-mechanical stress cracking along the precision bore perimeter.\n\n2. Model Reliability Assessment: Strong edge-gradient contrast yields high structural detection stability across lighting and noise perturbations.\n\n3. Immediate Containment & Preventive Action: Halt 5-Axis CNC Cell B1 immediately, replace carbide insert #7, restore coolant nozzle pressure to 32 bar, and ultrasonic-scan remaining Lot LOT-CNC-2611C housings.',
        },
        {
          passportCode: 'PX-FB-2026-2002',
          sample: SIMULATED_SAMPLES[3],
          batchNumber: 'LOT-STP-2611D',
          componentSerial: 'PNL-EXT-01288',
          reviewStatus: 'RECLASSIFIED',
          humanLabel: 'Surface Dent',
          humanNotes: 'Confirmed shallow 0.18mm dent + secondary handling scratch from transfer gripper.',
          geminiReport:
            '1. Root-Cause Engineering Diagnosis: Localized die cushion pressure imbalance combined with debris on transfer press gripper caused a 0.18mm panel indentation and adjacent 12µm linear scratch.\n\n2. Model Reliability Assessment: Specular glare on brushed aluminum increases confidence variance; engineer verification confirmed true positive.\n\n3. Immediate Containment & Preventive Action: Clean upper die face on Stamping Press B3 and recalibrate cushion force to 620 kN.',
        },
        {
          passportCode: 'PX-FC-2026-3001',
          sample: SIMULATED_SAMPLES[4],
          batchNumber: 'LOT-ECU-2611E',
          componentSerial: 'ECU-VG50-77210',
          reviewStatus: 'UNREVIEWED',
          humanLabel: null,
          humanNotes: null,
          geminiReport:
            '1. Root-Cause Engineering Diagnosis: Post-solder aqueous wash pressure dropped to 26 PSI while coating cell humidity rose to 58% RH, leaving ionic white flux residue across TE Connectivity pins P1-P7.\n\n2. Model Reliability Assessment: Cross-factory signature matches Factory A flux thermal breakdown patterns; reliability remains stable under exposure shifts.\n\n3. Immediate Containment & Preventive Action: Hold ECU batch LOT-ECU-2611E from potting, raise wash pressure to 45 PSI, and inspect inline filtration cartridges.',
        },
      ];

      for (const def of inspectionSeedDefs) {
        const factory = factoryByCode.get(def.sample.factoryCode);
        if (!factory) continue;
        const analysis = runDeterministicCVInspection({
          sector: def.sample.sector,
          sampleId: def.sample.id,
        });
        await db
          .insert(inspections)
          .values({
            passportCode: def.passportCode,
            factoryId: factory.id,
            inspectorUid: 'system-simulated-aoi',
            sector: def.sample.sector,
            lineName: def.sample.lineName,
            batchNumber: def.batchNumber,
            componentSerial: def.componentSerial,
            imageUrl: def.sample.imageUrl,
            defectType: analysis.defectType,
            severity: analysis.severity,
            cvConfidence: analysis.cvConfidence,
            anomalyScore: analysis.anomalyScore,
            boundingBox: analysis.boundingBox,
            cvMetrics: analysis.cvMetrics,
            reliabilityScore: analysis.reliabilityScore,
            reliabilityStatus: analysis.reliabilityStatus,
            perturbationResults: analysis.perturbationResults,
            geminiReport: def.geminiReport,
            humanReviewStatus: def.reviewStatus,
            humanLabel: def.humanLabel,
            humanNotes: def.humanNotes,
            reviewedByUid: def.reviewStatus !== 'UNREVIEWED' ? 'system-qa-lead' : null,
            reviewedAt: def.reviewStatus !== 'UNREVIEWED' ? new Date() : null,
            isSimulated: true,
          })
          .onConflictDoNothing({ target: inspections.passportCode });
      }
    }

    // Seed Predictive Maintenance Equipment Forecasts across Factory A, B, C
    const existingMaintenance = await db.select().from(maintenanceForecasts);
    if (existingMaintenance.length === 0) {
      const maintSeeds = [
        {
          factoryCode: 'FACTORY_A',
          equipmentCode: 'EQ-FA-RF02',
          equipmentName: '10-Zone Nitrogen Reflow Oven #2',
          lineName: 'SMT Reflow Line A2',
          healthScore: 68.4,
          failureProb7d: 0.29,
          failureProb30d: 0.64,
          rulHours: 148,
          primaryRiskFactor: 'Zone 4 thermocouple drift (+11°C) correlating with Solder Bridge spikes',
          recommendedAction: 'Replace Zone 4 heater SSR & run thermal profiler before next shift',
          status: 'MAINTENANCE_REQUIRED',
        },
        {
          factoryCode: 'FACTORY_A',
          equipmentCode: 'EQ-FA-PP04',
          equipmentName: 'High-Speed Pick-and-Place Gantry A4',
          lineName: 'Pick-and-Place Line A4',
          healthScore: 81.2,
          failureProb7d: 0.14,
          failureProb30d: 0.37,
          rulHours: 410,
          primaryRiskFactor: 'Nozzle bank #3 vacuum decay causing 0402/0603 placement skew',
          recommendedAction: 'Clean rotary vacuum manifold & calibrate fiducial vision camera',
          status: 'WATCH',
        },
        {
          factoryCode: 'FACTORY_B',
          equipmentCode: 'EQ-FB-CNC1',
          equipmentName: '5-Axis CNC Machining Center B1',
          lineName: '5-Axis CNC Cell B1',
          healthScore: 59.5,
          failureProb7d: 0.42,
          failureProb30d: 0.78,
          rulHours: 84,
          primaryRiskFactor: 'Spindle RMS vibration 3.6 mm/s & 72% cutter wear linked to bore cracks',
          recommendedAction: 'Immediate tool carousel swap & spindle bearing harmonic check',
          status: 'MAINTENANCE_REQUIRED',
        },
        {
          factoryCode: 'FACTORY_B',
          equipmentCode: 'EQ-FB-STP3',
          equipmentName: '800-Ton Servo Stamping Press B3',
          lineName: 'Stamping Press Line B3',
          healthScore: 86.0,
          failureProb7d: 0.09,
          failureProb30d: 0.24,
          rulHours: 620,
          primaryRiskFactor: 'Minor hydraulic die cushion drift (+140 kN peak overshoot)',
          recommendedAction: 'Re-zero hydraulic pressure transducer during weekend PM window',
          status: 'WATCH',
        },
        {
          factoryCode: 'FACTORY_C',
          equipmentCode: 'EQ-FC-CC02',
          equipmentName: 'Inline Aqueous Flux Washer & Coater C2',
          lineName: 'ECU Conformal Coat Line C2',
          healthScore: 72.8,
          failureProb7d: 0.24,
          failureProb30d: 0.55,
          rulHours: 196,
          primaryRiskFactor: 'Spray manifold pressure drop (26 PSI) leaving ionic flux residue on ECU headers',
          recommendedAction: 'Replace 5-micron inline DI water filter & descale spray nozzles',
          status: 'WATCH',
        },
        {
          factoryCode: 'FACTORY_C',
          equipmentCode: 'EQ-FC-AOI1',
          equipmentName: '3D Structured-Light AOI Bridge C1',
          lineName: 'ECU Final Inspection Line C1',
          healthScore: 94.6,
          failureProb7d: 0.03,
          failureProb30d: 0.09,
          rulHours: 1420,
          primaryRiskFactor: 'Nominal LED coaxial illuminator intensity within 1.2% tolerance',
          recommendedAction: 'Continue routine weekly optical target calibration',
          status: 'NOMINAL',
        },
      ];

      for (const m of maintSeeds) {
        const factory = factoryByCode.get(m.factoryCode);
        if (!factory) continue;
        await db
          .insert(maintenanceForecasts)
          .values({
            factoryId: factory.id,
            equipmentCode: m.equipmentCode,
            equipmentName: m.equipmentName,
            lineName: m.lineName,
            healthScore: m.healthScore,
            failureProb7d: m.failureProb7d,
            failureProb30d: m.failureProb30d,
            rulHours: m.rulHours,
            primaryRiskFactor: m.primaryRiskFactor,
            recommendedAction: m.recommendedAction,
            status: m.status,
            isSimulated: true,
          })
          .onConflictDoNothing({ target: maintenanceForecasts.equipmentCode });
      }
    }

    // Seed initial Counterfactual Factory Twin scenarios
    const existingScenarios = await db.select().from(counterfactualScenarios);
    if (existingScenarios.length === 0) {
      const fa = factoryByCode.get('FACTORY_A');
      const fb = factoryByCode.get('FACTORY_B');
      if (fa) {
        const baseA = Object.fromEntries(
          FACTORY_TWIN_PROFILES.FACTORY_A.parameters.map((p) => [p.key, p.baseline])
        );
        const cfA = { ...baseA, reflowPeakTempC: 245, solderPasteViscosity: 195, stencilWipeInterval: 5 };
        const resA = evaluateCounterfactualTwin('FACTORY_A', baseA, cfA);
        await db.insert(counterfactualScenarios).values({
          factoryId: fa.id,
          createdByUid: 'system-simulated-twin',
          title: 'Reflow Profile & Stencil Wipe Stabilization',
          targetDefect: 'Solder Bridge',
          baselineParams: baseA,
          counterfactualParams: cfA,
          baselineDefectProb: resA.baselineDefectProb,
          predictedDefectProb: resA.predictedDefectProb,
          riskDeltaPct: resA.riskDeltaPct,
          sensitivityBreakdown: resA.sensitivityBreakdown,
          aiInvestigationSummary:
            'Simulated Twin Estimate: Restoring Reflow Peak Temperature to 245°C, increasing solder paste viscosity to 195 Pa·s, and tightening stencil wipe intervals to every 5 boards reduces predicted Solder Bridge probability significantly by eliminating paste slump during peak wetting.',
          isSimulated: true,
        });
      }
      if (fb) {
        const baseB = Object.fromEntries(
          FACTORY_TWIN_PROFILES.FACTORY_B.parameters.map((p) => [p.key, p.baseline])
        );
        const cfB = { ...baseB, toolWearIndexPct: 22, spindleRpm: 8600, coolantPressureBar: 32 };
        const resB = evaluateCounterfactualTwin('FACTORY_B', baseB, cfB);
        await db.insert(counterfactualScenarios).values({
          factoryId: fb.id,
          createdByUid: 'system-simulated-twin',
          title: 'Carbide Tool Swap & Coolant Pressure Restoration',
          targetDefect: 'Hairline Crack',
          baselineParams: baseB,
          counterfactualParams: cfB,
          baselineDefectProb: resB.baselineDefectProb,
          predictedDefectProb: resB.predictedDefectProb,
          riskDeltaPct: resB.riskDeltaPct,
          sensitivityBreakdown: resB.sensitivityBreakdown,
          aiInvestigationSummary:
            'Simulated Twin Estimate: Swapping the worn carbide insert (72% to 22% wear), lowering spindle speed to 8,600 RPM, and restoring coolant pressure to 32 bar sharply mitigates thermal micro-cracking around precision bore edges.',
          isSimulated: true,
        });
      }
    }

    // Seed Billing Records for SUPER_ADMIN governance
    const existingBilling = await db.select().from(billingRecords);
    if (existingBilling.length === 0) {
      const billingSeeds = [
        { code: 'FACTORY_A', tier: 'ENTERPRISE', amount: 4800, period: '2026-11', status: 'PAID', ref: 'INV-PX-202611-A' },
        { code: 'FACTORY_B', tier: 'ENTERPRISE', amount: 4800, period: '2026-11', status: 'PAID', ref: 'INV-PX-202611-B' },
        { code: 'FACTORY_C', tier: 'GROWTH', amount: 2400, period: '2026-11', status: 'PAID', ref: 'INV-PX-202611-C' },
      ];
      for (const b of billingSeeds) {
        const factory = factoryByCode.get(b.code);
        if (!factory) continue;
        await db.insert(billingRecords).values({
          factoryId: factory.id,
          tier: b.tier,
          monthlyAmountUsd: b.amount,
          billingPeriod: b.period,
          status: b.status,
          invoiceRef: b.ref,
        });
      }
    }

    seedCompleted = true;
  } catch (error) {
    console.error('Simulated data seeding check failed:', error);
    throw new Error('Failed to initialize simulated platform records.', { cause: error });
  }
}

export async function getFactoryById(factoryId: number) {
  try {
    const rows = await db.select().from(factories).where(eq(factories.id, factoryId));
    return rows[0] ?? null;
  } catch (error) {
    console.error('Factory lookup failed:', error);
    throw new Error('Unable to retrieve factory record.', { cause: error });
  }
}
