import { Bone, HeaderSkeleton, Sweep } from "@/components/Skeleton";

/**
 * Shaped like the team cards that are arriving: a wide bar, a face stack and a
 * headcount. Closed cards, because that is how they land.
 */
export default function Loading() {
  return (
    <>
      <Sweep />
      <HeaderSkeleton />
      <div className="page-body">
        <div className="stack gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="panel row between center wrap gap-4"
                 style={{ padding: "20px 22px" }}>
              <span className="stack gap-2 grow" style={{ minWidth: 200 }}>
                <Bone w={i === 0 ? 150 : 110} h={16} />
                <Bone w="52%" h={10} />
                <span className="row gap-2" style={{ marginTop: 4 }}>
                  <Bone w={68} h={20} r={999} />
                  <Bone w={82} h={20} r={999} />
                </span>
              </span>
              <span className="row gap-3 center">
                <span className="faces">
                  {[0, 1, 2, 3].map((f) => (
                    <Bone key={f} w={32} h={32} r={999} />
                  ))}
                </span>
                <Bone w={46} h={38} />
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
