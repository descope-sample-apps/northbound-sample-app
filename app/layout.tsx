import type { Metadata } from 'next';
import { Fraunces, Figtree } from 'next/font/google';
import './globals.css';
import { Nav } from '@/components/brand/Nav';
import { Footer } from '@/components/brand/Footer';

// No system font stack: Fraunces carries every heading, Figtree every control.
//
// Both are variable fonts and are loaded as such — next/font/google rejects an
// explicit `weight` list alongside `axes`, and pinning static weights would
// also cost us Fraunces' SOFT axis, which is what keeps the headings warm
// rather than merely serif.
export const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  axes: ['SOFT', 'WONK'],
  display: 'swap',
});

export const figtree = Figtree({
  subsets: ['latin'],
  variable: '--font-figtree',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Northbound — Outdoor Gear & Apparel',
  description: 'Gear that earns its place on your back.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${figtree.variable}`}>
      <body className="flex min-h-screen flex-col">
        <Nav />
        <div className="flex-1">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
