import { Bone, ListSkeleton, Sweep } from "@/components/Skeleton";

export default function Loading() {
  return (
    <>
      <Sweep />
      <header className="page-head dawn">
        <div className="stack gap-3">
          <Bone w={190} h={9} />
          <Bone w={280} h={30} r={8} />
          <Bone w={320} h={12} />
        </div>
      </header>
      <div className="page-body">
        <ListSkeleton rows={5} />
        <ListSkeleton rows={3} />
      </div>
    </>
  );
}
