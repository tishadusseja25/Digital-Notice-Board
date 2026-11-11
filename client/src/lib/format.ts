/** "10 Nov 2026, 9:30 pm" in the visitor's own locale and time zone. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
