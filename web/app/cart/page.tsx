'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api, money, REGIONS, type CartView, type Order } from '../../lib/api';
import { useAuth } from '../../lib/auth';

export default function CartPage() {
  const router = useRouter();
  const { user, ready, refreshCart } = useAuth();
  const [cart, setCart] = useState<CartView>();
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(() => api<CartView>('/api/cart').then(setCart).catch((e) => setErr(e.message)), []);
  useEffect(() => { if (ready && user) load(); }, [ready, user, load]);

  async function run(fn: () => Promise<CartView | Order | unknown>) {
    try { const r = await fn(); setErr(''); if (r && (r as CartView).pricing) setCart(r as CartView); await refreshCart(); return r; }
    catch (e) { setErr((e as Error).message); }
  }

  if (ready && !user) return <p>Please <Link href="/login">log in</Link> to see your cart.</p>;
  if (!cart) return <p>{err || 'Loading…'}</p>;
  const pr = cart.pricing;

  async function checkout() {
    const o = (await run(() => api<Order>('/api/orders', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() } }))) as Order | undefined;
    if (o?.id) router.push(`/orders/${o.id}`);
  }

  return (
    <>
      <h1>Your cart</h1>
      {err && <p className="err" role="alert">{err}</p>}
      {pr.lines.length === 0 ? <p>Your cart is empty. <Link href="/">Keep shopping</Link></p> : (
        <>
          <div className="card">
            <table>
              <thead><tr><th>Item</th><th>Qty</th><th>Line total</th><th /></tr></thead>
              <tbody>
                {pr.lines.map((l) => (
                  <tr key={l.productId} data-testid={`line-${l.productId}`}>
                    <td>{l.name}<div className="muted">{money(l.unitPrice)} each</div></td>
                    <td>
                      <input type="number" min={0} max={100} aria-label={`Quantity for ${l.name}`} defaultValue={l.qty} style={{ width: 70 }}
                        onBlur={(e) => Number(e.target.value) !== l.qty && run(() => api<CartView>(`/api/cart/items/${l.productId}`, { method: 'PATCH', body: { qty: Number(e.target.value) } }))} />
                    </td>
                    <td>{money(l.net)}{l.tierDiscount > 0 && <div className="muted">bulk discount −{money(l.tierDiscount)}</div>}</td>
                    <td><button aria-label={`Remove ${l.name}`} onClick={() => run(() => api<CartView>(`/api/cart/items/${l.productId}`, { method: 'PATCH', body: { qty: 0 } }))}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="row">
              <label>Ship to <select value={cart.region} onChange={(e) => run(() => api<CartView>('/api/cart/region', { method: 'PUT', body: { region: e.target.value } }))}>
                {REGIONS.map((r) => <option key={r}>{r}</option>)}
              </select></label>
            </div>
            <div className="row">
              <input aria-label="Coupon code" placeholder="Coupon code" value={code} onChange={(e) => setCode(e.target.value)} />
              <button onClick={() => run(() => api<CartView>('/api/cart/coupon', { method: 'POST', body: { code } })).then(() => setCode(''))}>Apply coupon</button>
            </div>
            {pr.coupons.map((c) => (
              <div key={c.code} className="row"><span className="badge">{c.code}</span>
                <button aria-label={`Remove coupon ${c.code}`} onClick={() => run(() => api<CartView>(`/api/cart/coupon/${c.code}`, { method: 'DELETE' }))}>Remove</button></div>
            ))}
            {pr.droppedCoupons.map((d) => <p key={d.code} className="err">{d.code} no longer applies: {d.reason}</p>)}
          </div>

          <div className="card totals" data-testid="totals">
            <div><span>Subtotal</span><span>{money(pr.subtotal)}</span></div>
            {pr.tierDiscount > 0 && <div><span>Bulk discount</span><span>−{money(pr.tierDiscount)}</span></div>}
            {pr.couponDiscount > 0 && <div><span>Coupon discount</span><span>−{money(pr.couponDiscount)}</span></div>}
            <div><span>Shipping</span><span>{pr.shipping === 0 ? 'Free' : money(pr.shipping)}</span></div>
            <div><span>Tax</span><span>{money(pr.tax)}</span></div>
            <div className="grand"><span>Total</span><span>{money(pr.total)}</span></div>
            <button className="primary" style={{ marginTop: 12 }} onClick={checkout}>Place order</button>
          </div>
        </>
      )}
    </>
  );
}
