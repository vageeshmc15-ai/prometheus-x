import type {
  InspectionRecord,
  MaintenanceForecastRecord,
} from '../types/prometheus';

export type TwinStationId = 'station1' | 'station2' | 'station3';

export interface StationMeta {
  id: TwinStationId;
  shortLabel: string;
  fullLabel: string;
  role: string;
}

export interface StationInspectionSummary {
  meta: StationMeta;
  inspections: InspectionRecord[];
  defectiveInspections: InspectionRecord[];
  alertInspections: InspectionRecord[];
  hasAlert: boolean;
  alertSeverity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'NOMINAL';
  alertCount: number;
  maintenanceAlert: MaintenanceForecastRecord | null;
  latestInspection: InspectionRecord | null;
}

export interface FactoryLineStatusSummary {
  operationalStatus: 'ALERT' | 'WATCH' | 'RUNNING';
  operationalLabel: string;
  dataMode: 'LIVE' | 'SIMULATED' | 'MIXED';
  dataModeLabel: string;
  liveCount: number;
  simulatedCount: number;
  totalInspections: number;
  defectiveCount: number;
  activeAlertCount: number;
}

export function getStationMetadata(factoryCode: string): Record<TwinStationId, StationMeta> {
  if (factoryCode === 'FACTORY_B') {
    return {
      station1: {
        id: 'station1',
        shortLabel: 'CNC Cell',
        fullLabel: 'Station 01 · 5-Axis CNC Cell',
        role: 'Precision milling & bore machining',
      },
      station2: {
        id: 'station2',
        shortLabel: 'Stamping Press',
        fullLabel: 'Station 02 · 800T Stamping Press',
        role: 'Forming & structural flange die press',
      },
      station3: {
        id: 'station3',
        shortLabel: 'AOI Bridge',
        fullLabel: 'Station 03 · Optical AOI Bridge',
        role: 'Final inline surface metrology & crack inspection',
      },
    };
  }

  if (factoryCode === 'FACTORY_C') {
    return {
      station1: {
        id: 'station1',
        shortLabel: 'Flux Washer',
        fullLabel: 'Station 01 · Aqueous Flux Washer',
        role: 'Post-solder ionic residue & flux cleaning',
      },
      station2: {
        id: 'station2',
        shortLabel: 'Coating Cell',
        fullLabel: 'Station 02 · Conformal Coating Cell',
        role: 'ECU dielectric seal & particulate control',
      },
      station3: {
        id: 'station3',
        shortLabel: 'AOI Bridge',
        fullLabel: 'Station 03 · Optical AOI Bridge',
        role: 'Final inline ECU optical verification',
      },
    };
  }

  return {
    station1: {
      id: 'station1',
      shortLabel: 'Reflow Oven',
      fullLabel: 'Station 01 · 10-Zone Reflow Oven',
      role: 'Thermal solder paste profile & fillet bonding',
    },
    station2: {
      id: 'station2',
      shortLabel: 'Pick & Place',
      fullLabel: 'Station 02 · Pick-and-Place Gantry',
      role: 'High-speed SMD & micro-BGA placement',
    },
    station3: {
      id: 'station3',
      shortLabel: 'AOI Bridge',
      fullLabel: 'Station 03 · Optical AOI Bridge',
      role: 'Final inline coaxial PCB defect inspection',
    },
  };
}

export function mapInspectionToStation(
  record: InspectionRecord,
  factoryCode: string
): TwinStationId {
  const haystack = `${record.lineName} ${record.defectType}`.toLowerCase();

  if (haystack.includes('aoi') || haystack.includes('optical') || haystack.includes('station 03')) {
    return 'station3';
  }

  if (factoryCode === 'FACTORY_B') {
    if (
      haystack.includes('stamp') ||
      haystack.includes('press') ||
      haystack.includes('dent') ||
      haystack.includes('irregular') ||
      haystack.includes('station 02')
    ) {
      return 'station2';
    }
    if (
      haystack.includes('cnc') ||
      haystack.includes('crack') ||
      haystack.includes('scratch') ||
      haystack.includes('machin') ||
      haystack.includes('spindle') ||
      haystack.includes('station 01')
    ) {
      return 'station1';
    }
    return 'station3';
  }

  if (factoryCode === 'FACTORY_C') {
    if (
      haystack.includes('coat') ||
      haystack.includes('clean') ||
      haystack.includes('dust') ||
      haystack.includes('particulate') ||
      haystack.includes('blister') ||
      haystack.includes('station 02')
    ) {
      return 'station2';
    }
    if (
      haystack.includes('wash') ||
      haystack.includes('flux') ||
      haystack.includes('reflow') ||
      haystack.includes('solder') ||
      haystack.includes('contam') ||
      haystack.includes('station 01')
    ) {
      return 'station1';
    }
    return 'station3';
  }

  // FACTORY_A (Electronics / SMT)
  if (
    haystack.includes('pick') ||
    haystack.includes('place') ||
    haystack.includes('gantry') ||
    haystack.includes('misalign') ||
    haystack.includes('missing') ||
    haystack.includes('station 02')
  ) {
    return 'station2';
  }
  if (
    haystack.includes('reflow') ||
    haystack.includes('oven') ||
    haystack.includes('solder') ||
    haystack.includes('bridge') ||
    haystack.includes('void') ||
    haystack.includes('delam') ||
    haystack.includes('station 01')
  ) {
    return 'station1';
  }
  return 'station3';
}

export function isInspectionAlert(record: InspectionRecord): boolean {
  if (record.humanReviewStatus === 'FALSE_POSITIVE') return false;
  return (
    record.severity === 'CRITICAL' ||
    record.severity === 'HIGH' ||
    record.reliabilityStatus === 'UNSTABLE' ||
    record.reliabilityStatus === 'REVIEW_REQUIRED'
  );
}

export function buildStationSummaries(
  factoryCode: string,
  factoryInspections: InspectionRecord[],
  factoryMaintenance: MaintenanceForecastRecord[]
): Record<TwinStationId, StationInspectionSummary> {
  const metas = getStationMetadata(factoryCode);
  const buckets: Record<TwinStationId, InspectionRecord[]> = {
    station1: [],
    station2: [],
    station3: [],
  };

  for (const rec of factoryInspections) {
    const st = mapInspectionToStation(rec, factoryCode);
    buckets[st].push(rec);
    // Station 3 (AOI Bridge) inspects every workpiece exiting the line,
    // so keep all AOI-logged records visible when inspecting Station 3 if it has no direct-only items
    if (st !== 'station3') {
      buckets.station3.push(rec);
    }
  }

  const findMaint = (stationId: TwinStationId): MaintenanceForecastRecord | null => {
    const keywords =
      stationId === 'station1'
        ? ['reflow', 'oven', 'cnc', 'spindle', 'wash', 'flux']
        : stationId === 'station2'
          ? ['pick', 'place', 'gantry', 'stamp', 'press', 'coat']
          : ['aoi', 'camera', 'optical', 'vision', 'sensor'];

    return (
      factoryMaintenance.find((m) => {
        const txt = `${m.equipmentName} ${m.lineName}`.toLowerCase();
        return (
          (m.status === 'MAINTENANCE_REQUIRED' || m.status === 'WATCH') &&
          keywords.some((k) => txt.includes(k))
        );
      }) ?? null
    );
  };

  const result = {} as Record<TwinStationId, StationInspectionSummary>;
  for (const id of ['station1', 'station2', 'station3'] as TwinStationId[]) {
    const list = buckets[id];
    const defective = list.filter((i) => i.severity !== 'PASS');
    const alerts = list.filter(isInspectionAlert);
    const maint = findMaint(id);
    const hasCritical =
      alerts.some((a) => a.severity === 'CRITICAL') ||
      maint?.status === 'MAINTENANCE_REQUIRED';
    const hasHigh =
      alerts.some((a) => a.severity === 'HIGH' || a.reliabilityStatus === 'UNSTABLE') ||
      maint?.status === 'WATCH';
    const hasMedium = alerts.length > 0;

    result[id] = {
      meta: metas[id],
      inspections: list,
      defectiveInspections: defective,
      alertInspections: alerts,
      hasAlert: alerts.length > 0 || maint !== null,
      alertSeverity: hasCritical ? 'CRITICAL' : hasHigh ? 'HIGH' : hasMedium ? 'MEDIUM' : 'NOMINAL',
      alertCount: alerts.length + (maint ? 1 : 0),
      maintenanceAlert: maint,
      latestInspection: list[0] ?? null,
    };
  }

  return result;
}

export function buildFactoryLineStatus(
  factoryInspections: InspectionRecord[],
  factoryMaintenance: MaintenanceForecastRecord[]
): FactoryLineStatusSummary {
  const liveCount = factoryInspections.filter((i) => !i.isSimulated).length;
  const simulatedCount = factoryInspections.filter((i) => i.isSimulated).length;
  const defectiveCount = factoryInspections.filter((i) => i.severity !== 'PASS').length;
  const inspectionAlerts = factoryInspections.filter(isInspectionAlert);
  const maintAlerts = factoryMaintenance.filter(
    (m) => m.status === 'MAINTENANCE_REQUIRED' || m.status === 'WATCH'
  );

  const hasCritical =
    inspectionAlerts.some((i) => i.severity === 'CRITICAL') ||
    maintAlerts.some((m) => m.status === 'MAINTENANCE_REQUIRED');
  const hasWatch = inspectionAlerts.length > 0 || maintAlerts.length > 0;

  const operationalStatus: FactoryLineStatusSummary['operationalStatus'] = hasCritical
    ? 'ALERT'
    : hasWatch
      ? 'WATCH'
      : 'RUNNING';

  const operationalLabel =
    operationalStatus === 'ALERT'
      ? 'Alert Active'
      : operationalStatus === 'WATCH'
        ? 'Watch · Review Needed'
        : 'Running Nominal';

  const dataMode: FactoryLineStatusSummary['dataMode'] =
    liveCount > 0 && simulatedCount > 0
      ? 'MIXED'
      : liveCount > 0
        ? 'LIVE'
        : 'SIMULATED';

  const dataModeLabel =
    dataMode === 'MIXED'
      ? `Live + Simulated (${liveCount} live / ${simulatedCount} sim)`
      : dataMode === 'LIVE'
        ? `Live Inspection Feed (${liveCount} records)`
        : `Simulated Line Telemetry (${simulatedCount} records)`;

  return {
    operationalStatus,
    operationalLabel,
    dataMode,
    dataModeLabel,
    liveCount,
    simulatedCount,
    totalInspections: factoryInspections.length,
    defectiveCount,
    activeAlertCount: inspectionAlerts.length + maintAlerts.length,
  };
}
