import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PtyExit, ShellAttention, ShellHookState } from "./types";

// **터미널 스토어를 그대로 돌린다**(코드 리뷰 스펙 2 · 6 반영). 이 폴더의 다른 L2는 순수 모듈을 재거나 스토어의 줄을 소스로
// 못박는다 — 스토어는 xterm과 Tauri를 들여 그대로는 노드에서 셸을 못 연다. 그래서 **배선이 순서를 틀리거나 줄 하나를 잃는
// 회귀**(보고 있던 셸의 확인할 것이 ⌘J 기억에서 빠진다, 요청한 셸의 기다리는 포커스가 안 적힌다, 셸이 뜨기 전 키가 첫 입력으로
// 앉는다, 주인 잃은 셸 토스트의 수가 안 따라온다)는 순수 함수의 표가 아무리 맞아도 안 잡혔다.
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
import { appToasts } from "@/components/shell/app-toast";
import { terminalApi } from "./api";
import { applyNotifySettings } from "./notify-settings";
import { ptyIdOf } from "./shell-key";
import { ownerlessNotice, ownerlessToastId } from "./shell-owners";
import { NO_SHELLS, ownerOf, topTerminal } from "./shell-registry";
import type { ShellOrigin } from "./shell-registry";
import {
  attachShell,
  closeQuietShells,
  openNewShell,
  recalledShell,
  requestCloseShell,
  selectShell,
  selectShellWithFocus,
  settleOwners,
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

type FakeTerminal = InstanceType<typeof fake.FakeTerminal>;
type FakeChannel = InstanceType<typeof fake.FakeChannel>;

/** 띄운 셸 하나 — 레지스트리 id · pty 번호 · 셸 키와, 그 셸의 가짜 xterm과 채널. */
interface SpawnedShell {
  id: number;
  ptyId: number;
  shellKey: string;
  term: FakeTerminal;
  channel: FakeChannel;
}

/** 셸을 하나 열고(기본은 최상위 터미널) 띄우기 답이 앉을 때까지 기다린다. */
async function openShellSpawned(origin: ShellOrigin = topTerminal("atelier")): Promise<SpawnedShell> {
  const before = terminalStore.state.shells.length;
  openNewShell(origin);
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

/** 채널로 종료 프레임을 흘린다 — 셸이 스스로 끝났다. */
function exitFrame(channel: FakeChannel, exit: PtyExit): void {
  channel.onmessage(exit);
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
  // 확인할 것이 되어(`markShellsSeen`) 기억에 못 든다. 프로세스 결정 16 · 프로세스 스펙 S59는 「보고 있어서 안 울린 부름도 사람을 부른 것」이다.
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
  // 붙는 순간 준다(`selectShellWithFocus` → `focusShell`). 그 줄이 빠져도 L3 ②(띠에서 다른 work의 셸)는 초록이었다 — 화면을 옮기면 기다리는 것이 없어도
  // 붙는 셸이 포커스를 받는다(`focusOnAttach`). 그래서 **사이에 다른 셸이 붙는** 모양으로 잰다: 기다림이 적혔으면 그 셸은 못
  // 가로챈다.
  it("붙지 않은 셸에 포커스를 요청하면 그 셸이 붙을 때까지 기다린다 — 사이에 붙는 다른 셸이 가로채지 않는다", async () => {
    const a = await openShellSpawned();
    const b = await openShellSpawned();

    selectShellWithFocus(a.id);
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

    selectShellWithFocus(a.id);
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

    selectShellWithFocus(a.id);
    await requestCloseShell(a.id);
    // 앵커: 닫혔다.
    expect(terminalStore.state.shells.some((one) => one.id === a.id)).toBe(false);
    attachShell(자리(), b.id);
    expect(b.term.focused).toBe(1);
  });
});

describe("주인 잃은 셸 토스트의 N — 스토어를 거쳐", () => {
  // 구현 기록 12 · 32의 남은 것. 주인 잃은 셸 토스트(동작 토스트 — 누르거나 닫을 때까지 남는다)의 N은 **살아 있는** 주인 잃은 셸이다.
  // 한때 그 N은 세울 때만 지어져, 그 셸이 스스로 끝나거나 `Processes`에서 닫혀도 「아직 도는 것이 있어요」가 옛 수로 남았다.
  // 고치는 길은 **고치기만** 한다(`update`) — 새로 세우면(`add`) 사람이 이미 닫은 토스트가 셸 하나 닫힐 때마다 되살아난다.
  const 사라진work = (slug: string): ShellOrigin => ({ mode: "atelier", owner: ownerOf("atelier", slug), project: null, cwd: `~/${slug}` });
  const 토스트 = ownerlessToastId("atelier");
  const 목록 = { status: "success" as const, data: [] };

  /** 그 work의 셸 `count`개를 열고, 그 work이 목록에서 사라진 것을 알린다 — 셸이 모두 주인 잃은 셸이 된다(조용한지 모른다). */
  async function 주인잃은셸(slug: string, count: number) {
    const shells = [];
    for (let n = 0; n < count; n += 1) shells.push(await openShellSpawned(사라진work(slug)));
    await settleOwners("atelier", 목록);
    for (const one of shells) expect(terminalStore.state.shells.find((shell) => shell.id === one.id)?.ownerless).toBe(true);
    return shells;
  }

  let add: ReturnType<typeof vi.spyOn>;
  let update: ReturnType<typeof vi.spyOn>;
  let close: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    add = vi.spyOn(appToasts, "add");
    update = vi.spyOn(appToasts, "update");
    close = vi.spyOn(appToasts, "close");
  });
  afterEach(() => {
    add.mockRestore();
    update.mockRestore();
    close.mockRestore();
  });

  it("주인 잃은 셸 하나가 닫히면 토스트의 N이 줄고, 마지막이 닫히면 토스트가 내려간다", async () => {
    const [a, b] = await 주인잃은셸("gone", 2);
    // 앵커 — 세웠다(새 주인 잃은 셸이 생겼다).
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ id: 토스트, title: ownerlessNotice("atelier", 2) }));

    // `Processes`의 한 줄 닫기 — 셸 닫기 확인을 거치는 길이다.
    await requestCloseShell(a.id);
    expect(update).toHaveBeenLastCalledWith(토스트, { title: ownerlessNotice("atelier", 1) });
    expect(close).not.toHaveBeenCalledWith(토스트);

    await requestCloseShell(b.id);
    expect(close).toHaveBeenCalledWith(토스트);
    // 세우기는 처음 한 번뿐이다.
    expect(add).toHaveBeenCalledTimes(1);
  });

  // 사람이 [×]로 닫은 동작 토스트는 셸이 닫힐 때마다 되살아나면 안 된다 — 고치기(`update`)는 떠 있지 않은 id에 아무것도 안 한다
  // (Base UI 매니저). 그래서 닫는 길 셋 어디서도 **세우지(`add`) 않는다**.
  it("닫는 길 셋(한 줄 닫기 · [조용한 셸 모두 닫기] · 스스로 끝남)은 토스트를 세우지 않고 고치기만 한다", async () => {
    const [a, b, c, d] = await 주인잃은셸("gone", 4);
    appToasts.close(토스트);
    add.mockClear();
    update.mockClear();

    await requestCloseShell(a.id);
    expect(update).toHaveBeenLastCalledWith(토스트, { title: ownerlessNotice("atelier", 3) });

    // 조용해진 셸 하나(b)만 닫힌다 — 나머지는 답이 없어 조용한지 모른다.
    vi.mocked(terminalApi.closeChecks).mockResolvedValueOnce({ [b.ptyId]: { command: false, descendants: 0 } });
    await closeQuietShells();
    expect(terminalStore.state.shells.some((shell) => shell.id === b.id)).toBe(false);
    expect(update).toHaveBeenLastCalledWith(토스트, { title: ownerlessNotice("atelier", 2) });

    // 스스로 끝남 — 정상 종료는 목록에서 빠지고, 이유가 있는 끝은 목록에 남지만 더는 살아 있는 셸이 아니다.
    exitFrame(c.channel, { exitCode: 0, signal: null });
    expect(update).toHaveBeenLastCalledWith(토스트, { title: ownerlessNotice("atelier", 1) });
    exitFrame(d.channel, { exitCode: 1, signal: null });
    expect(terminalStore.state.shells.some((shell) => shell.id === d.id)).toBe(true);
    expect(close).toHaveBeenLastCalledWith(토스트);

    expect(add, "사람이 닫은 토스트가 다시 섰다").not.toHaveBeenCalled();
  });

  // 세우는 길은 그대로다 — 새 주인 잃은 셸이 생기면 사람이 앞의 것을 닫았어도 다시 선다(지금 수로).
  it("새 주인 잃은 셸이 생기면 토스트가 다시 선다", async () => {
    await 주인잃은셸("gone", 1);
    appToasts.close(토스트);
    add.mockClear();

    await 주인잃은셸("gone-too", 1);
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ id: 토스트, title: ownerlessNotice("atelier", 2) }));
  });
});
