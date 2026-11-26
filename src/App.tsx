import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MessageSquare, Plus, Server } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { apiClient, extractApiError } from './lib/api';
import type {
  CounterfactualScenarioRecord,
  InspectionRecord,
  MaintenanceForecastRecord,
} from './types/prometheus';
import type { SimulatedInspectionSample } from './lib/cv-engine';
import { AuthGate } from './components/auth/AuthGate';
import { AppShell, type WorkspaceTab } from './components/layout/AppShell';
import { CommandOverview } from './components/overview/CommandOverview';
import { InspectionStudio } from './components/inspection/InspectionStudio';
import { DefectPassportDrawer } from './components/passport/DefectPassportDrawer';
import { CrossFactoryView } from './components/crossfactory/CrossFactoryView';
import { CounterfactualTwin } from './components/twin/CounterfactualTwin';
import { FeedbackLoopView } from './components/feedback/FeedbackLoopView';
import { MaintenanceView } from './components/maintenance/MaintenanceView';
import { GovernanceAdminView } from './components/admin/GovernanceAdminView';
import { DashboardChatbot } from './components/assistant/DashboardChatbot';
import { BackendOutputModal } from './components/api/BackendOutputModal';
import { Button } from './components/ui/primitives';

function AuthenticatedWorkspace() {
  const { profile, factories, loading, refreshProfile } = useAuth();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('overview');
  const [selectedFactoryId, setSelectedFactoryId] = useState<number | 'ALL'>('ALL');
  const [inspections, setInspections] = useState<InspectionRecord[]>([]);
  const [samples, setSamples] = useState<SimulatedInspectionSample[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceForecastRecord[]>([]);
  const [scenarios, setScenarios] = useState<CounterfactualScenarioRecord[]>([]);
  const [selectedPassport, setSelectedPassport] = useState<InspectionRecord | null>(null);
  const [chatbotOpen, setChatbotOpen] = useState(false);
  const [backendModalOpen, setBackendModalOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    return (
      window.location.hash === '#backend' ||
      new URLSearchParams(window.location.search).get('backend') === '1'
    );
  });
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  const isAuthorizedActive = Boolean(profile && profile.accountStatus === 'ACTIVE');

  const loadWorkspaceData = useCallback(async () => {
    if (!isAuthorizedActive) return;
    setDataLoading(true);
    setDataError(null);
    try {
      const [insRes, sampRes, maintRes, cfRes] = await Promise.all([
        apiClient.get<InspectionRecord[]>('/inspections'),
        apiClient.get<SimulatedInspectionSample[]>('/samples'),
        apiClient.get<MaintenanceForecastRecord[]>('/maintenance'),
        apiClient.get<CounterfactualScenarioRecord[]>('/counterfactuals'),
      ]);
      setInspections(insRes.data);
      setSamples(sampRes.data);
      setMaintenance(maintRes.data);
      setScenarios(cfRes.data);
    } catch (err) {
      setDataError(extractApiError(err, 'Unable to load factory data from server.'));
    } finally {
      setDataLoading(false);
    }
  }, [isAuthorizedActive]);

  useEffect(() => {
    if (isAuthorizedActive) {
      void loadWorkspaceData();
    } else {
      setInspections([]);
      setSamples([]);
      setMaintenance([]);
      setScenarios([]);
      setSelectedPassport(null);
    }
  }, [isAuthorizedActive, loadWorkspaceData]);

  const scopedInspections = useMemo(
    () =>
      selectedFactoryId === 'ALL'
        ? inspections
        : inspections.filter((i) => i.factoryId === selectedFactoryId),
    [inspections, selectedFactoryId]
  );

  const scopedMaintenance = useMemo(
    () =>
      selectedFactoryId === 'ALL'
        ? maintenance
        : maintenance.filter((m) => m.factoryId === selectedFactoryId),
    [maintenance, selectedFactoryId]
  );

  const upsertInspection = (record: InspectionRecord) => {
    setInspections((prev) => {
      const idx = prev.findIndex((item) => item.id === record.id);
      if (idx >= 0) {
        const merged: InspectionRecord = {
          ...prev[idx],
          ...record,
          factoryName: record.factoryName ?? prev[idx].factoryName,
          factoryCode: record.factoryCode ?? prev[idx].factoryCode,
        };
        const next = [...prev];
        next[idx] = merged;
        return next;
      }
      return [record, ...prev];
    });
    setSelectedPassport((prev) =>
      prev && prev.id === record.id
        ? {
            ...prev,
            ...record,
            factoryName: record.factoryName ?? prev.factoryName,
            factoryCode: record.factoryCode ?? prev.factoryCode,
          }
        : prev
    );
  };

  if (loading && !profile) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center text-sm text-slate-500 dark:text-slate-400">
        Loading workspace...
      </div>
    );
  }

  if (!isAuthorizedActive) {
    return <AuthGate />;
  }

  return (
    <AppShell
      activeTab={activeTab}
      onTabChange={setActiveTab}
      selectedFactoryId={selectedFactoryId}
      onFactoryChange={setSelectedFactoryId}
      secondaryAction={
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setBackendModalOpen(true)}
          >
            <Server className="h-3.5 w-3.5 text-slate-600 dark:text-slate-300" />
            <span className="hidden sm:inline">Backend API</span>
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setChatbotOpen((prev) => !prev)}
            aria-expanded={chatbotOpen}
          >
            <MessageSquare className="h-3.5 w-3.5 text-slate-600 dark:text-slate-300" />
            <span className="hidden sm:inline">{chatbotOpen ? 'Close Assistant' : 'Assistant'}</span>
          </Button>
        </div>
      }
      primaryAction={
        <Button size="sm" onClick={() => setActiveTab('inspection')}>
          <Plus className="h-3.5 w-3.5" />
          New Inspection
        </Button>
      }
    >
      {dataError && (
        <div className="mb-6 rounded-md border border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/50 px-4 py-3 text-sm text-red-700 dark:text-red-400 flex items-center justify-between gap-4">
          <span>{dataError}</span>
          <Button size="sm" variant="secondary" onClick={() => void loadWorkspaceData()}>
            Retry
          </Button>
        </div>
      )}

      {dataLoading && inspections.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-12 text-center text-sm text-slate-500 dark:text-slate-400">
          Loading inspection records and site metrics...
        </div>
      ) : (
        <>
          {activeTab === 'overview' && (
            <CommandOverview
              factories={factories}
              inspections={scopedInspections}
              maintenance={scopedMaintenance}
              onSelectPassport={setSelectedPassport}
              onNavigateInspection={() => setActiveTab('inspection')}
              onNavigateTwin={() => setActiveTab('twin')}
              onNavigateMaintenance={() => setActiveTab('maintenance')}
            />
          )}

          {activeTab === 'inspection' && (
            <InspectionStudio
              factories={factories}
              samples={samples}
              onInspectionCreated={upsertInspection}
              onOpenPassport={setSelectedPassport}
            />
          )}

          {activeTab === 'cross-factory' && <CrossFactoryView />}

          {activeTab === 'twin' && (
            <CounterfactualTwin
              factories={factories}
              globalFactoryId={selectedFactoryId}
              inspections={inspections}
              maintenance={maintenance}
              scenarios={scenarios}
              onScenarioSaved={(rec) => setScenarios((prev) => [rec, ...prev])}
              onInspectionCreated={upsertInspection}
              onOpenPassport={setSelectedPassport}
            />
          )}

          {activeTab === 'feedback' && (
            <FeedbackLoopView inspections={scopedInspections} onUpdated={upsertInspection} />
          )}

          {activeTab === 'maintenance' && (
            <MaintenanceView
              factories={factories}
              forecasts={scopedMaintenance}
              onUpdated={(rec) =>
                setMaintenance((prev) => prev.map((m) => (m.id === rec.id ? rec : m)))
              }
            />
          )}

          {activeTab === 'governance' && (
            <GovernanceAdminView onFactoriesChanged={refreshProfile} />
          )}
        </>
      )}

      <DefectPassportDrawer
        passport={selectedPassport}
        onClose={() => setSelectedPassport(null)}
        onUpdated={upsertInspection}
      />

      <DashboardChatbot
        open={chatbotOpen}
        onOpenChange={setChatbotOpen}
        activeTab={activeTab}
        selectedFactoryId={selectedFactoryId}
        factories={factories}
      />

      <BackendOutputModal
        open={backendModalOpen}
        onClose={() => setBackendModalOpen(false)}
      />
    </AppShell>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AuthenticatedWorkspace />
      </AuthProvider>
    </ThemeProvider>
  );
}
