import { describe, expect, it } from "vitest";
import { pathToRoute, routeToPath } from "../src/lib/routing";
import { FLAG_LABELS, fmtBase, fmtPackages, type PrepFlag } from "../src/lib/prep";

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
