export interface User { id: number; email: string; coins: number; dailyAvailable: boolean; nextDailyAt: number; dailyCoins: number }

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch('/api' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status, data });
  return data as T;
}

export const api = {
  me: () => call<{ user: User }>('/auth/me'),
  signup: (email: string, password: string, ageConfirmed: boolean) => call<{ user: User; starter: number }>('/auth/signup', { email, password, ageConfirmed }),
  login: (email: string, password: string) => call<{ user: User }>('/auth/login', { email, password }),
  logout: () => call('/auth/logout', {}),
  daily: () => call<{ user: User; granted: number }>('/auth/daily', {}),
  shopConfig: () => call<{ packs: import('../../shared/config').CoinPack[]; stripe: boolean; testMode: boolean; devPurchases: boolean }>('/shop/config'),
  checkout: (packId: string) => call<{ url: string }>('/shop/checkout', { packId }),
  verify: (sessionId: string) => call<{ ok: boolean; reason?: string; user: User }>('/shop/verify', { sessionId }),
  testPurchase: (packId: string) => call<{ user: User; granted: number }>('/shop/test-purchase', { packId }),
};
