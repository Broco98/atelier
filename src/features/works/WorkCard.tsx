import { cn } from "@/lib/utils";
import { SignalNote, type CallingNote } from "@/components/shell/shell-signal";
import { formatCreated, STATUS_META } from "./status";
import type { WorkView } from "./types";

// 사이드바 행에 마우스를 올리면 뜨는 정보 카드. **제 파일로 선 조각이다** — 이 카드는 hover로만
// 마운트돼서 목록을 그려서는 닿을 수 없다. 조각으로 서 있으면 정적 마크업으로 직접 그릴 수 있다 —
// **그래서 훅을 부르지 않는다**(목록이 `WorkSectionList`를 따로 내보낸 것과 같은 계약이다).
// 프로바이더 없이 그려지는 이 자리가 카드의 그물이다(WorkCard.test.tsx).

// 정보 전용이다 — 누를 수 있는 것을 넣지 않는다. 클릭 대상이 생기면 마우스가 행에서 카드로
// 건너가는 경로(safe triangle)를 살려둬야 하고, 열림 상태의 소유가 행에서 카드로 넘어간다.
//
// 알려진 한계: 키보드로는 이 카드에 닿을 수 없다. 키보드로 작업을 고르는 경로(팔레트)에서는
// 이 정보가 보이지 않는다. 감수한다. 그 가운데 **셸의 마지막 말**만은 키보드에도 닿는다 — 같은
// 값이 행 버튼의 접근성 설명으로도 붙는다(`sidebar-active-band` 결정 14, `WorkSectionList`의 행).
export function WorkCard({
  work,
  note,
}: {
  work: WorkView;
  /**
   * 부르는 셸이 한 말(결정 14). **값으로 받는다** — 이 카드는 훅을 안 부르는 조각이라 스스로
   * 고르지 못하고, 고르는 자리는 사이드바 하나다(레인·메타·설명과 같은 셸). 없으면 `null`이고
   * 그때 말 칸이 통째로 없다(S6).
   */
  note: CallingNote | null;
}) {
  const meta = STATUS_META[work.status];
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-[13.5px] font-medium leading-snug">{work.title}</span>
      <span className="flex items-center gap-2">
        <span
          className={cn(
            "shrink-0 rounded-[6px] px-1.5 py-px text-[11px] font-medium",
            meta.badgeClass,
          )}
        >
          {meta.label}
        </span>
        <span className="text-[11.5px] text-tertiary">{formatCreated(work.createdAt)}</span>
      </span>
      {/* **상태 배지 줄 아래, 필드 표 위**다(결정 14). 배지는 work의 상태이고 이 칸은 그 work에서
          지금 나를 부르는 셸의 말이라, 둘이 붙어 서야 「무엇이 · 왜」가 한 번에 읽힌다. 필드 표는
          선 아래의 안 변하는 사실이다. */}
      {note && <SignalNote {...note} />}
      <div className="flex flex-col gap-1 border-t pt-2.5 text-[12px]">
        {/* 브랜치는 첫 프로젝트가 붙을 때 정해진다 — 그전에는 보여줄 이름이 없다. */}
        <CardField label="브랜치" muted={work.branch === null} mono={work.branch !== null}>
          {work.branch ?? "프로젝트가 붙으면 정해져요"}
        </CardField>
        <CardField label="프로젝트" muted={work.projects.length === 0}>
          {work.projects.length === 0 ? "아직 없어요" : work.projects.join(", ")}
        </CardField>
        <CardField label="spec">{`${work.specFiles.length}개`}</CardField>
      </div>
    </div>
  );
}

function CardField({
  label,
  muted = false,
  mono = false,
  children,
}: {
  label: string;
  muted?: boolean;
  mono?: boolean;
  children: string;
}) {
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="w-[46px] shrink-0 text-tertiary">{label}</span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          muted ? "text-tertiary" : "text-muted-foreground",
          mono && "font-mono",
        )}
      >
        {children}
      </span>
    </span>
  );
}
