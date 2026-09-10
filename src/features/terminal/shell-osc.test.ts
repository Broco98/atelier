import { describe, expect, it } from "vitest";
import { bellSignal, oscSignal } from "./shell-osc";

// 훅을 안 깐 셸의 **보너스 길**(#208 · 결정 11의 P). 재는 것은 「OSC 본문 한 줄이 들어가면
// 정규 이벤트가 무엇이 되고 무슨 말을 싣는가」뿐이라 DOM도 xterm도 없이 기본 환경에서 돈다
// (shell-attention.test.ts가 선례다).
//
// **접두사 넷은 지어낸 것이 아니다.** Codex TUI가 OSC 9로 보내는 문구 그대로이고 출처는
// 구현 스펙의 3절(「Codex TUI의 OSC 9는 본문으로만 갈린다」)이다 — 한 글자라도 틀리면 훅을
// 안 깐 Codex 사용자의 승인 요청이 앰버가 아니라 초록으로 뜬다.
describe("OSC 본문을 정규 이벤트로 접는다", () => {
  it.each([
    // 승인 넷 — 접두사 **뒤가** 말이 된다.
    ["Approval requested: Bash(git status)", "waiting", "Bash(git status)"],
    ["Codex wants to edit src/main.rs", "waiting", "src/main.rs"],
    ["Approval requested by codex", "waiting", "codex"],
    ["Plan mode prompt: 어느 쪽으로 갈까요?", "waiting", "어느 쪽으로 갈까요?"],
    // **그 밖은 전부 `end`(→ 초록)이고 본문 전체가 말이 된다**(결정 13의 둘째).
    // 누군가 알리려 했으니 안 본 것이 있다 — 무슨 일인지는 사람이 이 글자를 읽는다.
    ["PR #174 열었다", "end", "PR #174 열었다"],
    ["Codex", "end", "Codex"],
    // 여러 줄이면 첫 줄만 — 자르는 자리는 `firstLine` 하나다(훅 길과 같은 함수).
    ["테스트 셋 통과\n커밋할까요?", "end", "테스트 셋 통과"],
    ["\n\n  늦게 시작하는 말  ", "end", "늦게 시작하는 말"],
  ] as const)("%s → %s", (body, event, message) => {
    expect(oscSignal(body)).toEqual({ event, message });
  });

  // **접두사만 오고 뒤가 비면 말은 없되 앰버는 선다.** message가 `null`인 것은 「지운다」가
  // 아니라 「직전 것을 그대로 둔다」이고, 그 규칙은 `applySignal`이 든다.
  it.each([
    "Approval requested: ",
    "Codex wants to edit ",
  ])("%s는 말 없는 기다림이다", (body) => {
    expect(oscSignal(body)).toEqual({ event: "waiting", message: null });
  });

  // **빈 본문은 아무 주장도 아니다**(결정 3). 여기서 `done`을 만들면 본문 없는 OSC 하나에
  // 초록이 서고, 그 행은 눌러도 보여 줄 것이 없다.
  it.each(["", "   ", "\n", "\n  \n"])("빈 본문 %j은 아무것도 아니다", (body) => {
    expect(oscSignal(body)).toBeNull();
  });
});

// **벨은 「모르는 명령」에만 초록을 만든다**(스펙 전이 표의 벨 두 줄). 아는 에이전트가 도는
// 셸에서 울린 벨은 **훅이 이미 말한 것**이라 무시한다 — 안 무시하면 claude가 스스로 울리는
// 벨마다 초록이 하나씩 더 서고, 그 행은 훅이 방금 세운 앰버를 덮는다.
//
// **판정의 재료가 `agentMarkOf`인 것**은 그 표를 아는 자리가 앱에 하나뿐이어서다(판 04
// 결정 15). 여기에 이름 목록을 다시 적으면 마크가 뜨는 셸과 벨이 무시되는 셸이 갈린다.
describe("벨은 아는 에이전트가 없을 때만 말한다", () => {
  it.each(["claude", "codex"])("%s가 도는 셸의 벨은 아무것도 아니다", (running) => {
    expect(bellSignal(running)).toBeNull();
  });

  // 모르는 명령이 끝나며 울린 벨 — 이 판이 판 04 결정 21의 감수를 절반 닫는 자리다
  // (`; tput bel`을 붙인 사람은 밀려난 칸에서도 띠가 받는다).
  it.each(["make", "node", "cargo", "vim"])("%s가 도는 셸의 벨은 안 본 완료다", (running) => {
    expect(bellSignal(running)).toEqual({ event: "end", message: null });
  });

  // 빈 프롬프트에서 사람이 `printf '\\a'`를 친 자리다. 도는 명령이 없다는 것은 아는
  // 에이전트도 없다는 뜻이라 같은 길로 간다.
  it("도는 것이 없어도 안 본 완료다", () => {
    expect(bellSignal(null)).toEqual({ event: "end", message: null });
  });
});
