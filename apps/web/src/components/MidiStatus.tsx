'use client';

import { useEffect, useState } from 'react';
import { useMidiConnection } from '@/lib/input/useNoteInput';

/**
 * MIDI connection status and device picker.
 *
 * Deliberately explicit about *why* MIDI might be missing rather than just
 * showing it as absent. On the target tablet the most likely cause is that Silk
 * does not expose the API at all, and "not supported here, try Chrome or the
 * desktop bridge" is actionable in a way that a greyed-out button is not.
 */
export function MidiStatus({ compact = false }: { compact?: boolean }) {
  const { availability, connectedLabel, error, scanning, scan, connect } = useMidiConnection();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open && !availability) void scan();
  }, [open, availability, scan]);

  if (compact && connectedLabel) {
    return (
      <span className="rounded-lg bg-good/15 px-3 py-1.5 text-sm font-medium text-good">
        {connectedLabel}
      </span>
    );
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="tap rounded-lg bg-raised px-4 text-sm text-ink-dim"
      >
        Connect MIDI
      </button>
    );
  }

  return (
    <section className="panel p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold">MIDI keyboard</h2>
        {connectedLabel ? (
          <span className="text-sm font-medium text-good">{connectedLabel}</span>
        ) : (
          <button
            type="button"
            onClick={() => void scan()}
            disabled={scanning}
            className="tap rounded-lg bg-raised px-5 text-sm disabled:opacity-50"
          >
            {scanning ? 'Scanning…' : 'Scan for devices'}
          </button>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-bad">{error}</p>}

      {availability?.status === 'unsupported' && (
        <div className="mt-3 space-y-2 text-sm">
          <p className="text-warn">{availability.reason}</p>
          <p className="text-ink-faint">
            On a Fire tablet this is the expected failure: Chromium implements
            Web MIDI over <code>android.media.midi</code>, and Fire OS may not
            declare that feature. Sideloading Chrome is the most reliable
            workaround; the desktop LAN bridge is the fallback.
          </p>
        </div>
      )}

      {availability?.status === 'timeout' && (
        <p className="mt-3 text-sm text-warn">
          The permission prompt was not answered. Scan again and allow MIDI access.
        </p>
      )}

      {availability?.status === 'denied' && (
        <p className="mt-3 text-sm text-warn">{availability.reason}</p>
      )}

      {availability?.status === 'ok' && availability.ports.length === 0 && (
        <div className="mt-3 space-y-2 text-sm">
          <p className="text-warn">
            Web MIDI works here, but no device is connected.
          </p>
          <p className="text-ink-faint">
            Prefer a <strong>Bluetooth</strong> MIDI adapter on this tablet — USB
            MIDI has a documented defect on the Fire HD 10 where input dies after
            one packet. Pair the keyboard in Android settings first; it will then
            appear here.
          </p>
        </div>
      )}

      {availability?.status === 'ok' && availability.ports.length > 0 && (
        <ul className="mt-4 space-y-2">
          {availability.ports.map((port) => (
            <li key={port.id}>
              <button
                type="button"
                onClick={() => void connect(port.id, port.name)}
                className="tap w-full justify-between rounded-xl bg-raised px-4 text-left"
              >
                <span className="font-medium text-ink">{port.name}</span>
                <span className="text-xs text-ink-faint">
                  {port.manufacturer || port.state}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
