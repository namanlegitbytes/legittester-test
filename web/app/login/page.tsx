'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '../../lib/auth';

export default function Login() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try { await login(email, password); router.push('/'); } catch (x) { setErr((x as Error).message); }
  }

  return (
    <form className="card" onSubmit={submit} style={{ maxWidth: 360 }}>
      <h1>Log in</h1>
      <div className="row"><label>Email <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label></div>
      <div className="row"><label>Password <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label></div>
      {err && <p className="err" role="alert">{err}</p>}
      <button className="primary" type="submit">Log in</button>
      <p className="muted">Demo users: alice@shop.test / alice-pass, bob@shop.test / bob-pass, admin@shop.test / admin-pass</p>
    </form>
  );
}
