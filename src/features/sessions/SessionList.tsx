import { ShieldQuestion, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SessionView } from "./types";

interface SessionListProps {
  sessions: SessionView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** 이 세션을 뭐라고 부를지. 페이지가 정하고 브레드크럼과 여기가 같은 값을 쓴다. */
  label: (session: SessionView) => string;
  sidebarOpen: boolean;
}

function SessionList({ sessions, selectedId, onSelect, label, sidebarOpen }: SessionListProps) {
  // 이 패널은 접히지 않는다 — 목록과 대화가 늘 함께 보인다. Projects·Works의 접힘 패턴을
  // 쓰지 않는 것은 그래서다.
  return (
    <div className="flex h-full w-[360px] shrink-0 flex-col border-r bg-panel px-3 pb-3">
      {/* 타이틀바 스트립을 겸하는 패널 헤더 — 사이드바 닫힘 시 신호등·토글을 피한다 */}
      <div
        data-tauri-drag-region
        className={cn(
          "flex h-(--titlebar-height) shrink-0 items-center pr-0.5 transition-[padding] duration-[220ms]",
          sidebarOpen ? "pl-0.5" : "pl-[114px]",
        )}
      >
        <span className="flex items-baseline gap-[7px]">
          <span className="text-[15px] font-semibold tracking-[-0.01em]">Sessions</span>
          <span className="text-[12.5px] text-tertiary">{sessions.length}</span>
        </span>
      </div>

      {sessions.length === 0 ? (
        <div className="my-1 flex flex-col items-center gap-1.5 rounded-[14px] border border-dashed border-border-strong px-3.5 py-[22px] text-center">
          <Terminal className="mb-0.5 size-4 text-tertiary" strokeWidth={1.6} />
          <span className="text-[13.5px] font-medium text-muted-foreground">
            아직 세션이 없어요
          </span>
          <span className="text-[12.5px] leading-normal text-tertiary">
            시작점을 고르고 세션 시작을 누르면 그 디렉터리에서 에이전트가 떠요.
          </span>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pb-2">
          {sessions.map((session) => {
            const active = session.id === selectedId;
            return (
              <button
                key={session.id}
                type="button"
                onClick={() => onSelect(session.id)}
                className={cn(
                  "flex w-full shrink-0 flex-col gap-[7px] rounded-[14px] border px-4 py-3.5 text-left transition-colors",
                  active ? "border-transparent selected-ring" : "bg-background hover:bg-accent",
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
                  <span
                    className={cn(
                      "min-w-0 truncate text-[14.5px] font-semibold tracking-[-0.01em]",
                      active && "text-primary",
                    )}
                  >
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
                <span className="flex items-center justify-between gap-2 text-[11.5px] text-tertiary">
                  <span className="min-w-0 truncate font-mono">{session.cwd}</span>
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
