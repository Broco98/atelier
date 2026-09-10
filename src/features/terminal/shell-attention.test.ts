/// <reference types="node" />
// 소스 스캔 한 건 때문에 Node 타입을 끌어온다 — 근거는 shell-registry.test.ts 머리말과 같다.
import { readdirSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { foldHookState } from "./agents";
import {
  applySignal,
  attentionOn,
  bandRows,
  callingShells,
  isShellSeen,
  markShellsSeen,
  ptyIdOf,
  nextAttention,
  nextOnOutput,
  signalOf,
  signalsByOwner,
  topSignal,
  topSignalView,
} from "./shell-attention";
import type { Attention } from "./shell-attention";
import type { Shell, ShellsState } from "./shell-registry";
import type { ShellHookState } from "./types";

const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");

// 상태 축 seam. 순수 함수 하나가 대상이라 렌더도 DOM도 없이 기본 환경(node)에서 돈다
// (shell-registry.test.ts가 선례다). 관찰하는 것은 "에이전트가 말한 것을 넣으면 화면이 읽는
// 값이 무엇이 되는가"이지 안쪽 자료구조가 아니다.

const hook = (agent: string, event: string, payload: unknown = null): ShellHookState => ({
  agent,
  event,
  at: 10,
  payload,
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

describe("claude 어댑터가 실측 페이로드를 그대로 받는다", () => {
  // **이 세 줄이 「우리 가정」이 아니라 「실물」을 재는 자리다.** 나머지 표는 우리가 고른 키만
  // 남긴 축약본이라, 실물 한 장이 통째로 지나가는 것을 보는 자리가 따로 있어야 한다.
  it("실측 `UserPromptSubmit` 한 장 → 도는 중", () => {
    expect(foldHookState(hook("claude", "UserPromptSubmit", 실측_UserPromptSubmit))).toEqual({
      event: "start",
      message: null,
    });
  });

  it("실측 `Stop` 한 장 → 기다림, 말은 첫 줄", () => {
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
  ] as const)("%s → %s", (event, payload, canonical, message) => {
    expect(foldHookState(hook("claude", event, payload))).toEqual({ event: canonical, message });
  });

  // **모르는 이벤트는 아무것도 안 만든다** — 「모르면 아무 주장도 안 한다」(결정 3)가 여기서
  // 시작된다. 훅을 더 걸어 둔 사용자의 `PreToolUse`가 상태를 흔들면 앰버가 이유 없이 켜진다.
  it.each(["PreToolUse", "PostToolUse", "Notification", ""])("모르는 이벤트 %s는 아무것도 아니다", (event) => {
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

  // **`Interrupt`는 직전 말을 지우지 않는다**(전이 표). 사람이 esc로 끊은 것이라 방금까지
  // 하던 말이 곧 맥락이고, 그 자리를 비우면 둘째 줄이 이유 없이 빈다.
  // B-1:321 고유 필드는 `turn_id`·`permission_mode`다.
  it("`Interrupt`는 멈추되 직전 말을 그대로 둔다", () => {
    expect(foldHookState(hook("codex", "Interrupt", { turn_id: "t1", permission_mode: "default" }))).toEqual({
      event: "stop",
      message: null,
    });
  });

  // claude에만 있는 이벤트다. 어댑터가 갈려 있으니 여기서는 아무것도 아니어야 한다 —
  // 한 파일에 몰아 두면 이 가름이 조용히 사라진다.
  it("claude의 `Elicitation`은 codex에서 아무것도 아니다", () => {
    expect(foldHookState(hook("codex", "Elicitation", { message: "어느 쪽?" }))).toBeNull();
  });
});

// **설치되는 이벤트 = 어댑터가 접는 이벤트.** 이 둘은 argv → `atelier-hook.py` → 상태 파일의
// **문자열 하나**로만 이어져 있고 그 사이에 타입이 없다 — 어긋나면 훅은 정상 종료하고 파일도
// 정상으로 쓰이고 어댑터는 `null`을 돌려주며(`shell-attention.ts`의 「모르는 이벤트면 직전
// 그대로」) **어느 층도 안 빨개진다.** 이름 하나를 어댑터에만 더하면 그 훅이 사용자 설정에
// 아예 안 깔려 이벤트가 한 번도 안 오고, 설치 쪽에만 더하면 훅이 매 턴 파일을 쓰는데
// 어댑터가 버려 사용자 홈의 설정만 더러워진다. 그 그물이 필요해지는 바로 그 변경(실패 축의
// `StopFailure` — 결정 12)이 다음 판이라 지금 걸어 둔다.
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

// 스펙의 **전이 표 그대로**다. 재는 것은 「어느 훅 이벤트가 오면 화면이 읽는 kind와 message가
// 무엇이 되는가」 하나 — 어댑터가 무엇으로 접었는지는 이 표의 관심이 아니다.
const 직전 = {
  kind: "working",
  message: "직전에 하던 말",
  since: 1,
  seen: false,
  source: "hook",
  agent: "claude",
} as const;

describe("전이 표", () => {
  // 여기 실린 페이로드도 **밖에서 온 키 그대로**다(위 어댑터 표와 같은 규율 — claude의
  // `prompt`·`last_assistant_message`·`reason`은 실측, 나머지는 연구 표). 이 줄들이 실물과
  // 다른 모양 위에 서면 전이 표 전체가 「구현이 읽기로 한 키」를 재게 된다.
  it.each([
    ["claude", "UserPromptSubmit", { prompt: "고쳐" }, "working", "직전에 하던 말"],
    ["codex", "UserPromptSubmit", { permission_mode: "default" }, "working", "직전에 하던 말"],
    ["claude", "PermissionRequest", { tool_name: "Bash", tool_input: { command: "git push" }, tool_use_id: "toolu_02" }, "waiting", "Bash · git push"],
    ["codex", "PermissionRequest", { turn_id: "t2", tool_name: "shell", tool_input: { command: "rm -rf ." } }, "waiting", "shell · rm -rf ."],
    ["claude", "Elicitation", { mcp_server_name: "atelier", message: "어느 쪽으로 할까요?", elicitation_id: "el_2" }, "waiting", "어느 쪽으로 할까요?"],
    ["claude", "Stop", { last_assistant_message: "테스트 셋 통과 — 커밋할까요?", agent_id: "a2" }, "waiting", "테스트 셋 통과 — 커밋할까요?"],
    ["codex", "Stop", { turn_id: "t2", last_assistant_message: "PR #174 열었다" }, "waiting", "PR #174 열었다"],
    ["codex", "Interrupt", { turn_id: "t2", permission_mode: "default" }, "waiting", "직전에 하던 말"],
    ["claude", "SessionEnd", { reason: "logout" }, "done", "직전에 하던 말"],
    // codex `SessionEnd`는 고유 필드가 없다 — 빈 페이로드가 실물의 모양이다.
    ["codex", "SessionEnd", {}, "done", "직전에 하던 말"],
    // **`clear` 줄**. 스펙 전이 표에서 이 줄은 claude 전용이고, 실물 키는 `reason`이다(실측).
    ["claude", "SessionEnd", { reason: "clear" }, "working", null],
  ] as const)("%s %s → %s", (agent, event, payload, kind, message) => {
    expect(nextAttention(직전, hook(agent, event, payload))).toEqual({
      kind,
      message,
      since: 10,
      seen: false,
      source: "hook",
      // **누가 말했는가도 이 표를 함께 탄다** — 이 값이 없으면 초록 행에 마크가 안 선다
      // (`Attention.agent` 머리말). 훅 길에서는 늘 실린다.
      agent,
    });
  });

  // 훅이 처음 오는 셸에는 직전이 없다. 「직전 유지」가 그때 무엇이 되는지가 이 줄이다.
  it("직전이 없으면 「직전 유지」는 없음이다", () => {
    expect(nextAttention(null, hook("claude", "UserPromptSubmit", { prompt: "고쳐" }))).toEqual({
      kind: "working",
      message: null,
      since: 10,
      seen: false,
      source: "hook",
      agent: "claude",
    });
  });

  // 「PTY 종료 · 셸 닫힘 → 없음」. 감시가 파일이 사라진 것을 `state: null`로 실어 온다.
  it("상태가 사라지면 아무 주장도 안 남는다", () => {
    expect(nextAttention(직전, null)).toBeNull();
  });

  // **같은 파일이 두 번 와도 상태가 그대로다.** 감시가 안 바뀐 셸을 안 싣지만(`shells.rs`의
  // 차분) 그 한 겹에만 기대지 않는다 — 근거가 다른 두 겹이다. 레지스트리의 `setAttention`은
  // 이 항등성만 보고 칸을 갈아 끼울지 정하므로, 여기가 새면 사이드바가 이유 없이 다시 그려진다.
  it("같은 것이 다시 와도 상태가 그대로다 — 같은 객체다", () => {
    const 한장 = hook("claude", "Stop", { last_assistant_message: "커밋할까요?" });
    const 앉은뒤 = nextAttention(직전, 한장);
    expect(nextAttention(앉은뒤, 한장)).toBe(앉은뒤);
  });

  // **모르는 이벤트는 직전을 흔들지 않는다.** 어댑터가 `null`을 준 자리다.
  it("모르는 이벤트는 직전 그대로다 — 같은 객체다", () => {
    expect(nextAttention(직전, hook("claude", "PreToolUse", {}))).toBe(직전);
  });

  // **「봤다」는 새 사실이 오면 풀린다.** 안 풀면 Agent Deck이 겪은 「두 번째 진짜 프롬프트가
  // 삼켜짐」이 그대로 난다 — 끝난 셸을 한 번 보고 나면 그 뒤 진짜 완료가 영영 안 뜬다.
  it("에이전트가 새로 말하면 「봤다」가 풀린다", () => {
    const 본것 = { ...직전, kind: "done", seen: true } as const;
    expect(nextAttention(본것, hook("claude", "SessionEnd", { reason: "logout" }))?.seen).toBe(
      false,
    );
  });
});

// **권위**(결정 11). 이 판은 OSC·벨이 신호를 만드는 길을 아직 안 붙이지만(#208), 그것들이
// 들어올 문과 규칙은 여기서 연다 — 나중에 붙이면서 규칙을 같이 쓰면 그 규칙에 검사가 없다.
describe("훅이 말한 셸에서는 OSC·벨·출력이 아무것도 못 바꾼다", () => {
  const 훅이말한것: Attention = {
    kind: "waiting",
    message: "커밋할까요?",
    since: 100,
    seen: false,
    source: "hook",
    agent: "claude",
  };

  it.each(["osc", "bell"] as const)("%s가 와도 그대로다 — 같은 객체다", (source) => {
    const 그대로 = applySignal(훅이말한것, { event: "start", message: null }, 200, source, null);
    expect(그대로).toBe(훅이말한것);
  });

  // 훅이 안 온 셸은 OSC·벨이 바꾼다. 권위 규칙이 「아무도 못 바꾼다」로 넓어지면 훅을 안 깐
  // 사용자에게 이 판이 통째로 없는 것이 된다.
  it("훅이 안 온 셸은 OSC가 바꾼다", () => {
    const osc가말한것: Attention = { ...훅이말한것, source: "osc", agent: null };
    expect(applySignal(osc가말한것, { event: "start", message: null }, 200, "osc", null)).toEqual({
      kind: "working",
      message: "커밋할까요?",
      since: 200,
      seen: false,
      source: "osc",
      // **OSC·벨은 누가 말했는지를 모른다.** 본문이 어느 프로세스에서 나왔는지 PTY는 안
      // 적는다 — 그 갈래에서 마크를 내는 것은 「지금 도는 것」뿐이다.
      agent: null,
    });
  });

  // 반대 방향은 안 막는다 — 훅이 늦게 오면 그때부터 훅이 권위다.
  it("OSC가 말하던 셸에 훅이 오면 훅이 이긴다", () => {
    const osc가말한것: Attention = { ...훅이말한것, source: "osc", agent: null };
    expect(applySignal(osc가말한것, { event: "end", message: null }, 200, "hook", "claude").source).toBe(
      "hook",
    );
  });

  it("아무것도 안 온 셸은 벨이 바꾼다", () => {
    expect(applySignal(null, { event: "end", message: null }, 200, "bell", null)?.kind).toBe("done");
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
    const 상태값 = nextAttention(null, hook("codex", "SessionEnd", { reason: "logout" }));
    expect(상태값?.agent).toBe("codex");
  });
});

// 셸 한 칸을 세운다. 여기서 재는 것은 상태 축뿐이라 이름·소유자 같은 칸은 아무 값이나 든다.
const 칸 = (attention: Attention | null, status: Shell["status"] = { kind: "running" }): Shell => ({
  id: 1,
  status,
  title: null,
  shellName: "zsh",
  owner: null,
  project: null,
  cwd: null,
  running: null,
  attention,
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

  // **초록 행에 마크가 서는 자리가 여기다.** 스펙 전이 표에서 초록을 만드는 길은 둘뿐이고
  // (세션 종료 · 벨) **둘 다 그 순간 `running`이 비어 있다** — 세션이 끝났다는 것은
  // 에이전트 프로세스가 나갔다는 뜻이라 1초 폴링이 다음 바퀴에 `running`을 눕히고, 벨은
  // 정의상 「아는 에이전트 마크가 없을 때」만 초록이 된다. 그래서 마크의 재료를 「지금 도는
  // 것」에서만 뽑으면 초록 행의 둘째 줄은 **늘** 말과 경과 둘뿐이고, 티켓과 스펙이 못박은
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
  const 셸 = (owner: string | null, attention: Attention | null, id: number): Shell => ({
    ...칸(attention),
    id,
    owner,
  });

  it("work마다 최고 하나이고, 값이 없는 work은 키 자체가 없다", () => {
    const state = {
      shells: [
        셸("가", 상태({ kind: "working" }), 1),
        셸("가", 상태({ kind: "waiting" }), 2),
        셸("나", null, 3),
        셸("다", 상태({ kind: "done" }), 4),
      ],
      activeByOwner: {},
      nextId: 5,
    };
    expect(signalsByOwner(state)).toEqual({ 가: "waiting", 다: "done" });
  });

  // 최상위 셸은 어느 work의 것도 아니라 행이 없다 — 빈 문자열 키가 슬러그인 척하면
  // 그 키를 읽는 행이 영영 안 나온다(`shellCountsOf`와 같은 가름).
  it("최상위 셸은 안 든다", () => {
    const state = { shells: [셸(null, 상태({ kind: "waiting" }), 1)], activeByOwner: {}, nextId: 2 };
    expect(signalsByOwner(state)).toEqual({});
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
    expect(bandRows(화면(칸이({ id: 1, owner: "가", attention: 상태({ kind: "working" }) })))).toEqual([]);
  });

  // **차례는 화면을 가리지 않는다.** 최상위 셸도 같은 줄 세우기에 든다(결정 13의 다섯째) —
  // 빼면 거기서 부를 때 어디에도 안 보인다.
  it("기다림 먼저, 같은 종류 안에서는 오래된 순이다 — 최상위 셸도 함께 선다", () => {
    const rows = bandRows(
      화면(
        칸이({ id: 1, owner: "가", attention: 상태({ kind: "done", since: 30 }) }),
        칸이({ id: 2, owner: null, attention: 상태({ kind: "waiting", since: 50 }) }),
        칸이({ id: 3, owner: "나", attention: 상태({ kind: "waiting", since: 20 }) }),
        칸이({ id: 4, owner: "가", attention: 상태({ kind: "done", since: 10 }) }),
      ),
    );
    expect(rows.map((row) => row.id)).toEqual([3, 2, 4, 1]);
    expect(rows.map((row) => row.owner)).toEqual(["나", null, "가", "가"]);
    expect(rows.map((row) => row.kind)).toEqual(["waiting", "waiting", "done", "done"]);
    expect(rows.map((row) => row.since)).toEqual([20, 50, 10, 30]);
  });

  // 한 화면에서 **부르는** 셸이 둘 이상일 때만 붙는다(결정 5). 이름은 탭에 적히는 것과
  // 같은 규칙이라 그 함수를 딛는다 — 두 벌이 되면 띠와 탭이 같은 셸을 다르게 부른다.
  it("한 화면에서 둘이 부르면 줄마다 셸 이름이 붙는다", () => {
    const rows = bandRows(
      화면(
        칸이({ id: 1, owner: "가", title: "vite", attention: 상태({ kind: "waiting", since: 10 }) }),
        칸이({ id: 2, owner: "가", title: "claude", attention: 상태({ kind: "waiting", since: 20 }) }),
      ),
    );
    expect(rows.map((row) => row.shellName)).toEqual(["vite", "claude"]);
  });

  it("하나만 부르면 안 붙는다 — 그 화면에 조용한 셸이 더 있어도", () => {
    const rows = bandRows(
      화면(
        칸이({ id: 1, owner: "가", title: "vite", attention: 상태({ kind: "waiting" }) }),
        칸이({ id: 2, owner: "가", title: "claude", attention: null }),
        칸이({ id: 3, owner: "가", title: "cargo", attention: 상태({ kind: "done", seen: true }) }),
      ),
    );
    expect(rows.map((row) => row.shellName)).toEqual([null]);
  });

  // 최상위 셸도 한 화면이다 — 거기서 둘이 부르면 이름이 붙고, work의 셸과 섞이지 않는다.
  it("최상위 셸끼리도 자기들끼리 센다", () => {
    const rows = bandRows(
      화면(
        칸이({ id: 1, owner: null, title: "claude", attention: 상태({ kind: "waiting", since: 10 }) }),
        칸이({ id: 2, owner: "가", title: "codex", attention: 상태({ kind: "waiting", since: 20 }) }),
      ),
    );
    expect(rows.map((row) => row.shellName)).toEqual([null, null]);
  });

  // **마크의 재료는 행과 같은 규칙이다**(`topSignalView`) — 지금 도는 것이 먼저이고,
  // 없으면 그 상태를 말한 에이전트다. 초록 줄에 마크가 서는 자리가 그 둘째 갈래다.
  it("도는 것이 먼저, 없으면 말한 에이전트가 마크를 낸다", () => {
    const rows = bandRows(
      화면(
        칸이({ id: 1, owner: "가", running: "codex", attention: 상태({ kind: "waiting", since: 10, agent: "claude" }) }),
        칸이({ id: 2, owner: "나", running: null, attention: 상태({ kind: "waiting", since: 20, agent: "claude" }) }),
        칸이({ id: 3, owner: "다", running: null, attention: 상태({ kind: "waiting", since: 30, agent: null }) }),
      ),
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
  "Date.now",
  "performance.now",
  "new Date",
  "expire",
  "_MS",
  "TIMEOUT",
];

// **여기 이름을 더하는 것은 「이 파일은 시간을 안다」는 선언이다.** 상태 축이 그 목록에
// 들어오면 결정 2·3이 깨진 것이다 — 셋 다 상태 축 밖의 이유로 시간을 안다.
const 시간을아는파일 = [
  // 신호가 **도착한 순간**을 재료로 넣는 자리(`Date.now()` → `applySignal`의 `since`).
  // 재는 것이지 판정하는 것이 아니다 — 그 값으로 무엇이 되는지를 정하는 코드는 없다.
  "terminal-store.ts",
  // ⇧⇧ 사이의 간격(`SEARCH_GAP_MS`). 팔레트를 여는 키의 것이고 상태 축과 무관하다.
  "shell-registry.ts",
  // 같은 work의 알림을 접는 5초 창(`COALESCE_MS` · 결정 10). **알림의 시간이지 상태의
  // 시간이 아니다** — 화면값은 그 5초에 한 글자도 안 매인다.
  "shell-notify.ts",
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
// `shell-registry`의 `setAttention`이 그 판정 하나에 매달려 있는데, 견주는 칸이 여섯으로
// 적혀 있어 일곱째가 늘면 그 칸만 조용히 안 견줘진다 — 값이 바뀌었는데 화면이 안 바뀐다.
it("상태에 든 칸은 정확히 여섯이다", () => {
  const 상태값 = applySignal(null, { event: "waiting", message: "물음" }, 10, "hook", "claude");
  expect(Object.keys(상태값).sort()).toEqual([
    "agent",
    "kind",
    "message",
    "seen",
    "since",
    "source",
  ]);
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
