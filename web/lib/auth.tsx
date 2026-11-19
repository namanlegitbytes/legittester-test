'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, type CartView } from './api';

interface User { id: string; email: string; role: 'customer' | 'admin' }
interface Ctx {
  user: User | null; ready: boolean; cartCount: number;
  login: (email: string, password: string) => Promise<void>; logout: () => void; refreshCart: () => Promise<void>;
}
const AuthCtx = createContext<Ctx>(null as unknown as Ctx);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [cartCount, setCartCount] = useState(0);

  const refreshCart = useCallback(async () => {
    try { setCartCount((await api<CartView>('/api/cart')).itemCount); } catch { setCartCount(0); }
  }, []);

  useEffect(() => {
    api<User>('/api/auth/me').then(setUser).then(refreshCart).catch(() => setUser(null)).finally(() => setReady(true));
  }, [refreshCart]);

  const login = async (email: string, password: string) => {
    const r = await api<{ token: string; user: User }>('/api/auth/login', { method: 'POST', body: { email, password } });
    localStorage.setItem('token', r.token);
    setUser(r.user);
    await refreshCart();
  };
  const logout = () => { localStorage.removeItem('token'); setUser(null); setCartCount(0); };

  return <AuthCtx.Provider value={{ user, ready, cartCount, login, logout, refreshCart }}>{children}</AuthCtx.Provider>;
}
