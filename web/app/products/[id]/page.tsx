'use client';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, money, type Product } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';

export default function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, refreshCart } = useAuth();
  const [p, setP] = useState<Product>();
  const [qty, setQty] = useState(1);
  const [msg, setMsg] = useState<{ text: string; bad: boolean }>();
  const [missing, setMissing] = useState(false);

  useEffect(() => { api<Product>(`/api/products/${id}`).then(setP).catch(() => setMissing(true)); }, [id]);

  async function add() {
    if (!user) return router.push('/login');
    try {
      await api('/api/cart/items', { method: 'POST', body: { productId: id, qty } });
      setMsg({ text: `Added ${qty} to cart`, bad: false });
      await refreshCart();
    } catch (e) { setMsg({ text: (e as Error).message, bad: true }); }
  }

  if (missing) return <p>Product not found.</p>;
  if (!p) return <p>Loading…</p>;
  return (
    <div className="card">
      <h1>{p.name}</h1>
      <p>{p.description}</p>
      <p><strong>{money(p.price)}</strong> <span className="badge">{p.category}</span></p>
      {p.category !== 'gift-card' && <p className="muted">Buy 10+ for 10% off, 50+ for 20% off.</p>}
      <p className="muted">{p.inStock ? `${p.available} available` : 'Out of stock'}</p>
      <div className="row">
        <label>Quantity <input type="number" min={1} max={100} value={qty} onChange={(e) => setQty(Number(e.target.value))} style={{ width: 70 }} /></label>
        <button className="primary" disabled={!p.inStock} onClick={add}>Add to cart</button>
      </div>
      {msg && <p role="status" className={msg.bad ? 'err' : 'ok'}>{msg.text}</p>}
    </div>
  );
}
