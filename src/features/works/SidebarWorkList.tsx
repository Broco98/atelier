import { useEffect, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorks } from "./hooks";
import { splitWorkSections } from "./work-sections";
import { StatusIcon } from "./status";
import type { WorkView } from "./types";

// 사이드바에 상주하는 작업 목록. 어느 화면에 있든 그대로 있고, 항목을 누르면 Works로 간다.
//
// 이건 전역 컨텍스트가 아니라 **전환 수단**이다 — "선택된 작업"이 앱 전체에 걸리는 개념은
// 도입하지 않는다. 다른 화면들은 작업 선택과 무관하게 독립 동작한다.
function SidebarWorkList() {
  const { data: works = [] } = useWorks();
  const navigate = useNavigate();
  const [draftsOpen, setDraftsOpen] = useState(false);

  // 어느 항목을 강조할지는 URL이 정한다 — 셸은 그것을 비출 뿐이다 (AppShell의 activeKey와 같은 규칙).
  // 슬러그에 한글이 들어가므로 경로에서 떼어낸 뒤 디코드한다.
  const openSlug = useRouterState({
    select: (state) =>
      state.location.pathname.startsWith("/works/")
        ? decodeURIComponent(state.location.pathname.slice("/works/".length))
        : null,
  });

  const { main, drafts, visible } = splitWorkSections(works, draftsOpen);
  // 목록에 없는 슬러그는 강조하지 않는다 — 지워진 작업을 가리키는 주소로 들어온 순간이 있다
  const selectedSlug = works.some((work) => work.slug === openSlug) ? openSlug : null;

  const open = (slug: string) => void navigate({ to: "/works/$slug", params: { slug } });

  // 진행 중인 작업이 하나도 없으면 접을 것이 없다 — 초안이 곧 목록이다.
  // (splitWorkSections의 visible도 같은 판단을 해서, 화면과 숫자 단축키가 어긋나지 않는다)
  const foldDrafts = main.length > 0 && drafts.length > 0;
  const rows = foldDrafts ? main : visible;

  // Cmd+1~9 — **화면에 보이는** 순서 기준 N번째 작업. 접힌 초안은 세지 않는다.
  // 어느 화면에 있든 이 목록을 센다: 어디에 있든 작업으로 한 번에 돌아갈 수 있다.
  // 입력 중에는 무시.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey || e.shiftKey || e.altKey || e.ctrlKey || !/^[1-9]$/.test(e.key)) return;
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
      )
        return;
      const work = visible[Number(e.key) - 1];
      if (!work) return;
      e.preventDefault();
      open(work.slug);
      // open은 의존성에 넣지 않는다 — navigate 하나만 닫아 잡고 그건 라우터가 고정해준다
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visible]);

  return (
    <>
      {/* 좌측 정렬을 행·nav 라벨과 맞춘다 — 컨테이너 px-2 + 항목 px-[9px] = 17px */}
      <div className="shrink-0 px-[17px] pb-1 pt-4">
        <span className="text-[11.5px] font-medium tracking-[0.03em] text-tertiary">작업</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-[3px] overflow-y-auto px-2 pb-1 scroll-quiet">
        {rows.length === 0 ? (
          <span className="px-[9px] pt-1 text-[12.5px] leading-normal text-tertiary">
            작업은 Claude Code에서 시작돼요.
          </span>
        ) : (
          rows.map((work) => (
            <WorkRow
              key={work.slug}
              work={work}
              active={work.slug === selectedSlug}
              onOpen={open}
            />
          ))
        )}
      </div>

      {foldDrafts && (
        <div className="mx-2 shrink-0 border-t pt-1.5">
          <button
            type="button"
            onClick={() => setDraftsOpen((v) => !v)}
            aria-expanded={draftsOpen}
            className="flex h-8 w-full items-center gap-1.5 rounded-[10px] px-[9px] text-left text-[12.5px] text-muted-foreground transition-colors hover:bg-state-1"
          >
            <ChevronRight
              className={cn("size-3 shrink-0 transition-transform", draftsOpen && "rotate-90")}
              strokeWidth={2.2}
            />
            <span className="min-w-0 flex-1 truncate">초안</span>
            <span className="shrink-0 rounded-[6px] bg-accent px-1.5 py-px text-[11px] text-tertiary">
              {drafts.length}
            </span>
          </button>
          {draftsOpen && (
            <div className="flex max-h-[38vh] flex-col gap-[3px] overflow-y-auto pb-1 pt-0.5 scroll-quiet">
              {drafts.map((work) => (
                <WorkRow
                  key={work.slug}
                  work={work}
                  active={work.slug === selectedSlug}
                  onOpen={open}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

// 한 줄 — 상태 점 + 제목. 바로 위 nav 항목과 규격을 맞춘다(높이·반지름·간격·글자 크기):
// 둘이 세로로 붙어 있어 규칙이 다르면 그 자리에서 어긋난다.
// 좁은 폭이라 제목이 자주 잘린다 — 최소한 툴팁으로는 전체가 읽혀야 한다.
function WorkRow({
  work,
  active,
  onOpen,
}: {
  work: WorkView;
  active: boolean;
  onOpen: (slug: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(work.slug)}
      title={work.title}
      className={cn(
        "flex h-8 w-full shrink-0 items-center gap-[9px] rounded-[10px] px-[9px] text-left transition-colors",
        active ? "selected-row text-foreground" : "text-muted-foreground hover:bg-state-1",
      )}
    >
      <StatusIcon status={work.status} />
      <span
        className={cn(
          "min-w-0 truncate text-[13.5px] font-medium",
          work.status === "done" && "text-tertiary",
        )}
      >
        {work.title}
      </span>
    </button>
  );
}

export default SidebarWorkList;
