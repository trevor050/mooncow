export async function fetchJson<T = unknown>(url: string, signal?: AbortSignal, timeoutMs = 8000): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const res = await fetch(url, { signal: combined, credentials: 'omit' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}
