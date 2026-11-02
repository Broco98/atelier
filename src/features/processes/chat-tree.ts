import { chatName } from "@/features/thread/chat-name";
import type { ThreadSummary } from "@/features/thread/types";
import { sumMetrics } from "./metrics";
import { identityKey, processCount, processLabel, processRowLabel, processTree, withMemory, type ProcessNode } from "./process-tree";
import type { ProcessMetrics, ProcessRow, ProcessSnapshot } from "./types";

// **`Processes`의 「채팅」 구획**(restart 03-7 · 스펙 「03 — Processes」 Runtime · 스토리 126 · 127 · 시안 Processes · ProcessSheet). 판정이
// 채팅마다 묶은 행(`verdict.chats` — 이 실행의 엔진이 띄운 Runtime과 그 자손, Runtime 키로 묶인 dev 서버)을 채팅 줄 → 프로세스 트리로
// 편다. 순수 함수다.
//
// **묶음을 다시 가르지 않는다.** 무엇이 어느 채팅에 드는지, 무엇이 엔진의 몫인지는 판정이 정한다(`verdict.rs`의 `chats` · `runtimes`) —
// 화면은 채팅 목록에서 이름과 차례를 붙여 세울 뿐이다. 트리를 펴는 규칙은 셸의 자손과 같다(`processTree`).

/** 채팅 하나 — 머리 줄(이름 · Runtime 이름과 합)과 그 밑의 트리. */
export interface ChatGroup {
  /** 채팅 id — 판정의 열쇠이고 줄의 접힘 키다. */
  thread: string;
  /** 사이드바 채팅 줄과 같은 이름(`chatName`). */
  name: string;
  /** Runtime 이름(Claude Code · Codex). 그 채팅을 아직 못 읽었으면 `null`이다 — 머리 줄에 안 선다. */
  runtime: string | null;
  nodes: ProcessNode[];
  /** 그 채팅의 행을 더한 것 — 셸 행 · work 행과 같은 규칙(`sumMetrics`). */
  totals: ProcessMetrics;
}

/**
 * **채팅마다** — 채팅 목록(사이드바와 같은 캐시 · 새것이 먼저)의 차례로 서고, 목록에 없는 채팅(목록을 아직 못 읽었다)은 숨기지 않고 끝에
 * 채팅 id 순으로 선다. 행이 없는 채팅은 안 선다 — Runtime이 안 뜬 채팅이 대부분이다. `runtimeOf`는 그 채팅의 Runtime 이름이다(채팅을
 * 읽은 캐시에서 — 목록 요약에는 Runtime이 없다).
 */
export function chatGroups(
  snapshot: ProcessSnapshot,
  threads: ReadonlyArray<ThreadSummary>,
  runtimeOf: (thread: string) => string | null,
): ChatGroup[] {
  const byThread = snapshot.verdict.chats;
  const listed = threads.map((one) => one.id).filter((id) => id in byThread);
  const known = new Set(listed);
  const unlisted = Object.keys(byThread)
    .filter((id) => !known.has(id))
    .sort();
  return [...listed, ...unlisted]
    .map((thread): ChatGroup => {
      const rows = byThread[thread] ?? [];
      return {
        thread,
        name: chatName(threads.find((one) => one.id === thread)),
        runtime: runtimeOf(thread),
        nodes: processTree(rows),
        totals: sumMetrics(rows.map((row) => row.metrics)),
      };
    })
    .filter((group) => group.nodes.length > 0);
}

/** 채팅 줄의 접근성 이름 — 「이름, Runtime, 프로세스 N개, 메모리」 한 문장(S58). 메모리는 그 채팅의 합이다. */
export function chatRowLabel(group: ChatGroup): string {
  const parts = group.runtime === null ? [group.name] : [group.name, group.runtime];
  return withMemory([...parts, processCount(group.nodes.length)], group.totals.memory);
}

/** 엔진의 몫(`verdict.runtimes`)의 신원 글자 — 행과 신원으로 짝짓는다(pid만으로는 재사용을 못 가른다). */
export function engineShareOf(snapshot: ProcessSnapshot): ReadonlySet<string> {
  return new Set(snapshot.verdict.runtimes.map(identityKey));
}

/**
 * **[끝내기]가 서는 줄인가** — 엔진의 몫(Runtime과 그 프로세스 그룹 — MCP · Codex의 app-server)이 아닌 줄이다. 엔진이 채팅을 닫거나 앱을
 * 끌 때 그 몫을 그룹째 끝내므로 화면이 따로 안 끝낸다(스펙 「03 — Processes」 · 시안 Processes — dev 서버 줄에만 [끝내기]).
 */
export function endableIn(share: ReadonlySet<string>, row: ProcessRow): boolean {
  return !share.has(identityKey(row.id));
}

/**
 * **꼬리표 「Runtime」이 서는 줄인가** — 엔진의 몫의 맨 위 줄이다. 몫의 나머지(MCP · app-server)는 Runtime이 띄워 그 밑에 선다(시안
 * Processes — 꼬리표는 claude · codex-acp 줄에만).
 */
export function isRuntimeNode(share: ReadonlySet<string>, node: ProcessNode): boolean {
  return node.depth === 1 && share.has(identityKey(node.row.id));
}

/**
 * 채팅 밑 프로세스 줄의 접근성 이름 — Runtime 줄은 「이름, Runtime, 메모리」, 다른 줄은 셸의 자손 줄과 같은 「이름, 메모리」(S58). 눈으로
 * 꼬리표를 보는 사람과 같은 것을 듣는다 — 그 줄에 [끝내기]가 없는 까닭이다.
 */
export function chatProcessLabel(share: ReadonlySet<string>, node: ProcessNode): string {
  return isRuntimeNode(share, node)
    ? withMemory([processLabel(node.row), "Runtime"], node.row.metrics.memory)
    : processRowLabel(node.row);
}
