import { MODES } from '@etude/core';
import { PlayMode } from './PlayMode';

/**
 * Modes that have a page of their own under `play/`. A static segment beats
 * this dynamic one, so generating them here as well would only build the same
 * URL twice.
 */
const HAS_OWN_PAGE: ReadonlySet<string> = new Set(['independence', 'repertoire']);

/**
 * Every mode this route serves, named up front.
 *
 * A server can resolve `/play/<anything>` on request; the Android app is a
 * static export, where each URL has to exist as a file when the site is built.
 * Listing the modes is what puts a page on disk for each. The set is closed
 * (`dynamicParams = false`), so an unknown mode is a plain 404 rather than a
 * page that renders and then calls `notFound()` from the client.
 */
export const dynamicParams = false;

export function generateStaticParams(): { mode: string }[] {
  return MODES.filter((m) => !HAS_OWN_PAGE.has(m.id)).map((m) => ({ mode: m.id }));
}

export default function PlayModePage() {
  return <PlayMode />;
}
