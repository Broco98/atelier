/// <reference types="node" />
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { OUTCOME_LABEL, REASON_LABEL, eventKey, eventKeys, eventLabel, loggedAt, targetLabel } from "./cleanup-log";
import type { CleanupEvent, CleanupTarget } from "./types";

// 프로세스 티켓 32 — **정리 기록을 사람 말로**(프로세스 결정 6 · 프로세스 스펙 S12). 앱이 무엇을 언제 왜 끝냈는지가 `Processes`의
// 맨 끝 묶음에 선다: 사건마다 까닭과 대상 수(와 때), 펼치면 대상마다 이름 · 명령줄 · 결과. 여기는 기록 한 줄 → 화면의 말이다. 화면에
// 최근 것부터 서고 펼쳐지는지는 L3가 잰다(`processes-shells.spec.ts`).

const 대상 = (pid: number, name: string, outcome: CleanupTarget["outcome"], command: string | null = null): CleanupTarget => ({
  pid,
  name,
  command,
  outcome,
});

const 사건 = (over: Partial<CleanupEvent> = {}): CleanupEvent => ({
  id: 3,
  at: new Date(2026, 8, 27, 14, 3).getTime(),
  reason: "shellClose",
  shellKey: "1790-4",
  owner: "atelier:plain-work",
  targets: [대상(200, "node", "ended", "node vite --port 5173"), 대상(210, "esbuild", "forced")],
  ...over,
});

describe("까닭과 결과의 말", () => {
  // 까닭은 프로세스 결정 6 · 스펙 S5의 낱말이다. 「손으로」는 [끝내기] · [정리]의 까닭이라 「손으로 끝냄」으로 풀어 적는다 — 줄의 머리에
  // 「손으로」만 서면 무엇을 손으로 했는지가 비는 말이다.
  it("까닭마다 사람 말이 있다", () => {
    expect(REASON_LABEL).toEqual({
      shellClose: "셸 닫기",
      shellExit: "셸 스스로 끝남",
      appExit: "앱 종료",
      reload: "새로고침",
      archive: "아카이브",
      mcpArchive: "MCP 아카이브",
      startupCleanup: "시작 정리",
      manual: "손으로 끝냄",
    });
  });

  it("결과마다 사람 말이 있다", () => {
    expect(OUTCOME_LABEL).toEqual({ ended: "끝남", forced: "강제로 끝남", survived: "못 끝냄", gone: "이미 없음" });
  });

  // 까닭 글자는 **두 언어가 문자열로만** 잇는다(Rust `cleanup_log::Reason`의 serde camelCase). Rust에 까닭이 늘었는데 여기 말이 없으면
  // 그 줄의 머리가 비거나 영어 글자로 선다 — 그래서 그 선언을 읽어 견준다. 못 찾으면 던진다(fail-closed).
  it("Rust가 적는 까닭이 모두 여기 있다", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../../src-tauri/src/processes/cleanup_log.rs", import.meta.url)),
      "utf8",
    );
    const body = /pub enum Reason \{([\s\S]*?)\n\}/.exec(source)?.[1];
    if (!body) throw new Error("cleanup_log.rs에서 Reason 선언을 못 찾았다");
    const variants = [...body.matchAll(/^\s{4}([A-Z]\w*),$/gm)].map((m) => m[1][0].toLowerCase() + m[1].slice(1));
    expect(variants.length).toBeGreaterThan(0);
    expect(Object.keys(REASON_LABEL).sort()).toEqual([...variants].sort());
  });

  // 뒤 판의 앱이 쓴 기록을 앞 판이 읽는 날(두 빌드가 같은 데이터 루트를 쓴다) 모르는 까닭이 온다 — 빈 머리보다 그 글자가 낫다.
  it("모르는 까닭은 그 글자 그대로 선다", () => {
    expect(eventLabel(사건({ reason: "renamed" as CleanupEvent["reason"] }))).toMatch(/^renamed, /);
  });
});

describe("사건 한 줄 — 까닭, 대상 수, 때", () => {
  // 때는 그 사건의 끝내기가 **끝난** 때다(Rust `Event.at`). 이 화면의 다른 경과(「조용함 2h」)와 달리 「언제」를 묻는 자리라 시계의
  // 시각으로 적는다 — 새로 읽을 때마다 늙는 상대 시간은 기록의 말이 아니다.
  it("때는 월 · 일 · 시 · 분이다", () => {
    expect(loggedAt(new Date(2026, 8, 27, 14, 3).getTime())).toBe("9월 27일 14:03");
    expect(loggedAt(new Date(2026, 0, 5, 9, 0).getTime())).toBe("1월 5일 09:00");
  });

  it("까닭 · 대상 수 · 때를 한 문장으로 잇는다", () => {
    expect(eventLabel(사건())).toBe("셸 닫기, 프로세스 2개, 9월 27일 14:03");
    expect(eventLabel(사건({ reason: "startupCleanup", targets: [대상(1, "node", "ended")] }))).toBe(
      "시작 정리, 프로세스 1개, 9월 27일 14:03",
    );
  });

  // 번호는 파일 안에서 오르기만 한다(티켓 29). 번호가 없던 판의 줄은 모두 0이라 때와 함께 짓는다.
  it("줄의 열쇠는 번호와 때다 — 번호 없는 옛 줄끼리도 갈린다", () => {
    expect(eventKey(사건({ id: 0, at: 1 }))).not.toBe(eventKey(사건({ id: 0, at: 2 })));
    expect(eventKey(사건({ id: 7 }))).not.toBe(eventKey(사건({ id: 8 })));
  });

  // **펼침은 사건에 붙는다**(코드 리뷰 스펙 5) — 기록은 새 사건을 맨 앞에 넣는다. 목록 안 자리를 열쇠에 넣으면 새 사건 하나에 모든
  // 열쇠가 밀려 펼쳐 둔 사건이 다음 박자에 접힌다.
  it("목록의 열쇠는 새 사건이 맨 앞에 붙어도 옛 사건의 것이 그대로다", () => {
    const before = [사건({ id: 3, at: 30 }), 사건({ id: 2, at: 20 }), 사건({ id: 0, at: 5 }), 사건({ id: 0, at: 5 })];
    const after = [사건({ id: 4, at: 40 }), ...before];
    expect(eventKeys(after).slice(1)).toEqual(eventKeys(before));
  });

  // 번호 없는 옛 줄이 같은 ms에 둘이면 번호와 때가 다 같다 — 그때만 겹침 차례를 붙여 가른다. 겹치지 않는 열쇠는 `eventKey` 그대로다.
  it("겹치는 열쇠에만 겹침 차례를 붙인다", () => {
    const keys = eventKeys([사건({ id: 3, at: 30 }), 사건({ id: 0, at: 5 }), 사건({ id: 0, at: 5 }), 사건({ id: 0, at: 5 })]);
    expect(keys).toEqual([eventKey(사건({ id: 3, at: 30 })), "0@5", "0@5#1", "0@5#2"]);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("펼친 대상 한 줄", () => {
  it("이름과 결과를 잇는다 — 명령줄은 따로 선다", () => {
    expect(targetLabel(대상(200, "node", "ended", "node vite"))).toBe("node, 끝남");
    expect(targetLabel(대상(300, "python3", "survived"))).toBe("python3, 못 끝냄");
  });
});
