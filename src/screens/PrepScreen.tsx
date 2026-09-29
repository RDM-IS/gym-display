import { useCallback, useEffect, useState } from "react";
import {
  fetchPantry,
  fetchPrepMacros,
  fetchShopping,
  postPantryCount,
} from "../lib/api";
import {
  FLAG_LABELS,
  MACRO_LABELS,
  fmtBase,
  fmtPackages,
  type MacrosResponse,
  type PantryItem,
  type PantryResponse,
  type PrepLine,
  type ShoppingResponse,
} from "../lib/prep";

type Tab = "shopping" | "pantry";

/** Where the last list is kept so the shop works without a signal.
 *
 * The list is cached, the PANTRY IS NOT. A cached list is a record of what he
 * decided to buy and is still true in the aisle; a cached pantry screen would
 * invite counts typed against stale numbers and posted into a queue, and a count
 * is a measurement — it must reach the server or visibly fail, never sit in a
 * cache looking saved. */
const CACHE_KEY = "prep.shopping.v1";

interface Cached {
  at: string;
  data: ShoppingResponse;
}

function readCache(): Cached | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Cached) : null;
  } catch {
    // Private window, cleared site data, or a thumbnail capture. An unavailable
    // cache is not an error — the screen loads from the network as normal.
    return null;
  }
}

function writeCache(data: ShoppingResponse): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: new Date().toISOString(), data }));
  } catch {
    /* storage full or blocked: the list still renders, it just isn't cached */
  }
}

function fmtDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export default function PrepScreen() {
  const [tab, setTab] = useState<Tab>("shopping");
  const [shopping, setShopping] = useState<ShoppingResponse | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [shopError, setShopError] = useState<string | null>(null);
  const [noStay, setNoStay] = useState<string | null>(null);
  const [macros, setMacros] = useState<MacrosResponse | null>(null);
  const [pantry, setPantry] = useState<PantryResponse | null>(null);
  const [pantryError, setPantryError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadShopping = useCallback(async () => {
    setLoading(true);
    const res = await fetchShopping();
    if (res.status === "ok") {
      setShopping(res.data);
      setAsOf(null);
      setShopError(null);
      setNoStay(null);
      writeCache(res.data);
    } else if (res.status === "no_stay") {
      setNoStay(res.message);
      setShopping(null);
    } else {
      // Fall back to the cached list and SAY SO. Showing it silently would let
      // him shop from a list built before a pantry count he has since entered.
      const cached = readCache();
      setShopError(res.message);
      if (cached) {
        setShopping(cached.data);
        setAsOf(cached.at);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadShopping();
    void fetchPrepMacros().then((r) => setMacros(r.status === "ok" ? r.data : null));
  }, [loadShopping]);

  const loadPantry = useCallback(async () => {
    const res = await fetchPantry();
    if (res.status === "ok") {
      setPantry(res.data);
      setPantryError(null);
    } else {
      setPantryError(res.message);
    }
  }, []);

  useEffect(() => {
    if (tab === "pantry" && pantry === null && pantryError === null) void loadPantry();
  }, [tab, pantry, pantryError, loadPantry]);

  return (
    <div className="screen prep">
      <div className="prep-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "shopping"}
          className={tab === "shopping" ? "active" : ""}
          onClick={() => setTab("shopping")}
        >
          Shopping
        </button>
        <button
          role="tab"
          aria-selected={tab === "pantry"}
          className={tab === "pantry" ? "active" : ""}
          onClick={() => setTab("pantry")}
        >
          Pantry
        </button>
      </div>

      {tab === "shopping" ? (
        <ShoppingTab
          data={shopping}
          macros={macros}
          loading={loading}
          asOf={asOf}
          error={shopError}
          noStay={noStay}
          onRetry={loadShopping}
        />
      ) : (
        <PantryTab
          data={pantry}
          error={pantryError}
          onRetry={loadPantry}
          onCounted={() => {
            // A count changes the list. Reload it rather than leaving a stale one
            // one tab away — the server recomputes on every read precisely so
            // this is cheap and always right.
            void loadPantry();
            void loadShopping();
          }}
        />
      )}
    </div>
  );
}

// ── shopping ────────────────────────────────────────────────────────────────

function ShoppingTab({
  data, macros, loading, asOf, error, noStay, onRetry,
}: {
  data: ShoppingResponse | null;
  macros: MacrosResponse | null;
  loading: boolean;
  asOf: string | null;
  error: string | null;
  noStay: string | null;
  onRetry: () => void;
}) {
  if (noStay) {
    return (
      <div className="prep-body">
        <p className="muted">{noStay}</p>
      </div>
    );
  }
  if (loading && !data) return <div className="prep-body muted">Loading…</div>;
  if (!data) {
    return (
      <div className="prep-body">
        <p className="banner prep-error">{error ?? "No list."}</p>
        <button className="btn" onClick={onRetry}>Try again</button>
      </div>
    );
  }

  const { stay } = data;
  return (
    <div className="prep-body">
      <div className="prep-head">
        <div className="h2">
          {fmtDay(stay.start_date)} – {fmtDay(stay.end_date)}
        </div>
        <div className="muted">
          {stay.days} day{stay.days === 1 ? "" : "s"} · {data.day_count} with a menu
          {stay.shop_date ? ` · shop ${fmtDay(stay.shop_date)}` : ""}
          {stay.confirmed ? "" : " · proposed"}
        </div>
      </div>

      {asOf && (
        <p className="banner prep-stale">
          Offline — showing the list saved {new Date(asOf).toLocaleString()}.
        </p>
      )}

      {/* The loud case. An unsynced database makes the list SHORT, and a short
          list looks finished. */}
      {data.incomplete && (
        <div className="banner prep-incomplete">
          <strong>This list is incomplete.</strong>{" "}
          {data.sync.blocked.join(", ")} {data.sync.blocked.length === 1 ? "has" : "have"}{" "}
          not synced from Notion, so quantities or stores are missing. Anything
          needing those is absent from the list, not merely unflagged.
        </div>
      )}

      {data.item_count === 0 && !data.incomplete && (
        <p className="muted">Nothing to buy — everything needed is on hand.</p>
      )}

      {macros && macros.days.length > 0 && <MacroStrip macros={macros} />}

      {data.stores.map((g) => (
        <section className="prep-store" key={g.store_id ?? "_none"}>
          <h3 className="prep-store-name">
            {g.store ?? "No store"}{" "}
            <span className="muted">
              {g.rank !== null ? `· choice ${g.rank}` : ""} · {g.item_count} item
              {g.item_count === 1 ? "" : "s"}
            </span>
          </h3>
          {g.store_id === null && (
            <p className="muted prep-note">
              Nothing in Notion sells these. They are here so they are not silently
              missing from the list.
            </p>
          )}
          {g.aisles.map((a) => (
            <div className="prep-aisle" key={a.aisle}>
              <div className="prep-aisle-name">{a.aisle}</div>
              <ul className="prep-lines">
                {a.items.map((ln) => <Line key={ln.ingredient_id} line={ln} />)}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function Line({ line }: { line: PrepLine }) {
  return (
    <li className="prep-line">
      <div className="prep-line-main">
        <span className="prep-qty">{fmtPackages(line.packages, line.package_label)}</span>
        <span className="prep-name">{line.name ?? "(unnamed)"}</span>
      </div>
      <div className="prep-line-sub muted">
        need {fmtBase(line.short_base, line.unit)}
        {line.on_hand_base !== null
          ? ` · have ${fmtBase(line.on_hand_base, line.unit)}`
          : " · never counted"}
        {line.later_day
          ? ` · ${line.packages_now ?? "?"} now, ${line.packages_later ?? "?"} on ${fmtDay(line.later_day)}`
          : ""}
      </div>
      {line.flags.length > 0 && (
        <div className="prep-flags">
          {line.flags.map((f) => (
            <span className={`chip chip--${f}`} key={f}>{FLAG_LABELS[f] ?? f}</span>
          ))}
        </div>
      )}
    </li>
  );
}

/** Per-day macro warnings. WARNS — it never blocks anything, and a target with
 * no data source renders as "no data" rather than as met. */
function MacroStrip({ macros }: { macros: MacrosResponse }) {
  const flagged = macros.days.filter((d) => d.chips.length > 0);
  if (flagged.length === 0) {
    return (
      <p className="muted prep-note">
        Every planned day is inside the target.
        {macros.days[0]?.no_data.length
          ? ` No data for ${macros.days[0].no_data
              .map((k) => MACRO_LABELS[k] ?? k)
              .join(" or ")}.`
          : ""}
      </p>
    );
  }
  return (
    <div className="prep-macros">
      {flagged.map((d) => (
        <div className="prep-macro-day" key={d.day}>
          <span className="prep-macro-date">{fmtDay(d.day)}</span>
          {d.chips.map((c) => (
            <span className={`chip chip--${c.direction}`} key={c.macro}>
              {MACRO_LABELS[c.macro] ?? c.macro} {c.value} ({c.direction} {c.target})
            </span>
          ))}
          {d.placeholder && <span className="chip chip--estimate">estimated macros</span>}
        </div>
      ))}
    </div>
  );
}

// ── pantry ──────────────────────────────────────────────────────────────────

function PantryTab({
  data, error, onRetry, onCounted,
}: {
  data: PantryResponse | null;
  error: string | null;
  onRetry: () => void;
  onCounted: () => void;
}) {
  if (error) {
    return (
      <div className="prep-body">
        <p className="banner prep-error">{error}</p>
        <button className="btn" onClick={onRetry}>Try again</button>
      </div>
    );
  }
  if (!data) return <div className="prep-body muted">Loading…</div>;

  const groups = new Map<string, PantryItem[]>();
  for (const it of data.items) {
    const key = it.category ?? "other";
    const arr = groups.get(key);
    if (arr) arr.push(it);
    else groups.set(key, [it]);
  }

  return (
    <div className="prep-body">
      <p className="muted">
        {data.count} ingredients · {data.uncounted} never counted. Counts are in
        packages of the store item shown; they are stored in base units, so a
        change of store does not rebase them.
      </p>
      {[...groups.entries()].map(([cat, items]) => (
        <section className="prep-store" key={cat}>
          <h3 className="prep-store-name">{cat}</h3>
          <ul className="prep-lines">
            {items.map((it) => (
              <PantryRow key={it.ingredient_id} item={it} onCounted={onCounted} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function PantryRow({ item, onCounted }: { item: PantryItem; onCounted: () => void }) {
  const [pkgs, setPkgs] = useState<number | null>(item.on_hand_pkgs);
  const [saving, setSaving] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  const save = useCallback(async (next: number) => {
    setSaving(true);
    setRefused(null);
    const res = await postPantryCount(
      item.ingredient_id,
      item.countable_in_packages ? { packages: next } : { base: next },
    );
    setSaving(false);
    if (res.status === "ok") {
      setPkgs(next);
      onCounted();
    } else if (res.status === "refused") {
      // The server would not store a package count it cannot convert. Say so
      // rather than showing a number that was never saved.
      setRefused(res.message);
      setPkgs(item.on_hand_pkgs);
    } else {
      setRefused(res.message);
      setPkgs(item.on_hand_pkgs);
    }
  }, [item, onCounted]);

  const step = (delta: number) => {
    const base = pkgs ?? 0;
    const next = Math.max(0, Math.round((base + delta) * 100) / 100);
    void save(next);
  };

  return (
    <li className="prep-line prep-pantry-row">
      <div className="prep-line-main">
        <span className="prep-name">{item.name ?? "(unnamed)"}</span>
        <span className="prep-stepper">
          <button aria-label="less" disabled={saving} onClick={() => step(-1)}>−</button>
          <span className="prep-count">{pkgs === null ? "—" : pkgs}</span>
          <button aria-label="more" disabled={saving} onClick={() => step(1)}>+</button>
        </span>
      </div>
      <div className="prep-line-sub muted">
        {item.countable_in_packages
          ? `${item.package_label ?? `${item.package_size} ${item.unit ?? ""}`}${
              item.store ? ` · ${item.store}` : ""
            }`
          : `counted in ${item.unit ?? "base units"} — no package size`}
        {item.on_hand_base !== null ? ` · ${fmtBase(item.on_hand_base, item.unit)}` : ""}
        {item.par_level_pkgs ? ` · keep ${item.par_level_pkgs}` : ""}
      </div>
      {refused && <div className="prep-flags"><span className="chip chip--no_store">{refused}</span></div>}
    </li>
  );
}
