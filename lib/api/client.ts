const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}/api/v1${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new ApiError(body.error || response.statusText, response.status);
  }

  return response.json();
}

export function apiGet<T = unknown>(path: string, headers?: Record<string, string>) {
  return apiFetch<T>(path, { method: "GET", headers });
}

export function apiPost<T = unknown>(path: string, body?: unknown, headers?: Record<string, string>) {
  return apiFetch<T>(path, {
    method: "POST",
    body: body ? JSON.stringify(body) : undefined,
    headers,
  });
}

export function apiPatch<T = unknown>(path: string, body?: unknown, headers?: Record<string, string>) {
  return apiFetch<T>(path, {
    method: "PATCH",
    body: body ? JSON.stringify(body) : undefined,
    headers,
  });
}

export function apiDelete<T = unknown>(path: string, headers?: Record<string, string>) {
  return apiFetch<T>(path, { method: "DELETE", headers });
}