import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { SegmentGroup, SegmentGroupItem } from "@/components/ui/segment-group";
import { Spinner } from "@/components/ui/spinner";
import { threadIdOf } from "@/lib/path-prefix";
import { cn } from "@/lib/utils";
import { ThreadFaces } from "./AgentFace";
import type { Avatar } from "./faces";
import HostFace from "./HostFace";
import { threadQuery, useAgentRoster, useThreads, useWaiting } from "./hooks";
import { lastSaid } from "./preview";
import { since } from "./since";
import { seenOf, statusOf, type ThreadStatus } from "./status";
import { linesOf, threadRecordStore } from "./thread-store";
import type { ThreadSummary } from "./types";
import type { Waiting } from "./waiting";

// 사이드바의 Thread 묶음(v1 티켓 05 · 07 · 캔버스 「Thread 목록과 아바타」 보드) — Work 없는 Thread들이 새것부터 두 줄씩 선다: 얼굴 ·
// 제목 · 시각, 그 아래 마지막 말(`lastSaid`). 받은편지함처럼 열지 않아도 누가 무엇을 말했는지 보인다. 목록은 엔진의 요약 이벤트가
// 고친다(`useThreadFeeds`) — 다시 읽지 않는다.
// - **마지막 말은 기록에서 센다.** 줄마다 그 Thread의 기록을 한 번 읽어 기록 줄 스토어에 합치고(Thread를 열 때와 같은 자리 — seq로
//   합치니 겹쳐도 한 줄이다), 그 뒤는 앱 층이 받는 기록 줄 이벤트가 잇는다. 엔진이 요약에 말을 싣지 않는 까닭은 결정.md 07에 있다.
// - 얼굴(v1 티켓 14)은 참여자의 것이다(`ThreadFaces` — 32, 둘 이상이면 처음 · 마지막에 들어온 이를 겹친다). 요약에는 handle만 있어
//   `avatar`는 Library 정의에서 찾고, 없으면 handle에서 정한다.
// - **상태는 하나만 보인다**(v1 티켓 41 · 구현 스펙 §17 · 캔버스 Sidebar 보드 「상태는 다섯 가지」, 계산은 `status.ts`의 `statusOf`) — 내
//   차례는 얼굴에 파란 점 · 진한 미리보기(기다리는 것), 작업 중은 시각 자리의 스피너, 새 결과는 굵은 제목, 실패는 미리보기 앞의 빨간
//   「실패」, 중단은 「중단했습니다」다. 색은 내 차례의 파랑과 「실패」의 빨강 두 곳뿐이고(빨강은 여기와 diff만 — `color-guard`) 나머지는
//   모양과 굵기다. **줄은 자리를 지키고 상태 칸만 바뀐다**(Motion 보드 「목록 상태 바뀜」) — 둘째 줄은 비어도 자리를 지키고, 바뀐 칸만
//   떠오르고, 내 차례가 되면 점이 한 번 튄다.
// - 상태의 바탕은 Thread를 열 때와 같은 읽기다(`threadQuery` — `get`의 살아 있음 · 기록 끝, 그리고 기록) — 열린 캐시를 Thread 화면과
//   함께 쓴다. 읽은 자리(`lastRead`)는 요약의 것이다: Thread 화면이 맨 아래를 보면 적고(S38), 요약 이벤트가 이 줄을 고친다.
// - 깨진 Thread도 줄이 선다(무엇이 깨졌는지는 둘째 줄이 말한다) — 목록에서 조용히 빠지면 「내 Thread가 어디 갔지」에 답할 자리가 없다.
// - **「전체 | 내 차례」 거르기**(v1 티켓 42 · 구현 스펙 §17 · 스토리 131 · 보드 「내 차례만」) — 「내 차례」를 고르면 Work 묶음과 이 묶음
//   대신 나를 기다리는 Thread만 「기다리는 순서」로 선다(Work에 이은 Thread도 섞인다). 차례 · 수는 `waiting.ts`가 세고, 마디는 검색 칸
//   아래(`ThreadFilter`), 고른 칸은 사이드바가 쥔다.

/** 시각을 다시 세는 간격 — 「방금 · N분」이 한 자리에 멎지 않게 1분마다다. */
const TICK = 60_000;

/** Thread 묶음이 무엇을 세우나 — 전체(Work 묶음 · Thread 묶음) 또는 나를 기다리는 Thread만. */
export type ThreadListFilter = "all" | "mine";

const FILTERS = ["all", "mine"] as const satisfies readonly ThreadListFilter[];

/** 줄 하나의 얼굴들 — 요약에는 handle만 있어 `avatar`는 Library 정의에서 찾고, 없으면 handle에서 정한다(`ThreadFaces`). */
type PeopleOf = (thread: ThreadSummary) => { handle: string; avatar: Avatar | null }[];

function SidebarThreads({ filter }: { filter: ThreadListFilter }) {
  const { data: threads = [] } = useThreads();
  const roster = useAgentRoster(null);
  const avatarOf = (handle: string) =>
    roster?.agents.find((agent) => agent.from === "library" && agent.definition.handle === handle)?.definition.avatar ?? null;
  const peopleOf: PeopleOf = (thread) => thread.handles.map((handle) => ({ handle, avatar: avatarOf(handle) }));
  const navigate = useNavigate();
  const current = useRouterState({ select: (state) => threadIdOf(state.location.pathname) });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), TICK);
    return () => window.clearInterval(timer);
  }, []);
  const open = (thread: ThreadSummary) => void navigate({ to: "/threads/$id", params: { id: thread.id } });
  if (filter === "mine") return <WaitingThreads peopleOf={peopleOf} current={current} now={now} onOpen={open} />;
  const loose = threads.filter((thread) => thread.work === null);
  if (loose.length === 0) return null;
  return (
    <section aria-label="Thread" className="flex min-h-0 shrink flex-col pr-2 pb-1.5 pl-2">
      <h2 className="flex h-7.5 shrink-0 items-center px-2 text-chat-meta text-fg-tertiary">Thread</h2>
      <ul className="flex min-h-0 flex-col gap-0.5 overflow-y-auto scroll-quiet">
        {loose.map((thread) => (
          <li key={thread.id}>
            <ThreadRow thread={thread} people={peopleOf(thread)} on={thread.id === current} now={now} onOpen={() => open(thread)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * 「전체 | 내 차례」 마디(보드 `.seg`) — 검색 칸 아래에 선다. 「내 차례」 칸에 기다리는 Thread 수가 파란 배지로 선다(보드 `.cnt` — DS `link`).
 * 수는 고른 칸과 상관없이 늘 센다 — 「전체」를 보는 동안에도 몇이 기다리는지가 보여야 거르기를 누를 까닭이 생긴다.
 */
export function ThreadFilter({ filter, onChange }: { filter: ThreadListFilter; onChange: (filter: ThreadListFilter) => void }) {
  const count = useWaiting().length;
  return <FilterSegment filter={filter} count={count} onChange={onChange} />;
}

/**
 * 마디의 그림 — 훅을 부르지 않는다. DS 두 칸 토글(`SegmentGroup` sm — Codex `.at-seg`)을 사이드바 폭으로 편다. 수가 있으면 칸의 이름에
 * 수가 함께 든다(「내 차례 2」) — 배지는 글자가 붙어 읽혀 이름을 따로 적는다.
 */
export function FilterSegment({
  filter,
  count,
  onChange,
}: {
  filter: ThreadListFilter;
  count: number;
  onChange: (filter: ThreadListFilter) => void;
}) {
  return (
    <div className="shrink-0 px-2.5 pb-2">
      <SegmentGroup
        size="sm"
        aria-label="Thread 거르기"
        cells={FILTERS}
        value={[filter]}
        deselectable={false}
        onValueChange={(value) => {
          if (value[0]) onChange(value[0]);
        }}
        className="w-full"
      >
        <SegmentGroupItem value="all">전체</SegmentGroupItem>
        <SegmentGroupItem
          value="mine"
          aria-label={count > 0 ? `내 차례 ${count}` : undefined}
          className="inline-flex items-center justify-center gap-1.5"
        >
          내 차례
          {count > 0 && (
            <span className="inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-link px-1 text-caps-md text-fg-on-solid">
              {count}
            </span>
          )}
        </SegmentGroupItem>
      </SegmentGroup>
    </div>
  );
}

/** 「내 차례만」 — 기다리는 Thread를 기다린 순서로 읽어 그린다. */
function WaitingThreads(props: Omit<Parameters<typeof WaitingList>[0], "waiting">) {
  return <WaitingList waiting={useWaiting()} {...props} />;
}

/**
 * 「내 차례만」의 그림(보드 「내 차례만」 · 「내 차례만 · 비었을 때」) — 「기다리는 순서」 아래에 받은 차례 그대로 Thread 줄이 서고(줄은
 * 「전체」와 같은 `ThreadRow`라 파란 점 · 「승인 · …」 · 기다리기 시작한 때가 따라온다), 비었으면 그렇다는 한 줄이다.
 */
export function WaitingList({
  waiting,
  peopleOf,
  current,
  now,
  onOpen,
}: {
  waiting: readonly Waiting[];
  peopleOf: PeopleOf;
  current: string | null;
  now: number;
  onOpen: (thread: ThreadSummary) => void;
}) {
  return (
    <section aria-label="내 차례" className="flex min-h-0 shrink flex-col pr-2 pb-1.5 pl-2">
      {waiting.length === 0 ? (
        <p className="px-2.5 pt-5 pb-6 text-center text-chat-meta text-fg-tertiary">지금은 나를 기다리는 Thread가 없어요</p>
      ) : (
        <>
          {/* 위 8은 Work 묶음의 첫 소제목과 같은 자리다(`SectionHeader` — 목록 위 2 · 머리 위 6): 「내 차례」에서는 Work 묶음이 없어 이
              소제목이 nav 바로 아래에 선다. */}
          <h2 className="mt-2 flex h-7.5 shrink-0 items-center px-2 text-chat-meta text-fg-tertiary">기다리는 순서</h2>
          <ul className="flex min-h-0 flex-col gap-0.5 overflow-y-auto scroll-quiet">
            {waiting.map(({ thread }) => (
              <li key={thread.id}>
                <ThreadRow
                  thread={thread}
                  people={peopleOf(thread)}
                  on={thread.id === current}
                  now={now}
                  onOpen={() => onOpen(thread)}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * Thread 줄 하나 — 얼굴 · 제목 · 시각, 그 아래 마지막 말. 시각은 마지막 말의 때이고, 말이 아직 없으면 Thread가 선 때다. 상태가 있으면
 * 그 상태의 때(기다리기 시작한 때 · 끝난 때)다.
 */
export function ThreadRow({
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
  const { said, status, ready } = useRowState(thread);
  const moved = useMoved(status?.kind ?? null, ready);
  const title = thread.broken ? "열 수 없는 Thread" : thread.title || "새 Thread";
  // 다른 Agent의 말은 이름을 앞에 단다(보드 「리뷰어 · 수정 요청 2건」). Host와 사람의 말은 그대로다.
  const lastWords = said ? (said.name && said.who !== "host" ? `${said.name} · ${said.text}` : said.text) : "";
  const preview = thread.broken ?? (status && "text" in status && status.text !== null ? status.text : lastWords);
  const at = status?.kind === "mine" ? status.since : status && "at" in status ? status.at : (said?.at ?? thread.createdAt);
  // 바뀐 상태 칸만 떠오른다 — 열쇠가 상태라 바뀔 때마다 그 칸이 새로 선다.
  const slot = status?.kind ?? "quiet";
  return (
    <button
      type="button"
      aria-current={on ? "page" : undefined}
      data-status={status?.kind}
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
        <span className="relative flex shrink-0">
          <ThreadFaces people={people} faceClass="size-8" pairClass="size-8" pairFaceClass="size-5" ringClass="ring-surface-shell" />
          {status?.kind === "mine" && (
            <span
              role="img"
              aria-label="내 차례"
              className={cn(
                "absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-accent-solid ring-2 ring-surface-shell",
                moved && "dot-pop",
              )}
            />
          )}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-nav-row",
              thread.broken && "text-fg-tertiary",
              status?.kind === "new" && "font-semibold",
            )}
          >
            {title}
            {status?.kind === "new" && <span className="sr-only"> · 새 결과</span>}
          </span>
          <span key={slot} className={cn("flex h-4.5 shrink-0 items-center text-xs text-fg-tertiary", moved && "slot-in")}>
            {status?.kind === "working" ? (
              <Spinner role="img" aria-label="작업 중" className="size-3 text-fg-secondary" />
            ) : (
              since(at, now)
            )}
          </span>
        </span>
        {/* 둘째 줄은 비어도 자리를 지킨다 — 상태가 글을 더해도 아래 줄들이 움직이지 않는다. */}
        <span
          key={slot}
          className={cn(
            "h-4.5 truncate text-chat-meta",
            status?.kind === "mine" ? "text-fg" : "text-fg-tertiary",
            moved && "slot-in",
          )}
        >
          {status?.kind === "failed" && (
            <>
              <span className="text-danger">실패</span>
              {" · "}
            </>
          )}
          {preview}
        </span>
      </span>
    </button>
  );
}

/**
 * 줄의 마지막 말과 상태 — Thread를 열 때와 같은 읽기(`threadQuery` — 살아 있음 · 기록 끝을 읽고 기록을 스토어에 합친다)로 서고, 그
 * 뒤는 기록 줄 이벤트가 잇는다. 깨진 Thread는 읽지 않는다. 읽기가 실패하면 말도 상태도 없이 제목과 시각만 선다 — 줄은 열어서 고칠 수
 * 있다. `ready`는 그 읽기가 끝났나다(그 전의 빈 상태는 상태가 바뀐 것이 아니다).
 */
function useRowState(thread: ThreadSummary): { said: ReturnType<typeof lastSaid>; status: ThreadStatus | null; ready: boolean } {
  const { data: view } = useQuery({ ...threadQuery(thread.id), enabled: thread.broken === null });
  const lines = useStore(threadRecordStore, (state) => linesOf(state, thread.id));
  const said = useMemo(() => lastSaid(lines), [lines]);
  const status = useMemo(
    () => (view ? statusOf(lines, seenOf(view, thread.lastRead)) : null),
    [lines, view, thread.lastRead],
  );
  return { said, status, ready: view !== undefined };
}

/**
 * 상태가 바뀌었나 — 처음 그린 상태(앱을 켜고 줄을 그릴 때)는 움직이지 않고, 읽기가 끝난 뒤 상태가 바뀐 줄부터 움직인다(Motion 보드
 * 「움직임은 상태가 바뀐 그 자리에서만」). 한 번 바뀐 줄은 그 뒤로도 바뀔 때마다 움직인다 — 칸이 상태를 열쇠로 새로 서므로.
 */
function useMoved(kind: string | null, ready: boolean): boolean {
  const seen = useRef<{ kind: string | null } | null>(null);
  const [moved, setMoved] = useState(false);
  useEffect(() => {
    if (!ready) return;
    if (seen.current !== null && seen.current.kind !== kind) setMoved(true);
    seen.current = { kind };
  }, [kind, ready]);
  return moved;
}

export default SidebarThreads;
