import { Bone, Sweep } from "@/components/Skeleton";

/** The board: one card per person, side by side. */
export default function Loading() {
  return (
    <>
      <Sweep />
      <header className="page-head dawn">
        <div className="row between wrap gap-4" style={{ alignItems: "flex-end" }}>
          <div className="stack gap-3">
            <Bone w={230} h={9} />
            <Bone w={300} h={30} r={8} />
            <Bone w={360} h={12} />
          </div>
          <Bone w={210} h={44} r={12} />
        </div>
      </header>
      <div className="page-body">
        <div className="grid cols-auto stretch">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="panel stack" style={{ overflow: "hidden", height: "100%" }}>
              <div className="row gap-3 center"
                   style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
                <Bone w={32} h={32} r={999} />
                <span className="stack gap-2 grow">
                  <Bone w="62%" h={12} />
                  <Bone w="42%" h={9} />
                </span>
              </div>
              <div className="stack gap-3" style={{ padding: "14px 16px" }}>
                <Bone w={72} h={8} />
                <Bone w="88%" h={11} />
                <Bone w={72} h={8} />
                <Bone w="76%" h={11} />
                <Bone w="66%" h={11} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
