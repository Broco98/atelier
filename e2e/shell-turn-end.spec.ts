import { expect, test, type Page } from "./evidence";
import { WORKS } from "./fixtures";
import {
  fireAttention,
  markAttention,
  unknownIpcCalls,
  둘째가말할자리,
  띠,
  레인,
  이름표,
  툴팁,
  행버튼,
} from "./harness";

// 프로세스 티켓 20 — **턴을 마친 셸은 「확인할 것」이 되고, 훅이 도구 · 오류 · 서브에이전트를 말한다**(프로세스 결정
// 13 · 14). 전이 하나하나는 L2의 표가 재고(`shell-attention.test.ts`), 여기서는 그 값이 **진짜 스토어 → 띠 · 행 · 탭**
// 까지 가는 길 여섯을 본다: 턴의 끝이 띠에 확인할 것으로 서고 보면 꺼지는 것, 오류로 끝난 턴의 말, `/clear`가 아무것도
// 안 세우는 것, 서브에이전트 수가 탭 툴팁에 서는 것, 그리고 리뷰 반영 둘 — `claude -p`의 멈춘 세션 끝 한 장이 확인할
// 것을 세우는 것, 다른 에이전트의 도구가 승인 대기를 안 푸는 것.
//
// **보는 셸과 부르는 셸을 가른다.** 켠 칸에 온 확인할 것은 그 순간 「봤다」가 되어(terminal-activity-signal 결정 7) 띠에 안 선다 — 그래서
// 칸 둘을 세우고 첫째를 켠 채 **둘째(pty 2)가 말하게** 한다. 「보면 꺼진다」는 그 둘째를 켜는 것으로 잰다.

const [, plainWork] = WORKS;

const 띠줄 = (page: Page, name: string) => 띠(page).getByRole("button", { name, exact: true });

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

  // 그 셸을 켠다 — 창이 앞에 있고 칸이 켜졌으니 「봤다」다(terminal-activity-signal 결정 7).
  await 이름표(page, 1).click();
  await expect(이름표(page, 1)).toHaveAttribute("aria-pressed", "true");
  await expect(띠(page)).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **API 오류로 끝난 턴**(S57). 옛 설치에는 `StopFailure`가 없어 이 턴이 아무것도 안 세웠다 — 사람은 끝난 줄도 모른다.
// 말은 메시지 자리에 서고 색은 없다(terminal-activity-signal 결정 12의 「빨강 보류」).
test("API 오류로 끝난 턴은 확인할 것과 「오류로 끝남」을 보인다", async ({ page }) => {
  await 둘째가말할자리(page);
  // 셸의 말은 부르는 행 버튼의 설명이 든다(`sidebar-active-band` 결정 14 — 행이 한 줄이 되며 둘째 줄이 걷혔다).
  const 행의말 = 행버튼(page, `${plainWork.title} — 확인할 것`);

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
  await expect(행의말).toHaveAccessibleDescription("오류로 끝남 · 429 Too Many Requests");
  await expect(행의말).not.toHaveAccessibleDescription(/retry-after/);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **`/clear`는 아무것도 안 세운다.** 옛 표는 `clear`를 「도는 중」으로 접어, 방금 지운 대화 위에 링이 돌았다 — 그
// 링을 풀 사건은 다음 턴까지 안 온다. **세션 끝(`end`)과도 갈린다**: 멈춘 턴이 남긴 확인할 것은 세션 끝이면 남지만(프로세스
// 결정 13 — `claude -p`의 완료가 뜨자마자 사라지지 않게), `/clear`면 사람이 이미 그 자리에서 대화를 지운 것이라 걷힌다.
// 그래서 먼저 턴을 멈춰 띠에 확인할 것을 세운다. `/clear`가 그 줄을 걷는 것이 사건이 닿았다는 앵커이고, `clear`를 끝으로
// 읽는 코드면 그 줄이 남는다. 승인 대기로 세우면 두 사건 모두 지워 가르지 못한다.
test("`/clear` 뒤에는 띠에 아무것도 없고 도는 중도 안 선다 — 세션 끝과 달리 멈춘 턴의 확인할 것까지 걷는다", async ({ page }) => {
  await 둘째가말할자리(page);
  const 레인점 = 레인(page, plainWork.slug).locator("[data-signal]");

  await markAttention(
    page,
    { agent: "claude", event: "Stop", at: Date.now(), payload: { last_assistant_message: "다 했어요" }, stopped: true },
    2,
  );
  await expect(띠줄(page, `${plainWork.title} — 확인할 것`)).toHaveCount(1);
  await expect(레인점).toHaveCount(1);

  await fireAttention(page, { agent: "claude", event: "SessionEnd", at: Date.now(), payload: { reason: "clear" } }, 2);

  // 사건이 닿았다 — 확인할 것이 걷혔다. 끝이었다면 남는다.
  await expect(띠(page)).toHaveCount(0);
  // 그리고 그 자리에 **도는 중이 안 선다** — 레인에 점도 링도 없다(work 상태 아이콘이 돌아온다).
  await expect(레인점).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **`claude -p`의 끝**(티켓 20 리뷰 반영). `Stop` 뒤 17ms 만에 `SessionEnd`가 와서(판 03 선행 시험 r1) 감시의
// 디바운스(100ms)가 두 장을 한 회차로 읽는다 — 화면에 닿는 것은 멈춘 `SessionEnd` 한 장뿐이다. 그 장만으로도 확인할
// 것이 서야 프로세스 결정 13의 「안 본 완료를 남긴다」가 남길 것을 갖는다. 앵커는 **새 턴이 닿았다**는 것이다: 먼저 도는 중의
// 링을 세운다(안 닿았으면 아래 확인할 것이 「아무것도 없던 셸」의 것이 된다).
test("`claude -p`처럼 멈춘 세션 끝 한 장만 와도 띠에 확인할 것이 선다", async ({ page }) => {
  await 둘째가말할자리(page);
  const 링 = 레인(page, plainWork.slug).locator('[data-signal="working"]');

  await markAttention(page, { agent: "claude", event: "UserPromptSubmit", at: Date.now(), payload: { prompt: "hi" } }, 2);
  await expect(링).toHaveCount(1);
  await expect(띠(page)).toHaveCount(0);

  await fireAttention(
    page,
    { agent: "claude", event: "SessionEnd", at: Date.now(), payload: { reason: "other" }, stopped: true },
    2,
  );
  await expect(띠줄(page, `${plainWork.title} — 확인할 것`)).toHaveCount(1);
  await expect(링).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **승인을 기다리는 동안 다른 에이전트가 돌린 도구는 그 기다림을 안 푼다**(티켓 20 리뷰 반영). 서브에이전트 안의 도구
// 훅도 같은 설정으로 불리고 페이로드에 `agent_id`가 실린다 — 그 사건으로 기다림을 풀면 claude가 승인 창에 선 채로
// 「나를 기다림」이 내려간다. 기다림을 푸는 것은 **그 기다림을 낸 에이전트의** 도구다(승인한 도구가 끝나 온 PostToolUse).
//
// 앵커: 서브에이전트의 사건이 **닿았다**는 것. 사건은 한 통로로 차례로 오므로, 뒤에 쏜 사건(첫째 칸의 승인 요청)이
// 화면에 서면 앞의 것도 이미 앉았다 — 그때 둘째 칸의 기다림이 남아 있어야 한다.
test("승인을 기다리는 셸에 서브에이전트의 도구 사건이 와도 「나를 기다림」이 남는다", async ({ page }) => {
  await 둘째가말할자리(page);
  const 시각 = Date.now();
  const 기다림줄 = 띠(page).getByRole("button", { name: /나를 기다림/ });
  const 승인요청 = (at: number) => ({
    agent: "claude",
    event: "PermissionRequest",
    at,
    payload: { tool_name: "Bash", tool_input: { command: "git push" } },
  });

  await markAttention(page, 승인요청(시각), 2);
  await expect(기다림줄).toHaveCount(1);

  // 백그라운드 서브에이전트의 Read — 18의 실측 id 모양(16진 17자)이다.
  await fireAttention(
    page,
    {
      agent: "claude",
      event: "PreToolUse",
      at: 시각 + 10,
      payload: { tool_name: "Read", tool_input: { file_path: "src/a.ts" }, agent_id: "ace905bb8e05c8931", agent_type: "general-purpose" },
      subagents: 1,
    },
    2,
  );
  // 첫째 칸은 둘째 칸보다 먼저 앉았다(`둘째가말할자리`) — 착석을 다시 기다릴 것이 없어 곧바로 쏜다.
  await fireAttention(page, 승인요청(시각 + 20), 1);
  // 두 칸이 모두 부른다 — 둘째 칸의 기다림이 서브에이전트의 도구에 안 풀렸다.
  await expect(기다림줄).toHaveCount(2);

  // 기다림을 낸 에이전트(본 에이전트 — `agent_id`가 없다)의 도구가 끝나면 그때 풀린다.
  await fireAttention(
    page,
    {
      agent: "claude",
      event: "PostToolUse",
      at: 시각 + 30,
      payload: { tool_name: "Bash", tool_input: { command: "git push" }, tool_response: {} },
      subagents: 1,
    },
    2,
  );
  await expect(기다림줄).toHaveCount(1);
  await expect(이름표(page, 1)).toHaveAccessibleDescription("도는 중 · 서브에이전트 1");

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **서브에이전트가 도는 채 턴이 멈추면**(S50 · S51) 그 셸은 아직 도는 중이다 — 확인할 것이 서면 사람이 와서 보고
// 「아직 안 끝났네」가 된다. 수는 셸 탭 이름표의 툴팁에 선다(S32). 모두 끝나면 그때 확인할 것이 된다.
test("서브에이전트가 도는 채 멈추면 탭 툴팁에 그 수가 서고, 모두 끝나면 확인할 것이 된다", async ({ page }) => {
  await 둘째가말할자리(page);
  const 시각 = Date.now();

  // 먼저 없음을 센다 — 조용한 칸에는 툴팁이 없다.
  await expect(이름표(page, 1)).not.toHaveAccessibleDescription(/서브에이전트/);

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
  await expect(이름표(page, 1)).toHaveAccessibleDescription("도는 중 · 서브에이전트 2");
  // **눈에는 앱 툴팁으로 선다** — 올려 두면 그 글자가 뜬다(설명만 있고 툴팁이 안 뜨는 변형을 여기서 문다).
  await 이름표(page, 1).hover();
  await expect(툴팁(page)).toHaveText("도는 중 · 서브에이전트 2");
  // 도는 중이라 부르지 않는다.
  await expect(띠(page)).toHaveCount(0);

  // 수는 처리기가 접어 싣는다(S51) — 사건마다 파일의 수가 그대로 온다.
  await fireAttention(
    page,
    { agent: "claude", event: "SubagentStop", at: 시각 + 10, payload: { agent_id: "a1" }, subagents: 1, stopped: true },
    2,
  );
  await expect(이름표(page, 1)).toHaveAccessibleDescription("도는 중 · 서브에이전트 1");

  await fireAttention(
    page,
    { agent: "claude", event: "SubagentStop", at: 시각 + 20, payload: { agent_id: "a2" }, subagents: 0, stopped: true },
    2,
  );
  await expect(띠줄(page, `${plainWork.title} — 확인할 것`)).toHaveCount(1);
  // 확인할 것이 된 칸에는 도는 중의 툴팁이 없다.
  await expect(이름표(page, 1)).not.toHaveAccessibleDescription(/서브에이전트/);

  expect(await unknownIpcCalls(page)).toEqual([]);
});
