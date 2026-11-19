'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, money, type Order } from '../../lib/api';
import { useAuth } from '../../lib/auth';

export default function Orders() {
  const { user, ready } = useAuth();
  const [orders, setOrders] = useState<Order[]>();

  useEffect(() => { if (user) api<Order[]>('/api/orders').then(setOrders); }, [user]);

  if (ready && !user) return <p>Please <Link href="/login">log in</Link>.</p>;
  if (!orders) return <p>Loading…</p>;
  return (
    <>
      <h1>My orders</h1>
      {orders.length === 0 && <p>No orders yet.</p>}
      {orders.map((o) => (
        <div key={o.id} className="card row">
          <Link href={`/orders/${o.id}`}>{o.id}</Link>
          <span className="badge">{o.status}</span>
          <span>{money(o.pricing.total)}</span>
        </div>
      ))}
    </>
  );
}
