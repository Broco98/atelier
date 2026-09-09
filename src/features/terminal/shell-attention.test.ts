/// <reference types="node" />
// 소스 스캔 한 건 때문에 Node 타입을 끌어온다 — 근거는 shell-registry.test.ts 머리말과 같다.
import { readFileSync } from "fs";
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
  topSignal,
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

describe("claude 어댑터가 페이로드를 정규 이벤트로 접는다", () => {
  it.each([
    ["UserPromptSubmit", { prompt: "고쳐 줘" }, "start", null],
    ["PermissionRequest", { tool_name: "Bash", tool_input: { command: "git status" } }, "waiting", "Bash · git status"],
    ["Elicitation", { message: "어느 쪽으로 할까요?" }, "waiting", "어느 쪽으로 할까요?"],
    ["Stop", { last_assistant_message: "테스트 셋 통과\n커밋할까요?" }, "stop", "테스트 셋 통과"],
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
    ["UserPromptSubmit", { prompt: "고쳐 줘" }, "start", null],
    ["PermissionRequest", { tool_name: "shell", tool_input: { command: "cargo test" } }, "waiting", "shell · cargo test"],
    ["Stop", { last_assistant_message: "PR #174 열었다" }, "stop", "PR #174 열었다"],
    ["SessionEnd", { reason: "exit" }, "end", null],
  ] as const)("%s → %s", (event, payload, canonical, message) => {
    expect(foldHookState(hook("codex", event, payload))).toEqual({ event: canonical, message });
  });

  // **`Interrupt`는 직전 말을 지우지 않는다**(전이 표). 사람이 esc로 끊은 것이라 방금까지
  // 하던 말이 곧 맥락이고, 그 자리를 비우면 둘째 줄이 이유 없이 빈다.
  it("`Interrupt`는 멈추되 직전 말을 그대로 둔다", () => {
    expect(foldHookState(hook("codex", "Interrupt", { reason: "user" }))).toEqual({
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
  it.each([
    ["claude", "UserPromptSubmit", { prompt: "고쳐" }, "working", "직전에 하던 말"],
    ["codex", "UserPromptSubmit", { prompt: "고쳐" }, "working", "직전에 하던 말"],
    ["claude", "PermissionRequest", { tool_name: "Bash", tool_input: { command: "git push" } }, "waiting", "Bash · git push"],
    ["codex", "PermissionRequest", { tool_name: "shell", tool_input: { command: "rm -rf ." } }, "waiting", "shell · rm -rf ."],
    ["claude", "Elicitation", { message: "어느 쪽으로 할까요?" }, "waiting", "어느 쪽으로 할까요?"],
    ["claude", "Stop", { last_assistant_message: "테스트 셋 통과 — 커밋할까요?" }, "waiting", "테스트 셋 통과 — 커밋할까요?"],
    ["codex", "Stop", { last_assistant_message: "PR #174 열었다" }, "waiting", "PR #174 열었다"],
    ["codex", "Interrupt", { reason: "user" }, "waiting", "직전에 하던 말"],
    ["claude", "SessionEnd", { reason: "logout" }, "done", "직전에 하던 말"],
    ["codex", "SessionEnd", { reason: "exit" }, "done", "직전에 하던 말"],
    ["claude", "SessionEnd", { reason: "clear" }, "working", null],
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
    expect(nextAttention(null, hook("claude", "UserPromptSubmit", { prompt: "고쳐" }))).toEqual({
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
    expect(nextAttention(본것, hook("claude", "SessionEnd", { reason: "logout" }))?.seen).toBe(false);
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
