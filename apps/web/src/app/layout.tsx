import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppFrame } from '@/components/AppFrame';

export const metadata: Metadata = {
  title: 'Étude',
  description: 'Piano training that works the way a teacher would teach it.',
  applicationName: 'Étude',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Étude',
    statusBarStyle: 'black-translucent',
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#0d0f14',
  width: 'device-width',
  initialScale: 1,
  // Pinch-zoom off: a stray two-finger touch mid-drill should never rescale
  // the page while the other hand is on the keys.
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-full antialiased">
        <AppFrame>{children}</AppFrame>
      </body>
    </html>
  );
}
