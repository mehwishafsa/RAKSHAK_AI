import type { AppState, Incident, LedgerEntry, LedgerVerification, ScenarioId } from "../types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

const post = <T>(path: string, body: unknown = {}) => request<T>(path, { method: "POST", body: JSON.stringify(body) });

export const api = {
  state: () => request<AppState>("/api/state"),
  injectScenario: (scenario: ScenarioId) => post("/api/sim/scenario", { scenario }),
  reset: () => post("/api/sim/reset"),
  setSpeed: (speed: number) => post("/api/sim/speed", { speed }),
  emergencyStop: (actor: string) => post("/api/sim/estop", { actor }),
  releaseEstop: (actor: string) => post("/api/sim/release", { actor }),
  approve: (id: string, approver: string, note: string) =>
    post<Incident>(`/api/incidents/${encodeURIComponent(id)}/approve`, { approver, note }),
  reject: (id: string, approver: string, reason: string) =>
    post<Incident>(`/api/incidents/${encodeURIComponent(id)}/reject`, { approver, reason }),
  ledger: (limit = 200) => request<LedgerEntry[]>(`/api/ledger?limit=${limit}`),
  verifyLedger: () => request<LedgerVerification>("/api/ledger/verify"),
};

export function wsUrl(path: string): string {
  const { protocol, host } = window.location;
  return `${protocol === "https:" ? "wss" : "ws"}://${host}${path}`;
}
