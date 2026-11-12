import { demoResponse } from './demo-api';
import { useCallback, useEffect, useState } from 'react';

export class RequestError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = demoResponse(path, options);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new RequestError('Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.', 0);
  }
  if (response.status === 401 && !options.signal?.aborted && !path.startsWith('/api/auth/') && path !== '/api/bootstrap') {
    window.dispatchEvent(new Event('session-expired'));
  }
  let body: Record<string, unknown>;
  try { body = await response.json(); } catch { throw new RequestError('O servidor não respondeu como esperado. Tente novamente.', response.status); }
  if (!response.ok) {
    const message = response.status === 409 ? String(body.error || 'Este registro mudou em outro acesso. Atualize os dados e tente novamente.') : String(body.error || body.message || (response.status === 401 ? 'Usuário ou senha inválidos.' : 'Não foi possível concluir a operação.'));
    throw new RequestError(message, response.status, body.code as string | undefined);
  }
  return body as T;
}
export const post = <T,>(path: string, body: unknown) => api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const patch = <T,>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
export function useQuery<T>(path: string | null) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ path: string; revision: number; data: T | null; error: string | null } | null>(null);
  const reload = useCallback(() => setRevision(v => v + 1), []);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    api<T>(path, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setResult({ path, revision, data, error: null });
    }).catch((err: Error) => {
      if (!controller.signal.aborted) setResult({ path, revision, data: null, error: err.message });
    });
    return () => controller.abort();
  }, [path, revision]);
  const current = result?.path === path && result.revision === revision ? result : null;
  return { data: current?.data ?? null, error: current?.error ?? null, loading: Boolean(path && !current), reload };
}
