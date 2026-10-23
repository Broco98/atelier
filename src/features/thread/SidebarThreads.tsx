import { useEffect, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { ThreadFaces } from "./AgentFace";
import { useAgentRoster, useThreads } from "./hooks";
import { since } from "./since";

// 사이드바의 Thread 묶음(v1 티켓 05) — Work 없는 Thread들이 새것부터 한 줄씩(얼굴 · 제목 · 시각) 선다. 지금 사이드바에 묶음 하나만 더한
// 것이고, 시안 모양 전체(두 줄 · 내 차례 점 · 접기)는 07이 맞춘다. 목록은 엔진의 요약 이벤트가 고친다(`useThreadFeeds`) — 다시 읽지 않는다.
// 얼굴(v1 티켓 14)은 참여자의 것이다(`ThreadFaces`) — 요약에는 handle만 있어 `avatar`는 Library 정의에서 찾고, 없으면 handle에서 정한다.
// 깨진 Thread도 줄이 선다(무엇이 깨졌는지는 줄의 설명이 말한다) — 목록에서 조용히 빠지면 「내 Thread가 어디 갔지」에 답할 자리가 없다.

/** 시각을 다시 세는 간격 — 「방금 · N분」이 한 자리에 멎지 않게 1분마다다. */
const TICK = 60_000;

function SidebarThreads() {
  const { data: threads = [] } = useThreads();
  const roster = useAgentRoster(null);
  const avatarOf = (handle: string) =>
    roster?.agents.find((agent) => agent.from === "library" && agent.definition.handle === handle)?.definition.avatar ?? null;
  const navigate = useNavigate();
  const current = useRouterState({
    select: (state) => (state.location.pathname.startsWith("/threads/") ? state.location.pathname.slice("/threads/".length) : null),
  });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), TICK);
    return () => window.clearInterval(timer);
  }, []);
  const loose = threads.filter((thread) => thread.work === null);
  if (loose.length === 0) return null;
  return (
    <section aria-label="Thread" className="flex max-h-[40%] min-h-0 shrink-0 flex-col pr-2 pb-1.5 pl-2">
      <h2 className="flex h-7.5 shrink-0 items-center px-2 text-chat-meta text-fg-tertiary">Thread</h2>
      <ul className="flex min-h-0 flex-col gap-0.5 overflow-y-auto scroll-quiet">
        {loose.map((thread) => {
          const on = thread.id === current;
          const title = thread.broken ? "열 수 없는 Thread" : thread.title || "새 Thread";
          return (
            <li key={thread.id}>
              <button
                type="button"
                aria-current={on ? "page" : undefined}
                title={thread.broken ?? undefined}
                onClick={() => {
                  if (!on) void navigate({ to: "/threads/$id", params: { id: thread.id } });
                }}
                className={cn(
                  "flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-sm transition-colors focus-ring",
                  on ? "selected-row" : "text-fg hover:bg-fill-soft",
                  thread.broken && "text-fg-tertiary",
                )}
              >
                <ThreadFaces people={thread.handles.map((handle) => ({ handle, avatar: avatarOf(handle) }))} />
                <span className="min-w-0 flex-1 truncate">{title}</span>
                <span className="shrink-0 text-xs text-fg-tertiary">{since(thread.createdAt, now)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default SidebarThreads;
