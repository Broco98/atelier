import { describe, expect, it } from "vitest";
import type { ShellSignal } from "@/components/shell/shell-signal";
import type { StatusMarkKind } from "@/components/shell/status-mark";
import { workMark } from "./work-mark";

// **Work 줄의 상태 표시**(02 구현 스펙 §4 · S8 · 티켓 05) — seam은 순수 함수 `workMark` 하나다: 그 Work에 이은 Thread들이 그리는 표시(`markOf`
// — 멈춤 · 조용함은 `null`)와 그 Work 셸의 화면값을 넣고, Work 줄 오른쪽 끝에 설 표시 하나만 본다. 차례는 내 차례 › 도는 중 › 실패 › 새 결과다.
// 셸 신호는 같은 차례로 접힌다 — 답을 기다리는 셸은 내 차례, 끝났는데 안 본 셸은 새 결과이고, 도는 셸은 표시가 없다(결정.md 「05」).

type Row = [threads: (StatusMarkKind | null)[], shell: ShellSignal | null, mark: StatusMarkKind | null];

describe("Work 줄의 상태 표시", () => {
  it.each<Row>([
    // Thread도 셸도 조용하다
    [[], null, null],
    [[null, null], null, null],
    // Thread들 가운데 가장 센 것
    [["new", "mine", "working"], null, "mine"],
    [["new", "working", "failed"], null, "working"],
    [["new", "failed"], null, "failed"],
    [["new", null], null, "new"],
    // Thread가 조용하면 셸 신호(S8)
    [[], "waiting", "mine"],
    [[null], "waiting", "mine"],
    [[], "done", "new"],
    [[null], "done", "new"],
    [[], "working", null],
    // 두 출처는 한 차례로 접힌다 — 나를 기다리는 셸은 도는 Thread보다 세고, 안 본 셸은 실패보다 약하다
    [["working"], "waiting", "mine"],
    [["failed"], "waiting", "mine"],
    [["failed"], "done", "failed"],
    [["new"], "done", "new"],
    [["working"], "working", "working"],
    [["mine"], "done", "mine"],
  ])("Thread %j · 셸 %s → %s", (threads, shell, mark) => {
    expect(workMark(threads, shell)).toBe(mark);
  });
});
