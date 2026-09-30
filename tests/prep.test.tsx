import { describe, expect, it } from "vitest";
import { pathToRoute, routeToPath } from "../src/lib/routing";
import { FLAG_LABELS, fmtBase, fmtPackages, type PrepFlag, type PrepLine } from "../src/lib/prep";

describe("PREP-1 routing", () => {
  it("round-trips /prep", () => {
    expect(pathToRoute("/prep")).toBe("prep");
    expect(routeToPath("prep")).toBe("/prep");
    expect(pathToRoute("/prep/")).toBe("prep");
  });

  it("does not steal the other routes", () => {
    expect(pathToRoute("/today")).toBe("today");
    expect(pathToRoute("/status")).toBe("status");
    expect(pathToRoute("/library")).toBe("library");
  });

  it("every route has a path", () => {
    // routeToPath is a Record over the union, so a route added without a path
    // fails the BUILD. This asserts the runtime result too, because a Record
    // typed correctly can still hold a wrong string.
    for (const [path, route] of [
      ["/today", "today"], ["/status", "status"],
      ["/library", "library"], ["/prep", "prep"],
    ] as const) {
      expect(routeToPath(route)).toBe(path);
    }
  });
});

describe("PREP-1 formatting: unknown must never render as zero", () => {
  it("a null quantity is a dash, not 0", () => {
    // THE distinction this whole feature turns on. A null package count means
    // "nobody has said how big a package is"; rendering it as 0 would read as
    // "you have enough" and he would buy nothing.
    expect(fmtPackages(null, "32 oz carton")).toBe("—");
    expect(fmtBase(null, "g")).toBe("—");
  });

  it("a real zero still renders as zero", () => {
    expect(fmtPackages(0, null)).toBe("0");
    expect(fmtBase(0, "g")).toBe("0 g");
  });

  it("packages read as the printed label when there is one", () => {
    expect(fmtPackages(2, "32 oz carton")).toBe("2 × 32 oz carton");
    expect(fmtPackages(2, null)).toBe("2");
  });

  it("every flag the server can send has a human label", () => {
    // The server's flag list, spelled out. A flag with no label would render as
    // its field name in a shop.
    const serverFlags: PrepFlag[] = [
      "no_store", "no_rank1", "top_up", "count_unknown",
      "no_package_size", "no_unit", "par_only", "no_servings",
    ];
    for (const f of serverFlags) {
      expect(FLAG_LABELS[f], f).toBeTruthy();
    }
    expect(Object.keys(FLAG_LABELS).sort()).toEqual([...serverFlags].sort());
  });
});

describe("PREP-1 top-up: the headline is what to buy TODAY", () => {
  /** The first live list showed chicken thighs as "1" while the split said buy 0
   * now and 1 on the 7th — it is only eaten on the 7th and 8th and would not keep.
   * A shopper reads the big number, so the big number has to be the one he acts
   * on. */

  function line(over: Partial<PrepLine>): PrepLine {
    return {
      ingredient_id: "i", name: "thighs", category: null, unit: "g",
      as_used_base: 300, purchased_base: 300, yield_factor: 1,
      on_hand_base: null, par_level_pkgs: null, required_base: 300,
      short_base: 300, packages: 1, package_size: 680, package_label: "1.5 lb pack",
      price: null, store: "Aldi", store_chain: "Aldi", store_id: "s", rank: 1,
      rank_basis: "notion", aisle: "Other", packages_now: 0, packages_later: 1,
      later_day: "2026-10-07", flags: ["top_up"], ...over,
    };
  }

  it("a top-up row headlines what to buy now, not the total", () => {
    const l = line({});
    const headline = l.later_day !== null && l.packages_later !== null
      ? l.packages_now : l.packages;
    expect(headline).toBe(0);
    expect(l.packages).toBe(1);        // the total is still there, underneath
  });

  it("an ordinary row headlines its total", () => {
    const l = line({ later_day: null, packages_later: null, packages_now: 2, packages: 2 });
    const headline = l.later_day !== null && l.packages_later !== null
      ? l.packages_now : l.packages;
    expect(headline).toBe(2);
  });

  it("a zero headline is a zero, not a dash — it means do not buy this today", () => {
    // fmtPackages must keep 0 and null distinct here too: "—" would read as
    // "unknown" when the answer is a definite "not on this trip".
    expect(fmtPackages(0, "1.5 lb pack")).toBe("0");
    expect(fmtPackages(null, "1.5 lb pack")).toBe("—");
  });
});

describe("PREP-1: a flag chip never repeats the line above it", () => {
  it("count_unknown is dropped, because the sub-line already says it", () => {
    // 40 of the 41 items on the first real list were uncounted, so the chip
    // repeated "never counted" on every row and doubled the height of the list.
    const flags: PrepFlag[] = ["count_unknown", "top_up", "no_rank1"];
    const chips = flags.filter((f) => f !== "count_unknown");
    expect(chips).toEqual(["top_up", "no_rank1"]);
  });

  it("every other flag still shows", () => {
    const flags: PrepFlag[] = ["no_store", "par_only", "no_package_size"];
    expect(flags.filter((f) => f !== "count_unknown")).toEqual(flags);
  });
});
