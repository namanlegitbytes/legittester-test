'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, money, type Order, type Product } from '../../lib/api';
import { useAuth } from '../../lib/auth';

export default function Admin() {
  const { user, ready } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const [p, o] = await Promise.all([api<{ items: Product[] }>('/api/products?pageSize=50'), api<Order[]>('/api/admin/orders')]);
      setProducts(p.items); setOrders(o);
    } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { if (user?.role === 'admin') load(); }, [user, load]);

  if (!ready) return <p>Loading…</p>;
  if (user?.role !== 'admin') return <p className="err">Admins only.</p>;

  async function save(id: string, price: string, stock: string) {
    try {
      await api(`/api/products/${id}`, { method: 'PATCH', body: { price: Math.round(Number(price) * 100), stock: Number(stock) } });
      setErr(''); load();
    } catch (e) { setErr((e as Error).message); }
  }
  const advance = (id: string, step: 'ship' | 'deliver') => api(`/api/orders/${id}/${step}`, { method: 'POST' }).then(load).catch((e) => setErr(e.message));

  return (
    <>
      <h1>Admin</h1>
      {err && <p className="err" role="alert">{err}</p>}
      <h2>Products</h2>
      <div className="card">
        <table>
          <thead><tr><th>Name</th><th>Price ($)</th><th>Stock</th><th /></tr></thead>
          <tbody>
            {products.map((p) => <ProductRow key={`${p.id}-${p.price}-${p.stock}`} p={p} onSave={save} />)}
          </tbody>
        </table>
      </div>
      <h2>Orders</h2>
      <div className="card">
        {orders.length === 0 && <span className="muted">No orders.</span>}
        {orders.map((o) => (
          <div key={o.id} className="row">
            <span>{o.id}</span><span className="badge">{o.status}</span><span>{money(o.pricing.total)}</span>
            {o.status === 'paid' && <button onClick={() => advance(o.id, 'ship')}>Ship</button>}
            {o.status === 'shipped' && <button onClick={() => advance(o.id, 'deliver')}>Mark delivered</button>}
          </div>
        ))}
      </div>
    </>
  );
}

function ProductRow({ p, onSave }: { p: Product; onSave: (id: string, price: string, stock: string) => void }) {
  const [price, setPrice] = useState((p.price / 100).toFixed(2));
  const [stock, setStock] = useState(String(p.stock));
  return (
    <tr>
      <td>{p.name}</td>
      <td><input aria-label={`Price for ${p.name}`} value={price} onChange={(e) => setPrice(e.target.value)} size={7} /></td>
      <td><input aria-label={`Stock for ${p.name}`} value={stock} onChange={(e) => setStock(e.target.value)} size={5} /></td>
      <td><button onClick={() => onSave(p.id, price, stock)}>Save</button></td>
    </tr>
  );
}
