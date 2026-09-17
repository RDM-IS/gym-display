import type { PeekMode } from "../screens/PeekScreen";

/** GD-WEEK — the read-only Tomorrow / Week entry points next to Start. */
export default function PeekButtons({ onPeek }: { onPeek: (mode: PeekMode) => void }) {
  return (
    <>
      <button type="button" className="btn peek-btn" onClick={() => onPeek("tomorrow")}>
        Tomorrow
      </button>
      <button type="button" className="btn peek-btn" onClick={() => onPeek("week")}>
        Week
      </button>
    </>
  );
}
