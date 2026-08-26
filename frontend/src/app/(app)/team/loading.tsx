import { CardGrid, HeaderSkeleton, ListSkeleton, Sweep } from "@/components/Skeleton";

export default function Loading() {
  return (
    <>
      <Sweep />
      <HeaderSkeleton />
      <div className="page-body">
        <ListSkeleton rows={2} />
        <CardGrid count={5} />
      </div>
    </>
  );
}
