import { expect, test } from "./evidence";
import { IPC_RECORD_KEY, type IpcRecord } from "./ipc-record";
import { WORKS } from "./fixtures";
import { installFixtureBackend, markAttention, unknownIpcCalls } from "./harness";

// 판 06 — 셸이 **스스로 말한 것**이 프런트까지 오는 길(#201·#202). 이 판에서 그 값을 화면에
// 세우는 것은 뒤따르는 티켓 넷이라(#203~#206) 여기서 눈으로 볼 것은 아직 없다. 그런데도 이
// 층에 검사가 서는 이유는 **그 넷이 전부 이 손잡이를 딛고 서기 때문**이다 — 손잡이가 조용히
// 아무 데도 안 닿으면 뒤의 검사들이 「값이 안 왔다」와 「화면이 안 그린다」를 구분 못 한 채
// 초록이 되거나 빨개진다.
//
// 재는 것 둘: 구독이 실제로 걸려 있는가(모듈 최상위 구독이 사라지면 여기서 터진다),
// 그리고 손잡이가 전이를 **한 번만** 쏘는가.

const work = WORKS.find((one) => one.worktrees.length === 1) ?? WORKS[0];

/** 이 페이지에서 앱의 콜백이 `shell:attention`으로 몇 번 깨어났나. */
async function watchFires(page: import("./evidence").Page): Promise<void> {
  await page.evaluate(() => {
    const internals = (window as unknown as {
      __TAURI_INTERNALS__: { runCallback: (id: number, data: unknown) => void };
      __atelierFires?: number;
    }).__TAURI_INTERNALS__;
    const original = internals.runCallback.bind(internals);
    (window as unknown as { __atelierFires: number }).__atelierFires = 0;
    internals.runCallback = (id: number, data: unknown) => {
      if ((data as { event?: string })?.event === "shell:attention") {
        (window as unknown as { __atelierFires: number }).__atelierFires += 1;
      }
      original(id, data);
    };
  });
}

const firesOf = (page: import("./evidence").Page) =>
  page.evaluate(() => (window as unknown as { __atelierFires: number }).__atelierFires);

test("셸이 말한 것을 심는 손잡이가 전이를 한 번만 쏜다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${work.slug}?tab=terminal`);

  // **칸이 선 것을 여기서 안 기다린다** — `markAttention`이 spawn **응답**까지 기다린다.
  // 칸이 서는 순간과 그 칸이 pty를 갖는 순간은 다른 순간이라, 칸만 세고 쏘면 값이 조용히
  // 버려진 채로 이 검사가 초록이 된다(`harness.ts`의 `markAttention` 독).
  await watchFires(page);
  await markAttention(page, { agent: "claude", event: "Stop", payload: { last_assistant_message: "커밋할까요?" } });

  // **한 번이다.** 전이를 여러 번 쏘면 「봤다」가 그때마다 풀리고 알림 엣지가 그 수만큼
  // 발화한다 — 「진입당 한 번만 울린다」(결정 10)를 재는 검사가 하네스 때문에 빨개진다.
  expect(await firesOf(page)).toBe(1);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **손잡이가 「닿았다」를 잘못 말하면 뒤의 검사들이 무엇을 재는지 아무도 모른다.** 구독을
// 못 찾았는데 그냥 쏘고 돌아가면 값은 아무 데도 안 닿고, 그 조용함은 화면에서 「전이가
// 아무것도 안 바꿨다」와 구분되지 않는다. 기록에서 구독을 지워 그 길을 실제로 태운다.
test("구독이 없으면 손잡이가 던진다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${work.slug}?tab=terminal`);

  // 걸린 뒤에 지운다 — 지우기 전에 구독이 있었다는 것까지 이 검사가 딛는다.
  await markAttention(page, { agent: "claude", event: "UserPromptSubmit" });
  await page.evaluate((key) => {
    const record = (window as unknown as Record<string, IpcRecord | undefined>)[key];
    if (record) record.calls = record.calls.filter((call) => !call.includes('"shell:attention"'));
  }, IPC_RECORD_KEY);

  const 던진말 = await markAttention(page, { agent: "claude", event: "Stop" }).then(
    () => "던지지 않았다",
    (error: Error) => error.message,
  );
  expect(던진말).toContain("shell:attention 구독이");

  expect(await unknownIpcCalls(page)).toEqual([]);
});
