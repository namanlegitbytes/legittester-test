import './globals.css';
import { AuthProvider } from '../lib/auth';
import Header from './header';

export const metadata = { title: 'Shopflow' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <Header />
          <main>{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
