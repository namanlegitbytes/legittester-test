import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { randomBytes } from 'node:crypto';
import { COUPONS, REGIONS, isDiscountCoupon, priceCart, type LineInput, type Region } from './pricing.js';
import { DAY_MS, HOLD_MS, activeItems, advance, available, db, getCart, newId, now, reset, sweep, type Order, type Product, type User } from './store.js';

const app = express();
app.use(cors({ origin: ['http://localhost:8000', 'http://127.0.0.1:8000'] }));
app.use(express.json());
app.use((_req, _res, next) => { sweep(); next(); });

type Req = Request & { user?: User };
const fail = (res: Response, status: number, error: string, extra: object = {}) => res.status(status).json({ error, ...extra });
const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);
const roundHalfUp = (x: number) => Math.floor(x + 0.5);

// ---------- auth ----------
function auth(req: Req, res: Response, next: NextFunction) {
  const token = req.header('authorization')?.replace(/^Bearer /, '');
  const uid = token ? db.tokens.get(token) : undefined;
  req.user = db.users.find((u) => u.id === uid);
  if (!req.user) return fail(res, 401, 'login required');
  next();
}
const admin = (req: Req, res: Response, next: NextFunction) => (req.user?.role === 'admin' ? next() : fail(res, 403, 'admin only'));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body ?? {};
  const user = db.users.find((u) => u.email === String(email ?? '').toLowerCase() && u.password === password);
  if (!user) return fail(res, 401, 'invalid email or password');
  const token = randomBytes(16).toString('hex');
  db.tokens.set(token, user.id);
  res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
});

app.get('/api/auth/me', auth, (req: Req, res) => res.json({ id: req.user!.id, email: req.user!.email, role: req.user!.role }));

// ---------- products ----------
const publicProduct = (p: Product, uid = '') => ({ ...p, available: available(p, uid), inStock: available(p, uid) > 0 });
const optionalUser = (req: Request) => db.users.find((u) => u.id === db.tokens.get(req.header('authorization')?.replace(/^Bearer /, '') ?? ''))?.id ?? '';

app.get('/api/products', (req, res) => {
  const { search = '', category = '', sort = 'name' } = req.query as Record<string, string>;
  const page = req.query.page === undefined ? 1 : Number(req.query.page);
  const pageSize = req.query.pageSize === undefined ? 6 : Number(req.query.pageSize);
  const min = req.query.minPrice === undefined ? 0 : Number(req.query.minPrice);
  const max = req.query.maxPrice === undefined ? Infinity : Number(req.query.maxPrice);
  if (!isInt(page) || page < 1) return fail(res, 400, 'page must be a positive integer');
  if (!isInt(pageSize) || pageSize < 1 || pageSize > 50) return fail(res, 400, 'pageSize must be 1-50');
  if (Number.isNaN(min) || Number.isNaN(max) || min > max) return fail(res, 400, 'invalid price range');
  if (!['name', 'price_asc', 'price_desc'].includes(sort)) return fail(res, 400, 'invalid sort');

  let items = db.products.filter(
    (p) =>
      (!search || `${p.name} ${p.description}`.toLowerCase().includes(search.toLowerCase())) &&
      (!category || p.category === category) &&
      p.price >= min && p.price <= max,
  );
  items = [...items].sort((a, b) => (sort === 'price_asc' ? a.price - b.price : sort === 'price_desc' ? b.price - a.price : a.name.localeCompare(b.name)));
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const uid = optionalUser(req);
  res.json({ items: items.slice((page - 1) * pageSize, page * pageSize).map((p) => publicProduct(p, uid)), total, page, pages });
});

app.get('/api/products/:id', (req, res) => {
  const p = db.products.find((x) => x.id === req.params.id);
  p ? res.json(publicProduct(p, optionalUser(req))) : fail(res, 404, 'product not found');
});

app.post('/api/products', auth, admin, (req, res) => {
  const { name, category, price, stock, description = '' } = req.body ?? {};
  if (!name || !category || !isInt(price) || price < 0 || !isInt(stock) || stock < 0) return fail(res, 400, 'name, category, price (cents) and stock are required');
  const p: Product = { id: newId('p'), name, category, price, stock, description };
  db.products.push(p);
  res.status(201).json(p);
});

app.patch('/api/products/:id', auth, admin, (req, res) => {
  const p = db.products.find((x) => x.id === req.params.id);
  if (!p) return fail(res, 404, 'product not found');
  const { price, stock } = req.body ?? {};
  if (price !== undefined && (!isInt(price) || price < 0)) return fail(res, 400, 'price must be a non-negative integer (cents)');
  if (stock !== undefined) {
    if (!isInt(stock) || stock < 0) return fail(res, 400, 'stock must be a non-negative integer');
    const held = p.stock - available(p, '');
    if (stock < held) return fail(res, 409, 'stock cannot go below units currently held in carts/orders', { held });
    p.stock = stock;
  }
  if (price !== undefined) p.price = price;
  res.json(p);
});

// ---------- cart ----------
function cartView(uid: string) {
  const cart = getCart(uid);
  const lines: LineInput[] = activeItems(cart).flatMap((i) => {
    const p = db.products.find((x) => x.id === i.productId);
    return p ? [{ productId: p.id, name: p.name, category: p.category, unitPrice: p.price, qty: i.qty }] : [];
  });
  const pricing = priceCart(lines, cart.coupons, cart.region);
  return { region: cart.region, coupons: cart.coupons, itemCount: lines.reduce((n, l) => n + l.qty, 0), pricing };
}

const validQty = (q: unknown): q is number => isInt(q) && q >= 0 && q <= 100;

function setQty(uid: string, productId: string, qty: number, res: Response) {
  const p = db.products.find((x) => x.id === productId);
  if (!p) return fail(res, 404, 'product not found');
  const cart = getCart(uid);
  if (qty === 0) {
    cart.items = cart.items.filter((i) => i.productId !== productId);
    return res.json(cartView(uid));
  }
  const avail = available(p, uid);
  if (qty > avail) return fail(res, 409, avail === 0 ? 'out of stock' : `only ${avail} available`, { available: avail });
  const existing = cart.items.find((i) => i.productId === productId);
  if (existing) { existing.qty = qty; existing.updatedAt = now(); } else cart.items.push({ productId, qty, updatedAt: now() });
  res.json(cartView(uid));
}

app.get('/api/cart', auth, (req: Req, res) => res.json(cartView(req.user!.id)));

app.post('/api/cart/items', auth, (req: Req, res) => {
  const { productId, qty } = req.body ?? {};
  if (!validQty(qty) || qty < 1) return fail(res, 400, 'qty must be an integer from 1 to 100');
  const existing = getCart(req.user!.id).items.find((i) => i.productId === productId);
  const total = (existing?.qty ?? 0) + qty; // adding the same product accumulates
  if (total > 100) return fail(res, 400, 'max 100 units per product');
  setQty(req.user!.id, productId, total, res);
});

app.patch('/api/cart/items/:productId', auth, (req: Req, res) => {
  const { qty } = req.body ?? {};
  if (!validQty(qty)) return fail(res, 400, 'qty must be an integer from 0 to 100');
  if (!getCart(req.user!.id).items.some((i) => i.productId === req.params.productId)) return fail(res, 404, 'item not in cart');
  setQty(req.user!.id, req.params.productId, qty, res);
});

app.put('/api/cart/region', auth, (req: Req, res) => {
  const { region } = req.body ?? {};
  if (!REGIONS.includes(region)) return fail(res, 400, `region must be one of ${REGIONS.join(', ')}`);
  getCart(req.user!.id).region = region as Region;
  res.json(cartView(req.user!.id));
});

app.post('/api/cart/coupon', auth, (req: Req, res) => {
  const code = String(req.body?.code ?? '').trim().toUpperCase();
  const coupon = COUPONS[code];
  if (!coupon) return fail(res, 404, 'unknown coupon');
  const cart = getCart(req.user!.id);
  if (cart.coupons.includes(code)) return fail(res, 409, 'coupon already applied');
  if (isDiscountCoupon(coupon) && cart.coupons.some((c) => isDiscountCoupon(COUPONS[c]))) return fail(res, 409, 'only one discount coupon at a time (FREESHIP stacks)');
  const view = cartView(req.user!.id);
  const probe = priceCart(view.pricing.lines, [...cart.coupons, code], cart.region);
  const dropped = probe.droppedCoupons.find((d) => d.code === code);
  if (dropped) return fail(res, 422, `coupon not applicable: ${dropped.reason}`);
  cart.coupons.push(code);
  res.json(cartView(req.user!.id));
});

app.delete('/api/cart/coupon/:code', auth, (req: Req, res) => {
  const cart = getCart(req.user!.id);
  cart.coupons = cart.coupons.filter((c) => c !== req.params.code.toUpperCase());
  res.json(cartView(req.user!.id));
});

// ---------- orders ----------
const giftOnly = (o: Order) => o.items.every((i) => i.category === 'gift-card');

function refundQuote(o: Order): { allowed: boolean; amount: number; reason?: string } {
  if (o.status !== 'delivered') return { allowed: false, amount: 0, reason: 'only delivered orders can be refunded' };
  if (giftOnly(o)) return { allowed: false, amount: 0, reason: 'gift cards are non-refundable' };
  const days = Math.floor((now() - o.deliveredAt!) / DAY_MS);
  const giftNet = o.pricing.lines.filter((l) => l.category === 'gift-card').reduce((n, l) => n + l.net, 0);
  if (days <= 7) return { allowed: true, amount: o.pricing.total - giftNet };
  if (days <= 14) {
    const itemsNet = o.pricing.lines.filter((l) => l.category !== 'gift-card').reduce((n, l) => n + l.net, 0) - o.pricing.couponDiscount;
    return { allowed: true, amount: roundHalfUp(itemsNet * 0.9) }; // 10% restocking fee, no shipping/tax back
  }
  return { allowed: false, amount: 0, reason: 'refund window (14 days) has closed' };
}

const orderView = (o: Order) => ({ ...o, refund: refundQuote(o) });
const findOrder = (req: Req) => {
  const o = db.orders.find((x) => x.id === req.params.id);
  return o && (o.userId === req.user!.id || req.user!.role === 'admin') ? o : undefined;
};
const restock = (o: Order) => o.items.forEach((i) => { const p = db.products.find((x) => x.id === i.productId); if (p && i.category !== 'gift-card') p.stock += i.qty; });

function luhn(num: string): boolean {
  let sum = 0;
  [...num].reverse().forEach((ch, i) => { let d = Number(ch); if (i % 2) { d *= 2; if (d > 9) d -= 9; } sum += d; });
  return sum % 10 === 0;
}

app.post('/api/orders', auth, (req: Req, res) => {
  const key = req.header('idempotency-key');
  if (!key) return fail(res, 400, 'Idempotency-Key header is required');
  const prior = db.orders.find((o) => o.userId === req.user!.id && o.idempotencyKey === key);
  if (prior) return res.status(200).json(orderView(prior)); // replay: same order, no duplicate

  const cart = getCart(req.user!.id);
  const items = activeItems(cart);
  if (items.length === 0) return fail(res, 400, 'cart is empty');
  for (const i of items) {
    const p = db.products.find((x) => x.id === i.productId)!;
    if (i.qty > available(p, req.user!.id)) return fail(res, 409, `${p.name}: not enough stock`, { productId: p.id, available: available(p, req.user!.id) });
  }
  const view = cartView(req.user!.id);
  const order: Order = {
    id: newId('ord'), userId: req.user!.id, coupons: [...cart.coupons], region: cart.region, pricing: view.pricing,
    items: view.pricing.lines.map((l) => ({ productId: l.productId, name: l.name, category: l.category, unitPrice: l.unitPrice, qty: l.qty })),
    status: 'created', createdAt: now(), expiresAt: now() + HOLD_MS, idempotencyKey: key, paymentAttempts: 0,
  };
  db.orders.push(order);
  cart.items = [];
  cart.coupons = [];
  res.status(201).json(orderView(order));
});

app.get('/api/orders', auth, (req: Req, res) => res.json(db.orders.filter((o) => o.userId === req.user!.id).map(orderView).reverse()));

app.get('/api/orders/:id', auth, (req: Req, res) => {
  const o = findOrder(req);
  o ? res.json(orderView(o)) : fail(res, 404, 'order not found');
});

app.post('/api/orders/:id/pay', auth, (req: Req, res) => {
  const o = findOrder(req);
  if (!o || o.userId !== req.user!.id) return fail(res, 404, 'order not found');
  if (o.status !== 'created') return fail(res, 409, o.cancelReason === 'expired' ? 'order expired' : `order is ${o.status}`);
  const card = String(req.body?.cardNumber ?? '').replace(/[\s-]/g, '');
  if (!/^\d{16}$/.test(card) || !luhn(card)) return fail(res, 400, 'invalid card number');

  if (card === '4000000000000002') {
    o.paymentAttempts++;
    if (o.paymentAttempts >= 3) {
      o.status = 'cancelled'; o.cancelledAt = now(); o.cancelReason = 'payment_failed';
      return fail(res, 409, 'too many failed payments, order cancelled');
    }
    return fail(res, 402, 'card declined', { attemptsLeft: 3 - o.paymentAttempts });
  }
  for (const i of o.items) {
    const p = db.products.find((x) => x.id === i.productId)!;
    if (p.stock < i.qty) return fail(res, 409, `${p.name}: stock changed, cannot complete payment`);
  }
  o.items.forEach((i) => { const p = db.products.find((x) => x.id === i.productId)!; p.stock -= i.qty; });
  o.paidAt = now();
  o.paymentRef = `pay_${randomBytes(4).toString('hex')}`;
  o.status = 'paid';
  if (giftOnly(o)) { o.status = 'delivered'; o.deliveredAt = now(); } // digital goods deliver instantly
  res.json(orderView(o));
});

app.post('/api/orders/:id/cancel', auth, (req: Req, res) => {
  const o = findOrder(req);
  if (!o) return fail(res, 404, 'order not found');
  if (o.status === 'created') {
    o.status = 'cancelled'; o.cancelledAt = now(); o.cancelReason = 'customer';
  } else if (o.status === 'paid') {
    restock(o);
    o.status = 'refunded'; o.refundedAt = now(); o.refundAmount = o.pricing.total; // cancelled before shipping: full refund
  } else return fail(res, 409, `cannot cancel an order that is ${o.status}`);
  res.json(orderView(o));
});

app.post('/api/orders/:id/ship', auth, admin, (req: Req, res) => {
  const o = findOrder(req);
  if (!o) return fail(res, 404, 'order not found');
  if (o.status !== 'paid') return fail(res, 409, `only paid orders can ship (order is ${o.status})`);
  o.status = 'shipped'; o.shippedAt = now();
  res.json(orderView(o));
});

app.post('/api/orders/:id/deliver', auth, admin, (req: Req, res) => {
  const o = findOrder(req);
  if (!o) return fail(res, 404, 'order not found');
  if (o.status !== 'shipped') return fail(res, 409, `only shipped orders can be delivered (order is ${o.status})`);
  o.status = 'delivered'; o.deliveredAt = now();
  res.json(orderView(o));
});

app.post('/api/orders/:id/refund', auth, (req: Req, res) => {
  const o = findOrder(req);
  if (!o || o.userId !== req.user!.id) return fail(res, 404, 'order not found');
  const q = refundQuote(o);
  if (!q.allowed) return fail(res, 409, q.reason!);
  restock(o);
  o.status = 'refunded'; o.refundedAt = now(); o.refundAmount = q.amount;
  res.json(orderView(o));
});

app.get('/api/admin/orders', auth, admin, (req, res) => {
  const status = req.query.status as string | undefined;
  res.json(db.orders.filter((o) => !status || o.status === status).map(orderView).reverse());
});

// ---------- test helpers (disabled in production) ----------
if (process.env.NODE_ENV !== 'production') {
  app.post('/api/test/reset', (_req, res) => { reset(); res.json({ ok: true }); });
  app.post('/api/test/advance-time', (req, res) => {
    const m = req.body?.minutes;
    if (typeof m !== 'number' || m < 0) return fail(res, 400, 'minutes must be a non-negative number');
    advance(m);
    res.json({ ok: true });
  });
}

const port = Number(process.env.PORT ?? 8001);
app.listen(port, () => console.log(`shopflow api on :${port}`));
