import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';

/**
 * Optional server-side Firebase Admin Auth verifier.
 * Only initializes when FIREBASE_PROJECT_ID is configured via environment variables,
 * keeping repositories completely free of committed config files or client API keys.
 */
export function getOptionalAdminAuth(): Auth | null {
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  if (!projectId) {
    return null;
  }
  if (!getApps().length) {
    initializeApp({ projectId });
  }
  return getAuth();
}
