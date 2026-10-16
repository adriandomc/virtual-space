import { HttpError } from '../auth/auth.js';

/** Reject before collecting request chunks; no waiting queue retains upload bodies. */
export function createUploadAdmission() {
  const active = new Set<string>();
  const jsonAccounts = new Map<string, number>();
  let bytes = 0, jsonBodies = 0, validating = false;
  return {
    acquire(accountId: string, reservation: number, kind: 'upload' | 'json' = 'upload') {
      const overloaded = kind === 'upload' ? active.size >= 2 || active.has(accountId) : jsonBodies >= 8 || (jsonAccounts.get(accountId) ?? 0) >= 2;
      if (!Number.isSafeInteger(reservation) || reservation < 0 || overloaded || bytes + reservation > 40 * 1024 * 1024) throw new HttpError(429, 'Hay otras cargas en curso. Inténtalo de nuevo.', 5);
      if (kind === 'upload') active.add(accountId);
      else { jsonBodies++; jsonAccounts.set(accountId, (jsonAccounts.get(accountId) ?? 0) + 1); }
      bytes += reservation;
      let released = false;
      return () => {
        if (released) return;
        released = true; bytes -= reservation;
        if (kind === 'upload') active.delete(accountId);
        else { jsonBodies--; const count = jsonAccounts.get(accountId)! - 1; if (count) jsonAccounts.set(accountId, count); else jsonAccounts.delete(accountId); }
      };
    },
    validate<T>(apply: () => T): T {
      if (validating) throw new HttpError(429, 'Hay otras cargas en curso. Inténtalo de nuevo.', 5);
      validating = true;
      try { return apply(); } finally { validating = false; }
    },
  };
}
