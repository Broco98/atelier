/// <reference types="node" />
// 소스 스캔 한 건 때문에 Node 타입을 끌어온다 — 근거는 shell-registry.test.ts 머리말과 같다.
import { readdirSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { foldHookState } from "./agents";
import {
  applySignal,
  attentionOn,
  NO_HOOK_COUNTS,
  bandRows,
  callingShells,
  inferInterrupt,
  isShellSeen,
  markShellsSeen,
  ptyIdOf,
  nextAttention,
  nextOnOutput,
  nextOnRunning,
  runningSubagents,
  signalOf,
  signalsOf,
  topSignal,
  topSignalView,
} from "./shell-attention";
import type { Attention } from "./shell-attention";
import { ownerOf } from "./shell-registry";
import type { Shell, ShellOwner, ShellsState } from "./shell-registry";
import type { ShellHookState } from "./types";

const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");

// 상태 축 seam. 순수 함수 하나가 대상이라 렌더도 DOM도 없이 기본 환경(node)에서 돈다
// (shell-registry.test.ts가 선례다). 관찰하는 것은 "에이전트가 말한 것을 넣으면 화면이 읽는
// 값이 무엇이 되는가"이지 안쪽 자료구조가 아니다.

/**
 * 상태 파일 한 장. 수와 멈춤(프로세스 결정 13 · S50 · S51)은 **처리기가 접어 싣는 칸**이라 어댑터가 안 읽고, 상태
 * 기계만 읽는다 — 그래서 빠지면 옛 처리기의 파일과 같은 값(0 · 거짓)이고, 그 칸을 재는 줄만 `over`로 덮는다.
 */
const hook = (
  agent: string,
  event: string,
  payload: unknown = null,
  over: Partial<Pick<ShellHookState, "at" | "subagents" | "stopped">> = {},
): ShellHookState => ({
  agent,
  event,
  at: 10,
  payload,
  subagents: 0,
  stopped: false,
  ...over,
});

// **페이로드는 지어내지 않는다.** 아래 픽스처의 키는 지어낸 것이 아니라 밖에서 온 것이고,
// 옆에 그 출처를 단다 — 구현이 읽기로 한 키를 픽스처에 그대로 심으면 「구현의 가정」을 재는
// 검사가 되어, 키가 틀려도 표가 통째로 초록이다.
//
// **출처가 두 층이고, 층마다 힘이 다르다.**
// - **실측**(가장 셈): 아래 `실측_…` 상수들. 진짜 claude를 돌려 우리 훅 스크립트와 같은
//   모양의 프로세스가 stdin으로 받은 JSON 그대로다.
// - **연구 표**: `spec/research/claude-codex-first-party.md`의 B-2 표(claude) · B-1 표(codex).
//   실측이 없는 자리(`PermissionRequest`·`Elicitation`은 헤드리스로 못 띄운다)와 codex 전부가
//   아직 이 층에 있다.
//
// **그 둘이 갈린 자리가 실제로 있었다.** 연구 표 B-2:157이 `SessionEnd`의 이유 필드를
// `session_end_reason`으로 적었는데 실물은 **`reason`**이다(아래 실측). 연구 표가 옮겨 적은 것은
// 훅 matcher 문서의 이름이었던 듯하고, 그 한 글자 위에 `/clear` 줄 전체가 서 있었다. 그래서
// 실측이 있는 자리에서는 실측이 이긴다 — 연구 표는 실측 앞에서 근거가 못 된다.

// 진짜 claude(2.1.267)를 `--settings`로 훅만 걸어 한 턴 돌리고, 그 훅 프로세스가 stdin으로
// 받은 JSON을 그대로 옮긴 것이다(2026-09-10 실측). 값만 짧게 줄였고 키는 하나도 안 건드렸다.
// `hook_event_name`·`session_id`·`transcript_path`·`cwd`처럼 우리가 안 읽는 키까지 남겨 두는
// 것은, 어댑터가 **모르는 키가 섞인 실물**을 그대로 받는지도 이 표가 함께 재기 때문이다.
const 실측_UserPromptSubmit = {
  session_id: "7a1c0355-dbe8-4b50-9bb5-729ffc94d8d0",
  transcript_path: "/Users/me/.claude/projects/-tmp-probe/7a1c0355.jsonl",
  cwd: "/tmp/probe",
  prompt_id: "48c64dd3-9a9a-437f-bfb6-62af9063e1b9",
  permission_mode: "default",
  hook_event_name: "UserPromptSubmit",
  // **`prompt_text`가 아니라 `prompt`다** — 연구 표 B-2:158이 갈린 둘째 자리다. 어댑터가 이
  // 키를 안 읽어(전이 표에서 `start`의 message는 「직전 유지」다) 동작은 안 갈렸지만, 픽스처가
  // 실물과 다른 채로 남으면 다음 사람이 그것을 근거로 읽는다.
  prompt: "고쳐 줘",
};
const 실측_Stop = {
  session_id: "7a1c0355-dbe8-4b50-9bb5-729ffc94d8d0",
  transcript_path: "/Users/me/.claude/projects/-tmp-probe/7a1c0355.jsonl",
  cwd: "/tmp/probe",
  prompt_id: "48c64dd3-9a9a-437f-bfb6-62af9063e1b9",
  permission_mode: "default",
  hook_event_name: "Stop",
  stop_hook_active: false,
  background_tasks: [],
  session_crons: [],
  last_assistant_message: "ok done\nsecond line here",
};
const 실측_SessionEnd = {
  session_id: "7a1c0355-dbe8-4b50-9bb5-729ffc94d8d0",
  transcript_path: "/Users/me/.claude/projects/-tmp-probe/7a1c0355.jsonl",
  cwd: "/tmp/probe",
  prompt_id: "48c64dd3-9a9a-437f-bfb6-62af9063e1b9",
  hook_event_name: "SessionEnd",
  reason: "other",
};

// 진짜 claude(2.1.283)의 `-p` Agent 판에서 기록기가 받은 서브에이전트 사건 둘이다(2026-09-26 실측, 프로세스 티켓
// 18 — `research/판03-선행-시험.md` 「서브에이전트」). 값만 줄였고 키는 그대로다. id 칸은 `agent_id`(16진 17자)이고,
// 수는 처리기가 이 칸으로 접으므로(S51) 어댑터는 이 페이로드에서 아무것도 안 읽는다.
const 실측_SubagentStart = {
  session_id: "7a1c0355-dbe8-4b50-9bb5-729ffc94d8d0",
  transcript_path: "/Users/me/.claude/projects/-tmp-probe/7a1c0355.jsonl",
  cwd: "/tmp/probe",
  hook_event_name: "SubagentStart",
  agent_id: "ace905bb8e05c8931",
  agent_type: "general-purpose",
};
const 실측_SubagentStop = {
  session_id: "7a1c0355-dbe8-4b50-9bb5-729ffc94d8d0",
  transcript_path: "/Users/me/.claude/projects/-tmp-probe/7a1c0355.jsonl",
  cwd: "/tmp/probe",
  permission_mode: "default",
  hook_event_name: "SubagentStop",
  agent_id: "ace905bb8e05c8931",
  agent_type: "general-purpose",
  agent_transcript_path: "/Users/me/.claude/projects/-tmp-probe/7a1c0355/subagents/agent-ace905bb8e05c8931.jsonl",
  last_assistant_message: "파일 둘을 읽었어요",
  stop_hook_active: false,
  background_tasks: [],
  session_crons: [],
};

describe("claude 어댑터가 실측 페이로드를 그대로 받는다", () => {
  // **이 세 줄이 「우리 가정」이 아니라 「실물」을 재는 자리다.** 나머지 표는 우리가 고른 키만
  // 남긴 축약본이라, 실물 한 장이 통째로 지나가는 것을 보는 자리가 따로 있어야 한다.
  it("실측 `UserPromptSubmit` 한 장 → 도는 중", () => {
    expect(foldHookState(hook("claude", "UserPromptSubmit", 실측_UserPromptSubmit))).toEqual({
      event: "start",
      message: null,
    });
  });

  it("실측 `Stop` 한 장 → 멈춤, 말은 첫 줄", () => {
    expect(foldHookState(hook("claude", "Stop", 실측_Stop))).toEqual({
      event: "stop",
      message: "ok done",
    });
  });

  it("실측 `SessionEnd` 한 장 → 끝(이유가 `clear`가 아니다)", () => {
    expect(foldHookState(hook("claude", "SessionEnd", 실측_SessionEnd))).toEqual({
      event: "end",
      message: null,
    });
  });

  it("실측 `SessionEnd`의 이유만 `clear`로 바꾸면 `/clear` 줄이 선다", () => {
    expect(
      foldHookState(hook("claude", "SessionEnd", { ...실측_SessionEnd, reason: "clear" })),
    ).toEqual({ event: "clear", message: null });
  });

  // **fail-closed.** `session_end_reason`은 연구 표가 적었지만 실물에는 **없는** 키다 — 배포된
  // claude 2.1.267 바이너리의 SessionEnd 훅 스키마가 `{ hook_event_name, reason }` 하나뿐이고,
  // matcher가 견주는 필드도 `reason`이며, `session_end_reason`이라는 글자는 그 바이너리 어디에도
  // 없다(0회). 그런 키를 「혹시 몰라」 함께 읽으면 그 갈래에는 실물이 영영 안 흘러 검사만 초록인
  // 죽은 길이 하나 남고, 다음 사람이 그것을 근거로 읽는다 — 같은 이유로 이 파일은 이미
  // `tool`·`input` 갈래를 걷어냈다(`payload.ts`의 `permissionLine` 머리말).
  it("지어낸 키 `session_end_reason`은 안 읽는다 — 이유가 없는 것과 같다", () => {
    expect(
      foldHookState(hook("claude", "SessionEnd", { session_end_reason: "clear" })),
    ).toEqual({ event: "end", message: null });
  });
});

describe("claude 어댑터가 페이로드를 정규 이벤트로 접는다", () => {
  it.each([
    // 실측: `UserPromptSubmit`이 프롬프트를 싣는 키는 `prompt`다(위 실측 픽스처).
    ["UserPromptSubmit", { prompt: "고쳐 줘" }, "start", null],
    // B-2:149 `tool_name`·`tool_input`·`tool_use_id`.
    ["PermissionRequest", { tool_name: "Bash", tool_input: { command: "git status" }, tool_use_id: "toolu_01" }, "waiting", "Bash · git status"],
    // B-2:150 `mcp_server_name`·`message`·`mode`·`url`·`elicitation_id`·`requested_schema`.
    ["Elicitation", { mcp_server_name: "atelier", message: "어느 쪽으로 할까요?", mode: "form", elicitation_id: "el_1" }, "waiting", "어느 쪽으로 할까요?"],
    // B-2:152 `last_assistant_message`·`agent_id`·`agent_type`.
    ["Stop", { last_assistant_message: "테스트 셋 통과\n커밋할까요?", agent_id: "a1", agent_type: "general" }, "stop", "테스트 셋 통과"],
    // **실측**: `SessionEnd`가 이유를 싣는 키는 **`reason`**이다(위 실측 픽스처).
    // 이 한 글자가 틀리면 `/clear` 줄이 실물에서 한 번도 안 서고, 방금 지운 화면에 초록이 뜬다.
    ["SessionEnd", { reason: "clear" }, "clear", null],
    ["SessionEnd", { reason: "logout" }, "end", null],
    // ── 프로세스 결정 14가 더한 여섯. 키의 출처: 도구 셋은 Claude Code 훅 문서(2026-09-26, 티켓 18이 읽음) —
    // `tool_name`·`tool_input`·`tool_use_id`, Post에 `tool_response`, Failure에 `error`·`is_interrupt`(선택).
    // **도구 사건은 말을 안 싣는다**(직전 유지). 도는 중의 둘째 줄은 직전 맥락이고, 도구마다 두 번 오는 사건이
    // 그 줄을 도구 이름으로 갈아 끼우면 사람이 읽을 말이 도구가 돌 때마다 튄다.
    ["PreToolUse", { tool_name: "Bash", tool_input: { command: "git status" }, tool_use_id: "toolu_03" }, "tool", null],
    ["PostToolUse", { tool_name: "Bash", tool_input: { command: "git status" }, tool_response: { stdout: "clean" }, tool_use_id: "toolu_03" }, "tool", null],
    // **중단이 아닌 실패는 도구다**(S56) — 도구가 실패해도 턴은 돈다.
    ["PostToolUseFailure", { tool_name: "Bash", tool_input: { command: "false" }, tool_use_id: "toolu_04", error: "Exit code 1" }, "tool", null],
    ["PostToolUseFailure", { tool_name: "Bash", tool_input: { command: "false" }, tool_use_id: "toolu_04", error: "Exit code 1", is_interrupt: false }, "tool", null],
    // **중단으로 닿은 실패는 중단이다**(프로세스 결정 12의 사실 쪽).
    ["PostToolUseFailure", { tool_name: "Bash", tool_input: { command: "sleep 30" }, tool_use_id: "toolu_05", error: "Interrupted", is_interrupt: true }, "interrupt", null],
    // **`AskUserQuestion`은 훅이 아니라 도구다** — PreToolUse 안에서 도구 이름으로 가른다. 입력 모양은 claude
    // 2.1.283 바이너리의 도구 스키마(`questions[]` · `question` · `header` · `options` · `multiSelect`)다. 말은
    // 첫 물음의 첫 줄이다 — 사람이 답할 것이 그것이다.
    ["PreToolUse", { tool_name: "AskUserQuestion", tool_input: { questions: [{ question: "어느 쪽으로 할까요?\n둘 다 돼요", header: "방향", options: [{ label: "왼쪽" }, { label: "오른쪽" }], multiSelect: false }] }, tool_use_id: "toolu_06" }, "waiting", "어느 쪽으로 할까요?"],
    // 물음을 못 읽으면 도구 이름이 바닥이다(`permissionLine`) — 모르는 것을 지어내지 않는다.
    ["PreToolUse", { tool_name: "AskUserQuestion", tool_input: {}, tool_use_id: "toolu_07" }, "waiting", "AskUserQuestion"],
    // StopFailure(문서): `error`(종류 열둘 중 하나) · 선택 `error_details` · 선택 `last_assistant_message`. 말은 **오류
    // 상세의 첫 줄**, 없으면 **오류 종류**다(S57) — 「오류로 끝남」은 상태 기계가 붙인다(아래 전이 표).
    ["StopFailure", { error: "rate_limit", error_details: "429 Too Many Requests\nretry-after: 30", last_assistant_message: "API Error: 429" }, "stopFailure", "429 Too Many Requests"],
    ["StopFailure", { error: "server_error" }, "stopFailure", "server_error"],
    ["StopFailure", {}, "stopFailure", null],
    // **실측**(위 픽스처). 수는 처리기가 접으므로 어댑터는 사건 이름만 본다.
    ["SubagentStart", 실측_SubagentStart, "subagent", null],
    ["SubagentStop", 실측_SubagentStop, "subagent", null],
  ] as const)("%s → %s", (event, payload, canonical, message) => {
    expect(foldHookState(hook("claude", event, payload))).toEqual({ event: canonical, message });
  });

  // **모르는 이벤트는 아무것도 안 만든다** — 「모르면 아무 주장도 안 한다」(결정 3)가 여기서
  // 시작된다. 사용자가 더 걸어 둔 훅이 상태를 흔들면 앰버가 이유 없이 켜진다. 앱이 안 거는 이름
  // (프로세스 결정 14의 「더하지 않음」)이 여기 선다.
  it.each(["Notification", "PermissionDenied", "SessionStart", "PostToolBatch", ""])("모르는 이벤트 %s는 아무것도 아니다", (event) => {
    expect(foldHookState(hook("claude", event, { tool_name: "Bash" }))).toBeNull();
  });

  it("모르는 에이전트는 아무것도 아니다", () => {
    expect(foldHookState(hook("gemini", "Stop", { last_assistant_message: "다 했다" }))).toBeNull();
  });

  // 훅 스크립트는 페이로드를 못 읽어도 「그 이벤트가 났다」를 남긴다(`atelier-hook.py`).
  // 그 사실까지 버리면 사람이 부르는 셸을 못 본다 — message만 없는 채로 선다.
  it("페이로드가 없어도 이벤트는 산다", () => {
    expect(foldHookState(hook("claude", "PermissionRequest"))).toEqual({
      event: "waiting",
      message: null,
    });
  });

  it("상태가 없으면 아무것도 아니다", () => {
    expect(foldHookState(null)).toBeNull();
  });
});

describe("codex 어댑터가 페이로드를 정규 이벤트로 접는다", () => {
  it.each([
    // B-1:324 codex의 `UserPromptSubmit` 고유 필드는 `permission_mode`다 — 프롬프트 본문이 없다.
    ["UserPromptSubmit", { permission_mode: "default" }, "start", null],
    // B-1:317 `turn_id`·`tool_name`·`tool_input`(+`tool_input.description`).
    ["PermissionRequest", { turn_id: "t1", tool_name: "shell", tool_input: { command: "cargo test" } }, "waiting", "shell · cargo test"],
    // B-1:318 `turn_id`·`stop_hook_active`·`last_assistant_message`.
    ["Stop", { turn_id: "t1", stop_hook_active: false, last_assistant_message: "PR #174 열었다" }, "stop", "PR #174 열었다"],
    // B-1:323 codex `SessionEnd`에는 **고유 필드가 없다**(`—`). 이유를 물을 것이 없으니 늘 끝이다.
    ["SessionEnd", {}, "end", null],
    // ── 프로세스 결정 14가 더한 넷. 키의 출처는 codex-cli 0.155.1 네이티브 바이너리가 싣는 훅 입력 스키마다
    // (`pre-tool-use.command.input` · `post-tool-use.command.input` — `turn_id`·`tool_name`·`tool_input`·
    // `tool_use_id`, Post에 `tool_response`, 서브에이전트 안이면 `agent_id`·`agent_type`).
    ["PreToolUse", { turn_id: "t1", tool_name: "shell", tool_input: { command: "cargo test" }, tool_use_id: "call_1" }, "tool", null],
    ["PostToolUse", { turn_id: "t1", tool_name: "shell", tool_input: { command: "cargo test" }, tool_response: "ok", tool_use_id: "call_1" }, "tool", null],
    // **codex에는 `AskUserQuestion` 줄이 없다**(스펙 전이 표의 `waiting` 칸) — 이름이 같아도 도구다.
    ["PreToolUse", { turn_id: "t1", tool_name: "AskUserQuestion", tool_input: {}, tool_use_id: "call_2" }, "tool", null],
    // `subagent-start.command.input` · `subagent-stop.command.input` — `agent_id`(필수)·`agent_type` 등(티켓 19가 읽음).
    ["SubagentStart", { turn_id: "t1", agent_id: "019a-sub-1", agent_type: "worker", hook_event_name: "SubagentStart" }, "subagent", null],
    ["SubagentStop", { turn_id: "t1", agent_id: "019a-sub-1", agent_type: "worker", last_assistant_message: "다 읽었다", stop_hook_active: false }, "subagent", null],
    // **사람이 끊은 턴은 중단이다**(프로세스 결정 13) — 멈춘 것이 아니라 상태가 없어진다. B-1:321 고유 필드는
    // `turn_id`·`permission_mode`다.
    ["Interrupt", { turn_id: "t1", permission_mode: "default" }, "interrupt", null],
  ] as const)("%s → %s", (event, payload, canonical, message) => {
    expect(foldHookState(hook("codex", event, payload))).toEqual({ event: canonical, message });
  });

  // **`clear`는 claude 줄이다.** 스펙 전이 표는 `end` 줄에만 codex를 적고 `clear` 줄에서는
  // 뺐다(구현 스펙 162~163줄) — 연구가 codex `SessionEnd`의 고유 필드를 `—`로 적었으니
  // 이유를 실어 오는 길 자체가 없다. 그래도 이 갈래를 검사로 못박는 이유는, 이유가 실려 와도
  // codex에서는 그것이 `clear`가 **안 되는** 것이 스펙의 읽기이기 때문이다.
  it("codex의 `SessionEnd`는 이유가 `clear`여도 끝이다", () => {
    expect(foldHookState(hook("codex", "SessionEnd", { reason: "clear" }))).toEqual({
      event: "end",
      message: null,
    });
  });

  // **옛 표에서 `Interrupt`는 「멈추되 직전 말을 둔다」(`stop` → 나를 기다림)였다.** 프로세스 결정 13이 이렇게
  // 고쳤다: 사람이 끊은 턴은 사람이 이미 그 자리에 있으므로 부를 것이 없다 — 상태가 **없어진다**(`interrupt`).
  // 멈춘 것(`stop`)으로 접으면 끊은 순간 「확인할 것」이 서서, 방금 Esc를 누른 사람을 앱이 다시 부른다.
  it("`Interrupt`는 멈춘 것이 아니라 중단이다", () => {
    expect(foldHookState(hook("codex", "Interrupt", { turn_id: "t1", permission_mode: "default" }))?.event).toBe(
      "interrupt",
    );
  });

  // claude에만 있는 이벤트다. 어댑터가 갈려 있으니 여기서는 아무것도 아니어야 한다 —
  // 한 파일에 몰아 두면 이 가름이 조용히 사라진다. 결정 14가 codex에 안 더한 셋(StopFailure ·
  // PostToolUseFailure — codex 훅 목록에 없다)도 같은 자리다.
  it.each(["Elicitation", "StopFailure", "PostToolUseFailure"])("claude의 `%s`는 codex에서 아무것도 아니다", (event) => {
    expect(foldHookState(hook("codex", event, { message: "어느 쪽?", error: "rate_limit" }))).toBeNull();
  });
});

// **설치되는 이벤트 = 어댑터가 접는 이벤트.** 이 둘은 argv → `atelier-hook.py` → 상태 파일의
// **문자열 하나**로만 이어져 있고 그 사이에 타입이 없다 — 어긋나면 훅은 정상 종료하고 파일도
// 정상으로 쓰이고 어댑터는 `null`을 돌려주며(`shell-attention.ts`의 「모르는 이벤트면 직전
// 그대로」) **어느 층도 안 빨개진다.** 이름 하나를 어댑터에만 더하면 그 훅이 사용자 설정에
// 아예 안 깔려 이벤트가 한 번도 안 오고, 설치 쪽에만 더하면 훅이 매 턴 파일을 쓰는데
// 어댑터가 버려 사용자 홈의 설정만 더러워진다. 그 그물이 필요해진 변경이 프로세스 결정 14다 — claude 여섯
// (도구 셋 · `StopFailure` · 서브에이전트 둘)과 codex 넷을 **한 커밋에서** 양쪽에 더했다. (terminal-activity-signal
// 결정 12는 「오류로 멈추면 `Stop`이 기다림으로 잡는다」였고 `StopFailure`를 다음 판으로 미뤘는데, 프로세스 결정
// 13이 이렇게 고쳤다: `StopFailure` → 확인할 것 + 「오류로 끝남」.)
//
// **두 상수는 문자열 리터럴 배열 그대로다** — 아래 정규식이 선언 하나를 통째로 읽는다. 도구 사건의 `async`
// 대상은 다른 이름의 상수(`CLAUDE_ASYNC_EVENTS`)로 따로 두었다: 이어 붙여 만든 목록은 이 정규식이 못 뽑는다.
// 그리고 `AskUserQuestion`은 **훅 이름이 아니라 도구 이름**이라 어댑터에서 `case`가 아니라 `if`로 가른다 —
// 아래 스캔은 어댑터 파일 전체의 `case "…":`를 훅 이름으로 읽으므로 `case`로 쓰면 여기서 빨개진다.
//
// 같은 위험을 이 판은 **한 자리에서 이미 인정했다** — `shell-registry.test.ts`가 `shells.rs`와
// `api.ts`를 함께 읽어 `"shell:attention"`이 같은지 못박는다(스토리 85). 이것은 같은 방식을
// 훅 어휘에 한 번 더 쓰는 것이다.
describe("훅이 나르는 어휘가 Rust와 TS에서 같다", () => {
  const 소스 = (path: string) =>
    readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

  /** `pub const <이름>: &[&str] = &[…];`에서 문자열들을 뽑는다. */
  const rust이벤트 = (name: string): string[] => {
    const 본문 = new RegExp(`pub const ${name}: &\\[&str\\] =\\s*&\\[([^\\]]*)\\]`).exec(
      소스("../../../src-tauri/src/hooks.rs"),
    );
    // **파서가 새면 통과가 아니라 터진다**(fail-closed). 선언 모양이 바뀌어 아무것도 못
    // 뽑으면 아래 비교는 「빈 집합 = 빈 집합」으로 조용히 초록이 된다.
    expect(본문, `${name} 선언을 못 찾았습니다`).not.toBeNull();
    return [...본문![1].matchAll(/"([^"]+)"/g)].map((one) => one[1]);
  };

  /** 어댑터의 `case "…":` 이름들. */
  const ts이벤트 = (file: string): string[] =>
    [...소스(`./agents/${file}`).matchAll(/case "([^"]+)":/g)].map((one) => one[1]);

  it.each([
    ["claude", "CLAUDE_EVENTS", "claude.ts"],
    ["codex", "CODEX_EVENTS", "codex.ts"],
  ])("%s가 거는 훅과 접는 훅이 **정확히 같다**", (_agent, konst, file) => {
    const 깔리는것 = rust이벤트(konst).sort();
    const 접는것 = ts이벤트(file).sort();
    // 스캔이 헛돌지 않았음을 먼저 센다 — 둘 다 비면 아래 한 줄이 읽은 것 없이 초록이다.
    expect(깔리는것.length).toBeGreaterThan(0);
    expect(접는것.length).toBeGreaterThan(0);
    // **양방향이다.** 「적어도 있다」가 아니라 「이것뿐이다」라서 어느 쪽이 늘어도 터진다.
    expect(접는것).toEqual(깔리는것);
  });
});

// **프로세스 결정 13의 전이 표 그대로**다. 재는 것은 「어느 훅 사건이 오면 화면이 읽는 상태가 무엇이 되는가」 하나 —
// 어댑터가 무엇으로 접었는지는 이 표의 관심이 아니다.
//
// terminal-activity-signal 구현 스펙의 전이 표(`Stop` → 기다림, `clear` → 도는 중, `SessionEnd` → 초록)를 프로세스
// 결정 13이 이렇게 고쳤다: 턴을 마치면 **확인할 것**이고, `/clear`와 중단은 상태가 **없어지고**, 세션 끝은 도는 중 ·
// 기다림만 지운다. 「나를 기다림」은 사람이 답해야 할 때(승인 · elicitation · `AskUserQuestion`)만 선다.
const 직전: Attention = {
  kind: "working",
  message: "직전에 하던 말",
  since: 1,
  seen: false,
  source: "hook",
  agent: "claude",
  subagents: 0,
  subagentId: null,
};
const 기다리던것: Attention = { ...직전, kind: "waiting", message: "Bash · git push" };
const 끝난것: Attention = { ...직전, kind: "done", message: "다 했어요" };

/** 사건 여럿을 차례로 앉힌다 — 파일이 바뀔 때마다 감시가 한 장씩 실어 오는 그 길이다. */
const 차례로 = (prev: Attention | null, ...hooks: ReadonlyArray<ShellHookState>): Attention | null =>
  hooks.reduce<Attention | null>((acc, one) => nextAttention(acc, one), prev);

/** 훅이 세운 상태 한 장 — 이 표의 기대값이 늘 이 모양이라 빠진 칸이 조용히 틀리지 않게 한 자리에서 짓는다. */
const 훅상태 = (over: Partial<Attention>): Attention => ({
  kind: "working",
  message: null,
  since: 10,
  seen: false,
  source: "hook",
  agent: "claude",
  subagents: 0,
  subagentId: null,
  ...over,
});

describe("전이 표 — 프로세스 결정 13", () => {
  // 여기 실린 페이로드도 **밖에서 온 키 그대로**다(위 어댑터 표와 같은 규율 — claude의 `prompt`·
  // `last_assistant_message`·`reason`·서브에이전트 둘은 실측, 도구 · 실패는 훅 문서, codex는 연구 표와 바이너리
  // 스키마). 이 줄들이 실물과 다른 모양 위에 서면 전이 표 전체가 「구현이 읽기로 한 키」를 재게 된다.
  it.each([
    // `start` → 도는 중. 말은 직전 것을 둔다.
    ["claude 새 턴", 직전, hook("claude", "UserPromptSubmit", { prompt: "고쳐" }), 훅상태({ message: "직전에 하던 말" })],
    ["codex 새 턴", 직전, hook("codex", "UserPromptSubmit", { permission_mode: "default" }), 훅상태({ message: "직전에 하던 말", agent: "codex" })],
    // `tool` → 도는 중. **기다림이 풀린다** — 승인한 도구가 끝나면 PostToolUse가 오고(티켓 18 실측: 승인과
    // PostToolUse 사이에는 오는 훅이 없다), 그때 앰버가 내려간다.
    ["claude PreToolUse가 기다림을 푼다", 기다리던것, hook("claude", "PreToolUse", { tool_name: "Bash", tool_input: { command: "ls" }, tool_use_id: "toolu_10" }), 훅상태({ message: "Bash · git push" })],
    ["claude PostToolUse가 기다림을 푼다", 기다리던것, hook("claude", "PostToolUse", { tool_name: "Bash", tool_input: { command: "git push" }, tool_response: {}, tool_use_id: "toolu_02" }), 훅상태({ message: "Bash · git push" })],
    ["claude 중단 아닌 실패도 도는 중이다(S56)", 기다리던것, hook("claude", "PostToolUseFailure", { tool_name: "Bash", tool_input: { command: "git push" }, tool_use_id: "toolu_02", error: "Exit code 1" }), 훅상태({ message: "Bash · git push" })],
    ["codex PreToolUse", 기다리던것, hook("codex", "PreToolUse", { turn_id: "t2", tool_name: "shell", tool_input: { command: "ls" }, tool_use_id: "call_3" }), 훅상태({ message: "Bash · git push", agent: "codex" })],
    ["codex PostToolUse", 기다리던것, hook("codex", "PostToolUse", { turn_id: "t2", tool_name: "shell", tool_input: { command: "ls" }, tool_response: "ok", tool_use_id: "call_3" }), 훅상태({ message: "Bash · git push", agent: "codex" })],
    // `waiting` → 기다림. **사람이 답해야 할 때만** 선다.
    ["claude 승인 요청", 직전, hook("claude", "PermissionRequest", { tool_name: "Bash", tool_input: { command: "git push" } }), 훅상태({ kind: "waiting", message: "Bash · git push" })],
    ["codex 승인 요청", 직전, hook("codex", "PermissionRequest", { turn_id: "t2", tool_name: "shell", tool_input: { command: "rm -rf ." } }), 훅상태({ kind: "waiting", message: "shell · rm -rf .", agent: "codex" })],
    ["claude elicitation", 직전, hook("claude", "Elicitation", { mcp_server_name: "atelier", message: "어느 쪽으로 할까요?", elicitation_id: "el_2" }), 훅상태({ kind: "waiting", message: "어느 쪽으로 할까요?" })],
    ["claude AskUserQuestion", 직전, hook("claude", "PreToolUse", { tool_name: "AskUserQuestion", tool_input: { questions: [{ question: "어느 쪽으로 할까요?", header: "방향", options: [], multiSelect: false }] }, tool_use_id: "toolu_11" }), 훅상태({ kind: "waiting", message: "어느 쪽으로 할까요?" })],
    // `stop` → 서브에이전트가 없으면 **확인할 것**, 있으면 도는 중(서브에이전트 N).
    ["claude 턴 끝", 직전, hook("claude", "Stop", { last_assistant_message: "테스트 셋 통과 — 커밋할까요?" }, { stopped: true }), 훅상태({ kind: "done", message: "테스트 셋 통과 — 커밋할까요?" })],
    ["codex 턴 끝", 직전, hook("codex", "Stop", { turn_id: "t2", last_assistant_message: "PR #174 열었다" }, { stopped: true }), 훅상태({ kind: "done", message: "PR #174 열었다", agent: "codex" })],
    ["서브에이전트가 도는 턴 끝", 직전, hook("claude", "Stop", { last_assistant_message: "서브에이전트 둘을 띄웠어요" }, { subagents: 2, stopped: true }), 훅상태({ message: "서브에이전트 둘을 띄웠어요", subagents: 2 })],
    // `stopFailure` → 확인할 것 + 「오류로 끝남」(S57 — 오류 상세의 첫 줄, 없으면 오류 종류). 색은 없다.
    ["API 오류로 끝난 턴", 직전, hook("claude", "StopFailure", { error: "rate_limit", error_details: "429 Too Many Requests\nretry-after: 30" }, { stopped: true }), 훅상태({ kind: "done", message: "오류로 끝남 · 429 Too Many Requests" })],
    ["오류 상세가 없으면 종류", 직전, hook("claude", "StopFailure", { error: "server_error" }, { stopped: true }), 훅상태({ kind: "done", message: "오류로 끝남 · server_error" })],
    ["아무것도 없으면 「오류로 끝남」만", 직전, hook("claude", "StopFailure", {}, { stopped: true }), 훅상태({ kind: "done", message: "오류로 끝남" })],
  ] as const)("%s", (_이름, prev, one, expected) => {
    expect(nextAttention(prev, one)).toEqual(expected);
  });

  // **기다림을 푸는 도구는 그 기다림을 낸 에이전트의 것이다**(티켓 20 리뷰 반영). 서브에이전트 안의 도구 훅도 같은 설정으로
  // 불리고 페이로드에 `agent_id`가 실린다(Claude Code 훅 문서의 공통 입력 칸 — 연구 B-2, codex는 바이너리의 도구 훅
  // 스키마). 결정 13이 기다림을 푸는 까닭으로 든 것은 「승인 뒤 도구가 돌면」이다 — 한 에이전트가 승인 창에 서 있는 동안
  // **다른 에이전트**가 돌리는 도구는 그 승인이 아니다. 그것으로 풀면 사람이 답해야 하는 동안 「나를 기다림」이 내려가고,
  // 두 사건이 한 디바운스에 들면 기다림이 한 번도 안 서 알림도 안 운다. 서브에이전트는 기본으로 백그라운드로 돈다(18).
  const 서브 = { agent_id: "ace905bb8e05c8931", agent_type: "general-purpose" };
  const 다른서브 = { agent_id: "b01c2d3e4f5a6b7c8", agent_type: "Explore" };
  const 서브가기다린것 = 훅상태({ kind: "waiting", message: "Bash · npm test", subagentId: 서브.agent_id });
  it.each([
    ["본 에이전트의 승인 대기 + 서브에이전트의 PreToolUse", 기다리던것, hook("claude", "PreToolUse", { tool_name: "Read", tool_input: { file_path: "src/a.ts" }, tool_use_id: "toolu_20", ...서브 }, { at: 90 })],
    ["본 에이전트의 승인 대기 + 서브에이전트의 PostToolUse", 기다리던것, hook("claude", "PostToolUse", { tool_name: "Read", tool_input: { file_path: "src/a.ts" }, tool_response: {}, tool_use_id: "toolu_20", ...서브 }, { at: 90 })],
    ["본 에이전트의 승인 대기 + 서브에이전트의 도구 실패", 기다리던것, hook("claude", "PostToolUseFailure", { tool_name: "Bash", tool_input: { command: "false" }, tool_use_id: "toolu_21", error: "Exit code 1", ...서브 }, { at: 90 })],
    ["서브에이전트의 승인 대기 + 본 에이전트의 도구", 서브가기다린것, hook("claude", "PostToolUse", { tool_name: "Read", tool_input: { file_path: "src/b.ts" }, tool_response: {}, tool_use_id: "toolu_22" }, { at: 90 })],
    ["서브에이전트의 승인 대기 + 다른 서브에이전트의 도구", 서브가기다린것, hook("claude", "PreToolUse", { tool_name: "Grep", tool_input: { pattern: "fn" }, tool_use_id: "toolu_23", ...다른서브 }, { at: 90 })],
    ["codex 승인 대기 + 서브에이전트의 PreToolUse", { ...기다리던것, agent: "codex" }, hook("codex", "PreToolUse", { turn_id: "t2", tool_name: "shell", tool_input: { command: "ls" }, tool_use_id: "call_9", agent_id: "019a-sub-1", agent_type: "worker" }, { at: 90 })],
  ] as const)("다른 에이전트의 도구는 기다림을 안 푼다 — %s", (_이름, prev, one) => {
    // 같은 객체다 — 새 사실이 아니라서 시각도 「봤다」도 그대로이고, 알림 판정이 「머무름」으로 읽는다.
    expect(nextAttention(prev, one)).toBe(prev);
  });

  it("다른 에이전트의 도구가 기다림을 안 풀어도 파일의 서브에이전트 수는 앉는다", () => {
    const 하나 = hook("claude", "PreToolUse", { tool_name: "Read", tool_input: { file_path: "src/a.ts" }, tool_use_id: "toolu_20", ...서브 }, { at: 90, subagents: 1 });
    expect(nextAttention(기다리던것, 하나)).toEqual({ ...기다리던것, subagents: 1 });
  });

  // 서브에이전트가 낸 승인 요청은 **그 서브에이전트의** 도구가 풀어 준다 — 승인한 도구가 끝나 PostToolUse가 온다(18: 승인과
  // PostToolUse 사이에 오는 훅이 없다). 본 에이전트의 것도 같은 규칙이다(위 표의 「PostToolUse가 기다림을 푼다」).
  it("서브에이전트가 낸 승인 요청은 그 서브에이전트의 도구가 푼다", () => {
    const 요청 = hook("claude", "PermissionRequest", { tool_name: "Bash", tool_input: { command: "npm test" }, ...서브 }, { at: 80, subagents: 1 });
    const 끝 = hook("claude", "PostToolUse", { tool_name: "Bash", tool_input: { command: "npm test" }, tool_response: {}, tool_use_id: "toolu_24", ...서브 }, { at: 95, subagents: 1 });
    const 기다림 = 차례로(직전, 요청);
    expect(기다림).toEqual(훅상태({ kind: "waiting", message: "Bash · npm test", since: 80, subagents: 1, subagentId: 서브.agent_id }));
    expect(차례로(기다림, 끝)).toEqual(
      훅상태({ message: "Bash · npm test", since: 95, subagents: 1, subagentId: 서브.agent_id }),
    );
  });

  // **「없음」은 상태 전이가 상태 없음을 돌려주는 것이다**(스펙 전이 표 아래 줄). 옛 전이 함수는 늘 값을 돌려줘서
  // `/clear`가 「도는 중」을 세웠다 — 지워진 대화 위에 링이 돌고, 그 링을 풀 사건이 다음 턴까지 안 온다.
  it.each([
    ["claude 중단(`is_interrupt`)", hook("claude", "PostToolUseFailure", { tool_name: "Bash", tool_input: { command: "sleep 30" }, tool_use_id: "toolu_05", error: "Interrupted", is_interrupt: true })],
    ["codex 중단", hook("codex", "Interrupt", { turn_id: "t1", permission_mode: "default" })],
    ["claude `/clear`", hook("claude", "SessionEnd", { reason: "clear" })],
  ] as const)("`interrupt` · `clear` → 상태 없음 — %s", (_이름, one) => {
    for (const prev of [직전, 기다리던것, 끝난것]) expect(nextAttention(prev, one)).toBeNull();
  });

  // **`end` → 도는 중 · 기다림은 지우고, 안 본 확인할 것은 남긴다**(프로세스 결정 13 아래 줄). 여기 줄은 모두 **멈추지
  // 않은 끝**(`stopped: false`)이다 — 도는 턴이 끊긴 채 세션이 끝났다. `claude -p`처럼 멈춘 턴 뒤의 끝은 아래 줄이 잰다.
  it.each([
    ["claude", { reason: "logout" }],
    ["claude", { reason: "prompt_input_exit" }],
    // codex `SessionEnd`는 고유 필드가 없다 — 빈 페이로드가 실물의 모양이다.
    ["codex", {}],
  ] as const)("`end` → 도는 중 · 기다림은 지우고 안 본 확인할 것은 남김 — %s %j", (agent, payload) => {
    const 끝 = hook(agent, "SessionEnd", payload);
    expect(nextAttention(직전, 끝)).toBeNull();
    expect(nextAttention(기다리던것, 끝)).toBeNull();
    expect(nextAttention(null, 끝)).toBeNull();
    // **같은 객체다** — 남기는 것이지 새로 세우는 것이 아니라, 「봤다」도 시각도 그대로다.
    expect(nextAttention(끝난것, 끝)).toBe(끝난것);
    const 본것 = { ...끝난것, seen: true };
    expect(nextAttention(본것, 끝)).toBe(본것);
  });

  // **`claude -p`가 실제로 닿는 모양**(티켓 20 리뷰 반영). `Stop` 뒤 17ms 만에 `SessionEnd`가 오고(판 03 선행 시험 r1),
  // 감시는 100ms로 디바운스해 그 순간의 파일 한 장만 싣는다(`shells.rs`의 `DEBOUNCE` · `scan`) — 프런트는 `Stop`을
  // **못 보고** `SessionEnd` 한 장만 받는다. 결정 13이 「안 본 완료를 남긴다」를 둔 까닭이 바로 이 길인데, 남길 완료가
  // 화면에 한 번도 안 섰다. 처리기가 그 장에 멈춤을 남기므로(`stopped: true` — 세션 끝은 멈춤을 안 끈다) 「멈춘 턴 뒤의
  // 끝」으로 읽고 도는 중을 확인할 것으로 세운다. 멈춘 턴의 말은 파일에서 이미 사라졌으므로 말이 없다 — 직전 말은 지난
  // 턴의 것일 수 있어 결과로 세우지 않는다.
  it("디바운스가 `Stop`을 삼켜 멈춘 `SessionEnd` 한 장만 와도 도는 중은 확인할 것이 된다", () => {
    const 끝 = hook("claude", "SessionEnd", 실측_SessionEnd, { at: 60, stopped: true });
    expect(nextAttention(직전, 끝)).toEqual(훅상태({ kind: "done", message: null, since: 60 }));
    // 서브에이전트가 돌던 멈춤(도는 중 · 서브에이전트 2)도 같다 — 세션 끝이 집합을 비운다.
    expect(nextAttention({ ...직전, subagents: 2 }, 끝)).toEqual(훅상태({ kind: "done", message: null, since: 60 }));
    // 기다림은 표대로 지운다.
    expect(nextAttention(기다리던것, 끝)).toBeNull();
    // **아무 주장도 없던 셸에는 안 세운다** — `/clear` 뒤의 `/exit`가 그 모양이다(멈춤은 `/clear` 앞 턴의 것이다).
    expect(nextAttention(null, 끝)).toBeNull();
    // 확인할 것은 그대로 남긴다 — 같은 객체다.
    expect(nextAttention(끝난것, 끝)).toBe(끝난것);
  });

  it("멈춘 `SessionEnd` 한 장을 다시 읽어도 본 확인할 것이 되살아나지 않는다", () => {
    const 끝 = hook("claude", "SessionEnd", 실측_SessionEnd, { at: 60, stopped: true });
    const 본것 = { ...nextAttention(직전, 끝)!, seen: true };
    expect(nextAttention(본것, 끝)).toBe(본것);
  });

  // ── `subagent` — **지금 상태를 두고 수만 고친다**(S51). 수는 처리기가 id 집합으로 접은 것이고(19), 프런트는 사건을
  // 세지 않는다: 파일은 마지막 사건 하나만 담고 감시가 100ms로 디바운스하므로 세면 샌다.

  // **이것이 S50이다.** 결정 13 여섯째 줄(서브에이전트가 돌면 도는 중)은 들어가는 길만 적었다 — 나오는 길이
  // 없으면 결정 12가 없애려던 「도는 중」 고착이 새 길로 돌아온다.
  it("Stop(수 2) → SubagentStop → SubagentStop → 확인할 것", () => {
    const 멈춤 = hook("claude", "Stop", { last_assistant_message: "서브에이전트 둘을 띄웠어요" }, { at: 10, subagents: 2, stopped: true });
    const 하나끝 = hook("claude", "SubagentStop", 실측_SubagentStop, { at: 20, subagents: 1, stopped: true });
    const 둘끝 = hook("claude", "SubagentStop", 실측_SubagentStop, { at: 30, subagents: 0, stopped: true });

    expect(차례로(직전, 멈춤)).toEqual(훅상태({ message: "서브에이전트 둘을 띄웠어요", subagents: 2 }));
    expect(차례로(직전, 멈춤, 하나끝)).toEqual(훅상태({ message: "서브에이전트 둘을 띄웠어요", subagents: 1 }));
    // **`since`는 멈춘 시각 그대로다** — 서브에이전트 사건은 시각을 안 바꾼다. 확인할 것에 **들어서는** 것이라
    // 「봤다」는 풀린다(알림이 한 번 운다 — `shell-notify.test.ts`).
    expect(차례로(직전, 멈춤, 하나끝, 둘끝)).toEqual(
      훅상태({ kind: "done", message: "서브에이전트 둘을 띄웠어요", subagents: 0 }),
    );
  });

  // **확인할 것에 늦게 온 서브에이전트 사건은 다시 울리지 않는다** — `since`가 그대로라 알림 판정이 「머무름」으로
  // 읽는다. 「봤다」도 그대로라 본 완료가 되살아나지 않는다.
  it("확인할 것 + `subagent` → 그대로, `since`도 그대로", () => {
    const 늦은시작 = hook("claude", "SubagentStart", 실측_SubagentStart, { at: 40, subagents: 1, stopped: true });
    expect(nextAttention(끝난것, 늦은시작)).toEqual({ ...끝난것, subagents: 1 });
    const 본것 = { ...끝난것, seen: true };
    expect(nextAttention(본것, 늦은시작)).toEqual({ ...본것, subagents: 1 });
  });

  // 그 밖의 상태도 수만 고친다 — 기다리는 동안 서브에이전트가 끝나도 사람이 답할 것은 그대로다.
  it("기다림 + `subagent` → 기다림 그대로, 수만", () => {
    const 끝 = hook("claude", "SubagentStop", 실측_SubagentStop, { at: 40, subagents: 0, stopped: false });
    expect(nextAttention({ ...기다리던것, subagents: 1 }, 끝)).toEqual({ ...기다리던것, subagents: 0 });
  });

  // **멈추지 않은 턴**에서 수가 0이 되는 것은 끝이 아니다 — 본 에이전트가 아직 돈다(S50의 「멈춘 셸」).
  it("멈추지 않은 도는 중 + `subagent` → 도는 중, 수만", () => {
    const 시작 = hook("claude", "SubagentStart", 실측_SubagentStart, { at: 40, subagents: 1, stopped: false });
    const 끝 = hook("claude", "SubagentStop", 실측_SubagentStop, { at: 50, subagents: 0, stopped: false });
    expect(차례로(직전, 시작)).toEqual({ ...직전, subagents: 1 });
    expect(차례로(직전, 시작, 끝)).toEqual(직전);
  });

  // 아무 주장도 없는 셸에 서브에이전트 사건만 오면 아무것도 안 세운다 — 수만 고칠 상태가 없다.
  it("상태가 없는 셸에 `subagent`가 와도 없다", () => {
    expect(nextAttention(null, hook("claude", "SubagentStart", 실측_SubagentStart, { subagents: 1 }))).toBeNull();
  });

  // **둘째 승인 요청은 새 사실이다** — 새 `since`를 찍어야 알림 판정이 「같은 값으로 새로 도착한 것」으로 읽는다
  // (`decideNotification` 머리말). 그대로 두면 연달아 오는 승인 요청의 둘째부터 삼켜진다.
  it("기다림 + `waiting` → 기다림, 새 `since`", () => {
    const 둘째 = hook("claude", "PermissionRequest", { tool_name: "Edit", tool_input: { file_path: "src/pty.rs" } }, { at: 90 });
    expect(nextAttention(기다리던것, 둘째)).toEqual(
      훅상태({ kind: "waiting", message: "Edit · src/pty.rs", since: 90 }),
    );
  });

  // **순서 가드에 막힌 사건은 파일의 사건 이름과 `at`을 안 바꾸고 수만 바꾼다**(19 · S27). 그래서 「사건 이름과 `at`이
  // 같은 파일」도 버리지 않고 수를 새로 읽어 전이한다 — 버리면 `Stop`보다 먼저 시작해 늦게 끝난 SubagentStop이
  // 영영 반영되지 않아 도는 중에 굳는다.
  it("순서 가드에 막혀 수만 바뀐 파일(`Stop` 그대로, `at` 그대로, 수 0)이 와도 확인할 것", () => {
    const 멈춤 = hook("claude", "Stop", { last_assistant_message: "서브에이전트 둘을 띄웠어요" }, { at: 10, subagents: 2, stopped: true });
    const 막힌끝 = { ...멈춤, subagents: 0 };
    expect(차례로(직전, 멈춤, 막힌끝)).toEqual(
      훅상태({ kind: "done", message: "서브에이전트 둘을 띄웠어요", subagents: 0 }),
    );
  });

  // **같은 사실을 다시 읽는 것은 새 사실이 아니다** — 막힌 사건이 멈춤만 바꾼 파일(예: 늦은 중단의 `stopped: false`)을
  // 다시 읽어도 본 완료가 되살아나지 않는다. 되살아나면 사람이 방금 본 셸이 띠에 다시 서고 알림이 한 번 더 운다.
  it("같은 사건을 다시 읽어도 「봤다」가 안 풀린다", () => {
    const 멈춤 = hook("claude", "Stop", { last_assistant_message: "다 했어요" }, { at: 10, stopped: true });
    const 본것 = { ...nextAttention(직전, 멈춤)!, seen: true };
    expect(nextAttention(본것, { ...멈춤, stopped: false })).toEqual(본것);
  });

  // 훅이 처음 오는 셸에는 직전이 없다. 「직전 유지」가 그때 무엇이 되는지가 이 줄이다.
  it("직전이 없으면 「직전 유지」는 없음이다", () => {
    expect(nextAttention(null, hook("claude", "UserPromptSubmit", { prompt: "고쳐" }))).toEqual(훅상태({}));
  });

  // 「PTY 종료 · 셸 닫힘 → 없음」. 감시가 파일이 사라진 것을 `state: null`로 실어 온다.
  it("상태가 사라지면 아무 주장도 안 남는다", () => {
    expect(nextAttention(직전, null)).toBeNull();
  });

  // **같은 파일이 두 번 와도 상태가 그대로다.** 감시가 안 바뀐 셸을 안 싣지만(`shells.rs`의
  // 차분) 그 한 겹에만 기대지 않는다 — 근거가 다른 두 겹이다. 레지스트리의 `setAttention`은
  // 이 항등성만 보고 칸을 갈아 끼울지 정하므로, 여기가 새면 사이드바가 이유 없이 다시 그려진다.
  it("같은 것이 다시 와도 상태가 그대로다 — 같은 객체다", () => {
    const 한장 = hook("claude", "Stop", { last_assistant_message: "커밋할까요?" }, { stopped: true });
    const 앉은뒤 = nextAttention(직전, 한장);
    expect(nextAttention(앉은뒤, 한장)).toBe(앉은뒤);
  });

  // **일곱째 칸도 견준다** — 수만 바뀐 파일이 「같은 것」으로 삼켜지면 셸 탭 툴팁의 수가 안 바뀐다.
  it("수만 달라도 새 상태다 — 같은 객체가 아니다", () => {
    const 둘 = hook("claude", "Stop", { last_assistant_message: "기다려요" }, { subagents: 2, stopped: true });
    const 앉은뒤 = nextAttention(직전, 둘);
    const 하나 = nextAttention(앉은뒤, { ...둘, subagents: 1 });
    expect(하나).not.toBe(앉은뒤);
    expect(하나?.subagents).toBe(1);
  });

  // **모르는 이벤트는 직전을 흔들지 않는다.** 어댑터가 `null`을 준 자리다.
  it("모르는 이벤트는 직전 그대로다 — 같은 객체다", () => {
    expect(nextAttention(직전, hook("claude", "Notification", {}))).toBe(직전);
  });

  // **「봤다」는 새 사실이 오면 풀린다.** 안 풀면 Agent Deck이 겪은 「두 번째 진짜 프롬프트가
  // 삼켜짐」이 그대로 난다 — 끝난 셸을 한 번 보고 나면 그 뒤 진짜 완료가 영영 안 뜬다.
  it("에이전트가 새로 말하면 「봤다」가 풀린다", () => {
    const 본것 = { ...끝난것, seen: true };
    expect(nextAttention(본것, hook("claude", "Stop", { last_assistant_message: "또 했어요" }, { at: 20, stopped: true }))?.seen).toBe(
      false,
    );
  });
});

// **권위**(결정 11). 이 판은 OSC·벨이 신호를 만드는 길을 아직 안 붙이지만(#208), 그것들이
// 들어올 문과 규칙은 여기서 연다 — 나중에 붙이면서 규칙을 같이 쓰면 그 규칙에 검사가 없다.
//
// 그 구현 스펙의 권위 규칙은 「훅이 한 번 말한 셸은 그 뒤 OSC · 벨 · 출력을 무시한다」였다. 프로세스 결정 12가 이렇게
// 고쳤다: **에이전트 프로세스가 foreground에서 사라지면 권위가 풀린다** — 그 뒤의 OSC와 벨은 다시 말한다. 에이전트가 떠
// 있는 동안에는 지금처럼 훅만 말한다(아래 마지막 줄들).
describe("훅이 말한 셸에서는 OSC·벨·출력이 아무것도 못 바꾼다", () => {
  const 훅이말한것: Attention = {
    kind: "waiting",
    message: "커밋할까요?",
    since: 100,
    seen: false,
    source: "hook",
    agent: "claude",
    subagents: 0,
    subagentId: null,
  };

  it.each(["osc", "bell"] as const)("%s가 와도 그대로다 — 같은 객체다", (source) => {
    const 그대로 = applySignal(훅이말한것, { event: "start", message: null }, 200, source, null, NO_HOOK_COUNTS);
    expect(그대로).toBe(훅이말한것);
  });

  // 훅이 안 온 셸은 OSC·벨이 바꾼다. 권위 규칙이 「아무도 못 바꾼다」로 넓어지면 훅을 안 깐
  // 사용자에게 이 판이 통째로 없는 것이 된다.
  it("훅이 안 온 셸은 OSC가 바꾼다", () => {
    const osc가말한것: Attention = { ...훅이말한것, source: "osc", agent: null };
    expect(applySignal(osc가말한것, { event: "start", message: null }, 200, "osc", null, NO_HOOK_COUNTS)).toEqual({
      kind: "working",
      message: "커밋할까요?",
      since: 200,
      seen: false,
      source: "osc",
      // **OSC·벨은 누가 말했는지를 모른다.** 본문이 어느 프로세스에서 나왔는지 PTY는 안
      // 적는다 — 그 갈래에서 마크를 내는 것은 「지금 도는 것」뿐이다.
      agent: null,
      // 서브에이전트도 모른다 — 수는 처리기가 접어 싣는 훅 길의 값이고, 낸 서브에이전트는 훅 페이로드의 칸이다.
      subagents: 0,
      subagentId: null,
    });
  });

  // 반대 방향은 안 막는다 — 훅이 늦게 오면 그때부터 훅이 권위다.
  it("OSC가 말하던 셸에 훅이 오면 훅이 이긴다", () => {
    const osc가말한것: Attention = { ...훅이말한것, source: "osc", agent: null };
    expect(
      applySignal(osc가말한것, { event: "stop", message: null }, 200, "hook", "claude", NO_HOOK_COUNTS)?.source,
    ).toBe("hook");
  });

  // 벨과 OSC의 완료는 **`stop`으로 들어온다**(`shell-osc.ts`) — 프로세스 결정 13이 확인할 것을 턴의 끝(`stop`)에 두고
  // `end`를 「지우는 사건」으로 바꿨으므로, 옛 표대로 `end`를 쓰면 벨이 아무것도 못 세운다.
  it("아무것도 안 온 셸은 벨이 바꾼다", () => {
    expect(applySignal(null, { event: "stop", message: null }, 200, "bell", null, NO_HOOK_COUNTS)?.kind).toBe("done");
  });

  // **훅 없는 Codex 셸의 앰버를 푸는 것은 출력이다**(스펙 전이 표의 마지막 줄 · 구현 스펙
  // 3절). Codex는 승인 요청이 떠 있는 동안 턴 완료 OSC를 안 보내므로, OSC가 세운 앰버를
  // 풀 OSC가 영영 안 온다 — 사람이 승인한 뒤 다시 흐르기 시작한 **출력 자체**가 답이다.
  //
  // **훅 셸에는 안 건다.** claude는 답을 기다리는 동안에도 커서를 다시 그리느라 출력을
  // 내므로, 여기가 권위 규칙 밖으로 넓어지면 훅이 세운 앰버가 곧바로 꺼진다.
  describe("출력이 도착하면 OSC가 세운 기다림만 풀린다", () => {
    const osc가세운기다림: Attention = { ...훅이말한것, source: "osc", agent: null };

    it("OSC가 세운 기다림은 도는 중으로 간다 — 말은 그대로 남는다", () => {
      expect(nextOnOutput(osc가세운기다림, 300)).toEqual({
        kind: "working",
        message: "커밋할까요?",
        since: 300,
        seen: false,
        source: "osc",
        agent: null,
        subagents: 0,
        subagentId: null,
      });
    });

    it("훅이 세운 기다림은 안 풀린다 — 같은 객체다", () => {
      expect(nextOnOutput(훅이말한것, 300)).toBe(훅이말한것);
    });

    // **초록은 출력으로 안 꺼진다.** 스펙이 푸는 것은 「화면값이 `waiting`」인 자리 하나이고,
    // 안 본 완료를 지우는 것은 사람이 본 순간뿐이다(결정 7) — 여기서 넓히면 벨이 세운 초록이
    // 다음 프롬프트가 그려지는 순간 사라져 아무도 못 본다.
    it.each(["done", "working"] as const)("%s는 출력이 안 건드린다 — 같은 객체다", (kind) => {
      const 그것: Attention = { ...osc가세운기다림, kind };
      expect(nextOnOutput(그것, 300)).toBe(그것);
    });

    // 아무 주장도 없는 셸은 출력이 와도 조용하다 — 출력 정지 시간으로도, 출력 도착으로도
    // 상태를 **만들지** 않는다(결정 3).
    it("아무것도 안 온 셸은 출력이 아무것도 안 만든다", () => {
      expect(nextOnOutput(null, 300)).toBeNull();
    });
  });

  // **누가 말했는가는 상태와 함께 앉는다**(#203). 초록을 만드는 이벤트가 왔을 때 그 셸에서
  // 도는 것은 이미 없으므로, 이 값이 안 실리면 행의 둘째 줄이 마크를 낼 재료가 없다.
  it("훅이 말한 상태는 그 에이전트를 함께 싣는다", () => {
    const 상태값 = nextAttention(null, hook("codex", "Stop", { last_assistant_message: "PR #174 열었다" }, { stopped: true }));
    expect(상태값?.agent).toBe("codex");
  });

  // ── 권위가 풀리는 자리(프로세스 결정 12 · S31). 에이전트가 사라지면 도는 중 · 기다림은 지워지고(그 뒤는 「없음」이라 누구든
  // 말한다) 안 본 확인할 것은 남는데, **남은 그것이 권위를 쥐고 있으면** claude를 끝낸 셸에서 띄운 다른 도구의 OSC · 벨이
  // 영영 안 선다. 그래서 남은 확인할 것의 출처가 「사라짐」이 되고, 권위는 그 출처를 안 지킨다.
  const 훅이세운확인할것: Attention = { ...훅이말한것, kind: "done", message: "다 했어요" };

  it.each([
    ["OSC 승인 요청", { event: "waiting", message: "Bash(git push)" }, "osc", "waiting"],
    ["OSC 완료", { event: "stop", message: "PR #174 열었다" }, "osc", "done"],
    ["벨", { event: "stop", message: null }, "bell", "done"],
  ] as const)("에이전트가 사라진 뒤에는 다시 말한다 — %s", (_이름, signal, source, kind) => {
    const 남은것 = nextOnRunning(훅이세운확인할것, "claude", "zsh", 150);
    const 말한뒤 = applySignal(남은것, signal, 200, source, null, NO_HOOK_COUNTS);
    expect(말한뒤?.kind).toBe(kind);
    expect(말한뒤?.since).toBe(200);
    expect(말한뒤?.source).toBe(source);
  });

  it("에이전트가 사라져 지워진 셸에는 OSC가 새로 세운다", () => {
    const 도는중: Attention = { ...훅이말한것, kind: "working" };
    const 지워진것 = nextOnRunning(도는중, "claude", null, 150);
    expect(지워진것).toBeNull();
    expect(applySignal(지워진것, { event: "stop", message: "PR #174 열었다" }, 200, "osc", null, NO_HOOK_COUNTS)?.kind).toBe(
      "done",
    );
  });

  // **떠 있는 동안에는 무시한다** — 에이전트가 새로 뜬 것, 그대로인 것, 에이전트가 아닌 명령이 바뀐 것은 권위를 안 푼다.
  it.each([
    [null, "claude"],
    ["claude", "claude"],
    ["node", "zsh"],
  ] as const)("%s → %s 뒤에도 OSC · 벨은 훅이 세운 상태를 못 바꾼다", (before, after) => {
    for (const 그것 of [훅이말한것, 훅이세운확인할것]) {
      const 그대로 = nextOnRunning(그것, before, after, 150);
      expect(그대로).toBe(그것);
      expect(applySignal(그대로, { event: "waiting", message: "Bash(git push)" }, 200, "osc", null, NO_HOOK_COUNTS)).toBe(그것);
      expect(applySignal(그대로, { event: "stop", message: null }, 200, "bell", null, NO_HOOK_COUNTS)).toBe(그것);
    }
  });

  // 권위는 **훅이 다시 말하면** 돌아온다 — 같은 셸에서 claude를 다시 띄워 새 턴을 보냈다.
  it("에이전트가 다시 떠 훅이 말하면 권위가 돌아온다", () => {
    const 남은것 = nextOnRunning(훅이세운확인할것, "claude", null, 150);
    const 새턴 = nextAttention(남은것, hook("claude", "UserPromptSubmit", { prompt: "다시" }, { at: 300 }));
    expect(새턴?.source).toBe("hook");
    expect(applySignal(새턴, { event: "stop", message: "PR #174 열었다" }, 400, "osc", null, NO_HOOK_COUNTS)).toBe(새턴);
  });
});

// ── 중단 추론(프로세스 결정 12 · S29 · S30). claude는 생각하는 중에 Esc · Ctrl-C로 끊으면 그 순간 오는 훅이 없다 — 도는
// 중이 영영 남던 자리다. 스토어가 누른 순간의 상태를 기준값으로 잡고, 잠시 뒤 지금 값과 그사이 온 훅 사건 수를 건넨다.
// 여기서 재는 것은 그 셋으로 **중단인가**를 가르는 순수 함수다 — 기다리는 시간은 이 파일도 저 파일도 모른다(아래 소스 스캔).
//
// 답의 모양은 `nextOnOutput`과 같다: 중단이면 `interrupt`를 앉힌 값(표대로 **없음**), 아니면 **지금 값 그대로**(같은 객체).
describe("중단 추론 — 프로세스 결정 12", () => {
  it("누른 순간과 지금이 같으면 중단이다 — 상태가 없어진다", () => {
    expect(inferInterrupt(직전, 직전, 0, 700)).toBeNull();
  });

  // 견주는 것은 시각과 종류다(티켓 22). 「봤다」나 말이 바뀐 것은 새 사실이 아니다.
  it("「봤다」만 달라져도 같은 사실이다", () => {
    expect(inferInterrupt(직전, { ...직전, seen: true }, 0, 700)).toBeNull();
  });

  // **「그사이 훅이 왔나」는 상태로 못 본다** — 서브에이전트 사건은 시각을 안 바꾼다(티켓 20). 그래서 스토어가 센 훅
  // 사건 수가 따로 온다. 그 수가 0이 아니면 에이전트가 아직 말하고 있는 것이라 추론을 버린다.
  it("그사이 훅이 하나라도 왔으면 버린다 — 시각을 안 바꾸는 서브에이전트 사건도", () => {
    const 수만바뀜 = nextAttention(직전, hook("claude", "SubagentStart", 실측_SubagentStart, { at: 40, subagents: 1 }));
    // 앵커: 이 사건은 정말로 시각도 종류도 안 바꿨다 — 상태만 보면 「같다」로 읽힌다.
    expect(수만바뀜?.since).toBe(직전.since);
    expect(수만바뀜?.kind).toBe("working");
    expect(inferInterrupt(직전, 수만바뀜, 1, 700)).toBe(수만바뀜);
    expect(inferInterrupt(직전, 직전, 1, 700)).toBe(직전);
  });

  it.each([
    ["새 사실이 왔다(시각)", { ...직전, since: 30 }],
    ["승인 요청으로 바뀌었다", { ...직전, kind: "waiting" as const }],
    ["턴이 끝났다", { ...직전, kind: "done" as const, since: 30 }],
  ])("상태가 바뀌었으면 버린다 — %s", (_이름, 지금) => {
    expect(inferInterrupt(직전, 지금, 0, 700)).toBe(지금);
  });

  it("그사이 상태가 없어졌으면 없음 그대로다", () => {
    expect(inferInterrupt(직전, null, 0, 700)).toBeNull();
  });

  // **기다림에서의 Esc는 승인 거절이다**(S30) — 사람이 답한 것이고 그 답은 훅이 말한다. 확인할 것 · 조용한 셸에는 풀
  // 도는 중이 없다. 셋 다 지금 값을 그대로 준다.
  it.each([
    ["기다림", 기다리던것],
    ["확인할 것", 끝난것],
  ] as const)("도는 중이 아니면 안 한다 — %s", (_이름, 그것) => {
    expect(inferInterrupt(그것, 그것, 0, 700)).toBe(그것);
  });

  it("아무 상태도 없던 셸은 없음 그대로다", () => {
    expect(inferInterrupt(null, null, 0, 700)).toBeNull();
  });

  // **출처를 가리지 않는다**(S30) — 훅이 세운 도는 중에는 권위가 걸려 있지만, 사람이 누른 키는 훅 밖의 **말**이 아니다.
  // OSC가 세운 도는 중(승인 뒤 다시 흐른 출력)도 같은 키로 풀린다. 에이전트도 가리지 않는다.
  it.each([
    ["훅 · claude", 직전],
    ["훅 · codex", { ...직전, agent: "codex" }],
    ["OSC", { ...직전, source: "osc" as const, agent: null }],
  ])("출처를 가리지 않는다 — %s", (_이름, 도는중) => {
    expect(inferInterrupt(도는중, 도는중, 0, 700)).toBeNull();
  });

  // 스펙 Testing › 판 03의 줄. 끊은 뒤 늦게 닿은 서브에이전트 사건은 **수만 고칠 상태가 없어** 아무것도 안 세운다 —
  // 도는 중이 되살아나면 끊은 턴이 다시 굳는다.
  it("Stop(수 2) → 중단 추론 → 늦은 SubagentStop → 상태 없음 그대로", () => {
    const 멈춤 = hook("claude", "Stop", { last_assistant_message: "서브에이전트 둘을 띄웠어요" }, { at: 10, subagents: 2, stopped: true });
    const 도는중 = 차례로(직전, 멈춤);
    expect(도는중).toEqual(훅상태({ message: "서브에이전트 둘을 띄웠어요", subagents: 2 }));

    const 끊긴뒤 = inferInterrupt(도는중, 도는중, 0, 700);
    expect(끊긴뒤).toBeNull();

    const 늦은끝 = hook("claude", "SubagentStop", 실측_SubagentStop, { at: 30, subagents: 1, stopped: true });
    expect(nextAttention(끊긴뒤, 늦은끝)).toBeNull();
  });
});

// ── 에이전트 사라짐(프로세스 결정 12 · S31). 1초마다 오는 `pty:running`에서 그 셸의 도는 명령이 에이전트 이름(claude ·
// codex)에서 **다른 것이나 없음으로** 바뀌면 에이전트가 사라진 것이다 — kill이든 크래시든 `/exit`이든. 결과는 `end`와
// 같다: 도는 중 · 기다림은 지우고, 안 본 확인할 것은 남긴다. 그리고 **권위가 풀린다**(아래 권위 표).
describe("에이전트 사라짐 — 프로세스 결정 12", () => {
  it.each([
    ["claude", "zsh"],
    ["claude", null],
    ["codex", null],
    // 다른 에이전트로 바뀐 것도 앞의 에이전트는 사라진 것이다.
    ["claude", "codex"],
  ] as const)("%s → %s: 도는 중 · 기다림은 지운다", (before, after) => {
    expect(nextOnRunning(직전, before, after, 50)).toBeNull();
    expect(nextOnRunning(기다리던것, before, after, 50)).toBeNull();
    expect(nextOnRunning(null, before, after, 50)).toBeNull();
  });

  // **`end`와 같다**를 줄마다 옮겨 적지 않고 견준다 — 멈추지 않은 세션 끝(`stopped: false`)이 그 짝이다. 사라짐은 멈춤을
  // 모른다(`NO_HOOK_COUNTS`): 서브에이전트가 돌던 멈춘 턴도 프로세스가 사라졌으면 도는 것이 없다.
  it.each([
    ["도는 중", 직전],
    ["서브에이전트가 도는 멈춘 턴", { ...직전, subagents: 2 }],
    ["기다림", 기다리던것],
    ["확인할 것", 끝난것],
    ["없음", null],
  ] as const)("결과의 종류가 멈추지 않은 세션 끝과 같다 — %s", (_이름, prev) => {
    const 끝 = nextAttention(prev, hook("claude", "SessionEnd", 실측_SessionEnd, { at: 50 }));
    expect(nextOnRunning(prev, "claude", "zsh", 50)?.kind).toBe(끝?.kind);
  });

  // 남기는 것이지 새로 세우는 것이 아니다 — 시각도 「봤다」도 말도 그대로라 알림이 다시 안 운다. 바뀌는 것은 출처 하나다:
  // 그 값을 지키던 권위가 사라졌다(`gone`).
  it("안 본 확인할 것은 남는다 — 출처만 「사라짐」이 된다", () => {
    expect(nextOnRunning(끝난것, "claude", "zsh", 50)).toEqual({ ...끝난것, source: "gone" });
    const 본것 = { ...끝난것, seen: true };
    expect(nextOnRunning(본것, "claude", null, 50)).toEqual({ ...본것, source: "gone" });
  });

  it("한 번 풀린 것은 다시 사라져도 같은 객체다", () => {
    const 풀린것 = nextOnRunning(끝난것, "claude", "zsh", 50);
    expect(nextOnRunning(풀린것, "codex", null, 60)).toBe(풀린것);
  });

  // **사라진 것이 아니면 아무것도 안 바꾼다** — 같은 객체다. 에이전트가 새로 뜬 것, 그대로인 것, 에이전트가 아닌 명령이
  // 바뀐 것(`node` → `zsh`) 모두다. 옛 claude가 `node`로 뜨는 기계에서도 권위가 저절로 안 풀린다.
  it.each([
    [null, "claude"],
    ["claude", "claude"],
    ["node", "zsh"],
    ["zsh", null],
    [null, null],
  ] as const)("%s → %s: 사라진 것이 아니다 — 같은 객체다", (before, after) => {
    for (const prev of [직전, 기다리던것, 끝난것]) expect(nextOnRunning(prev, before, after, 50)).toBe(prev);
  });
});

/**
 * 소유자 키 하나. **모드를 여기서만 적는다** — 이 파일이 재는 것은 상태 축이라 세계는
 * 배경이고, 리터럴로 흩어 두면 소유자 모양이 바뀌는 날 스무 자리가 함께 빨개진다.
 * 인자가 없으면 그 세계의 최상위다.
 */
const 소유 = (slug = "") => ownerOf("atelier", slug);

// 셸 한 칸을 세운다. 여기서 재는 것은 상태 축뿐이라 이름·소유자 같은 칸은 아무 값이나 든다.
const 칸 = (attention: Attention | null, status: Shell["status"] = { kind: "running" }): Shell => ({
  id: 1,
  status,
  title: null,
  shellName: "zsh",
  owner: 소유(),
  project: null,
  cwd: null,
  running: null,
  attention,
  auto: false,
  firstInput: null,
  orphaned: false,
});

const 상태 = (over: Partial<Attention> = {}): Attention => ({
  kind: "waiting",
  message: "커밋할까요?",
  since: 100,
  seen: false,
  source: "hook",
  // 훅이 말한 상태에는 **늘** 누가 말했는지가 실려 있다 — 그것이 기본값인 이유다.
  // 없는 쪽(OSC·벨)을 재는 자리에서만 `null`로 덮는다.
  agent: "claude",
  subagents: 0,
  subagentId: null,
  ...over,
});

describe("화면값", () => {
  it.each([
    ["기다림은 그대로 선다", 상태({ kind: "waiting" }), "waiting"],
    ["안 본 완료는 초록이다", 상태({ kind: "done", seen: false }), "done"],
    // **본 완료는 아무것도 안 그린다**(결정 7). `kind`는 그대로 `done`이고 화면값만 없다 —
    // 사실을 지우는 게 아니라 안 그리는 것이다.
    ["본 완료는 아무것도 아니다", 상태({ kind: "done", seen: true }), null],
    // **기다림은 「봤다」로 안 꺼진다**(결정 7). 봤다고 답이 써진 것은 아니다.
    ["본 기다림도 그대로 선다", 상태({ kind: "waiting", seen: true }), "waiting"],
    ["도는 중은 봤든 안 봤든 그대로다", 상태({ kind: "working", seen: true }), "working"],
    ["아무것도 안 온 셸은 아무것도 아니다", null, null],
  ] as const)("%s", (_이름, attention, signal) => {
    expect(signalOf(칸(attention))).toBe(signal);
  });

  // **죽은 칸의 상태는 눕는다.** 정상 종료는 레지스트리가 칸을 통째로 빼므로 여기 올 일이
  // 없고, 남는 것은 이유가 있는 끝뿐이다 — 그 칸에 앰버가 굳어 있으면 영영 나를 부른다.
  // 가름을 여기 하나에 두는 것은 `runningOn`과 같은 이유다: 읽는 화면마다 가르면 한쪽이
  // 빠뜨린다. 뒤늦게 도착한 훅 이벤트도 이 문에서 함께 막힌다.
  it.each([
    ["비정상 종료", { kind: "exited", exit: { exitCode: 1, signal: null } }],
    ["못 뜬 칸", { kind: "failed", reason: "폴더가 없어요" }],
  ] as const)("%s한 셸은 아무 주장도 안 한다", (_이름, status) => {
    expect(signalOf(칸(상태(), status))).toBeNull();
    expect(attentionOn(칸(상태(), status))).toBeNull();
  });
});

// 우선순위(결정 3)와 띠 정렬(결정 5·8). 둘 다 화면값만 읽는다 — `kind`를 직접 세면 「본
// 완료」가 셈에 남아 행이 초록인데 띠에는 없는 어긋남이 난다.
const 칸들 = (...list: ReadonlyArray<Attention | null>): ReadonlyArray<Shell> =>
  list.map((attention, index) => ({ ...칸(attention), id: index + 1 }));

describe("work 하나의 값은 최고 하나다", () => {
  it.each([
    ["기다림이 안 본 완료를 이긴다", [상태({ kind: "done" }), 상태({ kind: "waiting" })], "waiting"],
    ["기다림이 도는 중을 이긴다", [상태({ kind: "working" }), 상태({ kind: "waiting" })], "waiting"],
    ["안 본 완료가 도는 중을 이긴다", [상태({ kind: "working" }), 상태({ kind: "done" })], "done"],
    ["도는 중뿐이면 도는 중이다", [상태({ kind: "working" }), null], "working"],
    ["아무것도 없으면 없다", [null, null], null],
    // 본 완료는 화면값이 없다 — 셈에서도 빠진다. 아니면 행은 아무것도 안 그리는데 띠에는
    // 그 셸이 서는 어긋남이 난다.
    ["본 완료만 있으면 없다", [상태({ kind: "done", seen: true })], null],
  ] as const)("%s", (_이름, list, signal) => {
    expect(topSignal(칸들(...list))).toBe(signal);
  });

  it("죽은 칸은 안 센다", () => {
    const 죽은칸 = { ...칸(상태({ kind: "waiting" }), { kind: "failed", reason: "없어요" }), id: 9 };
    expect(topSignal([죽은칸])).toBeNull();
  });
});

// **행이 그리는 것은 값 하나가 아니라 한 줄이다**(#203). 레인의 점·링은 화면값이 정하지만
// 둘째 줄은 그 값을 **낸 셸**의 말과 시각과 마크까지 든다 — 그 넷이 다른 함수에서 나오면
// 행이 「A 셸의 색으로 B 셸의 말」을 적을 수 있다. 스토리 79가 막으려는 어긋남이 그것이라
// 이기는 셸을 고르는 자리를 하나로 둔다.
describe("행이 읽는 한 줄", () => {
  const 칸이 = (over: Partial<Shell>): Shell => ({ ...칸(null), ...over });

  it("이긴 셸의 말·시각·도는 것이 값과 함께 나온다", () => {
    const list = [
      칸이({ id: 1, attention: 상태({ kind: "done", message: "PR 열었다", since: 30 }), running: "codex" }),
      칸이({ id: 2, attention: 상태({ kind: "waiting", message: "커밋할까요?", since: 50 }), running: "claude" }),
    ];
    expect(topSignalView(list)).toEqual({
      kind: "waiting",
      message: "커밋할까요?",
      since: 50,
      running: "claude",
    });
  });

  // **마크도 죽은 칸을 딛고 온다.** `runningOn`이 끝난 칸의 마지막 값을 가리는 것과 같은
  // 가름이라, 여기서 `shell.running`을 그냥 읽으면 죽은 셸의 로고가 행에 남는다.
  it("도는 것도 말한 에이전트도 없으면 마크가 없다", () => {
    const list = [칸이({ id: 1, attention: 상태({ kind: "waiting", agent: null }), running: null })];
    expect(topSignalView(list)?.running).toBeNull();
  });

  // **초록 행에 마크가 서는 자리가 여기다.** 초록은 **남는** 값이라(`end`가 안 본 확인할 것을 남긴다 —
  // 프로세스 결정 13) 그 셸에서 에이전트가 나간 뒤에도 선다: 세션이 끝나면 1초 폴링이 다음 바퀴에
  // `running`을 눕히고, 벨은 정의상 「아는 에이전트 마크가 없을 때」만 초록이 된다. 그래서 마크의 재료를 「지금
  // 도는 것」에서만 뽑으면 그 초록 행의 둘째 줄은 말과 경과 둘뿐이고, 티켓과 스펙이 못박은
  // `[마크] [말] [경과]` 셋이 그 갈래에서만 조용히 깨진다(목업의 초록 예시가 바로 `codex`
  // 셸이다). 상태가 「누가 말했나」를 함께 들고 다니는 것이 그 자리를 메운다.
  it("세션이 끝나 도는 것이 없어도 말한 에이전트가 마크를 낸다", () => {
    const list = [칸이({ id: 1, attention: 상태({ kind: "done", agent: "codex" }), running: null })];
    expect(topSignalView(list)?.running).toBe("codex");
  });

  // 지금 도는 것이 있으면 그쪽이 이긴다 — 「이 셸이 지금 무엇을 물고 있나」가 더 새로운
  // 사실이다. 훅이 claude라고 말한 뒤 사람이 codex를 띄웠으면 행은 codex를 보여야 한다.
  it("도는 것이 있으면 그것이 마크를 낸다", () => {
    const list = [칸이({ id: 1, attention: 상태({ kind: "done", agent: "claude" }), running: "codex" })];
    expect(topSignalView(list)?.running).toBe("codex");
  });

  it("화면값이 없으면 줄도 없다", () => {
    expect(topSignalView(칸들(null, 상태({ kind: "done", seen: true })))).toBeNull();
  });

  // **`topSignal`이 이 함수를 딛는다.** 우선순위를 아는 자리가 둘이면 레인과 둘째 줄이
  // 다른 셸을 고를 수 있다.
  it("값만 묻는 자리도 같은 줄을 딛는다", () => {
    const list = 칸들(상태({ kind: "working" }), 상태({ kind: "done" }));
    expect(topSignal(list)).toBe(topSignalView(list)?.kind);
  });
});

// 사이드바가 **한 번에** 읽는 값(#203). 행마다 구독하지 않는 것은 이 Record가 문자열만
// 담기 때문이다 — 얕은 비교가 그대로 먹어 상태가 실제로 바뀔 때만 목록이 다시 그려진다
// (`shellCountsOf` 머리말이 든 그 함정의 반대편).
describe("소유자별 화면값", () => {
  const 셸 = (owner: ShellOwner, attention: Attention | null, id: number): Shell => ({
    ...칸(attention),
    id,
    owner,
  });

  it("work마다 최고 하나이고, 값이 없는 work은 키 자체가 없다", () => {
    const state = {
      shells: [
        셸(소유("가"), 상태({ kind: "working" }), 1),
        셸(소유("가"), 상태({ kind: "waiting" }), 2),
        셸(소유("나"), null, 3),
        셸(소유("다"), 상태({ kind: "done" }), 4),
      ],
      activeByOwner: {},
      nextId: 5,
    };
    expect(signalsOf(state, "atelier")).toEqual({ 가: "waiting", 다: "done" });
  });

  // 최상위 셸은 어느 work의 것도 아니라 행이 없다 — 빈 문자열 키가 슬러그인 척하면
  // 그 키를 읽는 행이 영영 안 나온다(`shellCountsOf`와 같은 가름).
  it("최상위 셸은 안 든다", () => {
    const state = { shells: [셸(소유(), 상태({ kind: "waiting" }), 1)], activeByOwner: {}, nextId: 2 };
    expect(signalsOf(state, "atelier")).toEqual({});
  });
});

describe("띠에 서는 목록", () => {
  it("기다림 먼저, 같은 종류 안에서는 오래된 순이다", () => {
    const list = 칸들(
      상태({ kind: "done", since: 30 }),
      상태({ kind: "waiting", since: 50 }),
      상태({ kind: "done", since: 10 }),
      상태({ kind: "waiting", since: 20 }),
    );
    expect(callingShells(list).map((one) => one.shell.id)).toEqual([4, 2, 3, 1]);
  });

  // **판정을 안 버린다**(#204 리뷰). 「누가 부르나」를 정하면서 이미 읽은 것을 그대로
  // 들려 보내야 읽는 쪽(`bandRows` · #206의 배지)이 같은 문을 다시 딛지 않는다 — 두 번
  // 판정하면 두 자리가 **다르게** 판정하는 날이 오고, 실제로 그랬다(한쪽은 `?? 0`으로
  // 1970년을 만들고 다른 쪽은 줄을 안 그렸다).
  it("어떤 부름인지와 언제부터인지를 함께 들고 나온다", () => {
    const list = 칸들(상태({ kind: "done", since: 30 }), 상태({ kind: "waiting", since: 50 }));
    expect(callingShells(list).map((one) => ({ kind: one.kind, since: one.attention.since }))).toEqual(
      [
        { kind: "waiting", since: 50 },
        { kind: "done", since: 30 },
      ],
    );
  });

  // 띠에 서는 것은 **부르는 셸**뿐이다(결정 8) — 도는 중과 본 완료와 조용한 셸은 안 든다.
  it("도는 중·본 완료·조용한 셸은 안 든다", () => {
    const list = 칸들(
      상태({ kind: "working" }),
      상태({ kind: "done", seen: true }),
      null,
      상태({ kind: "waiting" }),
    );
    expect(callingShells(list).map((one) => one.shell.id)).toEqual([4]);
  });

  it("부르는 셸이 없으면 빈 목록이다 — 띠 자체가 없다", () => {
    expect(callingShells(칸들(상태({ kind: "working" }), null))).toEqual([]);
  });
});

// **띠가 그리는 줄**(#204). 위 `callingShells`가 「누가 부르나」와 그 차례를 정하고, 여기서
// 줄 하나가 지는 것이 붙는다 — 어느 화면으로 가는가(`owner`) · 어느 칸을 켜는가(`id`) ·
// 마크의 재료 · 그리고 **셸 이름을 붙이는가**.
//
// 셸 이름의 조건이 이 함수 안에 있는 이유는 그것이 **줄 하나로는 못 내는 판정**이기
// 때문이다: 「이 work에서 부르는 셸이 둘 이상인가」는 목록 전체를 봐야 안다. 그리는 쪽에
// 두면 띠가 스스로 무리를 세게 되고, 그 셈이 정렬과 갈리면 이름이 엉뚱한 줄에 붙는다.
describe("띠의 줄", () => {
  const 칸이 = (over: Partial<Shell>): Shell => ({ ...칸(null), ...over });
  const 화면 = (...shells: ReadonlyArray<Shell>): ShellsState => ({
    shells,
    activeByOwner: {},
    nextId: shells.length + 1,
  });

  it("부르는 셸이 없으면 줄이 하나도 없다 — 띠 자체가 없다", () => {
    expect(bandRows(
      화면(칸이({ id: 1, owner: 소유("가"), attention: 상태({ kind: "working" }) })), "atelier")).toEqual([]);
  });

  // **차례는 화면을 가리지 않는다.** 최상위 셸도 같은 줄 세우기에 든다(결정 13의 다섯째) —
  // 빼면 거기서 부를 때 어디에도 안 보인다.
  it("기다림 먼저, 같은 종류 안에서는 오래된 순이다 — 최상위 셸도 함께 선다", () => {
    const rows = bandRows(
      화면(
        칸이({ id: 1, owner: 소유("가"), attention: 상태({ kind: "done", since: 30 }) }),
        칸이({ id: 2, owner: 소유(), attention: 상태({ kind: "waiting", since: 50 }) }),
        칸이({ id: 3, owner: 소유("나"), attention: 상태({ kind: "waiting", since: 20 }) }),
        칸이({ id: 4, owner: 소유("가"), attention: 상태({ kind: "done", since: 10 }) }),
      ),
    "atelier",
    );
    expect(rows.map((row) => row.id)).toEqual([3, 2, 4, 1]);
    expect(rows.map((row) => row.owner)).toEqual([소유("나"), 소유(), 소유("가"), 소유("가")]);
    expect(rows.map((row) => row.kind)).toEqual(["waiting", "waiting", "done", "done"]);
    expect(rows.map((row) => row.since)).toEqual([20, 50, 10, 30]);
  });

  // 한 화면에서 **부르는** 셸이 둘 이상일 때만 붙는다(결정 5). 이름은 탭에 적히는 것과
  // 같은 규칙이라 그 함수를 딛는다 — 두 벌이 되면 띠와 탭이 같은 셸을 다르게 부른다.
  it("한 화면에서 둘이 부르면 줄마다 셸 이름이 붙는다", () => {
    const rows = bandRows(
      화면(
        칸이({ id: 1, owner: 소유("가"), title: "vite", attention: 상태({ kind: "waiting", since: 10 }) }),
        칸이({ id: 2, owner: 소유("가"), title: "claude", attention: 상태({ kind: "waiting", since: 20 }) }),
      ),
    "atelier",
    );
    expect(rows.map((row) => row.shellName)).toEqual(["vite", "claude"]);
  });

  it("하나만 부르면 안 붙는다 — 그 화면에 조용한 셸이 더 있어도", () => {
    const rows = bandRows(
      화면(
        칸이({ id: 1, owner: 소유("가"), title: "vite", attention: 상태({ kind: "waiting" }) }),
        칸이({ id: 2, owner: 소유("가"), title: "claude", attention: null }),
        칸이({ id: 3, owner: 소유("가"), title: "cargo", attention: 상태({ kind: "done", seen: true }) }),
      ),
    "atelier",
    );
    expect(rows.map((row) => row.shellName)).toEqual([null]);
  });

  // 최상위 셸도 한 화면이다 — 거기서 둘이 부르면 이름이 붙고, work의 셸과 섞이지 않는다.
  it("최상위 셸끼리도 자기들끼리 센다", () => {
    const rows = bandRows(
      화면(
        칸이({ id: 1, owner: 소유(), title: "claude", attention: 상태({ kind: "waiting", since: 10 }) }),
        칸이({ id: 2, owner: 소유("가"), title: "codex", attention: 상태({ kind: "waiting", since: 20 }) }),
      ),
    "atelier",
    );
    expect(rows.map((row) => row.shellName)).toEqual([null, null]);
  });

  // **마크의 재료는 행과 같은 규칙이다**(`topSignalView`) — 지금 도는 것이 먼저이고,
  // 없으면 그 상태를 말한 에이전트다. 초록 줄에 마크가 서는 자리가 그 둘째 갈래다.
  it("도는 것이 먼저, 없으면 말한 에이전트가 마크를 낸다", () => {
    const rows = bandRows(
      화면(
        칸이({ id: 1, owner: 소유("가"), running: "codex", attention: 상태({ kind: "waiting", since: 10, agent: "claude" }) }),
        칸이({ id: 2, owner: 소유("나"), running: null, attention: 상태({ kind: "waiting", since: 20, agent: "claude" }) }),
        칸이({ id: 3, owner: 소유("다"), running: null, attention: 상태({ kind: "waiting", since: 30, agent: null }) }),
      ),
    "atelier",
    );
    expect(rows.map((row) => row.running)).toEqual(["codex", "claude", null]);
  });
});

// **「봤다」의 판정은 여기 하나다**(결정 7). 탭 물들임(#205)과 알림 억제(#206)가 같은 함수를
// 쓴다 — 두 벌이 되면 한쪽에서만 초록이 꺼진다.
describe("「봤다」", () => {
  it("켜진 탭 + 창 포커스면 봤다", () => {
    expect(isShellSeen(3, { activeIds: [3], focused: true })).toBe(true);
  });

  // 창이 뒤에 있으면 화면에 떠 있어도 사람이 본 것이 아니다. 이 앱은 창이 하나라
  // 「어느 창인가」를 물을 것이 없다.
  it("창이 포커스가 아니면 안 봤다", () => {
    expect(isShellSeen(3, { activeIds: [3], focused: false })).toBe(false);
  });

  it("안 켜진 탭은 안 봤다", () => {
    expect(isShellSeen(4, { activeIds: [3], focused: true })).toBe(false);
  });

  // **분할 중이면 켜진 탭이 둘이고 둘 다 봤다.** 하나만 세면 다른 열의 초록이 안 꺼진다.
  it.each([3, 7])("분할 중 켜진 탭 둘 다 봤다 — %i", (id) => {
    expect(isShellSeen(id, { activeIds: [3, 7], focused: true })).toBe(true);
  });

  // 사이드바에 마우스를 올린 것도, 호버 카드를 띄운 것도 「봤다」가 아니다 — 판정에 그런
  // 입력 자체가 없다는 것이 이 줄이다.
  it("켜진 탭이 없으면 아무도 안 봤다", () => {
    expect(isShellSeen(3, { activeIds: [], focused: true })).toBe(false);
  });
});

// **판정을 상태에 적어 넣는 자리**(#205). 위 `isShellSeen`이 「이 셸을 지금 보고 있나」를
// 말하고, 이 함수가 그 답을 목록 전체에 한 번에 앉힌다 — 탭 물들임과 알림 억제가 **같은
// 판정을 같은 순간에** 쓰려면 그 앉히는 자리도 하나여야 한다.
describe("보고 있는 셸에 「봤다」를 앉힌다", () => {
  const 목록 = (...list: ReadonlyArray<Attention | null>): ShellsState => ({
    shells: 칸들(...list),
    activeByOwner: {},
    nextId: list.length + 1,
  });

  it("켜진 칸의 안 본 완료가 지워지고, 기다림은 남는다", () => {
    // 결정 7. 「봤다」가 지우는 것은 **안 본 완료 하나**다 — 본 것과 답한 것은 다르다.
    const state = 목록(상태({ kind: "done" }), 상태({ kind: "waiting" }));
    const 뒤 = markShellsSeen(state, { activeIds: [1, 2], focused: true });
    expect(signalOf(뒤.shells[0])).toBeNull();
    expect(signalOf(뒤.shells[1])).toBe("waiting");
  });

  it("창이 뒤에 있으면 아무것도 안 지워진다 — 상태도 그대로다", () => {
    // 화면에 떠 있어도 사람이 본 것이 아니다. **같은 객체로 남는 것**까지 재는 것은
    // 이 함수가 창을 눌렀다 뗄 때마다 불릴 자리라서다(`markSeen` 머리말).
    const state = 목록(상태({ kind: "done" }));
    expect(markShellsSeen(state, { activeIds: [1], focused: false })).toBe(state);
  });

  it("안 켜진 칸은 안 건드린다", () => {
    const state = 목록(상태({ kind: "done" }), 상태({ kind: "done" }));
    const 뒤 = markShellsSeen(state, { activeIds: [1], focused: true });
    expect(signalOf(뒤.shells[0])).toBeNull();
    expect(signalOf(뒤.shells[1])).toBe("done");
  });

  // **여럿을 받는 계약**(결정 7의 「분할 중이면 켜진 탭이 둘」). 하나만 세면 다른 열의
  // 초록이 안 꺼진다.
  //
  // **이 앱은 아직 그 화면을 못 만든다** — 분할의 조합이 늘 `spec ▏터미널`이라(결정 87)
  // 셸 열이 하나뿐이고, 배선(`terminal-store`의 `shownShell`)도 그래서 하나다. 그러니
  // 스토리 51이 사는 자리는 지금 이 층뿐이고, 그 사정은
  // `spec/물음-봤다의-셋째-조건.md`가 사람에게 열어 두고 있다.
  it("켜진 칸이 둘이면 둘 다 봤다", () => {
    const state = 목록(상태({ kind: "done" }), null, 상태({ kind: "done" }));
    const 뒤 = markShellsSeen(state, { activeIds: [1, 3], focused: true });
    expect([signalOf(뒤.shells[0]), signalOf(뒤.shells[2])]).toEqual([null, null]);
  });

  // 판정이 두 벌이 되면 탭에서만 초록이 꺼지거나 알림만 조용해진다. 소스로 못박는다 —
  // 이 함수는 스스로 조건을 적지 않고 `isShellSeen`을 부른다.
  it("판정을 다시 적지 않고 `isShellSeen`을 부른다", () => {
    // **본문의 끝을 표식으로 닫는다.** 파일 끝까지를 「본문」으로 삼으면 이 함수 **아래**에
    // 사는 아무 함수·주석이 그 글자를 갖게 되는 날, 본문이 조건을 손으로 다시 적어도 초록이
    // 된다 — 이 저장소는 그 fail-open으로 이미 데었다(`ShellTabs.test.tsx`의 `cellsOf`
    // 머리말). 시작 표식이 없으면 `slice(-1)`이 되어 빨개지고, 끝 표식이 없으면 여기서
    // 던진다: 경계가 표식이면 샐 자리가 없다.
    const source = read("shell-attention.ts");
    const 시작 = source.indexOf("export function markShellsSeen");
    if (시작 < 0) throw new Error("`markShellsSeen`을 못 찾았다 — 이름이 바뀌었나");
    const 뒤 = source.slice(시작);
    const 끝 = 뒤.indexOf("\n}\n");
    if (끝 < 0) throw new Error("`markShellsSeen`의 끝을 못 찾았다");
    expect(뒤.slice(0, 끝)).toContain("isShellSeen(");
  });
});

// **시간 상수도 만료도 타이머도 없다**(결정 2·3). 이 축에서 상태를 만드는 것은 에이전트가
// 말한 순간 하나뿐이고 지우는 것은 사람이 본 순간 하나뿐이다 — 「몇 초 조용하면 끝난 것」이
// 한 줄이라도 들어오면 앱이 모르는 것을 아는 척하기 시작한다.
//
// terminal-activity-signal 결정 2를 프로세스 결정 12가 이렇게 고쳤다: **사람이 누른 중단 키(Esc · Ctrl-C) 뒤의 한 순간만**
// 잰다(중단 추론). 그 시계와 상수는 터미널 스토어에 있고(아래 첫 줄 — 목록은 그대로 셋이다), 상태 기계는 「누른 순간의
// 값 · 지금 값 · 그사이 온 훅 수」만 견준다(`inferInterrupt` — 위 「중단 추론」 표). TTL은 여전히 없다.
//
// **대상을 손으로 적지 않는다**(#208 리뷰). 한때 축의 파일 여섯을 목록으로 들고 있었는데,
// 그 모양은 축에 파일이 하나 늘 때 **조용히 빠진다** — 이 판이 더한 `shell-osc.ts`가 실제로
// 그렇게 빠졌다. 그래서 터미널 트리를 통째로 읽어 **시간을 아는 파일의 목록이 아래 셋과
// 정확히 같은지**를 본다(옆의 `상태값을만지는파일`과 같은 모양). 「축에 없다」가 아니라
// 「이 셋뿐이다」라서, 새 파일이 시계를 들이면 여기서 이름을 대며 터지고 스캔이 통째로
// 헛돌아도 터진다(fail-closed).
//
// 소스를 **문자열로만** 본다. 자르거나 파싱하는 정규식은 파서가 새는 순간 조용히 통과하고,
// 이 저장소는 그것을 fail-open이라 부른다(shell-registry.test.ts 머리말).
const 시계 = [
  "setTimeout",
  "setInterval",
  "requestAnimationFrame",
  // 프레임 루프를 `@/lib`에 감싸 두어도 부르는 이름으로 잡는다 — 감싼 모듈 안의
  // `requestAnimationFrame`은 이 트리 밖이라 문자열로는 안 보인다.
  "everyFrame",
  "Date.now",
  "performance.now",
  "new Date",
  "expire",
  "_MS",
  "TIMEOUT",
];

// **여기 이름을 더하는 것은 「이 파일은 시간을 안다」는 선언이다.** 상태 축이 그 목록에
// 들어오면 결정 2·3이 깨진 것이다 — 셋 다 상태 축 밖의 이유로 시간을 안다.
//
// 한때 `shell-registry.ts`가 셋째였다 — ⇧⇧ 사이의 간격(`SEARCH_GAP_MS`)을 재느라. 팔레트
// 판이 그 키를 ⌘K로 갈면서 상수가 통째로 걷혔고, 그 파일은 다시 시간을 모른다.
const 시간을아는파일 = [
  // 신호가 **도착한 순간**을 재료로 넣는 자리(`Date.now()` → `applySignal`의 `since`).
  // 재는 것이지 판정하는 것이 아니다 — 그 값으로 무엇이 되는지를 정하는 코드는 없다. 중단 추론이 누른 뒤
  // 기다리는 시계(프로세스 결정 12 · S29)도 여기 있다 — 기다릴 뿐이고, 중단인지는 상태 기계가 가른다.
  "terminal-store.ts",
  // 같은 work의 알림을 접는 5초 창(`COALESCE_MS` · 결정 10). **알림의 시간이지 상태의
  // 시간이 아니다** — 화면값은 그 5초에 한 글자도 안 매인다.
  "shell-notify.ts",
  // 끄는 동안 줄 가장자리의 자동 스크롤(`everyFrame`). **제스처의 박자지 상태의 시간이
  // 아니다** — 굴리는 것은 `scrollLeft`와 틈 알림뿐이고 셸 상태는 한 글자도 안 만진다.
  "ShellTabs.tsx",
];

it("터미널에서 시간을 아는 파일은 셋뿐이다 — 상태 축엔 시계도 타이머도 없다", () => {
  const root = fileURLToPath(new URL("./", import.meta.url));
  const 아는것 = readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
    .map((file) => file.split("\\").join("/"))
    .filter((file) => 시계.some((one) => readFileSync(root + file, "utf8").includes(one)));

  expect(아는것.sort()).toEqual([...시간을아는파일].sort());
});

// **칸이 늘면 여기서 터진다.** `nextAttention`의 「안 바뀌면 받은 것을 그대로 준다」와
// `shell-registry`의 `setAttention`이 그 판정 하나에 매달려 있는데, 견주는 칸이 손으로
// 적혀 있어(`same`) 아홉째가 늘면 그 칸만 조용히 안 견줘진다 — 값이 바뀌었는데 화면이 안 바뀐다.
//
// **일곱째가 서브에이전트 수다**(프로세스 스펙 S51). 옆 맵에 두지 않은 것은 셸 탭 툴팁과 `Processes` 셸 행이 상태와
// **같은 문**(`attentionOn`의 죽은 칸 가리개)을 딛고 읽게 하려는 것이다 — 맵이 따로면 죽은 칸의 수가 남는다.
// **여덟째가 그 사실을 낸 서브에이전트다**(티켓 20 리뷰 반영) — 기다림을 푸는 도구가 그 기다림을 낸 에이전트의 것인지를
// 견주려면 기다림이 선 뒤에도 들고 있어야 한다. `stopped`는 여기 없다: 셸 상태의 칸이 아니라 사건에 실려 오는 값이다
// (전이에만 쓴다).
it("상태에 든 칸은 정확히 여덟이다", () => {
  const 상태값 = applySignal(null, { event: "waiting", message: "물음" }, 10, "hook", "claude", NO_HOOK_COUNTS);
  expect(Object.keys(상태값 ?? {}).sort()).toEqual([
    "agent",
    "kind",
    "message",
    "seen",
    "since",
    "source",
    "subagentId",
    "subagents",
  ]);
});

// **여덟째 칸도 견준다** — 낸 에이전트만 바뀐 기다림이 「같은 것」으로 삼켜지면, 그 뒤 도구 사건이 옛 에이전트로 견줘진다.
it("낸 서브에이전트만 달라도 새 상태다 — 같은 객체가 아니다", () => {
  const 서브요청 = hook("claude", "PermissionRequest", { tool_name: "Bash", agent_id: "ace905bb8e05c8931" }, { at: 10 });
  const 앉은뒤 = nextAttention(null, 서브요청);
  const 본에이전트요청 = nextAttention(앉은뒤, { ...서브요청, payload: { tool_name: "Bash" } });
  expect(본에이전트요청).not.toBe(앉은뒤);
  expect(본에이전트요청?.subagentId).toBeNull();
});

// **「도는 중 · 서브에이전트 N」의 N을 읽는 문**(S32 · S51). 셸 탭 툴팁이 쓰고 `Processes` 셸 행(27)이 같은 함수를
// 쓴다 — 화면이 `.attention`을 직접 읽으면 아래 소스 스캔이 터진다.
describe("도는 중의 서브에이전트 수", () => {
  it.each([
    ["도는 중이면 그 수", 상태({ kind: "working", subagents: 2 }), 2],
    ["도는 중이라도 없으면 0", 상태({ kind: "working", subagents: 0 }), 0],
    // 도는 중이 아닌 셸의 수는 말하지 않는다 — 「도는 중 · 서브에이전트 N」은 도는 중의 말이다. 확인할 것에 늦은
    // 서브에이전트 사건이 오면 수는 앉지만(전이 표) 그 셸은 부르는 중이다.
    ["확인할 것이면 0", 상태({ kind: "done", subagents: 1 }), 0],
    ["기다림이면 0", 상태({ kind: "waiting", subagents: 1 }), 0],
    ["상태가 없으면 0", null, 0],
  ] as const)("%s", (_이름, attention, 수) => {
    expect(runningSubagents(칸(attention))).toBe(수);
  });

  // **죽은 칸은 아무것도 안 돌린다** — `attentionOn`과 같은 가리개다.
  it("죽은 칸은 0이다", () => {
    expect(runningSubagents(칸(상태({ kind: "working", subagents: 3 }), { kind: "failed", reason: "없어요" }))).toBe(0);
  });
});

// 훅이 아는 이름과 레지스트리가 아는 번호를 잇는 자리. 셸 ID는 `<앱 인스턴스 접두사>-<pty
// id>`라(`pty.rs`의 `shell_id`) 뒤쪽 번호만 되뽑으면 `shellOfPty`가 그다음을 잇는다.
describe("셸 ID에서 pty 번호를 되뽑는다", () => {
  it.each([
    ["1757000000-3", 3],
    ["1757000000-12", 12],
    // 접두사에 `-`가 없다는 보장은 없다. 마지막 `-` 뒤가 번호다.
    ["l3-fixture-7", 7],
  ] as const)("%s → %i", (shellId, ptyId) => {
    expect(ptyIdOf(shellId)).toBe(ptyId);
  });

  // **모르는 모양은 `null`이다.** 여기서 `NaN`이 새면 `shellOfPty`가 아무 칸도 못 찾는
  // 것으로 조용히 지나가고, 왜 상태가 안 앉는지 아무 데서도 안 보인다.
  it.each(["", "1757000000", "1757000000-", "1757000000-abc", "1757000000-3x", "-3"])(
    "%s는 아무 번호도 아니다",
    (shellId) => {
      expect(ptyIdOf(shellId)).toBeNull();
    },
  );
});

// **`shell.attention`을 직접 만지는 파일은 둘뿐이다.**
//
// 죽은 칸을 가리는 자리를 「눕히는 쪽」이 아니라 **읽는 쪽**(`attentionOn`)에 둔 것이 이
// 판의 선택이다(구현 결정 1의 문구는 「눕힌다」인데 `runningOn`과 같은 이유로 가리는 쪽을
// 골랐다 — 늦게 도착한 훅 이벤트까지 같은 문에서 막힌다). 그 선택이 성립하려면 **읽는 쪽이
// 늘 그 문을 딛어야** 하는데, 지금까지 그것을 지키는 것은 `attentionOn`의 주석 한 줄뿐이었다.
// 이 값을 읽는 자리 넷이 붙어 있고(#203 레인 · #204 띠 · #205 탭 · #206 알림), 그중 하나가
// `shell.attention`을 직접 읽으면 **죽은 칸이 사람을 영영 부른다.** 주석만이던 보장에
// 검사를 건다.
//
// **셋이 둘이 됐다**(#208 리뷰). 스토어가 「직전 값」을 뽑는 자리 셋에서 같은 조회를 손으로
// 적고 있었는데, 그것을 레지스트리의 `attentionOfId` 하나로 모으면서 이 필드를 아는 파일이
// 하나 줄었다.
//
// 파싱하지 않는다 — 파일 전체에서 문자열 하나를 세고, 나온 파일의 목록이 허용 목록과
// **정확히 같은지**를 본다. 「적어도 둘에 있다」가 아니라 「이 둘뿐이다」라서, 필드 이름이
// 바뀌어 스캔이 통째로 헛돌면 그것도 여기서 터진다(fail-closed).
const 상태값을만지는파일 = [
  // 쓰는 자리. `setAttention`이 칸에 앉히고 `markSeen`이 「봤다」를 세우며, `attentionOfId`가
  // 「직전에 무엇이었나」를 그대로 돌려준다(리듀서의 입력이다).
  "features/terminal/shell-registry.ts",
  // 가리는 자리. `attentionOn`이 죽은 칸을 여기서 끊는다.
  "features/terminal/shell-attention.ts",
];

it("상태 값을 직접 만지는 파일은 둘뿐이다 — 나머지는 `attentionOn`을 딛는다", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const 만지는것 = readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
    .map((file) => file.split("\\").join("/"))
    .filter((file) => readFileSync(root + file, "utf8").includes(".attention"));

  expect(만지는것.sort()).toEqual([...상태값을만지는파일].sort());
});
