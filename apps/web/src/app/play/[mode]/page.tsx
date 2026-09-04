'use client';

import { notFound, useParams } from 'next/navigation';
import { MODES, type ModeId } from '@etude/core';
import { DrillRunner } from '@/components/DrillRunner';

/** Free practice: one mode, a fixed run of drills, no session wrapper. */
export default function PlayModePage() {
  const params = useParams<{ mode: string }>();
  const modeId = params.mode as ModeId;

  if (!MODES.some((m) => m.id === modeId)) notFound();

  return (
    <DrillRunner
      steps={[{ modeId, count: 12 }]}
      sessionId={null}
      title="Practice"
    />
  );
}
