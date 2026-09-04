/**
 * `Score` → MusicXML.
 *
 * OSMD consumes MusicXML, so this is how a generated drill reaches the staff.
 * Written by hand rather than with a builder library: the output is a small,
 * fixed shape, and a serialiser you can read end to end is worth more than one
 * dependency fewer lines.
 *
 * Emits `divisions` fine enough for triplets (12 per quarter) so generated
 * rhythms round-trip exactly rather than drifting by a tick.
 */

import { accidentalAscii } from '../../theory/pitch';
import { keyFifths } from '../../theory/scale';
import {
  type Measure, type Part, type Score, type ScoreNote,
  DEFAULT_TIME_SIGNATURE, beatsPerMeasure,
} from '../model';

/** Ticks per quarter note. 12 divides by 2, 3 and 4, so triplets stay exact. */
const DIVISIONS = 12;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** MusicXML note-type name for a duration in quarter-note beats. */
function noteType(beats: number): string {
  const table: Array<[number, string]> = [
    [4, 'whole'], [3, 'half'], [2, 'half'], [1.5, 'quarter'], [1, 'quarter'],
    [0.75, 'eighth'], [0.5, 'eighth'], [0.375, '16th'], [0.25, '16th'],
    [1 / 3, 'quarter'], [1 / 6, 'eighth'], [0.125, '32nd'],
  ];
  let best = 'quarter';
  let bestDelta = Infinity;
  for (const [value, name] of table) {
    const delta = Math.abs(value - beats);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = name;
    }
  }
  return best;
}

/** True when a duration is a dotted value, which MusicXML marks separately. */
function isDotted(beats: number): boolean {
  return [6, 3, 1.5, 0.75, 0.375].some((v) => Math.abs(v - beats) < 1e-6);
}

function serializeNote(note: ScoreNote, isChordTone: boolean): string {
  const lines: string[] = ['      <note>'];
  if (isChordTone) lines.push('        <chord/>');

  if (note.midi === null || !note.spelled) {
    lines.push('        <rest/>');
  } else {
    lines.push('        <pitch>');
    lines.push(`          <step>${note.spelled.step}</step>`);
    if (note.spelled.alter !== 0) {
      lines.push(`          <alter>${note.spelled.alter}</alter>`);
    }
    lines.push(`          <octave>${note.spelled.octave}</octave>`);
    lines.push('        </pitch>');
  }

  lines.push(`        <duration>${Math.round(note.durationBeats * DIVISIONS)}</duration>`);

  if (note.tie === 'start' || note.tie === 'continue') {
    lines.push('        <tie type="start"/>');
  }
  if (note.tie === 'stop' || note.tie === 'continue') {
    lines.push('        <tie type="stop"/>');
  }

  lines.push(`        <voice>${note.voice}</voice>`);
  lines.push(`        <type>${noteType(note.durationBeats)}</type>`);
  if (isDotted(note.durationBeats)) lines.push('        <dot/>');
  lines.push(`        <staff>${note.staff}</staff>`);

  const notations: string[] = [];
  if (note.tie === 'start' || note.tie === 'continue') {
    notations.push('          <tied type="start"/>');
  }
  if (note.tie === 'stop' || note.tie === 'continue') {
    notations.push('          <tied type="stop"/>');
  }
  if (note.slurStart) notations.push('          <slur type="start" number="1"/>');
  if (note.slurStop) notations.push('          <slur type="stop" number="1"/>');
  if (note.arpeggiate) notations.push('          <arpeggiate/>');
  if (note.articulations.length > 0) {
    notations.push('          <articulations>');
    for (const a of note.articulations) {
      const tag = a === 'marcato' ? 'strong-accent' : a;
      if (a !== 'legato') notations.push(`            <${tag}/>`);
    }
    notations.push('          </articulations>');
  }
  if (note.fingering !== null) {
    notations.push('          <technical>');
    notations.push(`            <fingering>${note.fingering}</fingering>`);
    notations.push('          </technical>');
  }

  if (notations.length > 0) {
    lines.push('        <notations>', ...notations, '        </notations>');
  }

  lines.push('      </note>');
  return lines.join('\n');
}

function serializeMeasure(measure: Measure, staffCount: number, isFirst: boolean): string {
  const lines: string[] = [`    <measure number="${measure.number}">`];

  const needsAttributes = isFirst || measure.timeSignature || measure.key;
  if (needsAttributes) {
    lines.push('      <attributes>');
    if (isFirst) lines.push(`        <divisions>${DIVISIONS}</divisions>`);
    if (measure.key) {
      const fifths = keyFifths(measure.key) ?? 0;
      lines.push('        <key>');
      lines.push(`          <fifths>${fifths}</fifths>`);
      lines.push(`          <mode>${measure.key.mode}</mode>`);
      lines.push('        </key>');
    }
    if (measure.timeSignature) {
      lines.push('        <time>');
      lines.push(`          <beats>${measure.timeSignature.beats}</beats>`);
      lines.push(`          <beat-type>${measure.timeSignature.beatType}</beat-type>`);
      lines.push('        </time>');
    }
    if (isFirst) {
      lines.push(`        <staves>${staffCount}</staves>`);
      lines.push('        <clef number="1"><sign>G</sign><line>2</line></clef>');
      if (staffCount > 1) {
        lines.push('        <clef number="2"><sign>F</sign><line>4</line></clef>');
      }
    }
    lines.push('      </attributes>');
  }

  if (measure.tempo) {
    lines.push('      <direction placement="above">');
    lines.push('        <direction-type>');
    lines.push('          <metronome><beat-unit>quarter</beat-unit>' +
      `<per-minute>${measure.tempo.bpm}</per-minute></metronome>`);
    lines.push('        </direction-type>');
    lines.push(`        <sound tempo="${measure.tempo.bpm}"/>`);
    lines.push('      </direction>');
  }

  // One staff at a time, rewinding between them. Writing notes in plain onset
  // order across staves would need a backup before nearly every note and is far
  // harder to read — both for a human and for a renderer.
  const staves = [...new Set(measure.notes.map((n) => n.staff))].sort((a, b) => a - b);
  const beats = beatsPerMeasure(measure.timeSignature ?? DEFAULT_TIME_SIGNATURE);

  staves.forEach((staff, index) => {
    if (index > 0) {
      lines.push(`      <backup><duration>${Math.round(beats * DIVISIONS)}</duration></backup>`);
    }
    const staffNotes = measure.notes
      .filter((n) => n.staff === staff)
      .sort((a, b) => a.onsetBeats - b.onsetBeats || (a.midi ?? 0) - (b.midi ?? 0));

    let previousOnset: number | null = null;
    for (const note of staffNotes) {
      const isChordTone =
        previousOnset !== null && Math.abs(note.onsetBeats - previousOnset) < 1e-6;
      lines.push(serializeNote(note, isChordTone));
      previousOnset = note.onsetBeats;
    }
  });

  if (measure.repeatEnd) {
    lines.push('      <barline location="right">');
    lines.push('        <bar-style>light-heavy</bar-style>');
    lines.push('        <repeat direction="backward"/>');
    lines.push('      </barline>');
  }

  lines.push('    </measure>');
  return lines.join('\n');
}

function serializePart(part: Part): string {
  const measures = part.measures.map((m, i) =>
    serializeMeasure(m, part.staffCount, i === 0),
  );
  return `  <part id="${escapeXml(part.id)}">\n${measures.join('\n')}\n  </part>`;
}

/** Render a score as a MusicXML document string, ready for OSMD. */
export function serializeMusicXml(score: Score): string {
  const partList = score.parts
    .map(
      (p) =>
        `    <score-part id="${escapeXml(p.id)}">\n` +
        `      <part-name>${escapeXml(p.name)}</part-name>\n` +
        '    </score-part>',
    )
    .join('\n');

  const identification = score.composer
    ? `  <identification>\n    <creator type="composer">${escapeXml(score.composer)}</creator>\n  </identification>\n`
    : '';

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" ' +
      '"http://www.musicxml.org/dtds/partwise.dtd">',
    '<score-partwise version="4.0">',
    `  <work><work-title>${escapeXml(score.title)}</work-title></work>`,
    identification + '  <part-list>',
    partList,
    '  </part-list>',
    score.parts.map(serializePart).join('\n'),
    '</score-partwise>',
  ].join('\n');
}

export { accidentalAscii };
