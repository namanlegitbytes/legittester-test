'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { api, money, type Product } from '../lib/api';
import { useAuth } from '../lib/auth';

interface Page { items: Product[]; total: number; page: number; pages: number }

function Catalog() {
  const router = useRouter();
  const q = useSearchParams();
  const { user, refreshCart } = useAuth();
  const [data, setData] = useState<Page>();
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [search, setSearch] = useState(q.get('search') ?? '');
  const [min, setMin] = useState(q.get('min') ?? '');
  const [max, setMax] = useState(q.get('max') ?? '');

  const qs = q.toString();
  useEffect(() => {
    const p = new URLSearchParams();
    for (const k of ['search', 'category', 'sort', 'page']) if (q.get(k)) p.set(k, q.get(k)!);
    if (q.get('min')) p.set('minPrice', String(Math.round(Number(q.get('min')) * 100)));
    if (q.get('max')) p.set('maxPrice', String(Math.round(Number(q.get('max')) * 100)));
    api<Page>(`/api/products?${p}`).then((d) => { setData(d); setError(''); }).catch((e) => { setData(undefined); setError(e.message); });
  }, [qs, q]);

  const set = (patch: Record<string, string>) => {
    const p = new URLSearchParams(q.toString());
    for (const [k, v] of Object.entries(patch)) (v ? p.set(k, v) : p.delete(k));
    if (!('page' in patch)) p.delete('page'); // any filter change goes back to page 1
    router.replace(`/?${p}`);
  };

  async function add(id: string) {
    if (!user) return router.push('/login');
    try {
      await api('/api/cart/items', { method: 'POST', body: { productId: id, qty: 1 } });
      setMsg('Added to cart'); await refreshCart();
    } catch (e) { setMsg((e as Error).message); }
  }

  return (
    <>
      <h1>Shop</h1>
      <div className="row">
        <input aria-label="Search products" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && set({ search: search.trim() })} />
        <select aria-label="Category" value={q.get('category') ?? ''} onChange={(e) => set({ category: e.target.value })}>
          <option value="">All categories</option>
          {['shoes', 'shirts', 'accessories', 'gift-card'].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input aria-label="Min price" placeholder="Min $" size={5} value={min} onChange={(e) => setMin(e.target.value)} />
        <input aria-label="Max price" placeholder="Max $" size={5} value={max} onChange={(e) => setMax(e.target.value)} />
        <select aria-label="Sort" value={q.get('sort') ?? 'name'} onChange={(e) => set({ sort: e.target.value })}>
          <option value="name">Name</option>
          <option value="price_asc">Price: low to high</option>
          <option value="price_desc">Price: high to low</option>
        </select>
        <button onClick={() => set({ search: search.trim(), min: min.trim(), max: max.trim() })}>Apply</button>
      </div>

      {msg && <p role="status">{msg}</p>}
      {error && <p className="err" role="alert">{error}</p>}
      {data && data.items.length === 0 && <p>No products match your filters.</p>}
      <div className="grid">
        {data?.items.map((p) => (
          <div key={p.id} className="card" data-testid={`product-${p.id}`}>
            <Link href={`/products/${p.id}`}><strong>{p.name}</strong></Link>
            <div>{money(p.price)}</div>
            <div className="muted">
              {p.category} · {!p.inStock ? 'Out of stock' : p.available <= 3 ? `Only ${p.available} left` : 'In stock'}
            </div>
            <button className="primary" disabled={!p.inStock} onClick={() => add(p.id)} style={{ marginTop: 8 }}>Add to cart</button>
          </div>
        ))}
      </div>

      {data && (
        <div className="row">
          <button disabled={data.page <= 1} onClick={() => set({ page: String(data.page - 1) })}>Previous</button>
          <span>Page {data.page} of {data.pages} ({data.total} products)</span>
          <button disabled={data.page >= data.pages} onClick={() => set({ page: String(data.page + 1) })}>Next</button>
        </div>
      )}
    </>
  );
}

export default function Home() {
  return <Suspense fallback={<p>Loading…</p>}><Catalog /></Suspense>;
}
