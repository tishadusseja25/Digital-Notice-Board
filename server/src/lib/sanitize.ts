/**
 * True if any object key (at any depth) starts with "$" or contains ".".
 * Those keys are how MongoDB operators ({ "$ne": null }) and dotted paths are smuggled into queries.
 */
export function hasOperatorKeys(value: unknown, depth = 0): boolean {
  if (depth > 10) return true; // absurdly deep input is treated as hostile
  if (Array.isArray(value)) return value.some((v) => hasOperatorKeys(v, depth + 1));
  if (value !== null && typeof value === "object") {
    return Object.entries(value).some(
      ([key, v]) => key.startsWith("$") || key.includes(".") || hasOperatorKeys(v, depth + 1),
    );
  }
  return false;
}
