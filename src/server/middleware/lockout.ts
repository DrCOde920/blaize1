/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Secret-Code Attempt Limiter & Timing-Attack Defense (`src/server/middleware/lockout.ts`)
 * - Tracks failed secret code attempts per client IP / key handle
 * - Exponential backoff and temporary lockout
 * - Enforces constant-time execution padding to prevent timing side-channel leaks
 */

import crypto from 'node:crypto';
import { SERVER_DEFAULTS } from '../config';

interface AttemptRecord {
  failedAttempts: number;
  lockedUntil: number;
  lastAttemptAt: number;
  backoffMs: number;
}

export class SecretCodeAttemptLimiter {
  private attempts = new Map<string, AttemptRecord>();
  private readonly maxAttempts: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;

  constructor(options?: {
    maxAttempts?: number;
    baseBackoffMs?: number;
    maxBackoffMs?: number;
  }) {
    this.maxAttempts = options?.maxAttempts ?? SERVER_DEFAULTS.secretCodeMaxAttempts;
    this.baseBackoffMs = options?.baseBackoffMs ?? SERVER_DEFAULTS.secretCodeLockoutBaseMs;
    this.maxBackoffMs = options?.maxBackoffMs ?? SERVER_DEFAULTS.secretCodeLockoutMaxMs;
  }

  public checkLockout(identifier: string): { isLocked: boolean; retryAfterSeconds: number } {
    const record = this.attempts.get(identifier);
    if (!record) {
      return { isLocked: false, retryAfterSeconds: 0 };
    }

    const now = Date.now();
    if (now < record.lockedUntil) {
      const remainingSec = Math.ceil((record.lockedUntil - now) / 1000);
      return { isLocked: true, retryAfterSeconds: remainingSec };
    }

    return { isLocked: false, retryAfterSeconds: 0 };
  }

  public recordFailure(identifier: string): { locked: boolean; retryAfterSeconds: number } {
    const now = Date.now();
    let record = this.attempts.get(identifier);
    if (!record) {
      record = {
        failedAttempts: 1,
        lockedUntil: 0,
        lastAttemptAt: now,
        backoffMs: this.baseBackoffMs,
      };
    } else {
      record.failedAttempts += 1;
      record.lastAttemptAt = now;
    }

    if (record.failedAttempts >= this.maxAttempts) {
      // Exponential backoff
      const multiplier = Math.pow(2, record.failedAttempts - this.maxAttempts);
      const backoff = Math.min(this.baseBackoffMs * multiplier, this.maxBackoffMs);
      record.lockedUntil = now + backoff;
      record.backoffMs = backoff;
      this.attempts.set(identifier, record);
      return { locked: true, retryAfterSeconds: Math.ceil(backoff / 1000) };
    }

    this.attempts.set(identifier, record);
    return { locked: false, retryAfterSeconds: 0 };
  }

  public recordSuccess(identifier: string): void {
    this.attempts.delete(identifier);
  }

  public reset(): void {
    this.attempts.clear();
  }

  public getRecord(identifier: string): AttemptRecord | undefined {
    return this.attempts.get(identifier);
  }
}

export const globalSecretCodeAttemptLimiter = new SecretCodeAttemptLimiter();

/**
 * Constant-time comparison between two strings to prevent timing side channels.
 */
export function timingSafeStringCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(String(a || ''));
  const bufB = Buffer.from(String(b || ''));

  if (bufA.length !== bufB.length) {
    // Perform dummy constant-time compare against itself to normalize timing
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Normalizes execution timing so that successful and failed attempts take a consistent minimum duration,
 * completely neutralizing timing side-channel differences.
 */
export async function normalizeExecutionTiming<T>(
  startMs: number,
  fnResult: Promise<T> | T,
  minDurationMs = SERVER_DEFAULTS.secretCodeMinExecutionMs
): Promise<T> {
  const result = await fnResult;
  const elapsed = Date.now() - startMs;
  if (elapsed < minDurationMs) {
    await new Promise((resolve) => setTimeout(resolve, minDurationMs - elapsed));
  }
  return result;
}
