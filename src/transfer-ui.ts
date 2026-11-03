// Browser side of import / export: hand a JSON file to the user (share sheet or download) and read a picked file.
import { MAX_IMPORT_BYTES } from './transfer';

/** Share the text as a file where the browser can (phones), otherwise download it. Resolves to a short status for the UI. */
export async function exportFile(filename: string, text: string): Promise<string> {
  const type = 'application/json';
  try {
    const file = new File([text], filename, { type });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return 'Shared.';
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return ''; // the user closed the share sheet
    // any other share failure: fall back to a download
  }
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return `Saved ${filename}.`;
}

/** Read a picked file as text; null when it is too large to be an export. */
export async function readImportFile(file: File): Promise<string | null> {
  if (file.size > MAX_IMPORT_BYTES) return null;
  return file.text();
}
