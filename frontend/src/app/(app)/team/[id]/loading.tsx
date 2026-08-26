import { Bone, ListSkeleton, Sweep } from "@/components/Skeleton";

export default function Loading() {
  return (
    <>
      <Sweep />
      <header className="page-head dawn">
        <div className="stack gap-3">
          <Bone w={70} h={9} />
          <div className="row gap-4 center wrap">
            <Bone w={46} h={46} r={999} />
            <span className="stack gap-2 grow">
              <Bone w={230} h={26} r={7} />
              <Bone w={170} h={11} />
            </span>
            <span className="row gap-5">
              <Bone w={54} h={34} r={7} />
              <Bone w={54} h={34} r={7} />
            </span>
          </div>
        </div>
      </header>
      <div className="page-body">
        <section className="grid cols-2" style={{ alignItems: "start" }}>
          <ListSkeleton rows={4} />
          <div className="stack gap-4">
            <ListSkeleton rows={3} />
            <ListSkeleton rows={3} />
          </div>
        </section>
      </div>
    </>
  );
}
