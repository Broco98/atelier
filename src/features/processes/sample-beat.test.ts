import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { systemNote, unreadNote } from "./breakdown";
import { readSnapshotNow, snapshotQuery } from "./hooks";
import { MEASURED_AT, macOf, snapshotFixture } from "./process-fixture";
import { beatOf, beatText, sampleNote } from "./sample-beat";
import type { ProcessSnapshot } from "./types";

// restart 03-9 — **믿을 수 있는 표시**(스토리 129 ~ 133 · 스펙 「03 — Processes › 믿을 수 있는 표시」 · 시안 ProcessSheet 「표본 상태」).
// 머리가 언제 잰 값인지, 첫 표본을 기다리는지, 값이 멎었는지를 말하고, 멈춤에서 「다시 읽기」가 곧바로 한 번 잰다. 못 읽은 것은 수와 까닭을
// 말한다. 여기서 재는 것은 화면이 받는 것(스냅샷 쿼리의 상태)에서 무엇을 말하나다 — 화면에 실제로 서는지는 시안 비교가 본다.

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", async (original) => ({ ...(await original<typeof import("@tauri-apps/api/core")>()), invoke }));

/** 이 기계의 벽시계로 2026-11-03의 한 순간(에포크 ms). 머리의 시각은 그 기계의 시각으로 읽는다. */
const 시각 = (hours: number, minutes: number, seconds: number, ms = 0) => new Date(2026, 10, 3, hours, minutes, seconds, ms).getTime();

const GiB = 1024 * 1024 * 1024;
/** 14:02:31에 잰 장 — 맥 전체 CPU까지 쟀다. */
const 잰장 = snapshotFixture({ measuredAt: 시각(14, 2, 31), mac: macOf(31.4, 12 * GiB) });
/** 화면을 연 때. */
const 연때 = 시각(14, 2, 20);

/** 스냅샷 쿼리의 상태 — 값이 마지막으로 온 때와 실패가 마지막으로 온 때(react-query의 `dataUpdatedAt` · `errorUpdatedAt`, 없으면 0). */
const 상태 = (data: ProcessSnapshot | undefined, dataUpdatedAt: number, errorUpdatedAt = 0) => ({ data, dataUpdatedAt, errorUpdatedAt });

describe("머리의 표본 상태", () => {
  // **머리에 잰 시각이 선다**(스토리 129) — 이 기계의 시각으로 시 · 분 · 초다. 박자도 함께 말한다(시안 「…에 잰 값 · 2초마다」).
  it("값이 오면 잰 시각을 말한다", () => {
    const beat = beatOf(상태(잰장, 시각(14, 2, 31, 200)), 연때);
    expect(beat).toEqual({ kind: "live", measuredAt: 시각(14, 2, 31) });
    expect(beatText(beat)).toBe("14:02:31에 잰 값 · 2초마다");
    expect(beatText(beatOf(상태(snapshotFixture({ measuredAt: 시각(9, 5, 7) }), 시각(9, 5, 8)), 연때))).toBe("09:05:07에 잰 값 · 2초마다");
  });

  // **첫 표본이 나올 때까지는 재는 중이다**(스토리 130 · 시안 「첫 표본」) — 첫 스냅샷이 오기 전, 그리고 CPU를 두 번 재야 알아 머리가 아직
  // 「—」인 첫 표본. macOS 밖(맥 전체가 없다)은 기다려도 안 오니 잰 시각을 말한다.
  it("첫 스냅샷 전과 첫 표본은 재는 중이다", () => {
    expect(beatText(beatOf(상태(undefined, 0), 연때))).toBe("재는 중");
    const first = snapshotFixture({ measuredAt: 시각(14, 2, 31), mac: macOf(null, 12 * GiB) });
    expect(beatOf(상태(first, 시각(14, 2, 32)), 연때)).toEqual({ kind: "waiting" });
    expect(beatOf(상태(snapshotFixture({ measuredAt: 시각(14, 2, 31) }), 시각(14, 2, 32)), 연때)).toEqual({
      kind: "live",
      measuredAt: 시각(14, 2, 31),
    });
  });

  // **실패한 스냅샷은 6초 넘게 새 값이 없으면 멈춤이다**(스펙 「믿을 수 있는 표시」 · 시안 「멈춤 — 6초 넘게 새 값이 없을 때」). 그 전의 실패는
  // 마지막 값을 그대로 둔다 — 박자 하나 놓친 것을 멈춤이라 하지 않는다. 몇 초째인지는 마지막 값이 온 때에서 마지막 실패까지다.
  it("실패가 6초 넘게 이어지면 멈춤이다 — 그 전에는 마지막 값이 선다", () => {
    const 받은때 = 시각(14, 2, 32);
    expect(beatOf(상태(잰장, 받은때, 받은때 + 5_900), 연때).kind).toBe("live");
    const stalled = beatOf(상태(잰장, 받은때, 받은때 + 6_100), 연때);
    expect(stalled).toEqual({ kind: "stalled", quietMs: 6_100, measuredAt: 시각(14, 2, 31) });
    expect(beatText(stalled)).toBe("6초째 새 값이 없어요");
    expect(beatText(beatOf(상태(잰장, 받은때, 받은때 + 12_050), 연때))).toBe("12초째 새 값이 없어요");
  });

  // 새 값이 실패보다 늦게 왔으면 멈춤이 아니다 — 앞 실패는 지나간 일이다.
  it("새 값이 오면 멈춤이 풀린다", () => {
    expect(beatOf(상태(잰장, 시각(14, 3, 0), 시각(14, 2, 58)), 연때).kind).toBe("live");
  });

  // 값이 한 번도 안 왔으면 화면을 연 때부터 센다 — 첫 스냅샷부터 실패하는 앱도 멈춤을 말한다.
  it("값이 한 번도 없이 실패가 이어지면 화면을 연 때부터 센다", () => {
    expect(beatOf(상태(undefined, 0, 연때 + 4_000), 연때)).toEqual({ kind: "waiting" });
    expect(beatOf(상태(undefined, 0, 연때 + 8_000), 연때)).toEqual({ kind: "stalled", quietMs: 8_000, measuredAt: null });
  });
});

describe("안내 띠", () => {
  // **멈춤은 무엇이 멎었고 아래 숫자가 언제 것인지 말하고, 다시 읽기를 낸다**(스토리 131 · 132 · 시안 「멈춤」).
  it("멈춤은 아래 숫자의 잰 시각과 다시 읽기를 낸다", () => {
    const stalled = beatOf(상태(잰장, 시각(14, 2, 32), 시각(14, 2, 40)), 연때);
    expect(sampleNote(stalled, 잰장)).toEqual({
      text: "앱이 프로세스 표를 읽지 못하고 있어요. 아래 숫자는 14:02:31에 잰 값이에요.",
      retry: true,
    });
    const never = beatOf(상태(undefined, 0, 연때 + 8_000), 연때);
    expect(sampleNote(never, undefined)).toEqual({ text: "앱이 프로세스 표를 읽지 못하고 있어요.", retry: true });
  });

  // **못 읽은 것이 남아 있으면 수와 까닭을 말한다**(스토리 133 · 시안 「일부 못 읽음」). 권한 없음처럼 박자마다 남는 까닭이 있을 때만 띠가
  // 선다 — 그사이 끝난 것만이면 띠를 안 세운다: 같은 uid의 프로세스는 늘 뜨고 지므로 그것만으로 띠가 박자마다 섰다 졌다 하면 아래 줄이
  // 그만큼 오르내려 누르려던 줄 대신 다른 줄을 누른다. 그때의 수는 시스템 · 못 읽음 줄이 말한다(아래).
  it("권한 없음처럼 남는 까닭이 있으면 수와 까닭을 띠에 말한다", () => {
    const live = beatOf(상태(잰장, 시각(14, 2, 32)), 연때);
    const partial = { ...잰장, unread: { denied: 2, gone: 1, other: 0 } };
    expect(sampleNote(live, partial)).toEqual({
      text: "3개를 읽지 못했어요 · 권한 없음 2, 그사이 끝남 1. 그 몫은 「시스템 · 못 읽음」에 들어 있어요.",
      retry: false,
    });
    expect(sampleNote(live, { ...잰장, unread: { denied: 0, gone: 0, other: 1 } })?.text).toBe(
      "1개를 읽지 못했어요 · 그 밖 1. 그 몫은 「시스템 · 못 읽음」에 들어 있어요.",
    );
    expect(sampleNote(live, { ...잰장, unread: { denied: 0, gone: 4, other: 0 } }), "그사이 끝난 것만으로 띠가 섰다").toBeNull();
    expect(sampleNote(live, 잰장), "다 읽었는데 띠가 섰다").toBeNull();
  });

  // 멈춤이 못 읽음보다 먼저다 — 띠는 하나다.
  it("멈춤과 못 읽음이 겹치면 멈춤을 말한다", () => {
    const stalled = beatOf(상태(잰장, 시각(14, 2, 32), 시각(14, 2, 40)), 연때);
    expect(sampleNote(stalled, { ...잰장, unread: { denied: 2, gone: 0, other: 0 } })?.retry).toBe(true);
  });
});

describe("시스템 · 못 읽음 줄의 못 읽은 수", () => {
  // **못 읽은 수는 그 몫이 든 줄이 늘 말한다**(시안 「일부 못 읽음」 — 「읽지 못한 3개 포함 · 측정값에서 읽은 것을 뺀 몫」). 까닭까지 적은
  // 글은 그 줄의 툴팁이다(`unreadNote`) — 그사이 끝난 것만이라 띠가 안 선 장에서도 까닭을 본다.
  it("못 읽은 수를 줄의 말에 넣고, 까닭은 글로 따로 낸다", () => {
    const partial = { ...잰장, unread: { denied: 0, gone: 3, other: 0 } };
    expect(systemNote(partial)).toBe("읽지 못한 3개 포함 · 측정값에서 읽은 것을 뺀 몫");
    expect(unreadNote(partial)).toBe("3개를 읽지 못했어요 · 그사이 끝남 3. 그 몫은 「시스템 · 못 읽음」에 들어 있어요.");
    expect(systemNote(잰장)).toBe("측정값에서 읽은 것을 뺀 몫");
    expect(unreadNote(잰장)).toBeNull();
  });
});

describe("다시 읽기", () => {
  // **누르면 곧바로 한 번 잰다**(스토리 132 · AC) — 박자(2초)를 기다리지 않고 스냅샷을 한 번 묻는다. 실패하면 멈춤이 남고, 값이 오면 풀린다.
  // 재는 것은 IPC에 간 물음과 쿼리의 상태에서 읽은 머리다.
  it("누르면 곧바로 한 번 재고, 실패하면 멈춤이 남고, 값이 오면 풀린다", async () => {
    const client = new QueryClient();
    const 연지 = Date.now() - 7_000;
    invoke.mockRejectedValue("프로세스 스냅샷을 찍지 못했습니다");
    await client.fetchQuery(snapshotQuery).catch(() => undefined);
    const 머리 = () => beatOf(client.getQueryState(snapshotQuery.queryKey)!, 연지);
    expect(머리().kind, "화면을 연 지 7초 동안 실패만 왔다").toBe("stalled");

    invoke.mockClear();
    const pressed = readSnapshotNow(client);
    expect(invoke.mock.calls, "누른 그 자리에서 스냅샷을 한 번 묻지 않았다").toEqual([["processes_snapshot"]]);
    await pressed;
    expect(머리().kind, "다시 읽기가 실패했는데 멈춤이 풀렸다").toBe("stalled");

    invoke.mockClear();
    invoke.mockResolvedValue(snapshotFixture());
    await readSnapshotNow(client);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(머리()).toEqual({ kind: "live", measuredAt: MEASURED_AT });
  });
});
