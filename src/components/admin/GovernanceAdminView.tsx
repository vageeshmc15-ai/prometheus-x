import React, { useEffect, useState } from 'react';
import { Plus, RefreshCw, UserPlus } from 'lucide-react';
import { apiClient, extractApiError } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import type {
  AppRole,
  BillingRecordItem,
  FactoryRecord,
  InvitationRecord,
  ManagedUserRecord,
  SecurityAuditRecord,
} from '../../types/prometheus';
import { formatDateTime } from '../../lib/utils';
import { Button, Input, Select } from '../ui/primitives';

interface AdminOverviewResponse {
  users: ManagedUserRecord[];
  factories: FactoryRecord[];
  invitations: InvitationRecord[];
  billing: BillingRecordItem[];
  auditLogs: SecurityAuditRecord[];
}

export function GovernanceAdminView({
  onFactoriesChanged,
}: {
  onFactoriesChanged: () => Promise<void>;
}) {
  const { profile } = useAuth();
  const isSuperAdmin = profile?.role === 'SUPER_ADMIN';

  const [section, setSection] = useState<'users' | 'factories' | 'invitations' | 'audit'>('users');
  const [data, setData] = useState<AdminOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Register factory form state (SUPER_ADMIN)
  const [fCode, setFCode] = useState('');
  const [fName, setFName] = useState('');
  const [fSector, setFSector] = useState('Electronics & Semiconductor');
  const [fLocation, setFLocation] = useState('');
  const [fTier, setFTier] = useState<'PILOT' | 'GROWTH' | 'ENTERPRISE'>('GROWTH');

  // Invitation form state
  const [invEmail, setInvEmail] = useState('');
  const [invFactoryId, setInvFactoryId] = useState<number>(0);
  const [invRole, setInvRole] = useState<'FACTORY_ADMIN' | 'QUALITY_ENGINEER' | 'OPERATOR'>(
    'QUALITY_ENGINEER'
  );

  const loadGovernance = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<AdminOverviewResponse>('/admin/overview');
      setData(res.data);
      if (!invFactoryId && res.data.factories.length > 0) {
        setInvFactoryId(res.data.factories[0].id);
      }
    } catch (err) {
      setError(extractApiError(err, 'Unable to load administration data.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadGovernance();
  }, []);

  const handleRegisterFactory = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFeedback(null);
    try {
      await apiClient.post('/admin/factories', {
        code: fCode.trim().toUpperCase(),
        name: fName.trim(),
        sector: fSector,
        location: fLocation.trim(),
        subscriptionTier: fTier,
        isSimulated: true,
      });
      setFCode('');
      setFName('');
      setFLocation('');
      setFeedback('Factory registered and initial billing record created.');
      await loadGovernance();
      await onFactoriesChanged();
    } catch (err) {
      setError(extractApiError(err, 'Failed to register factory.'));
    }
  };

  const handleUpdateTier = async (factoryId: number, tier: 'PILOT' | 'GROWTH' | 'ENTERPRISE') => {
    const monthlyAmountUsd = tier === 'ENTERPRISE' ? 4800 : tier === 'GROWTH' ? 2400 : 900;
    setError(null);
    setFeedback(null);
    try {
      await apiClient.patch(`/admin/factories/${factoryId}/tier`, {
        subscriptionTier: tier,
        monthlyAmountUsd,
      });
      setFeedback(`Updated subscription tier to ${tier} ($${monthlyAmountUsd}/mo).`);
      await loadGovernance();
      await onFactoriesChanged();
    } catch (err) {
      setError(extractApiError(err, 'Failed to update subscription tier.'));
    }
  };

  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFeedback(null);
    try {
      await apiClient.post('/admin/invitations', {
        email: invEmail.trim(),
        factoryId: invFactoryId,
        assignedRole: invRole,
      });
      setInvEmail('');
      setFeedback('Onboarding invitation issued.');
      await loadGovernance();
    } catch (err) {
      setError(extractApiError(err, 'Unable to issue invitation.'));
    }
  };

  const handleUpdateUser = async (
    userId: number,
    patch: { role?: AppRole; accountStatus?: 'ACTIVE' | 'PENDING_APPROVAL' | 'SUSPENDED' }
  ) => {
    setError(null);
    setFeedback(null);
    try {
      await apiClient.patch(`/admin/users/${userId}`, patch);
      setFeedback('Updated user permissions.');
      await loadGovernance();
    } catch (err) {
      setError(extractApiError(err, 'Unable to update user permissions.'));
    }
  };

  if (loading && !data) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-10 text-center text-sm text-slate-500 dark:text-slate-400">
        Loading users and administration settings...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800 p-1">
          {(
            [
              ['users', 'Users & Roles'],
              ['factories', 'Factories & Billing'],
              ['invitations', 'Invitations'],
              ...(isSuperAdmin ? [['audit', 'Audit Log'] as const] : []),
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSection(key)}
              className={`px-3 py-1.5 text-xs font-medium rounded cursor-pointer whitespace-nowrap transition-colors ${
                section === key
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <Button size="sm" variant="secondary" onClick={() => void loadGovernance()}>
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/50 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}
      {feedback && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/50 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
          {feedback}
        </div>
      )}

      {/* Users & RBAC Section */}
      {section === 'users' && (
        <section className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="p-5 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Users &amp; Role-Based Access Control
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Approve pending registrations, assign factory administrators, and manage account status
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/50 text-xs font-medium text-slate-600 dark:text-slate-400">
                  <th className="py-3 px-4">Workspace Account</th>
                  <th className="py-3 px-4">Verification</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Account Status</th>
                  <th className="py-3 px-4 text-right">Factories</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {(data?.users || []).map((u) => (
                  <tr
                    key={u.id}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                  >
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {u.displayName}
                      </div>
                      <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
                        {u.email}
                      </div>
                    </td>
                    <td
                      className={`py-3 px-4 text-xs font-medium ${
                        u.emailVerified
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-amber-700 dark:text-amber-400'
                      }`}
                    >
                      {u.emailVerified ? 'Verified' : 'Unverified'}
                    </td>
                    <td className="py-3 px-4">
                      <Select
                        className="h-8 text-xs w-44"
                        value={u.role}
                        disabled={!isSuperAdmin || u.uid === profile?.uid}
                        onChange={(e) =>
                          void handleUpdateUser(u.id, { role: e.target.value as AppRole })
                        }
                      >
                        {isSuperAdmin && <option value="SUPER_ADMIN">SUPER_ADMIN</option>}
                        <option value="FACTORY_ADMIN">FACTORY_ADMIN</option>
                        <option value="QUALITY_ENGINEER">QUALITY_ENGINEER</option>
                        <option value="OPERATOR">OPERATOR</option>
                      </Select>
                    </td>
                    <td className="py-3 px-4">
                      <Select
                        className="h-8 text-xs w-40"
                        value={u.accountStatus}
                        disabled={
                          u.uid === profile?.uid ||
                          (!isSuperAdmin &&
                            (u.role === 'SUPER_ADMIN' || u.role === 'FACTORY_ADMIN'))
                        }
                        onChange={(e) =>
                          void handleUpdateUser(u.id, {
                            accountStatus: e.target.value as
                              | 'ACTIVE'
                              | 'PENDING_APPROVAL'
                              | 'SUSPENDED',
                          })
                        }
                      >
                        <option value="ACTIVE">ACTIVE</option>
                        <option value="PENDING_APPROVAL">PENDING_APPROVAL</option>
                        <option value="SUSPENDED">SUSPENDED</option>
                      </Select>
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-xs text-slate-600 dark:text-slate-400">
                      {u.role === 'SUPER_ADMIN' ? 'All Sites' : `${u.factoryIds.length} assigned`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Factories & Subscription Billing Section */}
      {section === 'factories' && (
        <div className="space-y-6">
          {isSuperAdmin && (
            <form
              onSubmit={(e) => void handleRegisterFactory(e)}
              className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-6"
            >
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Register Manufacturing Site
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Super Admin operation · Creates a new factory tenant and initial billing tier
              </p>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-5 gap-3">
                <Input
                  value={fCode}
                  onChange={(e) => setFCode(e.target.value)}
                  placeholder="Code (e.g. FACTORY_D)"
                  required
                />
                <Input
                  value={fName}
                  onChange={(e) => setFName(e.target.value)}
                  placeholder="Factory Display Name"
                  required
                />
                <Select value={fSector} onChange={(e) => setFSector(e.target.value)}>
                  <option value="Electronics & Semiconductor">Electronics &amp; Semiconductor</option>
                  <option value="Automotive Components">Automotive Components</option>
                  <option value="Automotive Electronics">Automotive Electronics</option>
                </Select>
                <Input
                  value={fLocation}
                  onChange={(e) => setFLocation(e.target.value)}
                  placeholder="Location"
                  required
                />
                <div className="flex gap-2">
                  <Select
                    value={fTier}
                    onChange={(e) =>
                      setFTier(e.target.value as 'PILOT' | 'GROWTH' | 'ENTERPRISE')
                    }
                  >
                    <option value="PILOT">PILOT</option>
                    <option value="GROWTH">GROWTH</option>
                    <option value="ENTERPRISE">ENTERPRISE</option>
                  </Select>
                  <Button type="submit">
                    <Plus className="h-4 w-4" />
                    Add
                  </Button>
                </div>
              </div>
            </form>
          )}

          <section className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="p-5 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Registered Factories &amp; Subscription Tiers
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/50 text-xs font-medium text-slate-600 dark:text-slate-400">
                    <th className="py-3 px-4">Code</th>
                    <th className="py-3 px-4">Factory Name</th>
                    <th className="py-3 px-4">Sector</th>
                    <th className="py-3 px-4">Dataset Mode</th>
                    <th className="py-3 px-4">Subscription Tier</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {(data?.factories || []).map((f) => (
                    <tr
                      key={f.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                    >
                      <td className="py-3 px-4 font-mono text-xs font-medium text-blue-700 dark:text-blue-400">
                        {f.code}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {f.name}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {f.location}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-700 dark:text-slate-300">
                        {f.sector}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-400">
                        {f.isSimulated ? 'Simulated' : 'Production'}
                      </td>
                      <td className="py-3 px-4">
                        <Select
                          className="h-8 text-xs w-40"
                          value={f.subscriptionTier}
                          disabled={!isSuperAdmin}
                          onChange={(e) =>
                            void handleUpdateTier(
                              f.id,
                              e.target.value as 'PILOT' | 'GROWTH' | 'ENTERPRISE'
                            )
                          }
                        >
                          <option value="PILOT">PILOT ($900/mo)</option>
                          <option value="GROWTH">GROWTH ($2,400/mo)</option>
                          <option value="ENTERPRISE">ENTERPRISE ($4,800/mo)</option>
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {isSuperAdmin && (
            <section className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="p-5 border-b border-slate-200 dark:border-slate-800">
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Billing History
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/50 text-xs font-medium text-slate-600 dark:text-slate-400">
                      <th className="py-3 px-4">Invoice Ref</th>
                      <th className="py-3 px-4">Billing Period</th>
                      <th className="py-3 px-4">Tier</th>
                      <th className="py-3 px-4 text-right">Amount (USD)</th>
                      <th className="py-3 px-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {(data?.billing || []).map((b) => (
                      <tr
                        key={b.id}
                        className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                      >
                        <td className="py-3 px-4 font-mono text-xs text-blue-700 dark:text-blue-400">
                          {b.invoiceRef}
                        </td>
                        <td className="py-3 px-4 font-mono text-xs text-slate-600 dark:text-slate-400">
                          {b.billingPeriod}
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-900 dark:text-slate-100">
                          {b.tier}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-xs font-medium text-slate-900 dark:text-slate-100">
                          ${b.monthlyAmountUsd.toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                          {b.status}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}

      {/* Invitations Section */}
      {section === 'invitations' && (
        <div className="space-y-6">
          <form
            onSubmit={(e) => void handleCreateInvite(e)}
            className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-6"
          >
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Send Workspace Invitation
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Pre-authorizes a workspace account with least-privilege factory membership upon sign-in
            </p>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
              <Input
                type="email"
                value={invEmail}
                onChange={(e) => setInvEmail(e.target.value)}
                placeholder="operator@prometheus-sim.local"
                required
              />
              <Select
                value={String(invFactoryId)}
                onChange={(e) => setInvFactoryId(Number(e.target.value))}
              >
                {(data?.factories || []).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </Select>
              <Select
                value={invRole}
                onChange={(e) =>
                  setInvRole(
                    e.target.value as 'FACTORY_ADMIN' | 'QUALITY_ENGINEER' | 'OPERATOR'
                  )
                }
              >
                {isSuperAdmin && <option value="FACTORY_ADMIN">FACTORY_ADMIN</option>}
                <option value="QUALITY_ENGINEER">QUALITY_ENGINEER</option>
                <option value="OPERATOR">OPERATOR</option>
              </Select>
              <Button type="submit">
                <UserPlus className="h-4 w-4" />
                Issue Invitation
              </Button>
            </div>
          </form>

          <section className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="p-5 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Active Invitations
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/50 text-xs font-medium text-slate-600 dark:text-slate-400">
                    <th className="py-3 px-4">Invited Account</th>
                    <th className="py-3 px-4">Assigned Role</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Expires</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {(data?.invitations || []).length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="py-8 text-center text-xs text-slate-500 dark:text-slate-400"
                      >
                        No pending invitations issued yet.
                      </td>
                    </tr>
                  ) : (
                    (data?.invitations || []).map((inv) => (
                      <tr
                        key={inv.id}
                        className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                      >
                        <td className="py-3 px-4 font-mono text-xs text-blue-700 dark:text-blue-400">
                          {inv.email}
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-900 dark:text-slate-100">
                          {inv.assignedRole}
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-400">
                          {inv.status}
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-500 dark:text-slate-400">
                          {formatDateTime(inv.expiresAt)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* Security Audit Log Section (SUPER_ADMIN Only) */}
      {section === 'audit' && isSuperAdmin && (
        <section className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="p-5 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Security &amp; Authorization Audit Log
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Request-correlated RBAC and mutation trail · Credentials and bearer tokens are never
              stored
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/50 font-medium text-slate-600 dark:text-slate-400">
                  <th className="py-3 px-4">Request ID</th>
                  <th className="py-3 px-4">Actor</th>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Outcome</th>
                  <th className="py-3 px-4">Details</th>
                  <th className="py-3 px-4">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {(data?.auditLogs || []).map((log) => (
                  <tr
                    key={log.id}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                  >
                    <td className="py-2.5 px-4 font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {log.requestId}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      {log.actorEmail}
                    </td>
                    <td className="py-2.5 px-4 font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      {log.action}
                    </td>
                    <td
                      className={`py-2.5 px-4 font-semibold whitespace-nowrap ${
                        log.outcome === 'ALLOW'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-red-700 dark:text-red-400'
                      }`}
                    >
                      {log.outcome}
                    </td>
                    <td className="py-2.5 px-4 text-slate-700 dark:text-slate-300">
                      {log.details}
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {formatDateTime(log.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
