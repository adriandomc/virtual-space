export type OfflineProgress = { done: number; total: number; label: string; labelIsKey: boolean };
export type OfflineSummary = { accountId: string | null; forced: boolean; prepared: boolean; preparing: boolean; pending: number; syncing: boolean; error: string; progress: OfflineProgress | null; bytes: number; quota: number | null };
export const offlineActivity = { preparing: false, syncing: false, error: '', progress: null as OfflineProgress | null };
export const signal = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event('space-offline-data')); };
