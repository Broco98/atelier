import { createContext, useContext, useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { AgentFace } from "./AgentFace";
import { callRunningFor, describeCall } from "./call-view";
import type { CallEntry, CastMember } from "./fold";
import { ToolRows } from "./WorkLog";

// 호출 줄(v1 티켓 17 · 구현 스펙 §8 · 캔버스 WorkLog 보드 「Agent 호출 줄」 · 화면 3) — Agent가 다른 Agent에게 일을 맡긴 부르기 하나를
// 부른 Agent의 흐름에 그린다. 글은 순수 함수(`call-view.ts`)가 짓고 여기는 그린다.
//
// - **카드 한 줄**(보드 `.call`) — 16 반경 · 머리카락 그림자, 불린 Agent의 얼굴 24 · 두 줄 글(14/20 · 12/18 `fg-tertiary`) · 오른쪽
//   끝의 할 일. 하는 중이면 첫 줄이 반짝이고 오른쪽에 경과와 돌기가, 끝나면 「Session 열기 ›」가, 답하지 못했으면 「다시 맡기기」가
//   선다. 불린 Agent가 사람에게 물으면 둘째 줄 끝에 「승인을 기다립니다」가 링크 색으로 붙는다(작업 머리줄과 같은 말).
// - **펼침**(보드 `.callx`) — 줄을 누르면 아래에 맡긴 것 · 받은 것과 그 Agent의 도구 줄(왼쪽 선 안)이 선다.
// - **「Session 열기」**는 같은 화면에서 그 Agent의 줄만 거른 보기다(S37). **「다시 맡기기」**는 같은 글로 부르기를 다시 하는 엔진
//   명령이다. 둘 다 흐름을 그리는 쪽이 준다(`CallActions`).

/** 호출 줄이 흐름에서 받는 것 — 참여자의 이름 · 얼굴, 물음을 기다리는 참여자, 두 할 일. */
export interface CallActions {
  cast: Readonly<Record<string, CastMember>>;
  asking: ReadonlySet<string>;
  openSession: (call: CallEntry) => void;
  callAgain: (call: CallEntry) => Promise<void>;
}

export const CallPlace = createContext<CallActions | null>(null);

/** 하는 중의 경과를 1초마다 다시 센다. */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [ticking]);
  return now;
}

/** 오른쪽 끝의 할 일(보드 `.lnk`) — 13/18 `fg-secondary`, 누를 자리 4 · 6, 8 반경. */
const ACTION =
  "flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-1 text-chat-meta text-fg-secondary transition-colors quiet-hover focus-ring disabled:opacity-50";

export function CallRow({ call }: { call: CallEntry }) {
  const place = useContext(CallPlace);
  const member = place?.cast[call.to] ?? { name: call.to, avatar: null };
  const view = describeCall(call, member.name);
  const running = view.state === "running";
  const now = useNow(running);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const waiting = running && place?.asking.has(call.to) === true;
  const again = () => {
    if (!place) return;
    setBusy(true);
    void place.callAgain(call).finally(() => setBusy(false));
  };
  return (
    <div role="group" aria-label={view.title} data-call={view.state} className="w-full overflow-hidden rounded-2xl shadow-hairline">
      <div className={cn("flex items-center gap-2.5 py-2.5 pr-2.5 pl-3", open && "border-b-[0.5px] border-border")}>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
          className="group flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-left focus-ring"
        >
          <AgentFace handle={call.to} avatar={member.avatar} className="size-6 shrink-0" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className={cn("truncate text-sm", running && "chat-shimmer")}>{view.title}</span>
            <span className="flex min-w-0 items-center gap-1 text-xs text-fg-tertiary">
              <span className="min-w-0 truncate">{view.meta}</span>
              {waiting && (
                <>
                  <span aria-hidden>·</span>
                  <span className="shrink-0 text-link">승인을 기다립니다</span>
                </>
              )}
            </span>
          </span>
          {open ? (
            <ChevronDown className="size-3.5 shrink-0 text-fg-tertiary" aria-hidden />
          ) : (
            <ChevronRight
              className="size-3.5 shrink-0 text-fg-tertiary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
             
              aria-hidden
            />
          )}
        </button>
        {running && (
          <>
            <span className="shrink-0 text-xs text-fg-tertiary">{callRunningFor(call, now)}</span>
            <Spinner className="size-3.5 text-fg-tertiary" aria-hidden />
          </>
        )}
        {view.state === "answered" && view.session && place && (
          <button type="button" aria-label={`${member.name}의 Session 열기`} onClick={() => place.openSession(call)} className={ACTION}>
            Session 열기
            <ChevronRight className="size-3.5" aria-hidden />
          </button>
        )}
        {view.state === "failed" && place && (
          <button type="button" aria-label={`${member.name}에게 다시 맡기기`} disabled={busy} onClick={again} className={ACTION}>
            다시 맡기기
          </button>
        )}
      </div>
      {open && (
        <div className="flex flex-col gap-1.5 px-3.5 pt-2.5 pb-3">
          <dl className="grid grid-cols-[56px_minmax(0,1fr)] gap-x-3 gap-y-1 text-chat-meta leading-5">
            <dt className="text-xs leading-5 text-fg-tertiary">맡긴 것</dt>
            <dd className="whitespace-pre-wrap wrap-anywhere">{call.text}</dd>
            <dt className="text-xs leading-5 text-fg-tertiary">받은 것</dt>
            <dd className="max-h-60 overflow-auto whitespace-pre-wrap wrap-anywhere scroll-quiet">
              {view.received ?? (running ? "아직 없음" : "없음")}
            </dd>
          </dl>
          {view.tools.length > 0 && (
            <div className="mt-1 ml-2 flex flex-col border-l border-border-heavy pl-3.5">
              <ToolRows tools={view.tools} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
