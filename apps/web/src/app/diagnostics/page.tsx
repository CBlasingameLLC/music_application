'use client';

import { useCallback, useEffect, useState } from 'react';
import { audio } from '@/lib/audio';
import { MidiStatus } from '@/components/MidiStatus';
import { LatencyCalibration } from '@/components/LatencyCalibration';
import { input } from '@/lib/input/manager';
import { requestPersistence, storageEstimate } from '@/db/schema';
import { exportLog, importLog } from '@/db/log';

/**
 * Device capability probe.
 *
 * Étude's target device is an Amazon Fire HD 10 running Silk, and several
 * things about it are genuinely undocumented — most importantly whether Web
 * MIDI is exposed at all, since Chromium implements it over `android.media.midi`
 * and Amazon does not publish whether the tablet declares that feature.
 *
 * Rather than guess, this page measures. Run it on the tablet with the keyboard
 * attached and every open question becomes a fact.
 */

/** Reject rather than hang. Used for anything that can sit behind a prompt. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

interface Probe {
  readonly label: string;
  readonly value: string;
  readonly status: 'good' | 'bad' | 'warn' | 'info';
  readonly note?: string;
}

export default function DiagnosticsPage() {
  const [probes, setProbes] = useState<Probe[]>([]);
  const [midiLog, setMidiLog] = useState<string[]>([]);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    const out: Probe[] = [];

    out.push({
      label: 'User agent',
      value: navigator.userAgent,
      status: 'info',
    });
    out.push({
      label: 'Display mode',
      value: window.matchMedia('(display-mode: standalone)').matches
        ? 'standalone (installed)'
        : 'browser tab',
      status: window.matchMedia('(display-mode: standalone)').matches ? 'good' : 'warn',
      note: 'Installed to the home screen improves the odds of durable storage.',
    });
    out.push({
      label: 'Viewport',
      value: `${window.innerWidth}×${window.innerHeight} @ ${window.devicePixelRatio}x`,
      status: 'info',
    });

    // --- The question that decides the MIDI architecture -------------------
    const midiSupported = typeof navigator.requestMIDIAccess === 'function';
    out.push({
      label: 'Web MIDI API',
      value: midiSupported ? 'present' : 'MISSING',
      status: midiSupported ? 'good' : 'bad',
      note: midiSupported
        ? 'The API exists. Whether devices enumerate is the next question.'
        : 'Silk does not expose Web MIDI. Fall back to sideloaded Chrome, a Capacitor wrap, or the desktop LAN bridge.',
    });

    if (midiSupported) {
      try {
        // A pending permission prompt never settles, and an un-timed await here
        // would leave this page permanently blank — exactly when you most need
        // it to tell you something.
        const access = await withTimeout(
          navigator.requestMIDIAccess({ sysex: false }),
          4000,
          'MIDI permission was not answered within 4s',
        );
        const inputs = [...access.inputs.values()];
        const outputs = [...access.outputs.values()];
        out.push({
          label: 'MIDI inputs',
          value: inputs.length > 0
            ? inputs.map((i) => `${i.name ?? 'unnamed'} (${i.manufacturer ?? '?'})`).join(', ')
            : 'none enumerated',
          status: inputs.length > 0 ? 'good' : 'warn',
          note: inputs.length === 0
            ? 'No device seen. On Fire OS, prefer Bluetooth MIDI: USB MIDI has a documented defect on this tablet family.'
            : undefined,
        });
        out.push({
          label: 'MIDI outputs',
          value: String(outputs.length),
          status: 'info',
        });
      } catch (err) {
        out.push({
          label: 'MIDI access',
          value: `denied or failed — ${(err as Error).message}`,
          status: 'bad',
          note: 'Since Chrome 124 all MIDI access prompts, and it needs a secure context plus a user gesture.',
        });
      }
    }

    // --- Audio -------------------------------------------------------------
    //
    // Every audio row is emitted regardless of outcome. A diagnostics page that
    // silently drops rows it could not measure is worse than useless: it makes
    // "not measured" indistinguishable from "not applicable", which is exactly
    // the ambiguity you are here to resolve.
    let ctx: AudioContext | null = null;
    try {
      // Autoplay policy leaves `resume()` pending indefinitely until a user
      // gesture — it does not reject. Awaiting it bare would hang this page.
      ctx = await withTimeout(
        audio.resume(),
        2500,
        'suspended pending a user gesture, or no audio device',
      );
      out.push({
        label: 'AudioContext',
        value: `${ctx.sampleRate} Hz, state ${ctx.state}`,
        status: ctx.state === 'running' ? 'good' : 'warn',
      });
    } catch (err) {
      out.push({
        label: 'AudioContext',
        value: `unavailable — ${(err as Error).message}`,
        status: 'warn',
        note: 'Tap anywhere on the page, then re-run. Browsers hold audio suspended until you interact, and a machine with no audio device never starts one at all.',
      });
    }

    out.push({
      label: 'Output latency',
      value: ctx ? `${audio.outputLatencyMs.toFixed(1)} ms` : 'not measured',
      status: !ctx ? 'warn' : audio.outputLatencyMs > 200 ? 'warn' : 'good',
      note: 'Subtracted from every timing measurement taken against the click. A large value is fine for playing — your piano makes its own sound — but it must be compensated when grading, or a steady player reads as consistently behind the beat.',
    });

    const timestamp = ctx?.getOutputTimestamp?.();
    const hasTimestamp = !!timestamp && timestamp.contextTime !== undefined;
    out.push({
      label: 'getOutputTimestamp',
      value: !ctx ? 'not measured' : hasTimestamp ? 'available' : 'unavailable',
      status: hasTimestamp ? 'good' : 'warn',
      note: 'Maps the audio clock onto performance.now(). Without it, MIDI timestamps and scheduled beats drift apart silently.',
    });

    // --- Storage -----------------------------------------------------------
    const persistence = await requestPersistence();
    out.push({
      label: 'Persistent storage',
      value: persistence.supported
        ? persistence.persisted ? 'granted' : 'not granted'
        : 'unsupported',
      status: persistence.persisted ? 'good' : 'warn',
      note: persistence.persisted
        ? undefined
        : 'Chromium decides by heuristic with no prompt. Practice history could be evicted — export regularly.',
    });

    const estimate = await storageEstimate();
    if (estimate) {
      const usedMb = ((estimate.usage ?? 0) / 1048576).toFixed(1);
      const quotaMb = ((estimate.quota ?? 0) / 1048576).toFixed(0);
      out.push({
        label: 'Storage used',
        value: `${usedMb} MB of ${quotaMb} MB`,
        status: 'info',
      });
    }

    out.push({
      label: 'OPFS',
      value: typeof navigator.storage?.getDirectory === 'function' ? 'available' : 'unavailable',
      status: typeof navigator.storage?.getDirectory === 'function' ? 'good' : 'warn',
      note: 'Where imported scores will live. Private content never leaves the device.',
    });

    // --- Microphone --------------------------------------------------------
    out.push({
      label: 'getUserMedia',
      value: typeof navigator.mediaDevices?.getUserMedia === 'function'
        ? 'present (not requested)'
        : 'unavailable',
      status: typeof navigator.mediaDevices?.getUserMedia === 'function' ? 'good' : 'warn',
      note: 'Needed for sung answers in ear training. Permission is only requested when that feature is used.',
    });

    // --- Service worker ----------------------------------------------------
    const reg = 'serviceWorker' in navigator
      ? await withTimeout(navigator.serviceWorker.getRegistration(), 3000, 'timeout')
          .catch(() => null)
      : null;
    out.push({
      label: 'Service worker',
      value: reg ? `registered (${reg.active ? 'active' : 'installing'})` : 'not registered',
      status: reg?.active ? 'good' : 'warn',
      note: reg?.active ? 'Offline practice is available.' : 'Offline support is inactive in development.',
    });

    setProbes(out);
    setBusy(false);
  }, []);

  useEffect(() => { void run(); }, [run]);

  /** Live MIDI monitor: proves note-on/off and velocity actually arrive. */
  const listenMidi = useCallback(async () => {
    if (typeof navigator.requestMIDIAccess !== 'function') return;
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false });
      setListening(true);
      setMidiLog(['Listening — play a note…']);
      for (const input of access.inputs.values()) {
        input.onmidimessage = (e: MIDIMessageEvent) => {
          const d = e.data;
          if (!d) return;
          const [status = 0, a = 0, b = 0] = d;
          const cmd = status & 0xf0;
          const kind = cmd === 0x90 && b > 0 ? 'note on'
            : cmd === 0x80 || cmd === 0x90 ? 'note off'
            : cmd === 0xb0 ? `cc ${a}`
            : `0x${cmd.toString(16)}`;
          setMidiLog((log) => [
            `${e.timeStamp.toFixed(1)}ms  ${kind}  note ${a}  vel ${b}`,
            ...log,
          ].slice(0, 25));
        };
      }
    } catch (err) {
      setMidiLog([`Failed: ${(err as Error).message}`]);
    }
  }, []);

  const doExport = async () => {
    const json = await exportLog();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `etude-log-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const doImport = (file: File) => {
    void file.text().then(async (text) => {
      const result = await importLog(text);
      alert(`Imported ${result.added} events (${result.skipped} already present).`);
    });
  };

  return (
    <div className="mx-auto max-w-4xl px-5 pt-8">
      <h1 className="text-3xl font-bold">Diagnostics</h1>
      <p className="mt-2 text-sm text-ink-faint">
        Run this on the tablet, with the keyboard connected, to settle what the
        device actually supports.
      </p>

      <div className="mt-6 space-y-4">
        <MidiStatus />
        <LatencyCalibration
          sourceId={input.hasKind('midi') ? 'midi:all' : 'onscreen'}
          label={input.hasKind('midi') ? 'MIDI keyboard' : 'On-screen keyboard'}
        />
      </div>

      <h2 className="mt-10 text-sm font-semibold uppercase tracking-wider text-ink-faint">
        Device probes
      </h2>

      <div className="mt-3 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="tap rounded-xl bg-raised px-6 font-semibold disabled:opacity-50"
        >
          {busy ? 'Probing…' : 'Re-run probes'}
        </button>
        <button
          type="button"
          onClick={() => void listenMidi()}
          disabled={listening}
          className="tap rounded-xl bg-accent px-6 font-bold text-accent-ink disabled:opacity-50"
        >
          {listening ? 'Listening for MIDI' : 'Monitor MIDI input'}
        </button>
      </div>

      {midiLog.length > 0 && (
        <pre className="mt-4 max-h-64 overflow-auto rounded-xl border border-hairline bg-black/40 p-4 text-xs leading-relaxed text-good">
          {midiLog.join('\n')}
        </pre>
      )}

      <div data-testid="device-probes" className="panel mt-6 divide-y divide-hairline">
        {probes.map((p) => (
          <div key={p.label} className="px-4 py-3">
            <div className="flex items-baseline gap-3">
              <span
                aria-hidden
                className={[
                  'mt-1 h-2 w-2 shrink-0 rounded-full',
                  p.status === 'good' ? 'bg-good'
                    : p.status === 'bad' ? 'bg-bad'
                    : p.status === 'warn' ? 'bg-warn' : 'bg-ink-faint',
                ].join(' ')}
              />
              <span className="w-40 shrink-0 text-sm font-semibold text-ink">{p.label}</span>
              <span className="min-w-0 flex-1 break-words font-mono text-sm text-ink-dim">
                {p.value}
              </span>
            </div>
            {p.note && (
              <p className="mt-1.5 pl-[3.5rem] text-xs leading-snug text-ink-faint">{p.note}</p>
            )}
          </div>
        ))}
      </div>

      <section className="panel mt-6 p-5">
        <h2 className="font-semibold">Your data</h2>
        <p className="mt-1 text-sm text-ink-faint">
          Everything lives on this device. Export is your backup, and for now it
          is also how progress reaches Dial.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void doExport()}
            className="tap rounded-xl bg-raised px-6 font-semibold"
          >
            Export log
          </button>
          <label className="tap cursor-pointer rounded-xl bg-raised px-6 font-semibold">
            Import log
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) doImport(f);
              }}
            />
          </label>
        </div>
      </section>
      <div className="h-10" />
    </div>
  );
}
