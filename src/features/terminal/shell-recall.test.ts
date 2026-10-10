import { describe, expect, it } from "vitest";
import { CLOSED_SHELL_NOTICE, nextRecall, recallHotkey, recallTarget } from "./shell-recall";
import type { CallEntry } from "./shell-recall";
import { createNotifier } from "./shell-notify";
import type { NotifyShell } from "./shell-notify";
import { ownerOf } from "./shell-registry";
import type { Shell } from "./shell-registry";

// 프로세스 티켓 23 — **방금 부른 셸을 기억하는 규칙**(프로세스 결정 16 · 프로세스 스펙 S59). 가는 곳은 가장 최근에 부르는
// 상태(기다림 · 확인할 것)에 **들어선** 셸이다. 「들어서는」 순간은 알림 판정이 이미 가르고(`createNotifier`의 `entered`),
// 이 파일이 재는 것은 그 순서를 받아 갈 셸을 고르는 순수 함수 둘과 키 판정 하나다. 시계도 셸 상태 칸도 안 읽는다.

const 들어섬 = (shellKey: string | null, since: number, call: CallEntry["call"] = "waiting"): CallEntry => ({
  shellKey,
  call,
  since,
});

describe("부르는 상태에 들어선 순서 → 갈 셸", () => {
  it("아무도 안 들어섰으면 기억이 그대로다", () => {
    expect(nextRecall(null, [])).toBeNull();
    expect(nextRecall("G-1", [])).toBe("G-1");
  });

  it("들어선 셸이 있으면 그 셸이 새 기억이다 — 앞 회차의 기억보다 늦다", () => {
    expect(nextRecall("G-1", [들어섬("G-2", 10)])).toBe("G-2");
    // 앞 회차의 셸이 더 늦은 시각을 들고 있었어도 — 기억에는 시각이 없다. 회차가 곧 차례다.
    expect(nextRecall("G-1", [들어섬("G-2", 1)])).toBe("G-2");
  });

  // 한 회차에 여럿이 들어서는 일이 있다(감시의 디바운스 한 번에 셸 여럿의 파일이 온다). 그 안에서는 **사실이 도착한 시각**이
  // 차례다 — 받은 목록은 띠의 차례(기다림 먼저, 오래된 것 위)라 그대로 끝을 고르면 늦게 부른 확인할 것이 먼저 부른 기다림에
  // 밀린다.
  it("한 회차에 여럿이 들어서면 가장 늦게 들어선 셸이다 — 받은 차례가 아니다", () => {
    expect(nextRecall(null, [들어섬("G-1", 30, "waiting"), 들어섬("G-2", 10, "waiting")])).toBe("G-1");
    expect(nextRecall(null, [들어섬("G-1", 10, "waiting"), 들어섬("G-2", 30, "done")])).toBe("G-2");
  });

  it("시각이 같으면 받은 차례의 앞이다 — 기다림이 확인할 것보다 앞에 온다", () => {
    expect(nextRecall(null, [들어섬("G-1", 10, "waiting"), 들어섬("G-2", 10, "done")])).toBe("G-1");
  });

  it("도는 중으로 들어선 셸은 안 된다", () => {
    expect(nextRecall("G-1", [들어섬("G-2", 10, "working")])).toBe("G-1");
    expect(nextRecall(null, [들어섬("G-2", 10, "working")])).toBeNull();
    expect(nextRecall(null, [들어섬("G-2", 10, null)])).toBeNull();
    // 도는 중이 더 늦어도 부른 셸이 이긴다.
    expect(nextRecall(null, [들어섬("G-1", 10, "done"), 들어섬("G-2", 30, "working")])).toBe("G-1");
  });

  // 셸 키는 spawn 답이 앉아야 선다. 답보다 먼저 부른 셸(첫 출력의 OSC)은 가리킬 키가 없어 기억하지 못한다 — 그 한 번을
  // 놓칠 뿐 다른 셸을 가리키지는 않는다.
  it("키가 아직 없는 셸은 기억하지 못한다 — 기억은 그대로다", () => {
    expect(nextRecall("G-1", [들어섬(null, 10)])).toBe("G-1");
  });
});

const 칸 = (id: number, shellKey: string | null, over: Partial<Shell> = {}): Shell => ({
  id,
  status: { kind: "running" },
  title: null,
  shellName: "zsh",
  shellKey,
  owner: ownerOf("signal"),
  project: null,
  cwd: null,
  running: null,
  attention: null,
  auto: false,
  firstInput: null,
  ownerless: false,
  ...over,
});

describe("기억한 셸 키 → 갈 곳", () => {
  it("부른 셸이 없으면 아무것도 안 한다", () => {
    expect(recallTarget(null, [칸(1, "G-1")])).toBeNull();
  });

  it("그 키의 셸이 떠 있으면 그 셸로 간다", () => {
    const 둘째 = 칸(2, "G-2", { owner: ownerOf("finance") });
    expect(recallTarget("G-2", [칸(1, "G-1"), 둘째])).toEqual({ kind: "go", shell: 둘째 });
  });

  // **fail-closed**(프로세스 결정 16). 닫힌 셸은 갈 셸에서 빠진다 — 먼저 부른 다른 셸로 대신 가지 않는다. 사람은 방금 부른
  // 그 셸을 보러 누른 것이라, 엉뚱한 셸로 옮기는 것보다 「닫혔다」가 참말이다.
  it("닫힌 셸은 빠진다 — 먼저 부른 셸로 대신 가지 않고 「닫혔다」를 돌려준다", () => {
    expect(recallTarget("G-2", [칸(1, "G-1")])).toEqual({ kind: "closed" });
    expect(recallTarget("G-2", [])).toEqual({ kind: "closed" });
  });

  // 옛 세대의 키(다른 실행이 준 키 — 알림 클릭이 싣는 날)도 같다. 번호만 보면 이번 실행의 같은 번호 셸로 간다(S34).
  it("옛 세대의 키는 같은 번호의 새 셸이 아니라 「닫혔다」다", () => {
    expect(recallTarget("OLD-1", [칸(1, "NEW-1")])).toEqual({ kind: "closed" });
  });

  it("끝났지만 목록에 남은 칸은 닫힌 것이 아니다 — 왜 끝났는지 읽으러 간다", () => {
    const 끝난칸 = 칸(1, "G-1", { status: { kind: "exited", exit: { exitCode: 1, signal: null } } });
    expect(recallTarget("G-1", [끝난칸])).toEqual({ kind: "go", shell: 끝난칸 });
  });

  it("닫혔다는 말은 해요체 한 줄이다", () => {
    expect(CLOSED_SHELL_NOTICE).toBe("그 셸은 닫혔어요");
  });
});

// **알림이 억제돼도 기억한다**(S59). 들어섬을 가르는 것은 알림 판정의 첫 두 줄(부르는가 · 새 사실인가)뿐이고, 보고 있어서 ·
// 5초 창에 접혀서 · 설정에서 꺼서 안 울린 것은 기억에서 안 빠진다. 알림 판정의 회차를 그대로 지나 잰다.
//
// 보고 있어서 안 울린 부름과 알림을 꺼 둔 동안의 부름은 **스토어를 거쳐** 잰다(`terminal-store.test.ts`의 「방금 부른 셸로」 —
// 코드 리뷰 스펙 2). 한때 여기서 회차의 줄을 손으로 지어 쟀는데, 그 두 검사는 스토어가 지나는 두 자리(보고 있는 셸의 사실이
// 곧바로 본 것이 되는 훅 구독 · 설정보다 먼저 가르는 회차)를 안 지나 실패할 수 없었다.
describe("OS 알림이 억제된 부름도 기억한다", () => {
  const 줄 = (patch: Partial<NotifyShell>): NotifyShell => ({
    id: 1,
    shellKey: "G-1",
    owner: ownerOf("signal"),
    kind: "waiting",
    call: "waiting",
    since: 0,
    visible: false,
    title: "터미널 신호",
    shellName: "zsh",
    message: null,
    ...patch,
  });

  it("같은 work의 5초 창에 접혀 안 울렸어도 기억한다", () => {
    const notifier = createNotifier();
    notifier.step([줄({ id: 1, shellKey: "G-1", since: 0 })], 0);
    const { fired, entered } = notifier.step(
      [줄({ id: 1, shellKey: "G-1", since: 0 }), 줄({ id: 2, shellKey: "G-2", since: 1000 })],
      1000,
    );
    expect(fired).toEqual([]);
    expect(nextRecall("G-1", entered)).toBe("G-2");
  });

  // 들어섬은 엣지다 — 같은 사실로 머무는 셸은 다시 들어서지 않는다. 그사이 다른 셸이 들어섰으면 그 셸이 기억으로 남는다.
  it("머무는 셸은 다시 들어서지 않는다 — 그사이 들어선 다른 셸이 기억에 남는다", () => {
    const notifier = createNotifier();
    let recalled = nextRecall(null, notifier.step([줄({ id: 1, shellKey: "G-1", since: 0 })], 0).entered);
    recalled = nextRecall(
      recalled,
      notifier.step([줄({ id: 1, shellKey: "G-1", since: 0 }), 줄({ id: 2, shellKey: "G-2", since: 10 })], 10).entered,
    );
    recalled = nextRecall(
      recalled,
      notifier.step([줄({ id: 1, shellKey: "G-1", since: 0 }), 줄({ id: 2, shellKey: "G-2", since: 10 })], 20).entered,
    );
    expect(recalled).toBe("G-2");
  });
});

// ⌘J(프로세스 스펙 P3). 메뉴가 쏘는 합성 keydown과 직접 누른 키가 같은 판정을 지난다(`menu-hotkey.ts`). `code`로 본다 —
// 한글 입력기가 켜져 있으면 `key`가 자모로 온다.
describe("「방금 부른 셸로」 키", () => {
  const 키 = (patch: Partial<Parameters<typeof recallHotkey>[0]> = {}) => ({
    type: "keydown",
    code: "KeyJ",
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...patch,
  });

  it("⌘J다", () => {
    expect(recallHotkey(키())).toBe(true);
  });

  it.each([
    ["⌘ 없음", { metaKey: false }],
    ["⌘⇧J", { shiftKey: true }],
    ["⌘⌥J", { altKey: true }],
    ["⌘⌃J", { ctrlKey: true }],
    ["⌘K", { code: "KeyK" }],
    ["키를 뗄 때", { type: "keyup" }],
  ] as const)("%s는 아니다", (_이름, patch) => {
    expect(recallHotkey(키(patch))).toBe(false);
  });
});
