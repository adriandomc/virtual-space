export async function accountRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(path, { ...options, credentials: 'same-origin', signal: controller.signal });
    let data: T & { error?: string };
    try { data = await response.json(); }
    catch { throw new Error('No se pudo conectar. Inténtalo de nuevo.'); }
    if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'No se pudo completar la operación.');
    return data;
  } catch (cause) {
    if (cause instanceof TypeError || (cause instanceof DOMException && cause.name === 'AbortError')) throw new Error('No se pudo conectar. Inténtalo de nuevo.');
    throw cause;
  } finally { clearTimeout(timeout); }
}
