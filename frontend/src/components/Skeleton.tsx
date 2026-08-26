/**
 * Loading placeholders shaped like the thing that is coming.
 *
 * Every one of these mirrors a real component's layout, so the page does not
 * jump when the data lands. That stability is most of what makes a load feel
 * quick — a spinner followed by a reflow reads as slower than a skeleton that
 * simply fills in.
 */

export function Sweep() {
  return <div className="sweep" role="progressbar" aria-label="Loading" />;
}

export function Bone({ w = "100%", h = 12, r }: {
  w?: number | string;
  h?: number;
  r?: number;
}) {
  return (
    <span className="bone" style={{ width: w, height: h, borderRadius: r ?? 6 }} aria-hidden />
  );
}

/** The page header: eyebrow, headline, one line of standfirst. */
export function HeaderSkeleton({ action = true }: { action?: boolean }) {
  return (
    <header className="page-head dawn">
      <div className="row between wrap gap-4" style={{ alignItems: "flex-end" }}>
        <div className="stack gap-3">
          <Bone w={140} h={9} />
          <Bone w={340} h={30} r={8} />
          <Bone w={280} h={12} />
        </div>
        {action && <Bone w={190} h={42} r={12} />}
      </div>
    </header>
  );
}

export function TileRow({ count = 4 }: { count?: number }) {
  return (
    <section className="grid cols-stat">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="panel stack gap-3" style={{ padding: "15px 17px" }}>
          <Bone w={70} h={8} />
          <Bone w={54} h={26} r={7} />
          <Bone w={96} h={9} />
        </div>
      ))}
    </section>
  );
}

export function TableSkeleton({ rows = 5, title = 200 }: { rows?: number; title?: number }) {
  return (
    <div className="panel" style={{ overflow: "hidden" }}>
      <div className="panel-head">
        <Bone w={title} h={15} />
        <Bone w={82} h={9} />
      </div>
      <div className="stack">
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className="row gap-3 center"
            style={{ padding: "13px 16px", borderBottom: "1px solid var(--line)" }}
          >
            <Bone w={32} h={32} r={999} />
            <span className="stack gap-2 grow">
              <Bone w={`${52 + ((i * 11) % 26)}%`} h={11} />
              <Bone w={86} h={9} />
            </span>
            <Bone w={38} h={11} />
            <Bone w={38} h={11} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function CardGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid cols-auto">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="panel stack gap-4" style={{ padding: 19 }}>
          <div className="stack gap-2">
            <Bone w={`${56 + ((i * 13) % 24)}%`} h={16} />
            <Bone w="86%" h={10} />
            <Bone w={150} h={9} />
          </div>
          <div className="stack gap-2">
            <Bone h={5} r={999} />
            <div className="row between">
              <Bone w={78} h={9} />
              <Bone w={64} h={9} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ListSkeleton({ rows = 4, head = true }: { rows?: number; head?: boolean }) {
  return (
    <div className="panel" style={{ overflow: "hidden" }}>
      {head && (
        <div className="panel-head">
          <Bone w={130} h={14} />
          <Bone w={40} h={9} />
        </div>
      )}
      <div className="stack">
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className="row gap-3 center"
            style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)" }}
          >
            <Bone w={19} h={19} r={6} />
            <Bone w={10} h={16} r={3} />
            <span className="grow"><Bone w={`${46 + ((i * 17) % 34)}%`} h={11} /></span>
            <Bone w={54} h={9} />
          </div>
        ))}
      </div>
    </div>
  );
}
