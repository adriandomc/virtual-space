export class AccountRequestError extends Error {
  readonly network: boolean;
  constructor(message: string, readonly status = 0, readonly data?: unknown) {
    super(message); this.name = 'AccountRequestError'; this.network = [0, 408, 502, 503, 504].includes(status);
  }
}
export const isNetworkError = (cause: unknown): cause is AccountRequestError => cause instanceof AccountRequestError && cause.network;

export async function accountRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(path, { ...options, credentials: 'same-origin', signal: controller.signal });
    let data: T & { error?: string };
    try { data = await response.json(); }
    catch (cause) {
      if (response.ok && (cause instanceof TypeError || cause instanceof DOMException && ['AbortError', 'TimeoutError'].includes(cause.name))) throw new AccountRequestError('No se pudo conectar. Inténtalo de nuevo.');
      throw new AccountRequestError('No se pudo leer la respuesta. Inténtalo de nuevo.', response.status);
    }
    if (!response.ok) throw new AccountRequestError(typeof data?.error === 'string' ? data.error : 'No se pudo completar la operación.', response.status, data);
    return data;
  } catch (cause) {
    if (cause instanceof TypeError || (cause instanceof DOMException && (cause.name === 'AbortError' || cause.name === 'TimeoutError'))) throw new AccountRequestError('No se pudo conectar. Inténtalo de nuevo.');
    throw cause;
  } finally { clearTimeout(timeout); }
}
