export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

type Options = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
};

// The server rotates refresh tokens and treats a reused one as theft (it ends every session), so
// all requests that hit a 401 at the same moment must share ONE refresh call.
let refreshing: Promise<boolean> | null = null;
let onSessionLost: () => void = () => {};

export const setSessionLostHandler = (fn: () => void) => {
  onSessionLost = fn;
};

function refreshOnce(): Promise<boolean> {
  refreshing ??= fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin" })
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

const buildUrl = (path: string, query: Options["query"]) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return `/api${path}${qs ? `?${qs}` : ""}`;
};

const send = (path: string, opts: Options) =>
  fetch(buildUrl(path, opts.query), {
    method: opts.method ?? "GET",
    credentials: "same-origin",
    headers: opts.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });

// Sign-in and refresh answer 401 for ordinary reasons; retrying them would loop.
const NO_REFRESH = new Set(["/auth/login", "/auth/refresh"]);

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  let res = await send(path, opts);
  if (res.status === 401 && !NO_REFRESH.has(path)) {
    if (await refreshOnce()) {
      res = await send(path, opts);
    } else {
      onSessionLost();
    }
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const error = data?.error;
    throw new ApiError(
      res.status,
      error?.code ?? "UNKNOWN",
      error?.message ?? "Something went wrong",
      error?.fields,
    );
  }
  return data as T;
}
