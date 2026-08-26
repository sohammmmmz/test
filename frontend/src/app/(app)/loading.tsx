import { CardGrid, HeaderSkeleton, Sweep, TableSkeleton, TileRow } from "@/components/Skeleton";

/** Today: tiles, the workload table beside what lands next, then projects. */
export default function Loading() {
  return (
    <>
      <Sweep />
      <HeaderSkeleton />
      <div className="page-body">
        <TileRow />
        <section className="grid cols-2" style={{ alignItems: "start" }}>
          <TableSkeleton rows={5} />
          <TableSkeleton rows={4} title={130} />
        </section>
        <CardGrid count={3} />
      </div>
    </>
  );
}
