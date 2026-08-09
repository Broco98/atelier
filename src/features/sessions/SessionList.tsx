import { useRef, useState } from "react";
import { Folder, Plus, ShieldQuestion, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { PopoverPortal } from "@/components/ui/popover-portal";
import type { ProjectView } from "@/features/projects/types";
import type { SessionView } from "./types";

interface SessionListProps {
  sessions: SessionView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** 이 세션을 뭐라고 부를지. 페이지가 정하고 브레드크럼과 여기가 같은 값을 쓴다. */
  label: (session: SessionView) => string;
  /** 세션을 띄울 수 있는 시작점들. 하나도 없으면 + 가 잠긴다. */
  projects: ProjectView[];
  onStart: (projectSlug: string) => void;
  starting: boolean;
  sidebarOpen: boolean;
}

function SessionList({
  sessions,
  selectedId,
  onSelect,
  label,
  projects,
  onStart,
  starting,
  sidebarOpen,
}: SessionListProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);

  // 이 패널은 접히지 않는다 — 목록과 대화가 늘 함께 보인다. Projects·Works의 접힘 패턴을
  // 쓰지 않는 것은 그래서다.
  return (
    // 흰 바닥 — Projects·Archive와 같은 이유다: 무채색 선택 표시(selected-row)가 state-2인데
    // 패널이 회색이면 그 위에서 선택된 행이 배경에 묻힌다.
    <div className="flex h-full w-[360px] shrink-0 flex-col border-r bg-background px-3 pb-3">
      {/* 타이틀바 스트립을 겸하는 패널 헤더 — 사이드바 닫힘 시 신호등·토글을 피해 좌측 패딩을 넓힌다.
          제목을 여기 두지 않는 것은 Projects와 같다: 어느 화면인지는 오른쪽 PageHeader가 말한다. */}
      <div
        data-tauri-drag-region
        className={cn(
          // ease-panel은 사이드바 폭 트랜지션과 같아야 한다 — 이 버튼의 화면상 위치가 두 값의
          // 합이라 곡선이 다르면 최종 자리를 지나쳤다 되돌아온다 (index.css의 --panel-ease 주석)
          "flex h-(--titlebar-height) shrink-0 items-center justify-between pr-0.5 transition-[padding] duration-[220ms] ease-panel",
          sidebarOpen ? "pl-0.5" : "pl-(--titlebar-inset-panel)",
        )}
      >
        <button
          ref={addButton}
          type="button"
          onClick={() => setPickerOpen((open) => !open)}
          disabled={projects.length === 0 || starting}
          aria-label="세션 시작"
          aria-expanded={pickerOpen}
          title={
            projects.length === 0
              ? "먼저 Projects에서 폴더를 등록하세요"
              : starting
                ? "세션을 시작하는 중"
                : "세션 시작"
          }
          // Projects의 등록 +와 같은 규격이다. 그쪽이 네이티브 폴더 선택창을 열듯 이쪽은
          // 시작점 목록을 연다 — 누르는 자리와 고르는 자리를 붙여 둔다.
          className="icon-button-quiet text-tertiary disabled:pointer-events-none disabled:opacity-40"
        >
          {/* 글리프도 16px — 사이드바를 닫으면 셸 컨트롤 바로 옆에 같은 간격으로 이어 선다 */}
          <Plus className="size-4" strokeWidth={1.8} />
        </button>
      </div>

      {pickerOpen && (
        <PopoverPortal
          anchorRef={addButton}
          width={260}
          onClose={() => setPickerOpen(false)}
          className="flex flex-col gap-px p-[5px]"
        >
          {projects.map((project) => (
            <button
              key={project.slug}
              type="button"
              onClick={() => {
                setPickerOpen(false);
                onStart(project.slug);
              }}
              className="flex h-11 w-full items-center gap-2 rounded-[9px] px-[9px] text-left transition-colors hover:bg-state-2"
            >
              <Folder className="size-3.5 shrink-0 text-tertiary" strokeWidth={1.7} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[12.5px] font-medium">{project.name}</span>
                <span className="truncate font-mono text-[11px] text-tertiary">{project.path}</span>
              </span>
            </button>
          ))}
        </PopoverPortal>
      )}

      {sessions.length === 0 ? (
        <div className="my-1 flex flex-col items-center gap-1.5 rounded-[14px] border border-dashed border-border-strong px-3.5 py-[22px] text-center">
          <Terminal className="mb-0.5 size-4 text-tertiary" strokeWidth={1.6} />
          <span className="text-[13.5px] font-medium text-muted-foreground">
            아직 세션이 없어요
          </span>
          <span className="text-[12.5px] leading-normal text-tertiary">
            위 +를 눌러 시작점을 고르면 그 디렉터리에서 에이전트가 떠요.
          </span>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-[3px] overflow-y-auto pb-2 scroll-quiet">
          {sessions.map((session) => {
            const active = session.id === selectedId;
            return (
              <button
                key={session.id}
                type="button"
                onClick={() => onSelect(session.id)}
                className={cn(
                  // 테두리 없는 평평한 행 — 패널이 흰색이라 흰 카드는 테두리만 남아 어긋난다.
                  // 규격(반지름·패딩·줄 간격)은 Projects·작업 목록과 같은 값이다
                  "flex w-full shrink-0 flex-col gap-[5px] rounded-[12px] px-3 py-1 text-left transition-colors",
                  active ? "selected-row" : "hover:bg-state-1",
                )}
              >
                <span className="flex w-full items-center gap-[7px]">
                  <span
                    aria-label={session.alive ? "살아있음" : "죽음"}
                    className={cn(
                      "size-[7px] shrink-0 rounded-full",
                      session.alive ? "bg-primary" : "bg-border-strong",
                    )}
                  />
                  {/* 선택된 행의 색은 selected-row가 정한다 — 여기서 다시 칠하면 그 규칙이 둘이 된다 */}
                  <span className="min-w-0 truncate text-[13.5px] font-medium">
                    {label(session)}
                  </span>
                  <span className="ml-auto shrink-0 rounded-[6px] bg-accent px-1.5 py-px text-[11px] text-muted-foreground">
                    {session.agent}
                  </span>
                </span>
                {/* 답하지 않은 권한 요청 — 내가 아니라 에이전트가 나를 기다리는 중이다 */}
                {session.awaitingPermission && (
                  <span className="flex items-center gap-1.5 self-start rounded-[7px] bg-primary/[0.12] px-1.5 py-0.5 text-[11.5px] font-medium text-primary">
                    <ShieldQuestion className="size-3.5 shrink-0" strokeWidth={1.8} />
                    권한을 기다려요
                  </span>
                )}
                <span className="flex items-center justify-between gap-2 font-mono text-[11.5px] text-tertiary">
                  <span className="min-w-0 truncate">{session.cwd}</span>
                  <span className="shrink-0">{formatStarted(session.createdAt)}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatStarted(iso: string) {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString();
}

export default SessionList;
