import { Bone, HeaderSkeleton, ListSkeleton, Sweep } from "@/components/Skeleton";

/**
 * A project takes the longest of any page: it reconciles with GitLab on open,
 * so this is the skeleton people see most. It mirrors the milestone cards
 * closely for that reason.
 */
export default function Loading() {
  return (
    <>
      <Sweep />
      <HeaderSkeleton action={false} />
      <div className="page-body">
        <div className="stack gap-3">
          <Bone w={110} h={18} />
          <Bone w={330} h={10} />
        </div>
        {[0, 1].map((i) => (
          <div key={i} className="panel" style={{ overflow: "hidden" }}>
            <div className="panel-head" style={{ background: "var(--sunk)" }}>
              <span className="stack gap-2">
                <Bone w={190} h={15} />
                <Bone w={140} h={9} />
              </span>
              <span className="stack gap-2" style={{ minWidth: 130 }}>
                <Bone h={5} r={999} />
                <Bone w={64} h={9} />
              </span>
            </div>
            <div className="stack">
              {[0, 1, 2].map((r) => (
                <div key={r} className="row gap-3 center"
                     style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
                  <Bone w={19} h={19} r={6} />
                  <span className="stack gap-2 grow">
                    <Bone w={`${48 + ((r * 15) % 30)}%`} h={11} />
                    <Bone w={110} h={9} />
                  </span>
                  <Bone w={132} h={30} r={8} />
                </div>
              ))}
            </div>
          </div>
        ))}
        <section className="grid cols-2-even" style={{ alignItems: "start" }}>
          <ListSkeleton rows={4} />
          <ListSkeleton rows={2} />
        </section>
      </div>
    </>
  );
}
