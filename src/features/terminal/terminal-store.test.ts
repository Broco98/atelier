import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShellAttention, ShellHookState } from "./types";

// **터미널 스토어를 그대로 돌린다**(코드 리뷰 스펙 2 · 6 반영). 이 폴더의 다른 L2는 순수 모듈을 재거나 스토어의 줄을 소스로
// 못박는다 — 스토어는 xterm과 Tauri를 들여 노드에서 셸을 못 연다(`shell-focus.test.ts`의 머리말). 그래서 **배선이 순서를
// 틀리거나 줄 하나를 잃는 회귀**(보고 있던 셸의 확인할 것이 ⌘J 기억에서 빠진다, 요청한 셸의 기다리는 포커스가 안 적힌다)는
// 순수 함수의 표가 아무리 맞아도 안 잡혔다.
//
// 여기서는 경계만 가짜로 둔다 — xterm(`Terminal` · 애드온), IPC(`./api` — 셸 띄우기 답 · 사건 구독), 채널(`Channel`), 창
// 포커스, 확인 창, 문서 몇 조각(`document` · `ResizeObserver` · `getComputedStyle`). 스토어의 코드는 한 줄도 안 바꾼다. 사건은
// 앱이 받는 그 모양으로 구독에 넣고(`hookEvent` — 셸 키로 온 훅 파일), 셸의 출력 · 종료는 그 셸의 채널로 흘린다.
//
// 스토어는 모듈 싱글턴이라 검사끼리 샌다 — 검사마다 연 셸을 닫고 목록을 비운다(`afterEach`).

const fake = vi.hoisted(() => {
  /** 가짜 xterm 하나 — 스토어가 부르는 것만. `focus`가 불린 수를 센다. */
  class FakeTerminal {
    cols = 80;
    rows = 24;
    options: Record<string, unknown>;
    focused = 0;
    /** 셸의 키 핸들러(`attachCustomKeyEventHandler`) — 검사가 키다운을 이리로 넣는다. */
    keyHandler: (event: unknown) => boolean = () => true;
    parser = { registerOscHandler: () => ({ dispose() {} }) };
    constructor(options: Record<string, unknown>) {
      this.options = { ...options };
      fake.terms.push(this);
    }
    loadAddon() {}
    onTitleChange() {}
    onBell() {}
    onResize() {}
    onData() {}
    attachCustomKeyEventHandler(handler: (event: unknown) => boolean) {
      this.keyHandler = handler;
    }
    open() {}
    focus() {
      this.focused += 1;
    }
    refresh() {}
    write() {}
    input() {}
    dispose() {}
  }
  /** 가짜 채널 — 스토어가 단 `onmessage`로 프레임을 흘린다. */
  class FakeChannel {
    onmessage: (frame: unknown) => void = () => {};
    constructor() {
      fake.channels.push(this);
    }
  }
  return {
    terms: [] as FakeTerminal[],
    channels: [] as FakeChannel[],
    FakeTerminal,
    FakeChannel,
    attention: null as ((changed: ShellAttention[]) => void) | null,
    focused: true,
    nextPty: 1,
  };
});

vi.mock("@xterm/xterm", () => ({ Terminal: fake.FakeTerminal }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));
vi.mock("@xterm/addon-webgl", () => ({ WebglAddon: class { onContextLoss() {} dispose() {} } }));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  Channel: fake.FakeChannel,
}));
vi.mock("@tauri-apps/api/window", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/window")>()),
  getCurrentWindow: () => ({ setBadgeCount: async () => {} }),
}));
vi.mock("@tauri-apps/plugin-notification", () => ({ sendNotification: vi.fn() }));
vi.mock("./terminal-ime", async (original) => ({
  ...(await original<typeof import("./terminal-ime")>()),
  attachIme: () => {},
}));
vi.mock("@/lib/window-focus", () => ({ windowFocused: () => fake.focused }));
vi.mock("@/components/ui/confirm-store", async (original) => ({
  ...(await original<typeof import("@/components/ui/confirm-store")>()),
  askDialog: vi.fn(async () => true),
}));
vi.mock("./api", () => ({
  terminalApi: {
    spawn: vi.fn(async () => {
      const id = fake.nextPty;
      fake.nextPty += 1;
      return { id, shellKey: `G-${id}`, shellName: "zsh" };
    }),
    write: vi.fn(async () => {}),
    resize: vi.fn(async () => {}),
    kill: vi.fn(async () => {}),
    firstInput: vi.fn(async () => {}),
    closeCheck: vi.fn(async () => ({ command: false, descendants: 0 })),
    closeChecks: vi.fn(async () => ({})),
  },
  onPtyRunning: () => new Promise(() => {}),
  onShellAttention: (listen: (changed: ShellAttention[]) => void) => {
    fake.attention = listen;
    return new Promise(() => {});
  },
}));

import { sendNotification } from "@tauri-apps/plugin-notification";
import { terminalApi } from "./api";
import { applyNotifySettings } from "./notify-settings";
import { ptyIdOf } from "./shell-key";
import { NO_SHELLS, topTerminal } from "./shell-registry";
import {
  attachShell,
  focusShell,
  openNewShell,
  recalledShell,
  requestCloseShell,
  selectShell,
  showShell,
  terminalStore,
} from "./terminal-store";

// ─── 문서 몇 조각 ───
//
// 셸의 집(`wrapper`)과 그것을 들이는 화면의 자리만 흉내 낸다. 들이면(`appendChild`) 문서에 붙은 것이다(`isConnected`).
class FakeElement {
  style: Record<string, string> = {};
  isConnected = false;
  addEventListener() {}
  querySelector() {
    return null;
  }
  remove() {
    this.isConnected = false;
  }
  appendChild(child: FakeElement) {
    child.isConnected = true;
  }
}

beforeAll(() => {
  vi.stubGlobal("document", {
    createElement: () => new FakeElement(),
    activeElement: null,
    fonts: { load: async () => [], ready: Promise.resolve() },
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  // 떼어 둔 집처럼 크기가 없다고 답해 맞춤(`refit`)이 곧바로 돌아간다 — 격자는 이 검사가 재는 것이 아니다.
  vi.stubGlobal("getComputedStyle", () => ({ width: "0px", height: "0px" }));
});

beforeEach(() => {
  fake.focused = true;
});

afterEach(async () => {
  showShell(null);
  for (const shell of terminalStore.state.shells) await requestCloseShell(shell.id);
  terminalStore.setState(() => NO_SHELLS);
  vi.clearAllMocks();
});

/** 최상위 터미널에 셸을 하나 열고 띄우기 답이 앉을 때까지 기다린다. 레지스트리 id · pty 번호 · 셸 키를 준다. */
async function openShellSpawned(): Promise<{ id: number; ptyId: number; shellKey: string; term: InstanceType<typeof fake.FakeTerminal>; channel: InstanceType<typeof fake.FakeChannel> }> {
  const before = terminalStore.state.shells.length;
  openNewShell(topTerminal("atelier"));
  const shell = terminalStore.state.shells[before];
  const term = fake.terms[fake.terms.length - 1];
  await vi.waitFor(() => expect(terminalStore.state.shells.find((one) => one.id === shell.id)?.shellKey).not.toBeNull());
  const shellKey = terminalStore.state.shells.find((one) => one.id === shell.id)!.shellKey!;
  const channel = fake.channels[fake.channels.length - 1];
  return { id: shell.id, ptyId: ptyIdOf(shellKey)!, shellKey, term, channel };
}

/** 셸이 훅으로 말한 것 한 장 — 앱이 받는 모양 그대로(셸 키 · 훅 상태). */
function hookEvent(shellKey: string, state: Omit<ShellHookState, "subagents" | "stopped"> & Partial<ShellHookState>): void {
  fake.attention?.([{ shellId: shellKey, state: { subagents: 0, stopped: false, ...state } }]);
}

/** 화면이 셸의 집을 들일 자리 하나. */
const 자리 = () => new FakeElement() as unknown as HTMLElement;

/** 화면이 그 셸을 붙여 보여 준다 — `TerminalPane`이 하는 둘(집 들이기 · 보이는 셸 알리기). */
function showOnScreen(id: number): void {
  attachShell(자리(), id);
  showShell(id);
}

describe("방금 부른 셸로(⌘J) — 스토어를 거쳐", () => {
  // 코드 리뷰 스펙 2. 기억의 재료가 「봤다」로 걸러진 화면값이면, 보고 있는 셸의 턴끝(Stop)은 같은 갱신 안에서 곧바로 본
  // 확인할 것이 되어(`markShellsSeen`) 기억에 못 든다. 결정 16 · S59는 「보고 있어서 안 울린 부름도 사람을 부른 것」이다.
  it("보고 있는 셸에 턴끝이 오면 다른 셸로 옮긴 뒤에도 ⌘J가 그 셸로 간다", async () => {
    const a = await openShellSpawned();
    const b = await openShellSpawned();
    showOnScreen(a.id);
    hookEvent(a.shellKey, { agent: "claude", event: "UserPromptSubmit", at: 100, payload: {} });
    hookEvent(a.shellKey, { agent: "claude", event: "Stop", at: 200, payload: { last_assistant_message: "다 했어요" }, stopped: true });
    // 보고 있었다 — 확인할 것은 곧바로 본 것이 된다(화면값이 없다). 이것이 이 검사의 전제다.
    expect(terminalStore.state.shells.find((one) => one.id === a.id)?.attention).toMatchObject({ kind: "done", seen: true });

    selectShell(b.id);
    showOnScreen(b.id);

    expect(recalledShell()).toMatchObject({ kind: "go", shell: { id: a.id } });
  });

  // 알림 설정은 기억과 무관하다(S59) — 기억은 설정(`outgoing`)보다 먼저 갈린다. 창이 뒤에 있어 울렸을 부름이다.
  it("알림을 꺼 두었어도 부른 셸을 기억한다", async () => {
    const a = await openShellSpawned();
    applyNotifySettings({ enabled: false, sound: false });
    try {
      // 창이 뒤에 있다 — 알림이 켜져 있었으면 울렸을 부름이다.
      fake.focused = false;
      hookEvent(a.shellKey, { agent: "claude", event: "Elicitation", at: 100, payload: { message: "어느 쪽으로 할까요?" } });
      // **앵커** — 꺼 두었으니 안 울렸다.
      expect(sendNotification).not.toHaveBeenCalled();
      expect(recalledShell()).toMatchObject({ kind: "go", shell: { id: a.id } });
    } finally {
      applyNotifySettings({ enabled: true, sound: true });
    }
  });
});

describe("첫 사람 입력 — 스토어를 거쳐", () => {
  /** 셸에서 누른 글자 키 하나 — xterm이 키 핸들러에 건네는 모양의 필요한 칸만. */
  const 글자키 = (key: string) => ({
    type: "keydown",
    key,
    code: `Key${key.toUpperCase()}`,
    keyCode: key.toUpperCase().charCodeAt(0),
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault() {},
    stopPropagation() {},
  });

  // 구현 기록 07의 남은 것. 띄우기 답이 오기 전에는 pty가 없어 친 키가 셸로 안 가고 버려진다(`onData`). 한때 그 키도 첫 입력으로
  // 적혀, 답이 앉는 자리가 **셸이 태어나기 전 시각**을 백엔드에 다시 알렸다 — 그 셸의 자손이 모두 「입력 뒤에 뜬 것」으로 읽혀
  // 도우미가 도우미로 안 갈렸다(판정은 첫 입력 전에 태어난 자손을 도우미로 가른다).
  it("셸 띄우기 답이 오기 전에 친 키는 첫 입력이 아니다 — 그 키는 셸에 안 닿는다", async () => {
    openNewShell(topTerminal("atelier"));
    const shell = terminalStore.state.shells[terminalStore.state.shells.length - 1];
    const term = fake.terms[fake.terms.length - 1];
    // 답 전이다 — 스토어는 아직 셸 키를 모른다.
    expect(shell.shellKey).toBeNull();
    term.keyHandler(글자키("a"));

    await vi.waitFor(() => expect(terminalStore.state.shells.find((one) => one.id === shell.id)?.shellKey).not.toBeNull());
    expect(terminalStore.state.shells.find((one) => one.id === shell.id)?.firstInput).toBeNull();
    expect(terminalApi.firstInput).not.toHaveBeenCalled();

    // **앵커** — 답 뒤에 친 키는 첫 입력이다. 그 셸의 pty로 한 번 알린다.
    term.keyHandler(글자키("b"));
    const seated = terminalStore.state.shells.find((one) => one.id === shell.id)!;
    expect(seated.firstInput).not.toBeNull();
    expect(terminalApi.firstInput).toHaveBeenCalledTimes(1);
    expect(terminalApi.firstInput).toHaveBeenCalledWith(ptyIdOf(seated.shellKey!), seated.firstInput);
  });
});

describe("셸로 가는 길의 포커스 — 스토어를 거쳐", () => {
  // 코드 리뷰 스펙 6 · 구현 기록 16의 남은 것. 붙지 않은 셸(다른 탭 · 다른 work의 셸)로 가는 길은 기다리는 포커스를 적어 그 셸이
  // 붙는 순간 준다(`focusShell`). 그 줄이 빠져도 L3 ②(띠에서 다른 work의 셸)는 초록이었다 — 화면을 옮기면 기다리는 것이 없어도
  // 붙는 셸이 포커스를 받는다(`focusOnAttach`). 그래서 **사이에 다른 셸이 붙는** 모양으로 잰다: 기다림이 적혔으면 그 셸은 못
  // 가로챈다.
  it("붙지 않은 셸에 포커스를 요청하면 그 셸이 붙을 때까지 기다린다 — 사이에 붙는 다른 셸이 가로채지 않는다", async () => {
    const a = await openShellSpawned();
    const b = await openShellSpawned();

    focusShell(a.id);
    // 붙어 있지 않다 — 그 자리에서 줄 곳이 없다.
    expect(a.term.focused).toBe(0);
    attachShell(자리(), b.id);
    expect(b.term.focused, "기다리는 포커스가 안 적혀 사이에 붙은 셸이 가져갔다").toBe(0);
    attachShell(자리(), a.id);
    expect(a.term.focused).toBe(1);
  });

  it("붙어 있는 셸에 요청하면 그 자리에서 준다 — 기다리는 것이 안 남는다", async () => {
    const a = await openShellSpawned();
    const b = await openShellSpawned();
    attachShell(자리(), a.id);
    const given = a.term.focused;

    focusShell(a.id);
    expect(a.term.focused).toBe(given + 1);
    // 기다리는 것이 없으니 뒤에 붙는 셸도 받는다.
    attachShell(자리(), b.id);
    expect(b.term.focused).toBe(1);
  });

  // 기다리던 셸이 닫히면 버린다(프로세스 스펙 S21). 안 버리면 줄 셸이 없는 기다림이 남아 다음에 붙는 셸마다 포커스를 막는다.
  // 닫기의 유일한 정리 길(`disposeInstance`)이 그 줄을 든다 — 그 줄이 빠지면 여기가 빨개진다(열다 터진 셸의 같은 줄은 다른
  // 자리라 소스 핀이 못 가른다).
  it("기다리던 셸이 닫히면 기다림을 버린다 — 다음에 붙는 셸이 포커스를 받는다", async () => {
    const a = await openShellSpawned();
    const b = await openShellSpawned();

    focusShell(a.id);
    await requestCloseShell(a.id);
    // 앵커: 닫혔다.
    expect(terminalStore.state.shells.some((one) => one.id === a.id)).toBe(false);
    attachShell(자리(), b.id);
    expect(b.term.focused).toBe(1);
  });
});
