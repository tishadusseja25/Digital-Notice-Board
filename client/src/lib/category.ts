// Each category gets one colour, so the board can be scanned by colour. The class names are
// written out in full (not built from strings) so Tailwind can see and keep them.
const STYLES = {
  red: { bar: "bg-cat-red", chip: "bg-cat-red-tint text-cat-red" },
  violet: { bar: "bg-cat-violet", chip: "bg-cat-violet-tint text-cat-violet" },
  green: { bar: "bg-cat-green", chip: "bg-cat-green-tint text-cat-green" },
  slate: { bar: "bg-cat-slate", chip: "bg-cat-slate-tint text-cat-slate" },
  teal: { bar: "bg-cat-teal", chip: "bg-cat-teal-tint text-cat-teal" },
  orange: { bar: "bg-cat-orange", chip: "bg-cat-orange-tint text-cat-orange" },
  rose: { bar: "bg-cat-rose", chip: "bg-cat-rose-tint text-cat-rose" },
} as const;

const KNOWN: Record<string, keyof typeof STYLES> = {
  exams: "red",
  events: "violet",
  placements: "green",
  general: "slate",
};
const SPARE = ["teal", "orange", "rose"] as const;

/** The same name always gets the same colour, in any browser, with nothing stored in the database. */
export function categoryStyle(name: string) {
  const key = name.trim().toLowerCase();
  const known = KNOWN[key];
  if (known) return STYLES[known];
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return STYLES[SPARE[hash % SPARE.length]!];
}
