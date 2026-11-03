import { describe, expect, it } from "vitest";
import { chatGroups, chatProcessLabel, chatRowLabel, endableIn, engineShareOf, isRuntimeNode } from "./chat-tree";
import { formatMemory } from "./metrics";
import { identityOf, metricsOf as 지표, pidNamedRow as 행, snapshotFixture } from "./process-fixture";
import type { ProcessNode } from "./process-tree";
import type { ProcessIdentity, ProcessRow } from "./types";
import type { ThreadSummary } from "@/features/thread/types";

// restart 03-7 — **「채팅」 구획**(스펙 「03 — Processes」 Runtime · 스토리 126 · 127 · 시안 Processes · ProcessSheet). 판정이 채팅마다 묶은
// 행(`verdict.chats`)을 채팅 줄 → 프로세스 트리로 세우고, 엔진의 몫(`verdict.runtimes`)에는 [끝내기]를 안 세운다. 순수 함수다 — 무엇이
// 어느 채팅에 드는지는 판정이 정하고(`verdict.rs`), 화면은 그 묶음을 이름 붙여 편다.

const MiB = 1024 * 1024;

const 채팅 = (id: string, title: string, over: Partial<ThreadSummary> = {}): ThreadSummary => ({
  id,
  title,
  createdAt: "2026-10-10T10:00:00Z",
  lastAt: "2026-10-10T10:00:00Z",
  service: null,
  project: null,
  work: null,
  lastRead: 0,
  readOnly: null,
  broken: null,
  ...over,
});

/** 채팅 묶음과 엔진의 몫만 선 스냅샷. */
const 스냅샷 = (chats: Record<string, ProcessRow[]>, runtimes: ProcessIdentity[] = []) =>
  snapshotFixture({ verdict: { chats, runtimes } });

const 펼침 = (nodes: ReadonlyArray<ProcessNode>) => nodes.map(({ row, depth }) => [row.id.pid, depth]);

/** Runtime(앱의 자식 — 그 그룹의 머리), 그 그룹의 MCP, Runtime이 띄운 dev 서버, 부모가 먼저 죽어 Runtime 키로 묶인 dev 서버. */
const claude = 행(401, 400, 4_010, { metrics: 지표(600 * MiB, 3) });
const mcp = 행(402, 401, 4_020, { metrics: 지표(88 * MiB, 0.5) });
const vitest = 행(403, 401, 4_030, { metrics: 지표(400 * MiB, 2, [51204]) });
const 떠난_dev = 행(405, 1, 4_050, { metrics: 지표(100 * MiB, null, [3000]) });
const codexAcp = 행(410, 400, 4_100, { metrics: 지표(46 * MiB, 0.1) });
const appServer = 행(411, 410, 4_110, { metrics: 지표(210 * MiB, 0.9) });

describe("채팅 줄", () => {
  // 시안 Processes — 채팅 줄 밑에 Runtime이 서고, 그 밑에 Runtime이 띄운 것이 선다. 부모가 먼저 죽은 dev 서버도 그 채팅 밑의 맨 위다.
  it("채팅마다 그 Runtime과 Runtime이 띄운 것이 한 트리로 서고, 합은 그 줄들의 합이다", () => {
    const groups = chatGroups(
      스냅샷({ T1: [claude, mcp, vitest, 떠난_dev], T2: [codexAcp, appServer] }),
      [채팅("T2", "배너 문구 리뷰"), 채팅("T1", "실패 신호 구현")],
      (thread) => (thread === "T1" ? "Claude Code" : "Codex"),
    );
    expect(groups.map((one) => [one.thread, one.name, one.runtime])).toEqual([
      ["T2", "배너 문구 리뷰", "Codex"],
      ["T1", "실패 신호 구현", "Claude Code"],
    ]);
    expect(펼침(groups[1].nodes)).toEqual([
      [401, 1],
      [402, 2],
      [403, 2],
      [405, 1],
    ]);
    expect(groups[1].totals).toEqual(지표(1188 * MiB, 5.5, [3000, 51204]));
    expect(펼침(groups[0].nodes)).toEqual([
      [410, 1],
      [411, 2],
    ]);
  });

  // 채팅 목록(사이드바와 같은 캐시)이 차례와 이름을 준다. 목록에 없는 채팅(목록을 아직 못 읽었다)의 묶음도 숨기지 않는다 — 끝에 「채팅」으로
  // 선다. 이름 없는 채팅 · 깨진 채팅은 사이드바 줄과 같은 말이다.
  it("차례와 이름은 채팅 목록의 것이고, 목록에 없는 채팅은 끝에 「채팅」으로 선다", () => {
    const groups = chatGroups(
      스냅샷({ T9: [행(490, 400, 4_900)], T3: [행(430, 400, 4_300)], T1: [claude], T2: [codexAcp] }),
      [채팅("T1", ""), 채팅("T2", "", { broken: "읽을 수 없음" }), 채팅("T3", "리뷰")],
      () => null,
    );
    expect(groups.map((one) => [one.thread, one.name, one.runtime])).toEqual([
      ["T1", "새 채팅", null],
      ["T2", "열 수 없는 채팅", null],
      ["T3", "리뷰", null],
      ["T9", "채팅", null],
    ]);
  });

  // 판정이 행을 안 실은 채팅(빈 칸)은 안 선다 — 채팅 목록에 있다고 줄이 서지 않는다. Runtime이 안 뜬 채팅이 대부분이다.
  it("행이 없는 채팅은 안 선다", () => {
    expect(chatGroups(스냅샷({ T1: [] }), [채팅("T1", "리뷰"), 채팅("T2", "다른 것")], () => null)).toEqual([]);
  });

  // S58 — 줄의 접근성 이름은 한 문장이다: 이름, Runtime, 프로세스 수, 메모리(그 채팅의 합).
  it("접근성 이름은 「이름, Runtime, 프로세스 N개, 메모리」", () => {
    const [group] = chatGroups(스냅샷({ T1: [claude, mcp] }), [채팅("T1", "실패 신호 구현")], () => "Claude Code");
    expect(chatRowLabel(group)).toBe(`실패 신호 구현, Claude Code, 프로세스 2개, ${formatMemory(688 * MiB)}`);
    const [unread] = chatGroups(스냅샷({ T1: [행(401, 400, 4_010)] }), [], () => null);
    expect(chatRowLabel(unread)).toBe("채팅, 프로세스 1개");
  });
});

describe("엔진의 몫", () => {
  // 스펙 「03 — Processes」 — 엔진이 채팅을 닫거나 앱을 끌 때 Runtime 그룹째 끝낸다. 그 몫(Runtime · MCP · app-server)에는 [끝내기]가 없고,
  // Runtime이 띄운 dev 서버(제 그룹)와 부모가 먼저 죽은 dev 서버에는 있다(시안 Processes — vitest만 [끝내기]).
  it("엔진의 몫에는 [끝내기]가 없고, Runtime이 띄운 dev 서버에는 있다", () => {
    const snapshot = 스냅샷({ T1: [claude, mcp, vitest, 떠난_dev] }, [claude.id, mcp.id]);
    const share = engineShareOf(snapshot);
    expect([claude, mcp, vitest, 떠난_dev].map((row) => [row.id.pid, endableIn(share, row)])).toEqual([
      [401, false],
      [402, false],
      [403, true],
      [405, true],
    ]);
  });

  // 시안 Processes — 꼬리표 「Runtime」은 Runtime 줄 하나에만 선다(MCP · app-server는 엔진의 몫이어도 꼬리표가 없다). Runtime은 엔진의
  // 몫의 맨 위 줄이다 — 몫의 나머지는 Runtime 밑에 선다.
  it("꼬리표 「Runtime」은 엔진의 몫의 맨 위 줄에만 선다", () => {
    const snapshot = 스냅샷({ T1: [claude, mcp, vitest] }, [claude.id, mcp.id]);
    const [group] = chatGroups(snapshot, [], () => null);
    const share = engineShareOf(snapshot);
    expect(group.nodes.map((node) => [node.row.id.pid, isRuntimeNode(share, node)])).toEqual([
      [401, true],
      [402, false],
      [403, false],
    ]);
  });

  // S58 — Runtime 줄의 접근성 이름에 「Runtime」이 든다: 눈으로 꼬리표를 보는 사람과 같은 것을 듣는다([끝내기]가 없는 까닭이다).
  it("Runtime 줄의 접근성 이름은 「이름, Runtime, 메모리」이고 다른 줄은 「이름, 메모리」다", () => {
    const snapshot = 스냅샷({ T1: [claude, mcp] }, [claude.id, mcp.id]);
    const [group] = chatGroups(snapshot, [], () => null);
    const share = engineShareOf(snapshot);
    expect(group.nodes.map((node) => chatProcessLabel(share, node))).toEqual([
      `p401, Runtime, ${formatMemory(600 * MiB)}`,
      `p402, ${formatMemory(88 * MiB)}`,
    ]);
  });

  // 같은 pid라도 시작 시각이 다르면 남이다(프로세스 결정 3) — 몫은 신원으로 짝짓는다.
  it("몫은 신원으로 짝짓는다 — pid만 같은 행은 몫이 아니다", () => {
    const share = engineShareOf(스냅샷({ T1: [claude] }, [{ pid: 401, startedUs: 9_999 }]));
    expect(endableIn(share, claude)).toBe(true);
    expect(endableIn(engineShareOf(스냅샷({ T1: [claude] }, [identityOf(7)])), claude)).toBe(true);
  });
});
