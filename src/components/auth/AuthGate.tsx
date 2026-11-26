import React, { useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import type { AppRole } from '../../types/prometheus';
import { Button, Input, Select } from '../ui/primitives';

const ROLE_PRESETS: Array<{ label: string; alias: string; role: AppRole; description: string }> = [
  {
    label: 'Super Admin',
    alias: 'A. Sharma',
    role: 'SUPER_ADMIN',
    description: 'All factories, analytics, and administration',
  },
  {
    label: 'Quality Engineer',
    alias: 'E. Park',
    role: 'QUALITY_ENGINEER',
    description: 'Inspections, 3D factory twin, and human review',
  },
  {
    label: 'Line Operator',
    alias: 'M. Lin',
    role: 'OPERATOR',
    description: 'Live optical inspection and defect passports',
  },
];

export function AuthGate() {
  const { loading, authError, simpleLogin } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const [displayName, setDisplayName] = useState('A. Sharma');
  const [role, setRole] = useState<AppRole>('SUPER_ADMIN');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void simpleLogin(displayName.trim() || 'Operations User', role);
  };

  return (
    <div className="relative min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 flex flex-col justify-center items-center px-4 py-12">
      <div className="absolute top-4 right-4">
        <Button
          size="sm"
          variant="secondary"
          onClick={toggleTheme}
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDark ? (
            <Sun className="h-3.5 w-3.5 text-amber-400" />
          ) : (
            <Moon className="h-3.5 w-3.5 text-slate-600" />
          )}
          <span>{isDark ? 'Light mode' : 'Dark mode'}</span>
        </Button>
      </div>

      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="inline-flex items-center gap-2.5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-blue-600 text-white font-display text-sm font-bold">
              P
            </span>
            <span className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 font-display">
              PROMETHEUS-X
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Industrial Defect Intelligence &amp; Manufacturing Quality Platform
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-7 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Sign in to workspace
          </h1>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Select a demo role or enter a display name. No personal data is collected.
          </p>

          <div className="mt-5 space-y-2">
            <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Quick role selection
            </p>
            <div className="grid grid-cols-1 gap-2">
              {ROLE_PRESETS.map((preset) => {
                const selected = role === preset.role && displayName === preset.alias;
                return (
                  <button
                    key={preset.role}
                    type="button"
                    onClick={() => {
                      setDisplayName(preset.alias);
                      setRole(preset.role);
                    }}
                    className={`text-left rounded-md border px-3.5 py-2.5 transition-colors cursor-pointer ${
                      selected
                        ? 'border-blue-600 bg-blue-50/70 text-slate-900 dark:border-blue-500 dark:bg-blue-950/50 dark:text-slate-100'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span>{preset.label}</span>
                      <span className="font-mono font-normal text-slate-500 dark:text-slate-400">
                        {preset.alias}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {preset.description}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Display name
              </label>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Enter a display name"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Role
              </label>
              <Select value={role} onChange={(e) => setRole(e.target.value as AppRole)}>
                <option value="SUPER_ADMIN">Super Admin — Full Platform Access</option>
                <option value="FACTORY_ADMIN">Factory Admin — Site Operations</option>
                <option value="QUALITY_ENGINEER">Quality Engineer — Inspection &amp; Review</option>
                <option value="OPERATOR">Operator — Line Inspection</option>
              </Select>
            </div>

            {authError && (
              <p className="text-xs text-red-600 dark:text-red-400" role="alert">
                {authError}
              </p>
            )}

            <Button type="submit" size="md" className="w-full" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>
        </div>

        <p className="mt-5 text-center text-xs text-slate-400 dark:text-slate-500">
          Simulated environment covering Factory A (Electronics), Factory B (Automotive Components),
          and Factory C (Automotive ECU).
        </p>
      </div>
    </div>
  );
}
