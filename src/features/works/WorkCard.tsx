import { cn } from "@/lib/utils";
import { hasProjects } from "@/mode";
import type { Mode } from "@/mode";
import { formatCreated, STATUS_META } from "./status";
import type { WorkView } from "./types";

// 사이드바 행에 마우스를 올리면 뜨는 정보 카드. **`SidebarWorkList.tsx`에서 갈라져 나왔다** —
// 그 파일에는 「세계의 이름이 리터럴로 하나도 없다」를 세는 소스 검사가 걸려 있는데(읽는 곳과
// 가는 곳이 `mode` 하나에서 나오는 것을 지키는 그물이다), 이 카드가 그리는 것은 반대로
// **세계마다 다른 낱말**이라 그 조건을 리터럴로 적어야 한다. 두 규율이 한 파일 안에서 부딪혀
// 파일을 갈랐다 — 검사를 느슨하게 하는 쪽이 아니라.
//
// 나뉜 김에 얻는 것이 하나 더 있다: 이 카드는 hover로만 마운트돼서 목록을 그려서는 닿을 수
// 없다. 조각으로 서 있으면 정적 마크업으로 직접 그릴 수 있다 — **그래서 훅을 부르지 않는다**
// (목록이 `WorkSectionList`를 따로 내보낸 것과 같은 계약이다). 세계 판정을 그물에 걸려면
// 프로바이더 없이 그려지는 자리가 있어야 한다(WorkCard.test.tsx).

// 정보 전용이다 — 누를 수 있는 것을 넣지 않는다. 클릭 대상이 생기면 마우스가 행에서 카드로
// 건너가는 경로(safe triangle)를 살려둬야 하고, 열림 상태의 소유가 행에서 카드로 넘어간다.
//
// 알려진 한계: 키보드로는 이 카드에 닿을 수 없다. 숫자 단축키로 작업을 고르는 경로에서는
// 이 정보가 보이지 않는다. 감수한다.
export function WorkCard({ mode, work }: { mode: Mode; work: WorkView }) {
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
      <div className="flex flex-col gap-1 border-t pt-2.5 text-[12px]">
        {/* 브랜치는 첫 프로젝트가 붙을 때 정해진다 — 그전에는 보여줄 이름이 없다.

            **Maison에는 둘 다 없다**(결정 17 · #186) — 값으로 가르지 않는 이유는 정보 탭·ⓘ
            쪽 주석과 같다: 「아직 없어요」·「프로젝트가 붙으면 정해져요」는 저 세계에서 영영
            일어날 수 없는 일을 기다리라고 말하는 문장이고, 코어는 이름을 준 채 만들어진
            Room에 브랜치를 실어 보낼 수 있어(works.rs의 nothing_to_decide) `null` 검사도
            안 문다. 세 자리가 **같은 조건 모양**이라 함께 늙는다. */}
        {hasProjects(mode) && (
          <>
            <CardField label="브랜치" muted={work.branch === null} mono={work.branch !== null}>
              {work.branch ?? "프로젝트가 붙으면 정해져요"}
            </CardField>
            <CardField label="프로젝트" muted={work.projects.length === 0}>
              {work.projects.length === 0 ? "아직 없어요" : work.projects.join(", ")}
            </CardField>
          </>
        )}
        {/* spec은 두 세계에 다 있다 — Room도 스펙 문서를 든다(결정 17). */}
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
