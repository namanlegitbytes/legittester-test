export const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8001';
export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export class ApiError extends Error {
  constructor(message: string, public status: number, public data: Record<string, unknown>) {
    super(message);
  }
}

export const getToken = (): string | null => {
  try { return localStorage.getItem('token'); } catch { return null; }
};

export async function api<T>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `HTTP ${res.status}`, res.status, data);
  return data as T;
}

export interface Product { id: string; name: string; category: string; price: number; stock: number; description: string; available: number; inStock: boolean }
export interface PricedLine { productId: string; name: string; category: string; unitPrice: number; qty: number; gross: number; tierDiscount: number; net: number }
export interface Priced {
  lines: PricedLine[]; subtotal: number; tierDiscount: number; subtotalAfterTier: number;
  coupons: { code: string; discount: number }[]; droppedCoupons: { code: string; reason: string }[];
  couponDiscount: number; freeShippingApplied: boolean; shipping: number; tax: number; total: number;
}
export interface CartView { region: string; coupons: string[]; itemCount: number; pricing: Priced }
export interface Order {
  id: string; status: string; pricing: Priced; region: string; createdAt: number; expiresAt: number;
  cancelReason?: string; refundAmount?: number; refund: { allowed: boolean; amount: number; reason?: string };
  items: { productId: string; name: string; qty: number; unitPrice: number }[];
}
export const REGIONS = ['CA', 'NY', 'TX', 'OR', 'WA', 'AK', 'HI', 'FL'];
