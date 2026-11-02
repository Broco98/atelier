import { describe, expect, it } from "vitest";
import { endText, expireMarks, LINGER_MS, markOf, NO_MARKS, pressEnd, settleEnd, withEndings, type EndMarks } from "./endings";
import { envReadRow, metricsOf, snapshotFixture } from "./process-fixture";
import { byStart } from "./process-tree";
import type { ProcessIdentity, ProcessRow } from "./types";

// restart 03-10 — **끝내기 결과가 줄에 보인다**(스토리 134 · 시안 ProcessSheet 「끝내기」). [끝내기] · [정리]를 누르면 대상 줄마다 「끝내는 중」이
// 서고, 끝내기 IPC가 대상마다 돌려준 결과(끝남 · 강제로 끝냄 · 못 끝냄 · 이미 없음)가 그 줄에 선다. 결과가 무엇인지는 Rust가 정한다
// (`processes::ending` — 신호 직전 신원 확인 · TERM · 2초 · KILL). 여기서 재는 것은 화면이 그 답을 어느 줄에 어떤 글로 세우는가다.

const vite = envReadRow(4100, 4000, 1_790_000_000_100_000, "vite");
const esbuild = envReadRow(4110, 4100, 1_790_000_000_200_000, "esbuild");
const watcher = envReadRow(4120, 4110, 1_790_000_000_300_000, "watcher");
const sleeper = envReadRow(4200, 4000, 1_790_000_000_400_000, "sleep");

const sheet = snapshotFixture({ verdict: { descendants: { "G-1": [vite, esbuild, watcher, sleeper] } } });

/** 줄마다 동작 칸에 선 글 — 표시가 없는 줄은 `null`. */
const texts = (marks: EndMarks, ids: ProcessIdentity[]) =>
  ids.map((id) => {
    const mark = markOf(marks, id);
    return mark ? endText(mark.state) : null;
  });

const NOW = 1_790_000_100_000;

describe("끝내기 결과가 줄에 보인다", () => {
  it("누른 줄마다 「끝내는 중」이 서고, 답이 오면 대상마다 그 결과가 선다", () => {
    const ids = [vite.id, esbuild.id, watcher.id, sleeper.id];
    const pressed = pressEnd(NO_MARKS, 1, sheet, ids);
    expect(texts(pressed, ids)).toEqual(["끝내는 중", "끝내는 중", "끝내는 중", "끝내는 중"]);

    const settled = settleEnd(
      pressed,
      1,
      [
        { id: vite.id, outcome: "ended" },
        { id: esbuild.id, outcome: "forced" },
        { id: watcher.id, outcome: "survived" },
        { id: sleeper.id, outcome: "gone" },
      ],
      NOW,
    );
    expect(texts(settled, ids)).toEqual(["끝남", "강제로 끝냄", "못 끝냄", "이미 없음"]);
  });

  // 답은 그 끝내기가 맡은 대상만 싣는다 — 진행 중인 끝내기(셸 닫기 · 먼저 누른 [끝내기])가 이미 SIGTERM을 보낸 신원은 빠진다. 그 줄은 표시
  // 없이 돌아오고(결과는 그것을 맡은 끝내기의 것이다), 먼저 누른 끝내기의 줄은 그 끝내기의 답을 기다린다.
  it("답에 없는 줄은 표시 없이 돌아오고, 다른 누름의 줄은 제 답을 기다린다", () => {
    const first = pressEnd(NO_MARKS, 1, sheet, [sleeper.id]);
    const second = pressEnd(first, 2, sheet, [vite.id, esbuild.id]);
    const settled = settleEnd(second, 2, [{ id: vite.id, outcome: "ended" }], NOW);
    expect(texts(settled, [vite.id, esbuild.id, sleeper.id])).toEqual(["끝남", null, "끝내는 중"]);
  });

  // 끝내기 IPC를 못 불렀으면(문제 창이 선다) 그 누름의 줄이 표시 없이 돌아온다 — 끝났는지 모른다.
  it("답을 못 받으면 그 누름의 줄이 표시 없이 돌아온다", () => {
    const pressed = pressEnd(pressEnd(NO_MARKS, 1, sheet, [sleeper.id]), 2, sheet, [vite.id]);
    expect(texts(settleEnd(pressed, 2, null, NOW), [vite.id, sleeper.id])).toEqual([null, "끝내는 중"]);
  });

  // 누른 순간 이미 「끝내는 중」인 줄(부모 줄의 [끝내기]가 맡았다 — 고아 묶음의 [정리]가 그 줄을 함께 싣는다)은 앞 누름의 표시를 그대로
  // 둔다 — 뒤 끝내기의 답에는 그 신원이 없다(이미 SIGTERM을 받았다).
  it("이미 끝내는 중인 줄을 또 실으면 앞 누름의 표시가 남는다", () => {
    const first = pressEnd(NO_MARKS, 1, sheet, [esbuild.id]);
    const second = settleEnd(pressEnd(first, 2, sheet, [vite.id, esbuild.id]), 2, [{ id: vite.id, outcome: "ended" }], NOW);
    const settled = settleEnd(second, 1, [{ id: esbuild.id, outcome: "forced" }], NOW);
    expect(texts(second, [vite.id, esbuild.id])).toEqual(["끝남", "끝내는 중"]);
    expect(texts(settled, [vite.id, esbuild.id])).toEqual(["끝남", "강제로 끝냄"]);
  });
});

describe("결과가 남는 때", () => {
  const settled = settleEnd(
    pressEnd(NO_MARKS, 1, sheet, [vite.id, esbuild.id, watcher.id, sleeper.id]),
    1,
    [
      { id: vite.id, outcome: "ended" },
      { id: esbuild.id, outcome: "forced" },
      { id: watcher.id, outcome: "survived" },
      { id: sleeper.id, outcome: "gone" },
    ],
    NOW,
  );
  const ids = [vite.id, esbuild.id, watcher.id, sleeper.id];
  const later = snapshotFixture({ verdict: { descendants: { "G-1": [watcher] } } });

  // 시안 ProcessSheet 「끝내기」 — 끝남은 「2.4초 뒤 줄이 빠진다」. 강제로 끝냄 · 이미 없음도 끝난(또는 이미 없던) 프로세스라 같다. 못 끝냄은
  // 「줄이 남는다」 — 그 프로세스가 표본에 있는 동안 표시가 남고, 표본에서 빠지면(뒤늦게 끝났다) 함께 빠진다.
  it("끝남 · 강제로 끝냄 · 이미 없음은 2.4초 뒤 빠지고, 못 끝냄은 그 프로세스가 표본에 있는 동안 남는다", () => {
    expect(texts(expireMarks(settled, later, NOW + LINGER_MS - 1), ids)).toEqual(["끝남", "강제로 끝냄", "못 끝냄", "이미 없음"]);
    expect(texts(expireMarks(settled, later, NOW + LINGER_MS), ids)).toEqual([null, null, "못 끝냄", null]);
    expect(texts(expireMarks(settled, snapshotFixture(), NOW + 60_000), ids)).toEqual([null, null, null, null]);
  });

  // 답을 기다리는 줄은 시간이 지나도 남는다 — 끝내기는 최악 2초 남짓이지만 답이 올 때까지가 「끝내는 중」이다. 표본에서 빠져도 남는다.
  it("끝내는 중은 답이 올 때까지 남는다", () => {
    const pressed = pressEnd(NO_MARKS, 1, sheet, [vite.id]);
    expect(texts(expireMarks(pressed, snapshotFixture(), NOW + 60_000), [vite.id])).toEqual(["끝내는 중"]);
  });

  // 표본을 아직 모르면(화면이 닫혀 박자가 멎었다) 못 끝냄을 거두지 않는다 — 산 줄인지 모른다.
  it("표본 없이는 못 끝냄을 거두지 않는다", () => {
    expect(texts(expireMarks(settled, undefined, NOW + 60_000), ids)).toEqual([null, null, "못 끝냄", null]);
  });
});

describe("표본에서 빠진 줄", () => {
  const MiB = 1024 * 1024;
  const alive = { ...watcher, metrics: metricsOf(300 * MiB, 1.2) };
  const settled = settleEnd(
    pressEnd(NO_MARKS, 1, sheet, [vite.id, esbuild.id, watcher.id, sleeper.id]),
    1,
    [
      { id: vite.id, outcome: "ended" },
      { id: esbuild.id, outcome: "forced" },
      { id: watcher.id, outcome: "survived" },
      { id: sleeper.id, outcome: "gone" },
    ],
    NOW,
  );

  /** 묶음의 줄을 시작 순으로 — 이름과 숫자 칸(메모리 · CPU). */
  const rowsOf = (rows: ReadonlyArray<ProcessRow> | undefined) =>
    [...(rows ?? [])].sort(byStart).map((row) => [row.name, row.metrics.memory, row.metrics.cpu]);

  // 끝난 프로세스는 다음 표본에 없다. 결과가 남는 동안 그 줄은 **제자리에** 선다 — 누른 순간의 행을 그 묶음에 다시 넣으니 부모 밑의 깊이도
  // 그대로다. 숫자는 「—」다: 이 표본이 잰 프로세스가 아니고, 숫자를 남기면 줄의 합이 합계와 갈린다(restart 03-6 「합이 맞는다」). 못 끝냄은
  // 표본에 그대로 있는 산 줄이라 이 표본의 숫자다.
  it("결과가 남는 동안 제 묶음의 제자리에 숫자 없이 선다", () => {
    const later = snapshotFixture({ verdict: { descendants: { "G-1": [alive] } } });
    expect(rowsOf(withEndings(later, settled).verdict.descendants["G-1"])).toEqual([
      ["vite", null, null],
      ["esbuild", null, null],
      ["watcher", 300 * MiB, 1.2],
      ["sleep", null, null],
    ]);
  });

  // 고아 묶음의 [정리] · 채팅의 [끝내기]도 같다 — 그 줄이 섰던 묶음(판정의 칸과 열쇠)으로 돌아간다. 셸이 사라져 열쇠가 없어진 묶음도 다시 선다.
  it("고아 · 채팅의 줄도 제 묶음으로 돌아간다", () => {
    const orphan = envReadRow(5100, 1, 1_790_000_000_500_000, "next-server");
    const dev = envReadRow(6100, 1, 1_790_000_000_600_000, "node");
    const shown = snapshotFixture({ verdict: { orphans: { confirmed: { "F-4": [orphan] }, unknown: {} }, chats: { "t-1": [dev] } } });
    const marks = settleEnd(
      pressEnd(NO_MARKS, 1, shown, [orphan.id, dev.id]),
      1,
      [
        { id: orphan.id, outcome: "forced" },
        { id: dev.id, outcome: "ended" },
      ],
      NOW,
    );
    const back = withEndings(snapshotFixture(), marks).verdict;
    expect([rowsOf(back.orphans.confirmed["F-4"]), rowsOf(back.chats["t-1"])]).toEqual([
      [["next-server", null, null]],
      [["node", null, null]],
    ]);
  });

  // 기다리는 동안(답이 아직 안 왔다) SIGTERM에 곧 끝난 줄도 「끝내는 중」으로 제자리에 남는다 — 박자가 답보다 먼저 올 수 있다.
  it("답을 기다리는 동안 빠진 줄도 제자리에 남는다", () => {
    const pressed = pressEnd(NO_MARKS, 1, sheet, [sleeper.id]);
    expect(rowsOf(withEndings(snapshotFixture(), pressed).verdict.descendants["G-1"])).toEqual([["sleep", null, null]]);
  });

  // 표본에 있는 줄은 다시 넣지 않는다 — 한 프로세스가 두 줄로 서지 않는다.
  it("표본에 있는 줄은 두 번 서지 않는다", () => {
    expect(rowsOf(withEndings(sheet, settled).verdict.descendants["G-1"])).toEqual([
      ["vite", null, null],
      ["esbuild", null, null],
      ["watcher", null, null],
      ["sleep", null, null],
    ]);
  });
});
