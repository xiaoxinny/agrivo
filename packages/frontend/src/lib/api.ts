const BASE_URL: string = import.meta.env.VITE_API_URL;
if (!BASE_URL) {
  throw new Error("VITE_API_URL is not set — add it to .env.local for development or as a build arg for production");
}

/** Custom event dispatched when a 401 response is received, signaling session expiry. */
export const SESSION_EXPIRED_EVENT = "session-expired";

/**
 * When true, 401 responses will NOT dispatch the session-expired event.
 * Used during the initial token refresh probe to avoid an infinite loop.
 */
export let suppressSessionExpired = false;
export function setSuppressSessionExpired(value: boolean) {
  suppressSessionExpired = value;
}

/**
 * Thin fetch wrapper that sends credentials (httpOnly cookies) with every request
 * and dispatches a `session-expired` custom event on 401 responses.
 */
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (res.status === 401) {
    if (!suppressSessionExpired) {
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
    }
    throw new ApiError("Session expired", 401);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new ApiError(body.detail ?? res.statusText, res.status);
  }

  // Handle 204 No Content
  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path),

  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "POST",
      body: body != null ? JSON.stringify(body) : undefined,
    }),
};
