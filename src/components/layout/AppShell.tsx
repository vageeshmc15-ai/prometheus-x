import React from 'react';
import {
  Box,
  Camera,
  ClipboardCheck,
  GitBranch,
  LayoutDashboard,
  LogOut,
  Moon,
  Shield,
  Sun,
  Wrench,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { cn } from '../../lib/utils';
import { Button, Select } from '../ui/primitives';

export type WorkspaceTab =
  | 'overview'
  | 'inspection'
  | 'twin'
  | 'cross-factory'
  | 'feedback'
  | 'maintenance'
  | 'governance';

interface NavItem {
  id: WorkspaceTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'inspection', label: 'Inspections', icon: Camera },
  { id: 'twin', label: '3D Factory Twin', icon: Box },
  { id: 'cross-factory', label: 'Cross-Factory', icon: GitBranch },
  { id: 'feedback', label: 'Human Review', icon: ClipboardCheck },
  { id: 'maintenance', label: 'Maintenance', icon: Wrench },
  { id: 'governance', label: 'Administration', icon: Shield, adminOnly: true },
];

const TAB_LABELS: Record<WorkspaceTab, string> = {
  overview: 'Quality Overview',
  inspection: 'Optical Inspection & Model Reliability',
  twin: '3D Counterfactual Factory Twin',
  'cross-factory': 'Cross-Factory Intelligence',
  feedback: 'Human Review Queue',
  maintenance: 'Predictive Maintenance',
  governance: 'Administration & Access Control',
};

export function AppShell({
  activeTab,
  onTabChange,
  selectedFactoryId,
  onFactoryChange,
  secondaryAction,
  primaryAction,
  children,
}: {
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  selectedFactoryId: number | 'ALL';
  onFactoryChange: (id: number | 'ALL') => void;
  secondaryAction?: React.ReactNode;
  primaryAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { profile, factories, logout } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const canAccessAdmin = profile?.role === 'SUPER_ADMIN' || profile?.role === 'FACTORY_ADMIN';
  const visibleNav = NAV_ITEMS.filter((item) => !item.adminOnly || canAccessAdmin);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 flex">
      {/* Standard 240px Enterprise Sidebar */}
      <aside className="hidden lg:flex lg:w-[240px] lg:shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="h-14 px-5 flex items-center border-b border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => onTabChange('overview')}
            className="flex items-center gap-2.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-blue-600 text-white font-display text-xs font-bold">
              P
            </span>
            <span className="text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-100 font-display">
              PROMETHEUS-X
            </span>
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5" aria-label="Workspace navigation">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onTabChange(item.id)}
                className={cn(
                  'w-full flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 whitespace-nowrap cursor-pointer',
                  active
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/70 dark:text-blue-400'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                )}
              >
                <Icon
                  className={cn(
                    'h-4 w-4 shrink-0',
                    active
                      ? 'text-blue-600 dark:text-blue-400'
                      : 'text-slate-400 dark:text-slate-500'
                  )}
                />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Simple Account Footer */}
        <div className="border-t border-slate-200 dark:border-slate-800 p-4">
          <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
            {profile?.displayName}
          </div>
          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 truncate">
            {profile?.role.replace('_', ' ')} · {factories.length} sites
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="mt-3 w-full"
            onClick={() => void logout()}
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </Button>
        </div>
      </aside>

      {/* Main Content Viewport */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 h-14 border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs text-slate-400 dark:text-slate-500 hidden sm:inline">
              Workspace /
            </span>
            <h1 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-slate-100 truncate">
              {TAB_LABELS[activeTab]}
            </h1>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="w-48 hidden md:block">
              <Select
                aria-label="Filter by manufacturing site"
                value={selectedFactoryId === 'ALL' ? 'ALL' : String(selectedFactoryId)}
                onChange={(e) =>
                  onFactoryChange(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))
                }
                className="h-9 text-xs"
              >
                <option value="ALL">All Factories ({factories.length})</option>
                {factories.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.code.replace('_', ' ')} — {f.sector}
                  </option>
                ))}
              </Select>
            </div>

            <Button
              size="sm"
              variant="secondary"
              onClick={toggleTheme}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="px-2.5"
            >
              {isDark ? (
                <Sun className="h-3.5 w-3.5 text-amber-400" />
              ) : (
                <Moon className="h-3.5 w-3.5 text-slate-600" />
              )}
              <span className="hidden xl:inline">{isDark ? 'Light' : 'Dark'}</span>
            </Button>

            {secondaryAction}
            {primaryAction}
          </div>
        </header>

        {/* Mobile Nav Strip */}
        <div className="lg:hidden border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 px-4 py-2 overflow-x-auto">
          <div className="flex items-center gap-1.5">
            {visibleNav.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onTabChange(item.id)}
                className={cn(
                  'px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer',
                  activeTab === item.id
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/70 dark:text-blue-400'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <main className="flex-1 p-6 max-w-[1440px] w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
