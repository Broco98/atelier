import { expect, test, type Page } from "./evidence";
import { WORKS } from "./fixtures";
import {
  fireAttention,
  installFixtureBackend,
  markAttention,
  openShell,
  unknownIpcCalls,
  띠,
  레인,
} from "./harness";

// 프로세스 티켓 20 — **턴을 마친 셸은 「확인할 것」이 되고, 훅이 도구 · 오류 · 서브에이전트를 말한다**(프로세스 결정
// 13 · 14). 전이 하나하나는 L2의 표가 재고(`shell-attention.test.ts`), 여기서는 그 값이 **진짜 스토어 → 띠 · 행 · 탭**
// 까지 가는 길 넷을 본다: 턴의 끝이 띠에 확인할 것으로 서고 보면 꺼지는 것, 오류로 끝난 턴의 말, `/clear`가 아무것도
// 안 세우는 것, 서브에이전트 수가 탭 툴팁에 서는 것.
//
// **보는 셸과 부르는 셸을 가른다.** 켠 칸에 온 확인할 것은 그 순간 「봤다」가 되어(결정 7) 띠에 안 선다 — 그래서
// 칸 둘을 세우고 첫째를 켠 채 **둘째(pty 2)가 말하게** 한다. 「보면 꺼진다」는 그 둘째를 켜는 것으로 잰다.

const [, plainWork] = WORKS;

const 칸들 = (page: Page) => page.locator('[data-tab="shell"]');
/** 칸의 이름 버튼 — 켜짐(`aria-pressed`)과 툴팁(`title`)이 서는 자리다. */
const 이름표 = (page: Page, at: number) => 칸들(page).nth(at).locator("button[aria-pressed]");
const 띠줄 = (page: Page, name: string) => 띠(page).getByRole("button", { name, exact: true });

/** 칸 둘을 세우고 첫째를 켠다. 둘째가 pty 2다(`openShell` 머리말). */
async function 둘째가말할자리(page: Page): Promise<void> {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await expect(칸들(page)).toHaveCount(1);
  await openShell(page);
  await 이름표(page, 0).click();
  await expect(이름표(page, 0)).toHaveAttribute("aria-pressed", "true");
}

// 옛 표에서 `Stop`은 「나를 기다림」이었고 보고 있어도 안 꺼졌다(기다림은 「봤다」로 안 꺼진다). 턴의 끝은 사람이
// 답할 것이 아니라 **아직 안 본 결과**다 — 그래서 확인할 것이고, 그 셸을 보면 꺼진다.
test("턴을 마친 셸은 띠에 확인할 것으로 서고, 그 셸 탭을 보면 꺼진다", async ({ page }) => {
  await 둘째가말할자리(page);

  // **먼저 없음을 센다** — 없으면 아래가 「원래 있던 것」으로도 초록이다.
  await expect(띠(page)).toHaveCount(0);

  await markAttention(
    page,
    { agent: "claude", event: "Stop", at: Date.now(), payload: { last_assistant_message: "다 했어요" }, stopped: true },
    2,
  );
  await expect(띠줄(page, `${plainWork.title} — 확인할 것`)).toHaveCount(1);
  // 「나를 기다림」은 안 선다 — 사람이 답할 것이 없다.
  await expect(띠줄(page, `${plainWork.title} — 나를 기다림`)).toHaveCount(0);

  // 그 셸을 켠다 — 창이 앞에 있고 칸이 켜졌으니 「봤다」다(결정 7).
  await 이름표(page, 1).click();
  await expect(이름표(page, 1)).toHaveAttribute("aria-pressed", "true");
  await expect(띠(page)).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **API 오류로 끝난 턴**(S57). 옛 설치에는 `StopFailure`가 없어 이 턴이 아무것도 안 세웠다 — 사람은 끝난 줄도 모른다.
// 말은 메시지 자리에 서고 색은 없다(terminal-activity-signal 결정 12의 「빨강 보류」).
test("API 오류로 끝난 턴은 확인할 것과 「오류로 끝남」을 보인다", async ({ page }) => {
  await 둘째가말할자리(page);
  const 둘째줄 = page.locator(`[data-subrow="${plainWork.slug}"]`);

  await markAttention(
    page,
    {
      agent: "claude",
      event: "StopFailure",
      at: Date.now(),
      // Claude Code 훅 문서의 모양(티켓 18이 읽음): `error` 종류 · 선택 `error_details` · 선택 `last_assistant_message`.
      payload: {
        error: "rate_limit",
        error_details: "429 Too Many Requests\nretry-after: 30",
        last_assistant_message: "API Error: 429",
      },
      stopped: true,
    },
    2,
  );

  await expect(띠줄(page, `${plainWork.title} — 확인할 것`)).toHaveCount(1);
  // 오류 상세의 **첫 줄**이 붙는다 — 둘째 줄은 안 든다.
  await expect(둘째줄).toContainText("오류로 끝남 · 429 Too Many Requests");
  await expect(둘째줄).not.toContainText("retry-after");

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **`/clear`는 아무것도 안 세운다.** 옛 표는 `clear`를 「도는 중」으로 접어, 방금 지운 대화 위에 링이 돌았다 — 그
// 링을 풀 사건은 다음 턴까지 안 온다. 앵커는 **그 사건이 도착했다**는 것이다: 먼저 승인 요청으로 띠에 한 줄을
// 세우고, `/clear`가 그 줄을 걷는 것으로 사건이 닿았음을 본다(안 닿았으면 줄이 남는다).
test("`/clear` 뒤에는 띠에 아무것도 없고 도는 중도 안 선다", async ({ page }) => {
  await 둘째가말할자리(page);
  const 레인점 = 레인(page, plainWork.slug).locator("[data-signal]");

  await markAttention(
    page,
    {
      agent: "claude",
      event: "PermissionRequest",
      at: Date.now(),
      payload: { tool_name: "Bash", tool_input: { command: "git push" } },
    },
    2,
  );
  await expect(띠줄(page, `${plainWork.title} — 나를 기다림`)).toHaveCount(1);
  await expect(레인점).toHaveCount(1);

  await fireAttention(page, { agent: "claude", event: "SessionEnd", at: Date.now(), payload: { reason: "clear" } }, 2);

  // 사건이 닿았다 — 기다림이 걷혔다.
  await expect(띠(page)).toHaveCount(0);
  // 그리고 그 자리에 **도는 중이 안 선다** — 레인에 점도 링도 없다(work 상태 아이콘이 돌아온다).
  await expect(레인점).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **서브에이전트가 도는 채 턴이 멈추면**(S50 · S51) 그 셸은 아직 도는 중이다 — 확인할 것이 서면 사람이 와서 보고
// 「아직 안 끝났네」가 된다. 수는 셸 탭 이름표의 툴팁에 선다(S32). 모두 끝나면 그때 확인할 것이 된다.
test("서브에이전트가 도는 채 멈추면 탭 툴팁에 그 수가 서고, 모두 끝나면 확인할 것이 된다", async ({ page }) => {
  await 둘째가말할자리(page);
  const 시각 = Date.now();

  // 먼저 없음을 센다 — 조용한 칸에는 툴팁이 없다.
  await expect(이름표(page, 1)).not.toHaveAttribute("title", /서브에이전트/);

  await markAttention(
    page,
    {
      agent: "claude",
      event: "Stop",
      at: 시각,
      payload: { last_assistant_message: "서브에이전트 둘을 띄웠어요" },
      subagents: 2,
      stopped: true,
    },
    2,
  );
  await expect(이름표(page, 1)).toHaveAttribute("title", "도는 중 · 서브에이전트 2");
  // 도는 중이라 부르지 않는다.
  await expect(띠(page)).toHaveCount(0);

  // 수는 처리기가 접어 싣는다(S51) — 사건마다 파일의 수가 그대로 온다.
  await fireAttention(
    page,
    { agent: "claude", event: "SubagentStop", at: 시각 + 10, payload: { agent_id: "a1" }, subagents: 1, stopped: true },
    2,
  );
  await expect(이름표(page, 1)).toHaveAttribute("title", "도는 중 · 서브에이전트 1");

  await fireAttention(
    page,
    { agent: "claude", event: "SubagentStop", at: 시각 + 20, payload: { agent_id: "a2" }, subagents: 0, stopped: true },
    2,
  );
  await expect(띠줄(page, `${plainWork.title} — 확인할 것`)).toHaveCount(1);
  // 확인할 것이 된 칸에는 도는 중의 툴팁이 없다.
  await expect(이름표(page, 1)).not.toHaveAttribute("title", /서브에이전트/);

  expect(await unknownIpcCalls(page)).toEqual([]);
});
