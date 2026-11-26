import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight,
  MessageSquare,
  RefreshCw,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { apiClient, extractApiError } from '../../lib/api';
import type {
  AssistantChatResponse,
  DashboardTabId,
  FactoryRecord,
} from '../../types/prometheus';
import { cn } from '../../lib/utils';
import { Button } from '../ui/primitives';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  dashboardTab: DashboardTabId;
  dashboardLabel: string;
  scopeLabel?: string;
  focusWidget?: string;
  timestamp: string;
}

interface DashboardWidgetCatalog {
  label: string;
  widgets: string[];
  quickPrompts: string[];
}

const DASHBOARD_CATALOG: Record<DashboardTabId, DashboardWidgetCatalog> = {
  overview: {
    label: 'Overview',
    widgets: [
      'KPI Summary',
      'Inspection Trend',
      'Defect Distribution',
      'Defect Heat Map',
      'Production Lines',
      'Equipment Alerts',
      'Digital Defect Passports',
    ],
    quickPrompts: [
      'What is the highest-priority defect and solution right now?',
      'Which production line needs immediate action?',
    ],
  },
  inspection: {
    label: 'Inspections',
    widgets: [
      'Optical Canvas',
      'Sobel Heatmap',
      'Perturbation Battery',
      'Reliability Audit',
    ],
    quickPrompts: [
      'How do I fix a drifted model reliability score?',
      'What does the Sobel heatmap reveal and what should be tuned?',
    ],
  },
  twin: {
    label: '3D Factory Twin',
    widgets: [
      '3D Optical Scanner',
      '3D Thermal Heat Map',
      'Process Parameters',
      'Sensitivity Chart',
      'Saved Scenarios',
    ],
    quickPrompts: [
      'Which slider parameters reduce defect risk the most?',
      'What calibration steps should be made on the physical line?',
    ],
  },
  'cross-factory': {
    label: 'Cross-Factory',
    widgets: [
      '3-Plant Comparison',
      'Transfer Graph',
      'Distribution Chart',
      'Executive Summary',
    ],
    quickPrompts: [
      'How do Factory A and B defects transfer into Factory C?',
      'What cross-plant corrective plan should be made next shift?',
    ],
  },
  feedback: {
    label: 'Human Review',
    widgets: [
      'Agreement KPIs',
      'Verification Queue',
      'Verdict Workflow',
    ],
    quickPrompts: [
      'Which pending passports should QA engineers verify first?',
      'How do false positives improve model thresholds?',
    ],
  },
  maintenance: {
    label: 'Maintenance',
    widgets: [
      '7d vs 30d Risk Chart',
      'Asset Health & RUL',
      'Maintenance Dispatch',
    ],
    quickPrompts: [
      'Which machine is closest to failure and what is the fix?',
      'What preventive maintenance schedule should be made today?',
    ],
  },
  governance: {
    label: 'Administration',
    widgets: [
      'Users & Roles',
      'Factories & Billing',
      'Invitations',
      'Audit Log',
    ],
    quickPrompts: [
      'Are there any access or role gaps to resolve?',
      'What governance improvements should be made?',
    ],
  },
};

function renderInlineBold(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-slate-900 dark:text-slate-100">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

function StructuredAssistantText({ content }: { content: string }) {
  const lines = content.split('\n');
  const blocks: React.ReactNode[] = [];
  let bulletBuffer: string[] = [];

  const flushBullets = (keyPrefix: string) => {
    if (bulletBuffer.length === 0) return;
    blocks.push(
      <ul key={`${keyPrefix}-ul`} className="space-y-1.5 pl-1">
        {bulletBuffer.map((item, i) => (
          <li
            key={i}
            className="flex items-start gap-2 text-xs leading-relaxed text-slate-700 dark:text-slate-300"
          >
            <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-slate-400 dark:bg-slate-500 shrink-0" />
            <span>{renderInlineBold(item)}</span>
          </li>
        ))}
      </ul>
    );
    bulletBuffer = [];
  };

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) {
      flushBullets(`b-${index}`);
      return;
    }

    if (line.startsWith('### ') || line.startsWith('## ')) {
      flushBullets(`h-${index}`);
      const title = line.replace(/^#{2,3}\s+/, '');
      const isAction = /action|should be made|next/i.test(title);
      const isSolution = /solution|fix|diagnos/i.test(title);
      const accentClass = isAction
        ? 'text-blue-700 border-blue-200 dark:text-blue-400 dark:border-blue-900'
        : isSolution
          ? 'text-amber-800 border-amber-200 dark:text-amber-400 dark:border-amber-900'
          : 'text-slate-900 border-slate-200 dark:text-slate-100 dark:border-slate-700';

      blocks.push(
        <div
          key={`hdr-${index}`}
          className={cn(
            'pt-2 first:pt-0 pb-1 border-b text-xs font-semibold',
            accentClass
          )}
        >
          {title}
        </div>
      );
      return;
    }

    if (line.startsWith('- ') || line.startsWith('* ')) {
      bulletBuffer.push(line.slice(2).trim());
      return;
    }

    flushBullets(`p-${index}`);
    blocks.push(
      <p key={`p-${index}`} className="text-xs leading-relaxed text-slate-700 dark:text-slate-300">
        {renderInlineBold(line)}
      </p>
    );
  });

  flushBullets('end');
  return <div className="space-y-2">{blocks}</div>;
}

export function DashboardChatbot({
  open,
  onOpenChange,
  activeTab,
  selectedFactoryId,
  factories,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  activeTab: DashboardTabId;
  selectedFactoryId: number | 'ALL';
  factories: FactoryRecord[];
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoExplain, setAutoExplain] = useState(true);
  const lastExplainedKeyRef = useRef<string | null>(null);
  const scrollEndRef = useRef<HTMLDivElement | null>(null);

  const catalog = DASHBOARD_CATALOG[activeTab];
  const scopeName = useMemo(() => {
    if (selectedFactoryId === 'ALL') return `All Sites (${factories.length})`;
    const match = factories.find((f) => f.id === selectedFactoryId);
    return match ? match.code.replace('_', ' ') : `Factory #${selectedFactoryId}`;
  }, [factories, selectedFactoryId]);

  const sendAssistantRequest = useCallback(
    async (opts: {
      mode: 'explain_dashboard' | 'chat';
      focusWidget?: string;
      userMessage?: string;
      displayPrompt?: string;
    }) => {
      setError(null);
      setLoading(true);

      const userPromptText =
        opts.displayPrompt ||
        opts.userMessage ||
        (opts.focusWidget
          ? `Explain "${opts.focusWidget}" on ${catalog.label}, its solution, and what should be made.`
          : `Explain everything on ${catalog.label}, solutions to active issues, and what should be made.`);

      const userEntry: ChatMessage = {
        id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: 'user',
        content: userPromptText,
        dashboardTab: activeTab,
        dashboardLabel: catalog.label,
        focusWidget: opts.focusWidget,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      const historyPayload = messages.slice(-8).map((m) => ({
        role: m.role,
        content: m.content.slice(0, 2400),
      }));

      setMessages((prev) => [...prev, userEntry]);

      try {
        const { data } = await apiClient.post<AssistantChatResponse>('/assistant/chat', {
          activeTab,
          factoryId: selectedFactoryId === 'ALL' ? null : selectedFactoryId,
          mode: opts.mode,
          focusWidget: opts.focusWidget,
          message: opts.userMessage,
          history: historyPayload,
        });

        const botEntry: ChatMessage = {
          id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role: 'assistant',
          content: data.reply,
          dashboardTab: activeTab,
          dashboardLabel: data.dashboardLabel,
          scopeLabel: data.scopeLabel,
          focusWidget: opts.focusWidget,
          timestamp: new Date(data.generatedAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          }),
        };
        setMessages((prev) => [...prev, botEntry]);
      } catch (err) {
        setError(extractApiError(err, 'Unable to reach Dashboard Assistant.'));
      } finally {
        setLoading(false);
      }
    },
    [activeTab, catalog.label, messages, selectedFactoryId]
  );

  // Auto-explain whenever the panel is open and the user switches dashboard or factory scope
  useEffect(() => {
    if (!open || !autoExplain || loading) return;
    const contextKey = `${activeTab}:${selectedFactoryId}`;
    if (lastExplainedKeyRef.current === contextKey) return;
    lastExplainedKeyRef.current = contextKey;
    void sendAssistantRequest({
      mode: 'explain_dashboard',
      displayPrompt: `Summary: Explain ${catalog.label} (${scopeName}) — details, solutions & next actions`,
    });
  }, [open, autoExplain, activeTab, selectedFactoryId, loading, catalog.label, scopeName, sendAssistantRequest]);

  // Keep conversation scrolled to newest message
  useEffect(() => {
    if (open) {
      scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loading, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    setInput('');
    void sendAssistantRequest({
      mode: 'chat',
      userMessage: trimmed,
      displayPrompt: trimmed,
    });
  };

  const handleExplainFullDashboard = () => {
    if (loading) return;
    lastExplainedKeyRef.current = `${activeTab}:${selectedFactoryId}`;
    void sendAssistantRequest({
      mode: 'explain_dashboard',
      displayPrompt: `Explain everything on ${catalog.label} (${scopeName}) — details, solutions & what should be made`,
    });
  };

  const handleExplainWidget = (widgetName: string) => {
    if (loading) return;
    void sendAssistantRequest({
      mode: 'explain_dashboard',
      focusWidget: widgetName,
      displayPrompt: `Explain "${widgetName}" on ${catalog.label} — detail, solution & action plan`,
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        aria-label="Open Dashboard Assistant"
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-md border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900 px-4 py-2.5 text-xs font-semibold text-slate-800 dark:text-slate-100 shadow-md hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
      >
        <MessageSquare className="h-4 w-4 text-blue-600 dark:text-blue-400" />
        <span>Explain {catalog.label}</span>
        <ChevronRight className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
      </button>
    );
  }

  return (
    <aside
      aria-label="Dashboard Assistant"
      className="fixed inset-y-0 right-0 z-50 w-full sm:w-[420px] border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 flex flex-col shadow-xl"
    >
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/60 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
              Dashboard Assistant
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 truncate">
            {catalog.label} · {scopeName}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleExplainFullDashboard}
            disabled={loading}
            title="Re-analyze current dashboard"
            className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </button>
          <button
            type="button"
            onClick={() => {
              setMessages([]);
              setError(null);
              lastExplainedKeyRef.current = `${activeTab}:${selectedFactoryId}`;
            }}
            disabled={loading || messages.length === 0}
            title="Clear chat history"
            className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:border-red-200 dark:hover:border-red-800 disabled:opacity-40 cursor-pointer"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close assistant"
            className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Auto-Explain Toggle + Dashboard Section Shortcuts */}
      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/90 space-y-2.5">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-medium text-slate-600 dark:text-slate-300">
            Inspect section on {catalog.label}
          </span>
          <label className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoExplain}
              onChange={(e) => setAutoExplain(e.target.checked)}
              className="rounded border-slate-300 dark:border-slate-600 accent-blue-600"
            />
            Auto-explain
          </label>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={loading}
            onClick={handleExplainFullDashboard}
            className="px-2.5 py-1 rounded border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/60 text-xs font-medium text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-950 disabled:opacity-50 cursor-pointer transition-colors"
          >
            Full Dashboard Brief
          </button>
          {catalog.widgets.map((widget) => (
            <button
              key={widget}
              type="button"
              disabled={loading}
              onClick={() => handleExplainWidget(widget)}
              className="px-2.5 py-1 rounded border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 cursor-pointer transition-colors"
            >
              {widget}
            </button>
          ))}
        </div>
      </div>

      {/* Conversation Thread */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-slate-50/40 dark:bg-slate-950/50">
        {messages.length === 0 && !loading && (
          <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-4 space-y-2.5">
            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              Ready to explain {catalog.label}
            </div>
            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
              Select any dashboard tab or section shortcut above to see a breakdown of active metrics,
              the recommended solution, and what actions should be taken next.
            </p>
            <Button size="sm" onClick={handleExplainFullDashboard} className="w-full">
              Explain {catalog.label}
            </Button>
          </div>
        )}

        {messages.map((msg) =>
          msg.role === 'user' ? (
            <div key={msg.id} className="flex justify-end">
              <div className="max-w-[88%] rounded-lg border border-blue-600 bg-blue-600 px-3.5 py-2.5 text-xs text-white">
                <div className="text-[11px] text-blue-100 mb-1">
                  {msg.dashboardLabel} · {msg.timestamp}
                </div>
                <p className="leading-relaxed">{msg.content}</p>
              </div>
            </div>
          ) : (
            <div key={msg.id} className="flex justify-start">
              <div className="w-full rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 px-4 py-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                  <span className="font-medium text-slate-800 dark:text-slate-200">
                    Assistant · {msg.dashboardLabel}
                  </span>
                  <span className="font-mono">{msg.timestamp}</span>
                </div>
                <StructuredAssistantText content={msg.content} />
              </div>
            </div>
          )
        )}

        {loading && (
          <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 px-4 py-3.5 text-xs text-slate-600 dark:text-slate-400 space-y-1">
            <div className="font-medium text-slate-900 dark:text-slate-100">
              Analyzing {catalog.label}...
            </div>
            <p className="text-slate-500 dark:text-slate-400">
              Reviewing live charts, defect records, maintenance risk, and recommended actions.
            </p>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/50 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-400"
          >
            {error}
          </div>
        )}

        <div ref={scrollEndRef} />
      </div>

      {/* Quick Follow-Up Prompts + Input Composer */}
      <div className="border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-3.5 space-y-2.5">
        <div className="flex flex-col gap-1.5">
          {catalog.quickPrompts.map((q) => (
            <button
              key={q}
              type="button"
              disabled={loading}
              onClick={() =>
                void sendAssistantRequest({
                  mode: 'chat',
                  userMessage: q,
                  displayPrompt: q,
                })
              }
              className="text-left px-2.5 py-1.5 rounded border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white disabled:opacity-50 cursor-pointer truncate transition-colors"
            >
              {q}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Ask about ${catalog.label}, solutions, or next actions...`}
            maxLength={1500}
            className="flex-1 h-9 rounded-md border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-950 px-3 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          />
          <Button type="submit" size="sm" disabled={loading || !input.trim()} aria-label="Send message">
            <Send className="h-3.5 w-3.5" />
          </Button>
        </form>
      </div>
    </aside>
  );
}
