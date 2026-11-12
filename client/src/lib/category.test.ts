import { describe, expect, it } from "vitest";
import { categoryStyle } from "./category";

describe("categoryStyle", () => {
  it("gives the main categories their own fixed colours, whatever the letter case", () => {
    expect(categoryStyle("Exams").bar).toBe("bg-cat-red");
    expect(categoryStyle("  EVENTS ").bar).toBe("bg-cat-violet");
    expect(categoryStyle("Placements").bar).toBe("bg-cat-green");
    expect(categoryStyle("General").bar).toBe("bg-cat-slate");
  });

  it("always returns a colour for any other name, and the same one every time", () => {
    for (const name of ["Sports", "Library", "Hostel", "Holidays", "x", "日本語", ""]) {
      const a = categoryStyle(name);
      expect(a.bar).toMatch(/^bg-cat-/);
      expect(a.chip).toContain("text-cat-");
      expect(categoryStyle(name)).toBe(a);
    }
  });
});
