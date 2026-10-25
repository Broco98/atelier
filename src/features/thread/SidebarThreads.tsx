import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { threadIdOf } from "@/lib/path-prefix";
import { SIDEBAR_AFTER_SECTION, SIDEBAR_HEADING, SIDEBAR_ROW_SHAPE, SIDEBAR_ROWS, sidebarRowTone } from "@/components/shell/sidebar-look";
import { StatusMark } from "@/components/shell/status-mark";
import { cn } from "@/lib/utils";
import { threadRowKey } from "@/features/works/work-sections";
import { useChanged } from "./arrival";
import { threadQuery, useThreads, useWaiting } from "./hooks";
import { markOf, seenOf, statusOf } from "./status";
import { linesOf, threadRecordStore } from "./thread-store";
import type { ThreadSummary } from "./types";
import type { Waiting } from "./waiting";

// 사이드바의 Thread 묶음(v1 티켓 05 · 07 · 02 티켓 05 · 캔버스 Diff-Frame 「제안」) — Work 없는 Thread들이 새것부터 **제목 한 줄씩** 선다(Codex
// 「최근」). 목록은 엔진의 요약 이벤트가 고친다(`useThreadFeeds`) — 다시 읽지 않는다.
// - **얼굴 · 시각 · 미리보기 · 둘째 줄을 걷었다**(02 구현 스펙 §4). v1은 받은편지함처럼 두 줄(얼굴 · 제목 · 시각 / 마지막 말)이었다 — 누가
//   무엇을 말했는지는 Thread 화면이 말하고, 목록은 촘촘하고 조용하다. 다른 Agent의 이름 앞붙이도 미리보기와 함께 걷혔다.
// - **상태는 줄 오른쪽 끝의 표시 하나다**(v1 티켓 41 · 02 구현 스펙 §4 · S11, 계산은 `status.ts`의 `statusOf` · `markOf`, 그림은
//   `components/shell/status-mark`의 `StatusMark`) — 내 차례 알약 · 도는 중 스피너 · 「실패」 글자 · 새 결과 파란 점이고, 멈춤은 표시가
//   없다. 상태를 고르는 차례는 그대로이고 그리는 법만 바뀌었다 — v1의 얼굴 옆 점 · 시각 자리의 스피너 · 미리보기 앞 「실패」 · 굵은 제목이
//   모두 이 하나로 모였다. **줄은 자리를 지키고 상태 칸만 바뀐다**(Motion 보드 「목록 상태 바뀜」) — 바뀐 표시만 떠오른다.
// - 상태의 바탕은 Thread를 열 때와 같은 읽기다(`threadQuery` — `get`의 살아 있음 · 기록 끝, 그리고 기록) — 열린 캐시를 Thread 화면과
//   함께 쓴다. 읽은 자리(`lastRead`)는 요약의 것이다: Thread 화면이 맨 아래를 보면 적고(S38), 요약 이벤트가 이 줄을 고친다.
// - 깨진 Thread도 줄이 선다(「열 수 없는 Thread」 — 무엇이 깨졌는지는 열면 말한다) — 목록에서 조용히 빠지면 「내 Thread가 어디 갔지」에
//   답할 자리가 없다.
// - **「내 차례」 거르기**(v1 티켓 42 · 구현 스펙 §17 · 스토리 131 · 보드 「내 차례만」 · 02 구현 스펙 §4) — 사이드바 위 줄의 「내 차례」 행을
//   켜면 Work 묶음과 이 묶음 대신 나를 기다리는 Thread만 「기다리는 순서」로 선다(Work에 이은 Thread도 섞인다). 차례 · 수는 `waiting.ts`가
//   세고, 행은 `components/shell/sidebar-item.tsx`의 `MineRow`, 켠 상태는 사이드바가 쥔다. 한때 사이드바 맨 위의 「전체 | 내 차례」 마디였다
//   (02 티켓 04가 걷었다 — Codex 사이드바 위에는 머리가 없다).
// - **Work에 이은 Thread는 Work 묶음이 품는다**(v1 티켓 37 · 구현 스펙 §13 · 02 S10) — 그 Work 줄을 펴면 그 아래에 같은 `ThreadRow`가 들여
//   선다(`WorkThreads`). 이 묶음에는 Work 없는 Thread만 남아 두 묶음이 겹치지 않는다.

/** Thread 묶음이 무엇을 세우나 — 전체(Work 묶음 · Thread 묶음) 또는 나를 기다리는 Thread만. */
export type ThreadListFilter = "all" | "mine";

// 소제목과 줄 목록의 꼴 — 「Thread」와 「기다리는 순서」가 한 벌이고, 리듬은 사이드바 줄 한 벌(`sidebar-look` — Work 묶음과 같다)이다.
// 위 사이는 놓인 자리가 고른다.
const HEADING = cn(SIDEBAR_HEADING, "text-sm text-fg-tertiary");
const ROWS = cn(SIDEBAR_ROWS, "min-h-0 overflow-y-auto scroll-quiet");

function SidebarThreads({ filter }: { filter: ThreadListFilter }) {
  const { data: threads = [] } = useThreads();
  const { current, open } = useRowKit();
  if (filter === "mine") return <WaitingThreads current={current} onOpen={open} />;
  const loose = threads.filter((thread) => thread.work === null);
  if (loose.length === 0) return null;
  return (
    <section aria-label="Thread" className="flex min-h-0 shrink flex-col pr-2 pb-1.5 pl-2">
      {/* 소제목은 Work 묶음의 소제목과 같은 꼴 · 같은 사이다(`WorkSectionList`의 `SectionHeader` — Codex 「최근」). */}
      <h2 className={cn(SIDEBAR_AFTER_SECTION, HEADING)}>Thread</h2>
      <ul className={ROWS}>
        {loose.map((thread) => (
          <li key={thread.id}>
            <ThreadRow thread={thread} on={thread.id === current} onOpen={() => open(thread)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Thread 줄들이 함께 읽는 것 — 지금 보는 Thread(주소)와 누르면 그 Thread로 가기. Thread 묶음 · 「내 차례만」 · Work 아래 줄이 같은 것을 읽는다.
 */
function useRowKit(): { current: string | null; open: (thread: ThreadSummary) => void } {
  const navigate = useNavigate();
  const current = useRouterState({ select: (state) => threadIdOf(state.location.pathname) });
  const open = (thread: ThreadSummary) => void navigate({ to: "/threads/$id", params: { id: thread.id } });
  return { current, open };
}

/**
 * 펼친 Work 아래 Thread 줄(v1 티켓 37) — 그 Work에 이은 Thread를 받은 차례로 그린다. Work 목록(`SidebarWorkList`)이 펼친 Work마다 부른다.
 * `stop`은 Work 목록 상자의 Tab 정류장 키다 — 이 줄들도 그 목록의 ↑↓ 안에 든다.
 */
export function WorkThreads({ threads, stop }: { threads: readonly ThreadSummary[]; stop: string | null }) {
  const { current, open } = useRowKit();
  return <WorkThreadList threads={threads} current={current} stop={stop} onOpen={open} />;
}

/**
 * Work 아래 Thread 줄들(02 S10) — 줄은 Thread 묶음과 같은 `ThreadRow`라 상태 표시가 따라오고, 제목만 들여 선다(`nested`).
 */
export function WorkThreadList({
  threads,
  current,
  stop,
  onOpen,
}: {
  threads: readonly ThreadSummary[];
  current: string | null;
  stop: string | null;
  onOpen: (thread: ThreadSummary) => void;
}) {
  return threads.map((thread) => {
    const key = threadRowKey(thread.id);
    return (
      <ThreadRow
        key={thread.id}
        thread={thread}
        on={thread.id === current}
        onOpen={() => onOpen(thread)}
        nested
        roving={{ key, stop: key === stop }}
      />
    );
  });
}

/** 「내 차례만」 — 기다리는 Thread를 기다린 순서로 읽어 그린다. */
function WaitingThreads(props: Omit<Parameters<typeof WaitingList>[0], "waiting">) {
  return <WaitingList waiting={useWaiting()} {...props} />;
}

/**
 * 「내 차례만」의 그림(보드 「내 차례만」 · 「내 차례만 · 비었을 때」) — 「기다리는 순서」 아래에 받은 차례 그대로 Thread 줄이 서고(줄은
 * 「전체」와 같은 `ThreadRow`라 「내 차례」 알약이 따라온다), 비었으면 그렇다는 한 줄이다.
 */
export function WaitingList({
  waiting,
  current,
  onOpen,
}: {
  waiting: readonly Waiting[];
  current: string | null;
  onOpen: (thread: ThreadSummary) => void;
}) {
  return (
    <section aria-label="내 차례" className="flex min-h-0 shrink flex-col pr-2 pb-1.5 pl-2">
      {waiting.length === 0 ? (
        <p className="px-2.5 pt-5 pb-6 text-center text-chat-meta text-fg-tertiary">지금은 나를 기다리는 Thread가 없어요</p>
      ) : (
        <>
          {/* 위 12는 Work 묶음의 첫 소제목과 같은 자리다(`WorkSectionList`의 `SectionHeader`): 「내 차례」에서는 Work 묶음이 없어 이
              소제목이 nav 바로 아래에 선다. */}
          <h2 className={cn("mt-3", HEADING)}>기다리는 순서</h2>
          <ul className={ROWS}>
            {waiting.map(({ thread }) => (
              <li key={thread.id}>
                <ThreadRow thread={thread} on={thread.id === current} onOpen={() => onOpen(thread)} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * Thread 줄 하나 — 제목 한 줄과 오른쪽 끝의 상태 표시(02 구현 스펙 §4 · Components 「사이드바 줄」). 줄은 사이드바의 다른 줄과 같은 모양이다 —
 * 30 · 14/400 · 둥글기 `row`, 고른 줄은 투명 면(`selected-row` — 사이드바 갈래). 아이콘이 없어 제목이 줄 안쪽 8에서 시작한다(Codex 「최근」).
 */
export function ThreadRow({
  thread,
  on,
  onOpen,
  nested = false,
  roving,
}: {
  thread: ThreadSummary;
  on: boolean;
  onOpen: () => void;
  /**
   * 펼친 Work 아래 줄이다(02 S10) — 면은 줄 폭 그대로 두고 제목만 줄 안쪽 46에서 시작한다(시안 `.row.sub` · 구현 스펙 「글자 x 46」).
   * Work 줄의 제목(안쪽 32)보다 한 단 들어가 그 Work의 Thread로 읽힌다.
   */
  nested?: boolean;
  /**
   * 목록 상자의 Tab 정류장 안의 줄이면 그 키와 정류장인가(roving — `@/lib/roving`). Work 아래 줄이 Work 목록의 ↑↓에 든다. 없으면 줄마다
   * Tab이 앉는다(Thread 묶음).
   */
  roving?: { key: string; stop: boolean };
}) {
  const { status, ready } = useRowState(thread);
  const mark = markOf(status);
  // 상태가 바뀌었나 — 처음 그린 상태(앱을 켜고 줄을 그릴 때)는 움직이지 않고, 읽기가 끝난 뒤 상태가 바뀐 줄부터 움직인다(Motion 보드
  // 「움직임은 상태가 바뀐 그 자리에서만」). 한 번 바뀐 줄은 그 뒤로도 바뀔 때마다 움직인다 — 표시가 상태를 열쇠로 새로 서므로. `ready`는
  // 그 읽기가 끝났나다(그 전의 빈 상태는 상태가 바뀐 것이 아니다).
  const moved = useChanged(mark, ready);
  const title = thread.broken ? "열 수 없는 Thread" : thread.title || "새 Thread";
  return (
    <button
      type="button"
      aria-current={on ? "page" : undefined}
      tabIndex={roving === undefined ? undefined : roving.stop ? 0 : -1}
      data-roving={roving?.key}
      data-status={status?.kind}
      onClick={() => {
        if (!on) onOpen();
      }}
      className={cn(
        "flex h-(--size-row-nav) w-full min-w-0 shrink-0 items-center gap-2 pr-2 text-left text-sm transition-colors focus-ring",
        SIDEBAR_ROW_SHAPE,
        nested ? "pl-11.5" : "pl-2",
        sidebarRowTone(on),
      )}
    >
      <span className={cn("min-w-0 flex-1 truncate", thread.broken && "text-fg-tertiary")}>{title}</span>
      {/* 바뀐 표시만 떠오른다 — 열쇠가 표시라 바뀔 때마다 그 칸이 새로 선다. 표시가 없으면 칸도 없다. */}
      {mark !== null && (
        <span key={mark} className={cn("flex shrink-0 items-center", moved && "row-in")}>
          <StatusMark kind={mark} />
        </span>
      )}
    </button>
  );
}

/**
 * 줄의 상태 — Thread를 열 때와 같은 읽기(`threadQuery` — 살아 있음 · 기록 끝을 읽고 기록을 스토어에 합친다)로 서고, 그 뒤는 기록 줄 이벤트가
 * 잇는다. 깨진 Thread는 읽지 않는다. 읽기가 실패하면 상태 없이 제목만 선다 — 줄은 열어서 고칠 수 있다. `ready`는 그 읽기가 끝났나다(그
 * 전의 빈 상태는 상태가 바뀐 것이 아니다).
 */
function useRowState(thread: ThreadSummary) {
  const { data: view } = useQuery({ ...threadQuery(thread.id), enabled: thread.broken === null });
  const lines = useStore(threadRecordStore, (state) => linesOf(state, thread.id));
  const status = useMemo(
    () => (view ? statusOf(lines, seenOf(view, thread.lastRead)) : null),
    [lines, view, thread.lastRead],
  );
  return { status, ready: view !== undefined };
}

export default SidebarThreads;
