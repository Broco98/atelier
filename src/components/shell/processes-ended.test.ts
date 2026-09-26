import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { endedNotice, PROCESSES_ENDED_EVENT, type ProcessesEnded } from "./processes-ended";

// 셸이 스스로 끝나며 그 셸에서 띄운 것을 끝냈다는 알림(프로세스 관리 티켓 13 · 프로세스 스펙 S49 · P4). 어느 화면에서든
// 서는 것과 곧 내려가는 것은 L3가(`e2e/processes-ended.spec.ts`), 여기는 **이벤트 → 알릴 말**과 **두 언어를 잇는 이름**을 본다.

const ended = (count: number, shellId = 3, reason = "shellExit"): ProcessesEnded => ({ reason, shellId, count });

describe("셸 스스로 끝남이 알리는 말", () => {
  it("끝낸 수를 말한다", () => {
    expect(endedNotice(ended(2))?.text).toBe("셸이 끝나면서 그 셸에서 띄운 프로세스 2개를 끝냈어요");
    expect(endedNotice(ended(1))?.text).toBe("셸이 끝나면서 그 셸에서 띄운 프로세스 1개를 끝냈어요");
  });

  // 판 01~03에는 [보기]가 없다 — 버튼 없는 짧은 토스트다. [보기]는 판 04(티켓 32)가 붙인다.
  it("버튼이 없는 짧은 토스트다", () => {
    const notice = endedNotice(ended(2));
    expect(notice).not.toBeNull();
    expect(notice && "action" in notice).toBe(false);
  });

  // Rust는 끝낸 것이 없으면 쏘지 않는다(`cleanup_log::ended_count`). 그래도 0이 오면 말하지 않는다 — 「0개를 끝냈어요」는
  // 알릴 것이 아니다.
  it("끝낸 것이 없으면 말하지 않는다", () => {
    expect(endedNotice(ended(0))).toBeNull();
  });

  // 까닭은 정리 기록의 낱말이다. 지금 이 이벤트로 오는 것은 셸 스스로 끝남 하나이고, 모르는 까닭에 이 문구를 붙이면 거짓이다.
  it("셸 스스로 끝남이 아닌 까닭에는 이 말을 붙이지 않는다", () => {
    expect(endedNotice(ended(2, 3, "reload"))).toBeNull();
    expect(endedNotice(ended(2, 3, "shellClose"))).toBeNull();
  });

  // 같은 셸의 알림이 두 번 와도(듣는 자리가 잠깐 둘일 때) 토스트는 하나다 — 매니저는 같은 id를 받으면 그 자리를 고친다.
  // 다른 셸의 알림은 따로 선다.
  it("셸마다 제 id를 단다", () => {
    expect(endedNotice(ended(2, 3))?.id).toBe(endedNotice(ended(5, 3))?.id);
    expect(endedNotice(ended(2, 3))?.id).not.toBe(endedNotice(ended(2, 4))?.id);
  });
});

// 이벤트 이름은 **두 언어가 문자열로만** 잇는다. 어긋나면 셸이 스스로 끝나며 dev 서버를 끝내도 화면은 아무 말이 없다 —
// 사람이 끝내기를 고르지 않은 길이라 무엇이 사라졌는지 알 길이 없어진다. 선례는 종료 요청 이벤트(`quit-request.test.ts`)다.
// 상수를 못 찾으면 던진다(fail-closed).
describe("셸 스스로 끝남 이벤트", () => {
  it("Rust가 쏘는 이름과 프런트가 듣는 이름이 같다", () => {
    const source = readFileSync(fileURLToPath(new URL("../../../src-tauri/src/pty.rs", import.meta.url)), "utf8");
    const declared = /pub const ENDED_EVENT: &str = "([^"]+)";/.exec(source);
    if (!declared) throw new Error("pty.rs에서 ENDED_EVENT 선언을 못 찾았다");
    expect(declared[1]).toBe(PROCESSES_ENDED_EVENT);
  });
});
