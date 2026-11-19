'use client';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, money, type Order } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const { ready, user, refreshCart } = useAuth();
  const [o, setO] = useState<Order>();
  const [card, setCard] = useState('');
  const [msg, setMsg] = useState<{ text: string; bad: boolean }>();
  const [left, setLeft] = useState(0);

  const load = useCallback(() => api<Order>(`/api/orders/${id}`).then(setO).catch((e) => setMsg({ text: e.message, bad: true })), [id]);
  useEffect(() => { if (ready && user) load(); }, [ready, user, load]);

  // countdown for the 15-minute payment hold
  useEffect(() => {
    if (o?.status !== 'created') return;
    const t = setInterval(() => setLeft(Math.max(0, Math.floor((o.expiresAt - Date.now()) / 1000))), 1000);
    return () => clearInterval(t);
  }, [o]);

  async function act(path: string, body?: unknown, okText?: string) {
    try {
      setO(await api<Order>(`/api/orders/${id}/${path}`, { method: 'POST', body }));
      setMsg(okText ? { text: okText, bad: false } : undefined);
      await refreshCart();
    } catch (e) {
      const err = e as ApiError;
      setMsg({ text: err.status === 402 ? `${err.message}. Attempts left: ${err.data.attemptsLeft}` : err.message, bad: true });
      await load();
    }
  }

  if (!o) return <p>{msg?.text ?? 'Loading…'}</p>;
  const pr = o.pricing;
  return (
    <>
      <h1>Order {o.id} <span className="badge" data-testid="order-status">{o.status}</span></h1>
      {o.status === 'cancelled' && <p className="err">Cancelled ({o.cancelReason})</p>}
      {o.status === 'refunded' && <p className="ok">Refunded {money(o.refundAmount ?? 0)}</p>}
      {msg && <p role="status" className={msg.bad ? 'err' : 'ok'}>{msg.text}</p>}

      <div className="card">
        {o.items.map((i) => <div key={i.productId}>{i.qty} × {i.name} — {money(i.qty * i.unitPrice)}</div>)}
      </div>
      <div className="card totals">
        <div><span>Subtotal</span><span>{money(pr.subtotal)}</span></div>
        {pr.tierDiscount > 0 && <div><span>Bulk discount</span><span>−{money(pr.tierDiscount)}</span></div>}
        {pr.couponDiscount > 0 && <div><span>Coupon discount</span><span>−{money(pr.couponDiscount)}</span></div>}
        <div><span>Shipping</span><span>{pr.shipping === 0 ? 'Free' : money(pr.shipping)}</span></div>
        <div><span>Tax ({o.region})</span><span>{money(pr.tax)}</span></div>
        <div className="grand"><span>Total</span><span>{money(pr.total)}</span></div>
      </div>

      {o.status === 'created' && (
        <div className="card">
          <p className="muted">Stock is held for you for {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}.</p>
          <div className="row">
            <input aria-label="Card number" placeholder="4242 4242 4242 4242" value={card} onChange={(e) => setCard(e.target.value)} />
            <button className="primary" onClick={() => act('pay', { cardNumber: card }, 'Payment successful')}>Pay {money(pr.total)}</button>
          </div>
          <button onClick={() => act('cancel', undefined, 'Order cancelled')}>Cancel order</button>
        </div>
      )}
      {o.status === 'paid' && <button onClick={() => act('cancel', undefined, 'Order cancelled and refunded')}>Cancel and refund</button>}
      {o.status === 'delivered' && (
        o.refund.allowed
          ? <button onClick={() => act('refund', undefined, `Refunded ${money(o.refund.amount)}`)}>Request refund ({money(o.refund.amount)})</button>
          : <p className="muted">Refund unavailable: {o.refund.reason}</p>
      )}
    </>
  );
}
