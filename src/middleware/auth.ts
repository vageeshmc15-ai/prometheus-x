import crypto from 'crypto';
import type { NextFunction, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { getOptionalAdminAuth } from '../lib/firebase-admin.ts';
import { db } from '../db/index.ts';
import { factories, factoryMemberships, invitations, users } from '../db/schema.ts';
import { ensureSimulatedDataSeeded } from '../db/seed.ts';
import { logSecurityEvent, type RequestWithId } from './security.ts';

export type AppRole = 'SUPER_ADMIN' | 'FACTORY_ADMIN' | 'QUALITY_ENGINEER' | 'OPERATOR';

export interface AuthenticatedDbUser {
  id: number;
  uid: string;
  email: string;
  displayName: string;
  role: AppRole;
  accountStatus: string;
  emailVerified: boolean;
  authorizedFactoryIds: number[];
}

export interface AuthRequest extends RequestWithId {
  firebaseUser?: DecodedIdToken;
  dbUser?: AuthenticatedDbUser;
}

const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const VALID_ROLES: AppRole[] = [
  'SUPER_ADMIN',
  'FACTORY_ADMIN',
  'QUALITY_ENGINEER',
  'OPERATOR',
];

interface SimpleSessionPayload {
  uid: string;
  email: string;
  displayName: string;
  role: AppRole;
  exp: number;
}

export function createSimpleSessionToken(input: {
  displayName: string;
  role: AppRole;
}): { token: string; payload: SimpleSessionPayload } {
  const safeName =
    input.displayName.trim().replace(/[^a-zA-Z0-9 ._-]/g, '').slice(0, 48) ||
    'Shift Engineer';
  const safeRole: AppRole = VALID_ROLES.includes(input.role) ? input.role : 'SUPER_ADMIN';
  const slug = safeName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'user';
  const uid = `simple-${safeRole.toLowerCase()}-${slug}`;
  const email = `${slug}.${safeRole.toLowerCase()}@prometheus-sim.local`;

  const payload: SimpleSessionPayload = {
    uid,
    email,
    displayName: safeName,
    role: safeRole,
    exp: Date.now() + 12 * 60 * 60 * 1000, // 12-hour workspace session
  };

  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encoded)
    .digest('base64url');

  return { token: `pxs.${encoded}.${sig}`, payload };
}

function verifySimpleSessionToken(token: string): SimpleSessionPayload | null {
  if (!token.startsWith('pxs.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, encoded, sig] = parts;
  const expected = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encoded)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    ) as SimpleSessionPayload;
    if (!parsed.uid || !parsed.exp || parsed.exp < Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function syncSimpleWorkspaceUser(
  payload: SimpleSessionPayload
): Promise<AuthenticatedDbUser> {
  try {
    await ensureSimulatedDataSeeded();

    const existingRows = await db
      .select()
      .from(users)
      .where(eq(users.uid, payload.uid));

    let userRecord = existingRows[0];
    if (!userRecord) {
      const inserted = await db
        .insert(users)
        .values({
          uid: payload.uid,
          email: payload.email,
          displayName: payload.displayName,
          role: payload.role,
          accountStatus: 'ACTIVE',
          emailVerified: true,
          invitedBy: 'simple-workspace-login',
        })
        .onConflictDoUpdate({
          target: users.uid,
          set: {
            displayName: payload.displayName,
            role: payload.role,
            accountStatus: 'ACTIVE',
            emailVerified: true,
            updatedAt: new Date(),
          },
        })
        .returning();
      userRecord = inserted[0];
    } else if (
      userRecord.role !== payload.role ||
      userRecord.displayName !== payload.displayName
    ) {
      const updated = await db
        .update(users)
        .set({
          displayName: payload.displayName,
          role: payload.role,
          accountStatus: 'ACTIVE',
          emailVerified: true,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userRecord.id))
        .returning();
      userRecord = updated[0];
    }

    const allFactories = await db.select().from(factories);
    for (const f of allFactories) {
      await db
        .insert(factoryMemberships)
        .values({
          userId: userRecord.id,
          factoryId: f.id,
          factoryRole: payload.role === 'SUPER_ADMIN' ? 'FACTORY_ADMIN' : payload.role,
          approved: true,
        })
        .onConflictDoNothing();
    }

    return {
      id: userRecord.id,
      uid: userRecord.uid,
      email: userRecord.email,
      displayName: userRecord.displayName,
      role: userRecord.role as AppRole,
      accountStatus: userRecord.accountStatus,
      emailVerified: userRecord.emailVerified,
      authorizedFactoryIds: allFactories.map((f) => f.id),
    };
  } catch (error) {
    console.error('Simple workspace user sync failed:', error);
    throw new Error('Unable to initialize workspace session.', { cause: error });
  }
}

const BOOTSTRAP_OWNER_EMAIL = (process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();

async function syncFirebaseUser(decoded: DecodedIdToken): Promise<AuthenticatedDbUser> {
  try {
    await ensureSimulatedDataSeeded();

    const uid = decoded.uid;
    const email = (decoded.email ?? `${uid}@unknown.local`).toLowerCase();
    const displayName = decoded.name || email.split('@')[0] || 'Industrial User';
    const emailVerified = Boolean(decoded.email_verified);

    const existingRows = await db.select().from(users).where(eq(users.uid, uid));
    let userRecord = existingRows[0];

    if (!userRecord) {
      const existingAdmins = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, 'SUPER_ADMIN'));

      const isBootstrapAdmin =
        emailVerified && (email === BOOTSTRAP_OWNER_EMAIL || existingAdmins.length === 0);

      const pendingInvites = await db
        .select()
        .from(invitations)
        .where(and(eq(invitations.email, email), eq(invitations.status, 'PENDING')));
      const activeInvite = pendingInvites.find((inv) => new Date(inv.expiresAt) > new Date());

      const initialRole: AppRole = isBootstrapAdmin
        ? 'SUPER_ADMIN'
        : activeInvite
          ? (activeInvite.assignedRole as AppRole)
          : 'OPERATOR';

      const initialStatus = isBootstrapAdmin || activeInvite ? 'ACTIVE' : 'PENDING_APPROVAL';

      const inserted = await db
        .insert(users)
        .values({
          uid,
          email,
          displayName,
          role: initialRole,
          accountStatus: initialStatus,
          emailVerified,
          invitedBy: activeInvite ? activeInvite.invitedByUid : isBootstrapAdmin ? 'bootstrap' : null,
        })
        .onConflictDoUpdate({
          target: users.uid,
          set: { email, displayName, emailVerified, updatedAt: new Date() },
        })
        .returning();

      userRecord = inserted[0];

      if (isBootstrapAdmin) {
        const allFactories = await db.select().from(factories);
        for (const f of allFactories) {
          await db
            .insert(factoryMemberships)
            .values({
              userId: userRecord.id,
              factoryId: f.id,
              factoryRole: 'FACTORY_ADMIN',
              approved: true,
            })
            .onConflictDoNothing();
        }
      } else if (activeInvite) {
        await db
          .insert(factoryMemberships)
          .values({
            userId: userRecord.id,
            factoryId: activeInvite.factoryId,
            factoryRole:
              activeInvite.assignedRole === 'SUPER_ADMIN'
                ? 'FACTORY_ADMIN'
                : activeInvite.assignedRole,
            approved: true,
          })
          .onConflictDoNothing();
        await db
          .update(invitations)
          .set({ status: 'ACCEPTED' })
          .where(eq(invitations.id, activeInvite.id));
      }
    }

    let authorizedFactoryIds: number[] = [];
    if (userRecord.role === 'SUPER_ADMIN' && userRecord.accountStatus === 'ACTIVE') {
      const allFactories = await db.select({ id: factories.id }).from(factories);
      authorizedFactoryIds = allFactories.map((f) => f.id);
    } else if (userRecord.accountStatus === 'ACTIVE' && userRecord.emailVerified) {
      const memberships = await db
        .select({ factoryId: factoryMemberships.factoryId })
        .from(factoryMemberships)
        .where(
          and(eq(factoryMemberships.userId, userRecord.id), eq(factoryMemberships.approved, true))
        );
      authorizedFactoryIds = memberships.map((m) => m.factoryId);
    }

    return {
      id: userRecord.id,
      uid: userRecord.uid,
      email: userRecord.email,
      displayName: userRecord.displayName,
      role: userRecord.role as AppRole,
      accountStatus: userRecord.accountStatus,
      emailVerified: userRecord.emailVerified,
      authorizedFactoryIds,
    };
  } catch (error) {
    console.error('User sync failed:', error);
    throw new Error('Authentication synchronization failed. Please retry.', { cause: error });
  }
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  // Path 1: Simple non-personal workspace session token (HMAC-SHA256 verified)
  if (token.startsWith('pxs.')) {
    const simplePayload = verifySimpleSessionToken(token);
    if (!simplePayload) {
      res.status(401).json({ error: 'Session expired. Please sign in again.' });
      return;
    }
    try {
      req.dbUser = await syncSimpleWorkspaceUser(simplePayload);
      next();
      return;
    } catch {
      res.status(500).json({ error: 'Unable to load workspace session.' });
      return;
    }
  }

  // Path 2: Optional Firebase ID Token verification (only active when FIREBASE_PROJECT_ID is set)
  const adminAuth = getOptionalAdminAuth();
  if (!adminAuth) {
    res.status(401).json({ error: 'Invalid or expired authentication session.' });
    return;
  }

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    req.firebaseUser = decoded;
    req.dbUser = await syncFirebaseUser(decoded);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired authentication session.' });
  }
}

export function requireActiveVerifiedAccount(req: AuthRequest, res: Response, next: NextFunction) {
  const user = req.dbUser;
  if (!user) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  if (!user.emailVerified || user.accountStatus !== 'ACTIVE') {
    void logSecurityEvent({
      requestId: req.requestId,
      actorUid: user.uid,
      actorEmail: user.email,
      action: `${req.method} ${req.path}`,
      resourceType: 'PROTECTED_DATA',
      outcome: 'DENY',
      details: `Blocked access for status=${user.accountStatus}.`,
    });
    res.status(403).json({ error: 'Active account authorization is required.' });
    return;
  }
  next();
}

export function requireRoles(allowedRoles: AppRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const user = req.dbUser;
    if (!user || !allowedRoles.includes(user.role)) {
      if (user) {
        void logSecurityEvent({
          requestId: req.requestId,
          actorUid: user.uid,
          actorEmail: user.email,
          action: `${req.method} ${req.path}`,
          resourceType: 'RBAC_GUARD',
          outcome: 'DENY',
          details: `Role ${user.role} lacks required privilege (${allowedRoles.join(', ')}).`,
        });
      }
      res.status(403).json({ error: 'Insufficient role permissions for this operation.' });
      return;
    }
    next();
  };
}

export function assertFactoryAccess(user: AuthenticatedDbUser, factoryId: number): boolean {
  if (user.role === 'SUPER_ADMIN' && user.accountStatus === 'ACTIVE') return true;
  return user.authorizedFactoryIds.includes(factoryId);
}
