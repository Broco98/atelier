/// <reference types="node" />
// 소스 스캔 한 건 때문에 Node 타입을 끌어온다 — 근거는 shell-registry.test.ts 머리말과 같다.
import { readdirSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { foldHookState } from "./agents";
import {
  applySignal,
  attentionOn,
  callingShells,
  isShellSeen,
  ptyIdOf,
  nextAttention,
  signalOf,
  signalsByOwner,
  topSignal,
  topSignalView,
} from "./shell-attention";
import type { Attention } from "./shell-attention";
import type { Shell } from "./shell-registry";
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

// **페이로드는 지어내지 않는다.** 아래 픽스처의 키는 전부 이 work의 정본 연구에서 그대로
// 옮긴 것이고, 옆에 그 줄 번호를 단다 — 구현이 읽기로 한 키를 픽스처에 그대로 심으면
// 「구현의 가정」을 재는 검사가 되어, 키가 틀려도 표가 통째로 초록이다.
// 출처: `spec/research/claude-codex-first-party.md`의 B-2 표(claude) · B-1 표(codex).
describe("claude 어댑터가 페이로드를 정규 이벤트로 접는다", () => {
  it.each([
    // B-2:158 `UserPromptSubmit` 고유 필드는 `prompt_text` 하나다.
    ["UserPromptSubmit", { prompt_text: "고쳐 줘" }, "start", null],
    // B-2:149 `tool_name`·`tool_input`·`tool_use_id`.
    ["PermissionRequest", { tool_name: "Bash", tool_input: { command: "git status" }, tool_use_id: "toolu_01" }, "waiting", "Bash · git status"],
    // B-2:150 `mcp_server_name`·`message`·`mode`·`url`·`elicitation_id`·`requested_schema`.
    ["Elicitation", { mcp_server_name: "atelier", message: "어느 쪽으로 할까요?", mode: "form", elicitation_id: "el_1" }, "waiting", "어느 쪽으로 할까요?"],
    // B-2:152 `last_assistant_message`·`agent_id`·`agent_type`.
    ["Stop", { last_assistant_message: "테스트 셋 통과\n커밋할까요?", agent_id: "a1", agent_type: "general" }, "stop", "테스트 셋 통과"],
    // B-2:157 `SessionEnd`의 고유 필드는 **`session_end_reason`**이다 — `reason`이 아니다.
    // 이 한 글자가 틀리면 `/clear` 줄이 실물에서 한 번도 안 서고, 방금 지운 화면에 초록이 뜬다.
    ["SessionEnd", { session_end_reason: "clear" }, "clear", null],
    ["SessionEnd", { session_end_reason: "logout" }, "end", null],
    // **대체 키 `reason`도 살아 있는 길이다.** 실물을 아직 한 번도 안 봤으므로
    // (`spec/훅-실물-확인.md`의 「확인 결과」) 문서 판이 갈렸을 때를 대비해 둘 다 읽는다.
    // 재는 값이 문자열 `clear` 하나뿐이라 넓게 읽어 잃는 것이 없다.
    ["SessionEnd", { reason: "clear" }, "clear", null],
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
    expect(foldHookState(hook("codex", "SessionEnd", { session_end_reason: "clear" }))).toEqual({
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

// 스펙의 **전이 표 그대로**다. 재는 것은 「어느 훅 이벤트가 오면 화면이 읽는 kind와 message가
// 무엇이 되는가」 하나 — 어댑터가 무엇으로 접었는지는 이 표의 관심이 아니다.
const 직전 = {
  kind: "working",
  message: "직전에 하던 말",
  since: 1,
  seen: false,
  source: "hook",
} as const;

describe("전이 표", () => {
  // 여기 실린 페이로드도 **연구 표의 키 그대로**다(위 어댑터 표와 같은 규율). 이 줄들이
  // 실물과 다른 모양 위에 서면 전이 표 전체가 「구현이 읽기로 한 키」를 재게 된다.
  it.each([
    ["claude", "UserPromptSubmit", { prompt_text: "고쳐" }, "working", "직전에 하던 말"],
    ["codex", "UserPromptSubmit", { permission_mode: "default" }, "working", "직전에 하던 말"],
    ["claude", "PermissionRequest", { tool_name: "Bash", tool_input: { command: "git push" }, tool_use_id: "toolu_02" }, "waiting", "Bash · git push"],
    ["codex", "PermissionRequest", { turn_id: "t2", tool_name: "shell", tool_input: { command: "rm -rf ." } }, "waiting", "shell · rm -rf ."],
    ["claude", "Elicitation", { mcp_server_name: "atelier", message: "어느 쪽으로 할까요?", elicitation_id: "el_2" }, "waiting", "어느 쪽으로 할까요?"],
    ["claude", "Stop", { last_assistant_message: "테스트 셋 통과 — 커밋할까요?", agent_id: "a2" }, "waiting", "테스트 셋 통과 — 커밋할까요?"],
    ["codex", "Stop", { turn_id: "t2", last_assistant_message: "PR #174 열었다" }, "waiting", "PR #174 열었다"],
    ["codex", "Interrupt", { turn_id: "t2", permission_mode: "default" }, "waiting", "직전에 하던 말"],
    ["claude", "SessionEnd", { session_end_reason: "logout" }, "done", "직전에 하던 말"],
    // codex `SessionEnd`는 고유 필드가 없다 — 빈 페이로드가 실물의 모양이다.
    ["codex", "SessionEnd", {}, "done", "직전에 하던 말"],
    // **`clear` 줄**. 스펙 전이 표에서 이 줄은 claude 전용이고, 실물 키는 `session_end_reason`이다.
    ["claude", "SessionEnd", { session_end_reason: "clear" }, "working", null],
  ] as const)("%s %s → %s", (agent, event, payload, kind, message) => {
    expect(nextAttention(직전, hook(agent, event, payload))).toEqual({
      kind,
      message,
      since: 10,
      seen: false,
      source: "hook",
    });
  });

  // 훅이 처음 오는 셸에는 직전이 없다. 「직전 유지」가 그때 무엇이 되는지가 이 줄이다.
  it("직전이 없으면 「직전 유지」는 없음이다", () => {
    expect(nextAttention(null, hook("claude", "UserPromptSubmit", { prompt_text: "고쳐" }))).toEqual({
      kind: "working",
      message: null,
      since: 10,
      seen: false,
      source: "hook",
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
    expect(nextAttention(본것, hook("claude", "SessionEnd", { session_end_reason: "logout" }))?.seen).toBe(
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
  };

  it.each(["osc", "bell"] as const)("%s가 와도 그대로다 — 같은 객체다", (source) => {
    const 그대로 = applySignal(훅이말한것, { event: "start", message: null }, 200, source);
    expect(그대로).toBe(훅이말한것);
  });

  // 훅이 안 온 셸은 OSC·벨이 바꾼다. 권위 규칙이 「아무도 못 바꾼다」로 넓어지면 훅을 안 깐
  // 사용자에게 이 판이 통째로 없는 것이 된다.
  it("훅이 안 온 셸은 OSC가 바꾼다", () => {
    const osc가말한것: Attention = { ...훅이말한것, source: "osc" };
    expect(applySignal(osc가말한것, { event: "start", message: null }, 200, "osc")).toEqual({
      kind: "working",
      message: "커밋할까요?",
      since: 200,
      seen: false,
      source: "osc",
    });
  });

  // 반대 방향은 안 막는다 — 훅이 늦게 오면 그때부터 훅이 권위다.
  it("OSC가 말하던 셸에 훅이 오면 훅이 이긴다", () => {
    const osc가말한것: Attention = { ...훅이말한것, source: "osc" };
    expect(applySignal(osc가말한것, { event: "end", message: null }, 200, "hook").source).toBe("hook");
  });

  it("아무것도 안 온 셸은 벨이 바꾼다", () => {
    expect(applySignal(null, { event: "end", message: null }, 200, "bell")?.kind).toBe("done");
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
  it("도는 것이 없으면 마크도 없다", () => {
    const list = [칸이({ id: 1, attention: 상태({ kind: "waiting" }), running: null })];
    expect(topSignalView(list)?.running).toBeNull();
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
    expect(callingShells(list).map((shell) => shell.id)).toEqual([4, 2, 3, 1]);
  });

  // 띠에 서는 것은 **부르는 셸**뿐이다(결정 8) — 도는 중과 본 완료와 조용한 셸은 안 든다.
  it("도는 중·본 완료·조용한 셸은 안 든다", () => {
    const list = 칸들(
      상태({ kind: "working" }),
      상태({ kind: "done", seen: true }),
      null,
      상태({ kind: "waiting" }),
    );
    expect(callingShells(list).map((shell) => shell.id)).toEqual([4]);
  });

  it("부르는 셸이 없으면 빈 목록이다 — 띠 자체가 없다", () => {
    expect(callingShells(칸들(상태({ kind: "working" }), null))).toEqual([]);
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

// **시간 상수도 만료도 타이머도 없다**(결정 2·3). 이 축에서 상태를 만드는 것은 에이전트가
// 말한 순간 하나뿐이고 지우는 것은 사람이 본 순간 하나뿐이다 — 「몇 초 조용하면 끝난 것」이
// 한 줄이라도 들어오면 앱이 모르는 것을 아는 척하기 시작한다.
//
// 소스를 **문자열로만** 본다. 자르거나 파싱하는 정규식은 파서가 새는 순간 조용히 통과하고,
// 이 저장소는 그것을 fail-open이라 부른다(shell-registry.test.ts 머리말).
describe("상태 축에 시간이 없다", () => {
  it.each([
    "./shell-attention.ts",
    "./agents/index.ts",
    "./agents/claude.ts",
    "./agents/codex.ts",
    "./agents/payload.ts",
    "./agents/types.ts",
  ])("%s에 시계도 타이머도 없다", (file) => {
    const source = read(file);
    for (const forbidden of [
      "setTimeout",
      "setInterval",
      "requestAnimationFrame",
      "Date.now",
      "performance.now",
      "new Date",
      "expire",
      "_MS",
      "TIMEOUT",
    ]) {
      expect(source, `${forbidden} — 이 축은 시간으로 아무것도 정하지 않는다`).not.toContain(
        forbidden,
      );
    }
  });
});

// **칸이 늘면 여기서 터진다.** `nextAttention`의 「안 바뀌면 받은 것을 그대로 준다」와
// `shell-registry`의 `setAttention`이 그 판정 하나에 매달려 있는데, 견주는 칸이 다섯으로
// 적혀 있어 여섯째가 늘면 그 칸만 조용히 안 견줘진다 — 값이 바뀌었는데 화면이 안 바뀐다.
it("상태에 든 칸은 정확히 다섯이다", () => {
  const 상태값 = applySignal(null, { event: "waiting", message: "물음" }, 10, "hook");
  expect(Object.keys(상태값).sort()).toEqual(["kind", "message", "seen", "since", "source"]);
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

// **`shell.attention`을 직접 만지는 파일은 셋뿐이다.**
//
// 죽은 칸을 가리는 자리를 「눕히는 쪽」이 아니라 **읽는 쪽**(`attentionOn`)에 둔 것이 이
// 판의 선택이다(구현 결정 1의 문구는 「눕힌다」인데 `runningOn`과 같은 이유로 가리는 쪽을
// 골랐다 — 늦게 도착한 훅 이벤트까지 같은 문에서 막힌다). 그 선택이 성립하려면 **읽는 쪽이
// 늘 그 문을 딛어야** 하는데, 지금까지 그것을 지키는 것은 `attentionOn`의 주석 한 줄뿐이었다.
// 이 값을 읽을 자리 넷이 아직 안 붙었고(#203 레인 · #204 띠 · #205 탭 · #206 알림), 그중
// 하나가 `shell.attention`을 직접 읽으면 **죽은 칸이 사람을 영영 부른다.** 주석만이던 보장에
// 검사를 건다.
//
// 파싱하지 않는다 — 파일 전체에서 문자열 하나를 세고, 나온 파일의 목록이 허용 목록과
// **정확히 같은지**를 본다. 「적어도 셋에 있다」가 아니라 「이 셋뿐이다」라서, 필드 이름이
// 바뀌어 스캔이 통째로 헛돌면 그것도 여기서 터진다(fail-closed).
const 상태값을만지는파일 = [
  // 쓰는 자리. `setAttention`이 칸에 앉히고 `markSeen`이 「봤다」를 세운다.
  "features/terminal/shell-registry.ts",
  // 가리는 자리. `attentionOn`이 죽은 칸을 여기서 끊는다.
  "features/terminal/shell-attention.ts",
  // 잇는 자리. 직전 값을 `nextAttention`에 넘긴다 — 화면이 아니라 리듀서의 입력이다.
  "features/terminal/terminal-store.ts",
];

it("상태 값을 직접 만지는 파일은 셋뿐이다 — 나머지는 `attentionOn`을 딛는다", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const 만지는것 = readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
    .map((file) => file.split("\\").join("/"))
    .filter((file) => readFileSync(root + file, "utf8").includes(".attention"));

  expect(만지는것.sort()).toEqual([...상태값을만지는파일].sort());
});
