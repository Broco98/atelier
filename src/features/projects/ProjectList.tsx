import { useState } from "react";
import { Folder, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { ListHead, ListScroll, ListSearch, TWO_LINE_ROW } from "@/components/shell/Frame";
import { navItem } from "@/components/shell/nav-items";
import type { TargetRegion } from "@/components/shell/TargetMenu";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InlineRename } from "@/components/ui/inline-rename";
import { Hint } from "@/components/ui/tooltip";
import { pressed } from "@/lib/hotkeys";
import { useRoving } from "@/lib/roving";
import type { ProjectView } from "./types";

interface ProjectListProps {
  projects: ProjectView[];
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
  onAdd: () => void;
  /** 이름을 그 자리에서 고치는 중인 행(slug). 없으면 null. 고치는 상태는 화면이 쥔다(`ProjectsPage`). */
  renaming: string | null;
  /** 행에서 F2 — 그 행의 이름을 고치기 시작한다. */
  onRename: (slug: string) => void;
  /** 고친 이름으로 저장한다 — 바뀐 때만 부른다(`InlineRename`). */
  onRenameCommit: (slug: string, name: string) => void;
  /** 저장이든 취소든 고치기가 끝났다. */
  onRenameEnd: () => void;
  /**
   * 행 메뉴의 손잡이(`TargetMenu`) — 행이 구르는 상자가 우클릭 · ⇧F10을 받아 그 행의 프로젝트 메뉴를 연다(codex-ds 티켓 30). 메뉴의
   * 상태와 목록은 화면이 든다(`ProjectsPage`) — 행은 표식(`data-project-row`)과 테두리 자리(`focus-ring`)만 든다.
   */
  rowMenu?: TargetRegion;
}

// 목록 칸의 안 — 목록 머리(「Projects」 · 개수 · `+`), 찾기 칸, 두 줄 행(DS `.at-listcol` · `.at-row.two` — 이름 줄과 경로 줄). 칸 ·
// 세로 선 · 폭 손잡이는 공용 틀의 목록 칸이 든다(`Frame`의 `list` — codex-ds 결정 28). 폭의 저장도 화면(`ProjectsPage`)이 그 칸에 건넨다.
// 찾기 칸 · 구르는 상자 · 행의 자리는 Archive 목록과 같은 조각이다(`Frame`의 `ListSearch` · `ListScroll` · `TWO_LINE_ROW`).
function ProjectList({
  projects,
  selectedSlug,
  onSelect,
  onAdd,
  renaming,
  onRename,
  onRenameCommit,
  onRenameEnd,
  rowMenu,
}: ProjectListProps) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = q
    ? projects.filter((p) =>
        [p.name, p.path, p.git?.remoteSlug ?? ""].some((s) => s.toLowerCase().includes(q)),
      )
    : projects;
  // **목록 하나가 Tab 정류장 하나다**(codex-ds 스펙 S10) — 걸러진 행이 다닐 차례이고, 정류장은 고른 프로젝트에서 시작한다.
  const roving = useRoving(filtered.map((project) => project.slug), selectedSlug);

  // 숫자 단축키는 여기에 없다 — 사이드바 작업 목록에도 없다. 한때 사이드바 N번째 작업을
  // 여는 키였는데, ⌘1~9가 한 화면 안에서 본문을 옮기는 키로 바뀌면서 걷혔다
  // (`shell-registry.ts`의 ⌘1~9 머리말). 목록 순서가 바뀌어도 따라 바꿀 키가 없다.

  return (
    <>
      {/* 목록 머리 — 제목 · 등록한 프로젝트 수와 끝의 `+`(DS `.at-ib` — 테두리 없는 28 아이콘 버튼). 신호등을 피할 일은 머리 줄의
          몫이라 여기에는 사이드바 열림에 따라 갈리는 여백이 없다. */}
      <ListHead
        title={navItem("projects").label}
        count={projects.length}
        end={
          <Hint
            text="프로젝트 등록"
            announce="name"
            render={<Button variant="ghost" size="icon" onClick={onAdd} />}
          >
            <Plus className="size-4" />
          </Hint>
        }
      />

      {projects.length > 0 && <ListSearch label="프로젝트 검색" value={query} onChange={setQuery} />}

      {projects.length === 0 ? (
        <Empty variant="list" className="my-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Folder />
            </EmptyMedia>
            <EmptyTitle>프로젝트가 없어요</EmptyTitle>
            <EmptyDescription>로컬 저장소 폴더를 등록해 시작하세요.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="soft" size="xs" onClick={onAdd}>
              프로젝트 등록
            </Button>
          </EmptyContent>
        </Empty>
      ) : filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center pb-10">
          <span className="text-chat-meta text-fg-tertiary">검색 결과가 없어요</span>
        </div>
      ) : (
        <ListScroll menu={rowMenu} roving={roving.box}>
          {filtered.map((project) => {
            const active = project.slug === selectedSlug;
            const editing = project.slug === renaming;
            // 고른 행과 hover는 카드 안 목록의 두 단이다.
            const tone = active ? "selected-row" : "hover:bg-fill-soft";
            const lines = (
              <>
                {/* 이름 줄 — 폴더 글리프 14(`fg-secondary`)와 이름 14/500. 폴더를 못 찾은 프로젝트는 끝에 「누락」 꼬리표가 선다.
                    이름을 고치는 동안은 이름 글자 자리에 입력칸이 선다 — 줄 높이(20)와 글자 자리가 이름 글자와 같아 행이 움직이지
                    않는다(왼쪽으로 4 넓힌 만큼 안쪽을 둔다). */}
                <span className="flex w-full min-w-0 items-center gap-2">
                  <Folder aria-hidden className="size-3.5 shrink-0 text-fg-secondary" />
                  {editing ? (
                    <InlineRename
                      value={project.name}
                      label="프로젝트 이름"
                      emptyMeans="revert"
                      fit="fill"
                      onCommit={(name) => onRenameCommit(project.slug, name)}
                      onDone={onRenameEnd}
                      returnFocus={() =>
                        document.querySelector<HTMLElement>(`button[data-project-row="${project.slug}"]`)
                      }
                      className="-ml-1 h-5 px-1 text-sm font-medium text-fg"
                    />
                  ) : (
                    <span
                      className={cn(
                        "min-w-0 truncate text-sm font-medium",
                        project.missing && "text-fg-secondary line-through",
                      )}
                    >
                      {project.name}
                    </span>
                  )}
                  {project.missing && (
                    // 꼬리표(`tag` — DS `Tag`)의 빨간 갈래(`.at-tag.danger`)다.
                    <span className="tag ml-auto bg-danger/8 text-xs text-danger">누락</span>
                  )}
                </span>
                {/* 경로 줄 — 고정폭 12 `fg-tertiary`(행 메타, DS 「대비」)이고 이름 글자 밑에서 시작한다(글리프 14 + 사이 8). */}
                <span className="w-full truncate pl-5.5 font-mono text-xs text-fg-tertiary">{project.path}</span>
              </>
            );
            // **이름을 고치는 동안 행 버튼 자리에 버튼이 아닌 상자가 선다**(codex-ds 스펙 §9) — 버튼 안에는 입력칸을 둘 수 없다. 자리
            // (`TWO_LINE_ROW`)와 두 줄은 같아 행이 움직이지 않는다. 입력칸 안의 누름은 행으로 올라가지 않아 그 행이 골라지지 않는다
            // (`InlineRename`). 키로 끝내면 포커스가 다시 선 행 버튼으로 돌아온다.
            if (editing) {
              return (
                <div key={project.slug} className={cn(TWO_LINE_ROW, tone)}>
                  {lines}
                </div>
              );
            }
            return (
              <button
                key={project.slug}
                type="button"
                // 이름을 고친 뒤 포커스가 돌아올 자리를 찾는 표(`returnFocus`)이자, 행 메뉴가 대상을 가르는 표다(`rowMenu`). 메뉴가
                // 열린 동안 이 버튼이 대상 테두리를 입는다(`focus-ring`의 `[data-menu-target]`).
                data-project-row={project.slug}
                // 목록의 정류장 행만 Tab이 앉는다 — 나머지 행은 ↑↓로 간다(`ListScroll`). Enter는 버튼의 누름이라 그 행을 고른다.
                tabIndex={project.slug === roving.stop ? 0 : -1}
                data-roving={project.slug}
                // ⌃클릭은 고르지 않는다 — macOS에서 ⌃클릭은 우클릭이라 같은 메뉴를 여는 손이고, 메뉴는 고름을 안 바꾼다(codex-ds 결정 7 —
                // 사이드바 work 행의 `onClick`과 같은 거름이다).
                onClick={(event) => {
                  if (!event.ctrlKey) onSelect(project.slug);
                }}
                // **F2는 이 행의 이름을 그 자리에서 고친다**(codex-ds 스펙 §9). 고르지 않은 행에서도 그 행의 이름이다.
                onKeyDown={(event) => {
                  if (!pressed(event, "rename")) return;
                  event.preventDefault();
                  onRename(project.slug);
                }}
                className={cn(TWO_LINE_ROW, "text-left focus-ring", tone)}
              >
                {lines}
              </button>
            );
          })}
        </ListScroll>
      )}
    </>
  );
}

export default ProjectList;
