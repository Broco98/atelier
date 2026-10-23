import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { ThreadFaces } from "./AgentFace";
import { threadApi } from "./api";
import type { Avatar } from "./faces";
import HostFace from "./HostFace";
import { useAgentRoster, useThreads } from "./hooks";
import { lastSaid } from "./preview";
import { since } from "./since";
import { linesOf, mergeLines, threadRecordStore } from "./thread-store";
import type { ThreadSummary } from "./types";

// 사이드바의 Thread 묶음(v1 티켓 05 · 07 · 캔버스 「Thread 목록과 아바타」 보드) — Work 없는 Thread들이 새것부터 두 줄씩 선다: 얼굴 ·
// 제목 · 시각, 그 아래 마지막 말(`lastSaid`). 받은편지함처럼 열지 않아도 누가 무엇을 말했는지 보인다. 목록은 엔진의 요약 이벤트가
// 고친다(`useThreadFeeds`) — 다시 읽지 않는다.
// - **마지막 말은 기록에서 센다.** 줄마다 그 Thread의 기록을 한 번 읽어 기록 줄 스토어에 합치고(Thread를 열 때와 같은 자리 — seq로
//   합치니 겹쳐도 한 줄이다), 그 뒤는 앱 층이 받는 기록 줄 이벤트가 잇는다. 엔진이 요약에 말을 싣지 않는 까닭은 결정.md 07에 있다.
// - 얼굴(v1 티켓 14)은 참여자의 것이다(`ThreadFaces` — 32, 둘 이상이면 처음 · 마지막에 들어온 이를 겹친다). 요약에는 handle만 있어
//   `avatar`는 Library 정의에서 찾고, 없으면 handle에서 정한다. 상태 칸(내 차례 점 · 스피너 · 실패 …)은 41이 이 줄에 얹는다.
// - 깨진 Thread도 줄이 선다(무엇이 깨졌는지는 둘째 줄이 말한다) — 목록에서 조용히 빠지면 「내 Thread가 어디 갔지」에 답할 자리가 없다.

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
    <section aria-label="Thread" className="flex min-h-0 shrink flex-col pr-2 pb-1.5 pl-2">
      <h2 className="flex h-7.5 shrink-0 items-center px-2 text-chat-meta text-fg-tertiary">Thread</h2>
      <ul className="flex min-h-0 flex-col gap-0.5 overflow-y-auto scroll-quiet">
        {loose.map((thread) => (
          <li key={thread.id}>
            <ThreadRow
              thread={thread}
              people={thread.handles.map((handle) => ({ handle, avatar: avatarOf(handle) }))}
              on={thread.id === current}
              now={now}
              onOpen={() => void navigate({ to: "/threads/$id", params: { id: thread.id } })}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Thread 줄 하나 — 얼굴 · 제목 · 시각, 그 아래 마지막 말. 시각은 마지막 말의 때이고, 말이 아직 없으면 Thread가 선 때다. */
function ThreadRow({
  thread,
  people,
  on,
  now,
  onOpen,
}: {
  thread: ThreadSummary;
  people: readonly { handle: string; avatar: Avatar | null }[];
  on: boolean;
  now: number;
  onOpen: () => void;
}) {
  const said = useLastSaid(thread);
  const title = thread.broken ? "열 수 없는 Thread" : thread.title || "새 Thread";
  // 다른 Agent의 말은 이름을 앞에 단다(보드 「리뷰어 · 수정 요청 2건」). Host와 사람의 말은 그대로다.
  const preview = thread.broken ?? (said ? (said.name && said.who !== "host" ? `${said.name} · ${said.text}` : said.text) : "");
  return (
    <button
      type="button"
      aria-current={on ? "page" : undefined}
      onClick={() => {
        if (!on) onOpen();
      }}
      className={cn(
        "flex w-full min-w-0 items-center gap-2.5 rounded-xl p-2 text-left transition-colors focus-ring",
        on ? "selected-row" : "text-fg hover:bg-fill-soft",
      )}
    >
      {thread.broken || people.length === 0 ? (
        // 깨진 Thread는 참여자를 모른다 — 같은 자리에 옅은 Host 얼굴이 서서 제목이 줄마다 같은 x에서 시작한다.
        <HostFace className={cn("size-8", thread.broken && "opacity-40")} />
      ) : (
        <ThreadFaces people={people} faceClass="size-8" pairClass="size-8" pairFaceClass="size-5" ringClass="ring-surface-shell" />
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-nav-row", thread.broken && "text-fg-tertiary")}>{title}</span>
          <span className="shrink-0 text-xs text-fg-tertiary">{since(said?.at ?? thread.createdAt, now)}</span>
        </span>
        {preview !== "" && <span className="truncate text-chat-meta text-fg-tertiary">{preview}</span>}
      </span>
    </button>
  );
}

/**
 * 그 Thread의 마지막 말 — 기록을 한 번 읽어 스토어에 합치고(깨진 Thread는 읽지 않는다), 스토어의 줄에서 센다. 읽기가 실패하면 말 없이
 * 제목과 시각만 선다 — 줄은 열어서 고칠 수 있다.
 */
function useLastSaid(thread: ThreadSummary) {
  useQuery({
    queryKey: ["thread-record", thread.id],
    queryFn: async () => {
      mergeLines(thread.id, await threadApi.readRecord(thread.id, 0));
      return null;
    },
    enabled: thread.broken === null,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const lines = useStore(threadRecordStore, (state) => linesOf(state, thread.id));
  return useMemo(() => lastSaid(lines), [lines]);
}

export default SidebarThreads;
