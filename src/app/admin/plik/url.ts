// Kept out of route.ts: a route file may only export its handlers and
// segment config, and the pages and client cards need the link builder.
export type AdminFileKind = "dokument" | "dokument-tyl" | "selfie" | "polisa" | "firma";

// FNV-1a: a short fingerprint, not a secret — it only has to change when the
// storage path does.
function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * The stable link to a private file, served by ./route.ts. `id` is the row
 * the file belongs to: the verification, the car, or the company document.
 *
 * `storagePath` goes into the link as a fingerprint (`v`), which the route
 * ignores. Every upload gets a new random path, so when someone resubmits
 * their documents or replaces the OC policy the link changes too, and the
 * browser cannot answer it with the redirect it kept for the OLD file — the
 * admin must never approve a resubmission while looking at the photos it
 * replaced.
 */
export function adminFileUrl(kind: AdminFileKind, id: string, storagePath: string): string {
  return `/admin/plik?plik=${kind}&id=${encodeURIComponent(id)}&v=${fingerprint(storagePath)}`;
}
