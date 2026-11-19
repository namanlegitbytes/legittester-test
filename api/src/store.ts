import type { Priced, Region } from './pricing.js';

export interface Product { id: string; name: string; category: string; price: number; stock: number; description: string }
export interface User { id: string; email: string; password: string; role: 'customer' | 'admin' }
export interface CartItem { productId: string; qty: number; updatedAt: number }
export interface Cart { items: CartItem[]; coupons: string[]; region: Region }
export type OrderStatus = 'created' | 'paid' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';
export interface OrderItem { productId: string; name: string; category: string; unitPrice: number; qty: number }
export interface Order {
  id: string; userId: string; items: OrderItem[]; coupons: string[]; region: Region; pricing: Priced;
  status: OrderStatus; createdAt: number; expiresAt: number; idempotencyKey: string;
  paymentAttempts: number; paymentRef?: string; paidAt?: number; shippedAt?: number; deliveredAt?: number;
  cancelledAt?: number; cancelReason?: string; refundedAt?: number; refundAmount?: number;
}

export const HOLD_MS = 15 * 60_000; // stock is held 15 minutes for carts and unpaid orders
export const DAY_MS = 86_400_000;

// Test clock: lets tests fast-forward without sleeping.
let offset = 0;
export const now = () => Date.now() + offset;
export const advance = (minutes: number) => { offset += minutes * 60_000; };

const seedProducts = (): Product[] => [
  { id: 'p1', name: 'Trail Runner Shoes', category: 'shoes', price: 8999, stock: 25, description: 'Grippy trail shoes.' },
  { id: 'p2', name: 'Court Classic Sneakers', category: 'shoes', price: 6500, stock: 3, description: 'Low stock classic.' },
  { id: 'p3', name: 'Cotton Tee', category: 'shirts', price: 1800, stock: 200, description: 'Everyday tee. Bulk discounts apply.' },
  { id: 'p4', name: 'Wool Sweater', category: 'shirts', price: 7400, stock: 12, description: 'Warm merino sweater.' },
  { id: 'p5', name: 'Canvas Backpack', category: 'accessories', price: 5500, stock: 40, description: '20L daypack.' },
  { id: 'p6', name: 'Leather Belt', category: 'accessories', price: 2900, stock: 0, description: 'Currently out of stock.' },
  { id: 'p7', name: 'Digital Gift Card $25', category: 'gift-card', price: 2500, stock: 9999, description: 'Delivered instantly.' },
  { id: 'p8', name: 'Running Socks 3-pack', category: 'accessories', price: 1200, stock: 500, description: 'Moisture-wicking.' },
  { id: 'p9', name: 'Rain Jacket', category: 'shirts', price: 12900, stock: 8, description: 'Waterproof shell.' },
  { id: 'p10', name: 'Limited Edition Hoodie', category: 'shirts', price: 9900, stock: 1, description: 'Only one left.' },
  { id: 'p11', name: 'Sports Cap', category: 'accessories', price: 1500, stock: 60, description: 'Breathable cap.' },
  { id: 'p12', name: 'Hiking Boots', category: 'shoes', price: 14900, stock: 15, description: 'Waterproof boots.' },
];

const seedUsers = (): User[] => [
  { id: 'u1', email: 'alice@shop.test', password: 'alice-pass', role: 'customer' },
  { id: 'u2', email: 'bob@shop.test', password: 'bob-pass', role: 'customer' },
  { id: 'u3', email: 'admin@shop.test', password: 'admin-pass', role: 'admin' },
];

export const db = {
  products: seedProducts(),
  users: seedUsers(),
  tokens: new Map<string, string>(), // token -> userId
  carts: new Map<string, Cart>(),
  orders: [] as Order[],
  seq: 1,
};

export function reset(): void {
  db.products = seedProducts();
  db.users = seedUsers();
  db.tokens.clear();
  db.carts.clear();
  db.orders = [];
  db.seq = 1;
  offset = 0;
}

export const getCart = (userId: string): Cart => {
  let c = db.carts.get(userId);
  if (!c) { c = { items: [], coupons: [], region: 'CA' }; db.carts.set(userId, c); }
  return c;
};

// Cart lines older than the hold window no longer reserve stock (and are dropped lazily).
export const activeItems = (cart: Cart) => cart.items.filter((i) => now() - i.updatedAt < HOLD_MS);

// Expire unpaid orders whose hold ran out.
export function sweep(): void {
  for (const o of db.orders) {
    if (o.status === 'created' && now() > o.expiresAt) {
      o.status = 'cancelled';
      o.cancelledAt = now();
      o.cancelReason = 'expired';
    }
  }
  for (const c of db.carts.values()) c.items = activeItems(c);
}

// Stock currently promised to other people (other carts + unpaid orders).
export function reservedByOthers(productId: string, userId: string): number {
  let n = 0;
  for (const [uid, c] of db.carts) if (uid !== userId) n += activeItems(c).filter((i) => i.productId === productId).reduce((s, i) => s + i.qty, 0);
  for (const o of db.orders) if (o.status === 'created') n += o.items.filter((i) => i.productId === productId).reduce((s, i) => s + i.qty, 0);
  return n;
}

export const available = (p: Product, userId: string) => Math.max(0, p.stock - reservedByOthers(p.id, userId));
export const newId = (prefix: string) => `${prefix}_${(db.seq++).toString().padStart(4, '0')}`;
