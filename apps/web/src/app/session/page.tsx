'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ulid } from '@etude/core';
import { DrillRunner, type RunnerStep } from '@/components/DrillRunner';

/**
 * The guided session.
 *
 * The plan is handed over in sessionStorage rather than recomputed here, so the
 * queue you were shown on the practice screen is exactly the queue you get.
 */
export default function SessionPage() {
  const router = useRouter();
  const [steps, setSteps] = useState<RunnerStep[] | null>(null);
  const [sessionId] = useState(() => ulid());

  useEffect(() => {
    const raw = sessionStorage.getItem('etude.session.steps');
    if (!raw) {
      router.replace('/practice');
      return;
    }
    try {
      setSteps(JSON.parse(raw) as RunnerStep[]);
    } catch {
      router.replace('/practice');
    }
  }, [router]);

  if (!steps) return <div className="p-8 text-ink-faint">Building your session…</div>;

  return <DrillRunner steps={steps} sessionId={sessionId} title="Session" />;
}
