import { CardGrid, HeaderSkeleton, Sweep } from "@/components/Skeleton";

export default function Loading() {
  return (
    <>
      <Sweep />
      <HeaderSkeleton />
      <div className="page-body">
        <CardGrid count={6} />
      </div>
    </>
  );
}
