const BASE = (process.env.API_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
export class ApiError extends Error {
    status;
    constructor(status, message) {
        super(`HTTP ${status}: ${message}`);
        this.status = status;
    }
}
export default async function apiFetch(path) {
    const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok)
        throw new ApiError(res.status, await res.text().catch(() => res.statusText));
    return res.json();
}
