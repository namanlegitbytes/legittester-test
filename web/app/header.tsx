'use client';
import Link from 'next/link';
import { useAuth } from '../lib/auth';

export default function Header() {
  const { user, cartCount, logout } = useAuth();
  return (
    <header>
      <strong><Link href="/">Shopflow</Link></strong>
      <Link href="/">Shop</Link>
      <Link href="/cart">Cart ({cartCount})</Link>
      {user && <Link href="/orders">My orders</Link>}
      {user?.role === 'admin' && <Link href="/admin">Admin</Link>}
      <span className="spacer" />
      {user ? (
        <>
          <span>{user.email}</span>
          <button onClick={logout}>Log out</button>
        </>
      ) : (
        <Link href="/login">Log in</Link>
      )}
    </header>
  );
}
