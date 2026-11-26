export interface TwinParameterSpec {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  nominal: number;
  baseline: number;
  weight: number;
  direction: 'higher_worse' | 'lower_worse' | 'deviation_worse';
}

export interface FactoryTwinProfile {
  factoryCode: 'FACTORY_A' | 'FACTORY_B' | 'FACTORY_C';
  defaultTargetDefect: string;
  parameters: TwinParameterSpec[];
}

export const FACTORY_TWIN_PROFILES: Record<string, FactoryTwinProfile> = {
  FACTORY_A: {
    factoryCode: 'FACTORY_A',
    defaultTargetDefect: 'Solder Bridge',
    parameters: [
      {
        key: 'reflowPeakTempC',
        label: 'Reflow Peak Temperature',
        unit: '°C',
        min: 225,
        max: 270,
        step: 1,
        nominal: 245,
        baseline: 256,
        weight: 0.31,
        direction: 'deviation_worse',
      },
      {
        key: 'solderPasteViscosity',
        label: 'Solder Paste Viscosity',
        unit: 'Pa·s',
        min: 140,
        max: 260,
        step: 2,
        nominal: 195,
        baseline: 168,
        weight: 0.25,
        direction: 'lower_worse',
      },
      {
        key: 'conveyorSpeedCmMin',
        label: 'Conveyor Belt Speed',
        unit: 'cm/min',
        min: 55,
        max: 115,
        step: 1,
        nominal: 82,
        baseline: 96,
        weight: 0.19,
        direction: 'deviation_worse',
      },
      {
        key: 'ambientHumidityPct',
        label: 'SMT Bay Relative Humidity',
        unit: '%RH',
        min: 30,
        max: 75,
        step: 1,
        nominal: 45,
        baseline: 59,
        weight: 0.15,
        direction: 'higher_worse',
      },
      {
        key: 'stencilWipeInterval',
        label: 'Stencil Wipe Interval',
        unit: 'boards',
        min: 2,
        max: 20,
        step: 1,
        nominal: 5,
        baseline: 13,
        weight: 0.1,
        direction: 'higher_worse',
      },
    ],
  },
  FACTORY_B: {
    factoryCode: 'FACTORY_B',
    defaultTargetDefect: 'Hairline Crack',
    parameters: [
      {
        key: 'spindleRpm',
        label: 'CNC Spindle Speed',
        unit: 'RPM',
        min: 4000,
        max: 14000,
        step: 200,
        nominal: 8500,
        baseline: 11400,
        weight: 0.28,
        direction: 'higher_worse',
      },
      {
        key: 'toolWearIndexPct',
        label: 'Carbide Tool Wear Index',
        unit: '%',
        min: 5,
        max: 95,
        step: 1,
        nominal: 25,
        baseline: 72,
        weight: 0.3,
        direction: 'higher_worse',
      },
      {
        key: 'coolantPressureBar',
        label: 'Coolant Nozzle Pressure',
        unit: 'bar',
        min: 10,
        max: 45,
        step: 1,
        nominal: 32,
        baseline: 19,
        weight: 0.18,
        direction: 'lower_worse',
      },
      {
        key: 'stampingDieForceKn',
        label: 'Stamping Die Force',
        unit: 'kN',
        min: 400,
        max: 900,
        step: 10,
        nominal: 620,
        baseline: 760,
        weight: 0.14,
        direction: 'deviation_worse',
      },
      {
        key: 'spindleVibrationMmS',
        label: 'Spindle RMS Vibration',
        unit: 'mm/s',
        min: 0.4,
        max: 6.0,
        step: 0.1,
        nominal: 1.2,
        baseline: 3.6,
        weight: 0.1,
        direction: 'higher_worse',
      },
    ],
  },
  FACTORY_C: {
    factoryCode: 'FACTORY_C',
    defaultTargetDefect: 'Flux Contamination',
    parameters: [
      {
        key: 'reflowPeakTempC',
        label: 'ECU Reflow Peak Temp',
        unit: '°C',
        min: 225,
        max: 270,
        step: 1,
        nominal: 244,
        baseline: 254,
        weight: 0.26,
        direction: 'deviation_worse',
      },
      {
        key: 'fluxWashPressurePsi',
        label: 'Post-Solder Wash Pressure',
        unit: 'PSI',
        min: 15,
        max: 65,
        step: 1,
        nominal: 45,
        baseline: 26,
        weight: 0.32,
        direction: 'lower_worse',
      },
      {
        key: 'cleanroomDustPpm',
        label: 'Enclosure Bay Particulates',
        unit: 'PPM',
        min: 10,
        max: 160,
        step: 2,
        nominal: 28,
        baseline: 86,
        weight: 0.18,
        direction: 'higher_worse',
      },
      {
        key: 'ambientHumidityPct',
        label: 'Coating Cell Humidity',
        unit: '%RH',
        min: 28,
        max: 72,
        step: 1,
        nominal: 42,
        baseline: 58,
        weight: 0.14,
        direction: 'higher_worse',
      },
      {
        key: 'conformalCureTempC',
        label: 'Conformal Cure Oven Temp',
        unit: '°C',
        min: 65,
        max: 120,
        step: 1,
        nominal: 88,
        baseline: 103,
        weight: 0.1,
        direction: 'deviation_worse',
      },
    ],
  },
};

function computeParameterStress(spec: TwinParameterSpec, value: number): number {
  const span = Math.max(1e-6, spec.max - spec.min);
  if (spec.direction === 'higher_worse') {
    return Math.max(0, Math.min(1, (value - spec.nominal) / (spec.max - spec.nominal + 1e-6)));
  }
  if (spec.direction === 'lower_worse') {
    return Math.max(0, Math.min(1, (spec.nominal - value) / (spec.nominal - spec.min + 1e-6)));
  }
  // deviation_worse
  const dev = Math.abs(value - spec.nominal) / (span * 0.48);
  return Math.max(0, Math.min(1, dev));
}

export function evaluateCounterfactualTwin(
  factoryCode: string,
  baselineParams: Record<string, number>,
  counterfactualParams: Record<string, number>
) {
  const profile = FACTORY_TWIN_PROFILES[factoryCode] ?? FACTORY_TWIN_PROFILES.FACTORY_A;

  const evalSet = (params: Record<string, number>) => {
    let linearRisk = 0.04;
    const perParam: Record<string, number> = {};
    for (const spec of profile.parameters) {
      const v = params[spec.key] ?? spec.baseline;
      const stress = computeParameterStress(spec, v);
      // Nonlinear interaction curve
      const contrib = spec.weight * (0.65 * stress + 0.35 * stress * stress);
      perParam[spec.key] = contrib;
      linearRisk += contrib * 0.88;
    }
    // Cross-term synergy (e.g. high temp + high humidity or high RPM + tool wear)
    const keys = profile.parameters.map((p) => p.key);
    const synergy = (perParam[keys[0]] ?? 0) * (perParam[keys[1]] ?? 0) * 1.4;
    const probability = Math.max(0.02, Math.min(0.96, linearRisk + synergy));
    return { probability, perParam };
  };

  const baseEval = evalSet(baselineParams);
  const cfEval = evalSet(counterfactualParams);

  const sensitivityBreakdown = profile.parameters.map((spec) => {
    const delta = (cfEval.perParam[spec.key] ?? 0) - (baseEval.perParam[spec.key] ?? 0);
    const contributionPct = Math.round(delta * 1000) / 10;
    return {
      parameter: spec.label,
      contributionPct,
      direction:
        contributionPct < -0.2
          ? 'Reduces Risk'
          : contributionPct > 0.2
            ? 'Increases Risk'
            : 'Neutral',
    };
  });

  const baselineDefectProb = Math.round(baseEval.probability * 1000) / 1000;
  const predictedDefectProb = Math.round(cfEval.probability * 1000) / 1000;
  const riskDeltaPct = Math.round((predictedDefectProb - baselineDefectProb) * 1000) / 10;

  return {
    baselineDefectProb,
    predictedDefectProb,
    riskDeltaPct,
    sensitivityBreakdown,
  };
}

export interface TwinScanResult {
  scanId: string;
  scannedAt: string;
  factoryCode: string;
  defectDetected: boolean;
  defectType: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'PASS';
  confidencePct: number;
  defectProbPct: number;
  originStation: 'station1' | 'station2' | 'station3';
  originStationLabel: string;
  zoneLabel: string;
  hotspotLocal: { x: number; z: number };
  primaryDriver: {
    key: string;
    label: string;
    currentValue: number;
    nominalValue: number;
    unit: string;
    stressPct: number;
  };
  secondaryDriver: {
    label: string;
    currentValue: number;
    nominalValue: number;
    unit: string;
  } | null;
  measuredTelemetry: {
    deviationMicrons: number;
    thermalDeltaC: number;
    surfaceAnomalyIdx: number;
  };
  correctiveAction: string;
  sampleIdForPassport: string;
}

export function scanFactoryTwinDefect(
  factoryCode: string,
  params: Record<string, number>
): TwinScanResult {
  const profile = FACTORY_TWIN_PROFILES[factoryCode] ?? FACTORY_TWIN_PROFILES.FACTORY_A;
  const baselineParams = Object.fromEntries(profile.parameters.map((p) => [p.key, p.baseline]));
  const evalResult = evaluateCounterfactualTwin(profile.factoryCode, baselineParams, params);

  const ranked = profile.parameters
    .map((spec) => {
      const currentValue = params[spec.key] ?? spec.baseline;
      const stress = computeParameterStress(spec, currentValue);
      return {
        spec,
        currentValue,
        stress,
        weightedStress: stress * spec.weight,
      };
    })
    .sort((a, b) => b.weightedStress - a.weightedStress);

  const top = ranked[0];
  const second = ranked[1] ?? null;
  const prob = evalResult.predictedDefectProb;
  const defectProbPct = Math.round(prob * 1000) / 10;
  const scanId = `SCAN-${profile.factoryCode.replace('FACTORY_', 'F')}-${Math.floor(1000 + Math.random() * 9000)}`;

  // Clean pass when process parameters are stabilized near nominal specification
  if (prob < 0.14 || top.stress < 0.16) {
    return {
      scanId,
      scannedAt: new Date().toISOString(),
      factoryCode: profile.factoryCode,
      defectDetected: false,
      defectType: 'No Defect Detected (Nominal)',
      severity: 'PASS',
      confidencePct: Math.round((96.5 - prob * 20) * 10) / 10,
      defectProbPct,
      originStation: 'station3',
      originStationLabel: 'Station 03 · 3D Optical AOI Bridge',
      zoneLabel: 'Full Workpiece Surface Geometry',
      hotspotLocal: { x: 0, z: 0 },
      primaryDriver: {
        key: top.spec.key,
        label: top.spec.label,
        currentValue: top.currentValue,
        nominalValue: top.spec.nominal,
        unit: top.spec.unit,
        stressPct: Math.round(top.stress * 100),
      },
      secondaryDriver: second
        ? {
            label: second.spec.label,
            currentValue: second.currentValue,
            nominalValue: second.spec.nominal,
            unit: second.spec.unit,
          }
        : null,
      measuredTelemetry: {
        deviationMicrons: Math.round((3.2 + prob * 14) * 10) / 10,
        thermalDeltaC: Math.round((0.8 + prob * 4) * 10) / 10,
        surfaceAnomalyIdx: Math.round((0.04 + prob * 0.25) * 1000) / 1000,
      },
      correctiveAction: 'All scanned tolerances are within IPC/ISO specification. Maintain current line recipe.',
      sampleIdForPassport:
        profile.factoryCode === 'FACTORY_B'
          ? 'auto-machined-crack'
          : profile.factoryCode === 'FACTORY_C'
            ? 'auto-ecu-contamination'
            : 'pcb-solder-bridge',
    };
  }

  // Determine exact defect class, origin station, 3D hotspot coordinates & corrective fix from dominant physical driver
  let defectType = profile.defaultTargetDefect;
  let originStation: 'station1' | 'station2' | 'station3' = 'station1';
  let originStationLabel = 'Station 01 · 10-Zone Reflow Oven';
  let zoneLabel = 'Fine-Pitch QFP Lead Array (Pins 14–16)';
  let hotspotLocal = { x: 0.22, z: 0.14 };
  let correctiveAction = '';
  let sampleIdForPassport = 'pcb-solder-bridge';

  if (profile.factoryCode === 'FACTORY_A') {
    if (top.spec.key === 'conveyorSpeedCmMin') {
      defectType = 'Component Misalignment';
      originStation = 'station2';
      originStationLabel = 'Station 02 · Pick-and-Place Gantry';
      zoneLabel = 'U14 Micro-BGA Placement Pad (+4.2° skew)';
      hotspotLocal = { x: -0.08, z: -0.06 };
      correctiveAction = `Re-synchronize conveyor speed from ${top.currentValue} to ${top.spec.nominal} ${top.spec.unit} and recalibrate vision fiducial offset on Pick-and-Place head.`;
      sampleIdForPassport = 'pcb-component-misalign';
    } else if (top.spec.key === 'ambientHumidityPct') {
      defectType = 'Moisture Delamination & Solder Void';
      originStation = 'station1';
      originStationLabel = 'Station 01 · 10-Zone Reflow Oven';
      zoneLabel = 'Thermal Soak Pad & Solder Fillet Edge';
      hotspotLocal = { x: -0.24, z: 0.18 };
      correctiveAction = `Reduce SMT bay humidity from ${top.currentValue}% to ${top.spec.nominal}% RH and verify dry-cabinet MSL storage before reflow.`;
      sampleIdForPassport = 'pcb-solder-bridge';
    } else {
      defectType = 'Solder Bridge';
      originStation = 'station1';
      originStationLabel = 'Station 01 · 10-Zone Reflow Oven';
      zoneLabel = 'QFP Lead Pitch Bridge (0.4 mm pad clearance)';
      hotspotLocal = { x: 0.26, z: 0.12 };
      correctiveAction = `Tune ${top.spec.label} from ${top.currentValue} to ${top.spec.nominal} ${top.spec.unit} and tighten stencil wipe cadence to eliminate excess paste slumping.`;
      sampleIdForPassport = 'pcb-solder-bridge';
    }
  } else if (profile.factoryCode === 'FACTORY_B') {
    if (top.spec.key === 'stampingDieForceKn') {
      defectType = 'Stamping Die Dent & Surface Irregularity';
      originStation = 'station2';
      originStationLabel = 'Station 02 · 800T Stamping Press';
      zoneLabel = 'Outer Flange Crown Radius';
      hotspotLocal = { x: -0.2, z: 0.14 };
      correctiveAction = `Adjust stamping die force from ${top.currentValue} to ${top.spec.nominal} ${top.spec.unit} and inspect hydraulic cushion nitrogen pressure.`;
      sampleIdForPassport = 'auto-body-dent';
    } else if (top.spec.key === 'spindleVibrationMmS' || top.spec.key === 'coolantPressureBar') {
      defectType = 'Machining Chatter & Surface Scratch';
      originStation = 'station1';
      originStationLabel = 'Station 01 · 5-Axis CNC Cell';
      zoneLabel = 'Precision Machined Chamfer Face';
      hotspotLocal = { x: 0.2, z: -0.14 };
      correctiveAction = `Restore ${top.spec.label} from ${top.currentValue} to ${top.spec.nominal} ${top.spec.unit}, balance tool holder collet, and flush high-pressure coolant nozzles.`;
      sampleIdForPassport = 'auto-machined-crack';
    } else {
      defectType = 'Hairline Crack';
      originStation = 'station1';
      originStationLabel = 'Station 01 · 5-Axis CNC Cell';
      zoneLabel = 'Bearing Journal Inner Bore Wall';
      hotspotLocal = { x: 0.08, z: 0.16 };
      correctiveAction = `Replace worn carbide insert and bring ${top.spec.label} from ${top.currentValue} to ${top.spec.nominal} ${top.spec.unit} to eliminate micro-fracture stress.`;
      sampleIdForPassport = 'auto-machined-crack';
    }
  } else {
    // FACTORY_C — Automotive Electronics (ECU)
    if (top.spec.key === 'cleanroomDustPpm') {
      defectType = 'Particulate Surface Contamination';
      originStation = 'station2';
      originStationLabel = 'Station 02 · Conformal Coating Cell';
      zoneLabel = 'ECU High-Density Interconnect Bus';
      hotspotLocal = { x: -0.16, z: 0.15 };
      correctiveAction = `Replace HEPA intake pre-filters to drop bay particulates from ${top.currentValue} to ${top.spec.nominal} ${top.spec.unit} and purge coating nozzle shroud.`;
      sampleIdForPassport = 'auto-ecu-contamination';
    } else if (top.spec.key === 'conformalCureTempC' || top.spec.key === 'ambientHumidityPct') {
      defectType = 'Conformal Coating Blister & Delamination';
      originStation = 'station2';
      originStationLabel = 'Station 02 · Conformal Coating Cell';
      zoneLabel = 'Power MOSFET Perimeter Seal';
      hotspotLocal = { x: 0.06, z: -0.18 };
      correctiveAction = `Stabilize ${top.spec.label} from ${top.currentValue} to ${top.spec.nominal} ${top.spec.unit} and verify UV/thermal cure ramp rate.`;
      sampleIdForPassport = 'auto-ecu-contamination';
    } else {
      defectType = 'Flux Contamination';
      originStation = 'station1';
      originStationLabel = 'Station 01 · Aqueous Flux Washer';
      zoneLabel = 'CAN-Bus Pin Header Dielectric Corridor';
      hotspotLocal = { x: 0.24, z: -0.1 };
      correctiveAction = `Restore ${top.spec.label} from ${top.currentValue} to ${top.spec.nominal} ${top.spec.unit} and inspect inline wash manifold nozzles for clogging.`;
      sampleIdForPassport = 'auto-ecu-contamination';
    }
  }

  const severity: TwinScanResult['severity'] =
    prob >= 0.52 ? 'CRITICAL' : prob >= 0.34 ? 'HIGH' : prob >= 0.22 ? 'MEDIUM' : 'LOW';

  const confidencePct = Math.round(Math.min(98.8, 81.5 + prob * 18.2) * 10) / 10;

  return {
    scanId,
    scannedAt: new Date().toISOString(),
    factoryCode: profile.factoryCode,
    defectDetected: true,
    defectType,
    severity,
    confidencePct,
    defectProbPct,
    originStation,
    originStationLabel,
    zoneLabel,
    hotspotLocal,
    primaryDriver: {
      key: top.spec.key,
      label: top.spec.label,
      currentValue: top.currentValue,
      nominalValue: top.spec.nominal,
      unit: top.spec.unit,
      stressPct: Math.round(top.stress * 100),
    },
    secondaryDriver: second
      ? {
          label: second.spec.label,
          currentValue: second.currentValue,
          nominalValue: second.spec.nominal,
          unit: second.spec.unit,
        }
      : null,
    measuredTelemetry: {
      deviationMicrons: Math.round((18 + prob * 145) * 10) / 10,
      thermalDeltaC: Math.round((2.4 + top.stress * 14.8) * 10) / 10,
      surfaceAnomalyIdx: Math.round((0.28 + prob * 0.68) * 1000) / 1000,
    },
    correctiveAction,
    sampleIdForPassport,
  };
}

