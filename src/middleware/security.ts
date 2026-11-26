import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { db } from '../db/index.ts';
import { securityAuditLogs } from '../db/schema.ts';

export interface RequestWithId extends Request {
  requestId?: string;
}

export function attachRequestId(req: RequestWithId, res: Response, next: NextFunction) {
  const id = `req_${crypto.randomBytes(6).toString('hex')}`;
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

export async function logSecurityEvent(params: {
  requestId?: string;
  actorUid: string;
  actorEmail: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  factoryId?: number | null;
  outcome: 'ALLOW' | 'DENY' | 'ERROR';
  details: string;
}) {
  try {
    // Never log tokens, passwords, or secret keys
    const sanitizedDetails = params.details
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
      .slice(0, 280);

    await db.insert(securityAuditLogs).values({
      requestId: params.requestId ?? 'system',
      actorUid: params.actorUid,
      actorEmail: params.actorEmail,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId ?? null,
      factoryId: params.factoryId ?? null,
      outcome: params.outcome,
      details: sanitizedDetails,
    });
  } catch (error) {
    // Non-fatal: keep main request responsive while logging safely on server
    console.error('Security audit write skipped:', error instanceof Error ? error.message : 'unknown');
  }
}

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const inspectionImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB strict ceiling
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new Error('Unsupported file format. Only JPEG, PNG, and WebP inspection images are permitted.'));
      return;
    }
    cb(null, true);
  },
});

export function verifyImageMagicBytes(buffer: Buffer, mimeType: string): boolean {
  if (buffer.length < 12) return false;
  if (mimeType === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType === 'image/png') {
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    );
  }
  if (mimeType === 'image/webp') {
    return (
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  return false;
}
