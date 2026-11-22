/**
 * Getting a file out of the app.
 *
 * In a browser, a download is a Blob and an `<a download>`. An Android WebView
 * has no download handler, so the same code does nothing at all — no error, no
 * file — and the one backup route the app has would silently stop working in
 * the APK. There, the file is written to the app's cache and handed to
 * Android's share sheet, which is how an app on a tablet gets a file somewhere
 * the user can reach it.
 *
 * The branch tests the build target inline, not through a helper: that is what
 * lets the bundler drop the native branch, plugins included, from the ordinary
 * web build.
 */

import { isNativeApp } from '@/lib/native';

export type SaveOutcome = 'downloaded' | 'shared';

/** The user closing the share sheet is a decision, not a failure. */
export const wasCancelled = (error: unknown): boolean =>
  /cancel/i.test(error instanceof Error ? error.message : String(error));

export async function saveTextFile(
  filename: string,
  text: string,
  mime = 'application/json',
): Promise<SaveOutcome> {
  if (process.env.NEXT_PUBLIC_ETUDE_TARGET === 'native' && isNativeApp()) {
    const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ]);
    const written = await Filesystem.writeFile({
      path: filename,
      data: text,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    await Share.share({
      title: filename,
      dialogTitle: 'Save or send this file',
      files: [written.uri],
    });
    return 'shared';
  }

  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
  return 'downloaded';
}
