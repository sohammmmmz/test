import { Bone, HeaderSkeleton, Sweep, TableSkeleton, TileRow } from "@/components/Skeleton";

/** Shaped like the report: headline numbers, the sheet list, then the tables. */
export default function Loading() {
  return (
    <>
      <Sweep />
      <HeaderSkeleton />
      <div className="page-body">
        <TileRow />
        <div className="panel stack gap-3" style={{ padding: "16px 18px" }}>
          <Bone w={210} h={13} />
          <span className="row gap-2 wrap">
            {[132, 118, 104, 140, 126, 148].map((w, i) => (
              <Bone key={i} w={w} h={32} r={10} />
            ))}
          </span>
        </div>
        <div className="grid cols-2" style={{ alignItems: "start" }}>
          <TableSkeleton rows={6} />
          <TableSkeleton rows={6} />
        </div>
        <TableSkeleton rows={7} title={240} />
      </div>
    </>
  );
}
