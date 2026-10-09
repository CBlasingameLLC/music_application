/**
 * Turning a set of probe rows into one block of text someone can paste.
 *
 * The point of the diagnostics page is that the person holding the tablet and
 * the person fixing the app are not in the same room. A screenshot of a long
 * scrolling page loses rows and cannot be searched; a single block of text can
 * be pasted into a chat, diffed against last week's, and read by a script.
 *
 * Failures come first, then warnings, then everything else. The row that
 * explains the symptom is nearly always a failure, and it should not be forty
 * lines down.
 */

export type ReportStatus = 'good' | 'bad' | 'warn' | 'info';

export interface ReportRow {
  readonly label: string;
  readonly value: string;
  readonly status: ReportStatus;
  readonly note?: string;
}

const MARK: Record<ReportStatus, string> = {
  bad: '[FAIL]',
  warn: '[warn]',
  good: '[ ok ]',
  info: '[info]',
};

const ORDER: readonly ReportStatus[] = ['bad', 'warn', 'good', 'info'];

/** Pad a continuation line so it hangs under the text, not under the marker. */
const HANG = ' '.repeat(MARK.bad.length + 1);

export function formatProbeReport(
  rows: readonly ReportRow[],
  header: readonly string[] = [],
): string {
  const lines: string[] = ['Étude device report', ...header, ''];

  for (const status of ORDER) {
    for (const row of rows.filter((r) => r.status === status)) {
      lines.push(`${MARK[status]} ${row.label}: ${row.value}`);
      // Notes explain a problem. On a row that is fine they are noise, and a
      // pasted report is read far more often than it is written.
      if (row.note && (status === 'bad' || status === 'warn')) {
        lines.push(`${HANG}${row.note}`);
      }
    }
  }

  const counts = ORDER.map((s) => [s, rows.filter((r) => r.status === s).length] as const);
  lines.push(
    '',
    counts.filter(([, n]) => n > 0).map(([s, n]) => `${n} ${s}`).join(', ') || 'no rows',
  );

  return lines.join('\n');
}
