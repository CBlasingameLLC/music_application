'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { requestPersistence } from '@/db/schema';

const NAV = [
  { href: '/', label: 'Today' },
  { href: '/practice', label: 'Practice' },
  { href: '/map', label: 'Progress' },
] as const;

/**
 * The persistent shell.
 *
 * Navigation sits at the bottom because the tablet stands on a music desk and
 * the bottom edge is the only part reachable without leaning in over the keys.
 */
export function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    // Register the service worker ourselves rather than at import time, so it
    // never races the first paint.
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // A failed registration costs offline support, not the app.
      });
    }
    // Ask for durable storage on every start. Chromium decides by heuristic and
    // can change its mind, so this is not a one-time call.
    void requestPersistence();
  }, []);

  const inDrill = pathname.startsWith('/play/');

  return (
    <div className="flex min-h-dvh flex-col">
      <main className="flex-1 pb-24">{children}</main>

      {/* Hidden during a drill: navigation next to a timed answer is a
          mis-tap waiting to happen. */}
      {!inDrill && (
        <nav
          className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-surface/95 backdrop-blur"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <ul className="mx-auto flex max-w-5xl">
            {NAV.map((item) => {
              const active =
                item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              return (
                <li key={item.href} className="flex-1">
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={[
                      'tap w-full flex-col gap-0.5 py-3 text-[0.94rem] font-medium transition-colors',
                      active ? 'text-accent' : 'text-ink-faint',
                    ].join(' ')}
                  >
                    {item.label}
                    <span
                      aria-hidden
                      className={[
                        'h-0.5 w-8 rounded-full transition-colors',
                        active ? 'bg-accent' : 'bg-transparent',
                      ].join(' ')}
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </div>
  );
}
