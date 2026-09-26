/// <reference types="node" />
import { readdirSync, readFileSync, type Dirent } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  armDrag,
  cancelGoneShellDrag,
  clearHalf,
  DRAG_THRESHOLD,
  dragStore,
  farEnough,
  hoverHalf,
  hoverSlot,
  shellMoveOf,
  tabDragOf,
} from "./pointer-drag";
import type { DragSource, DragState, EntryDragSource, RowDragSource } from "./pointer-drag";

// 끌기 제스처가 **기능 폴더 밖**에 사는 이유가 import 금지 검사 둘이다(스펙 S4) — 작업 기능
// 폴더는 `/terminal`이 못 부르고(TerminalPage.test.tsx), 터미널 기능 폴더는 사이드바 목록이
// 못 부른다(SidebarWorkList.test.tsx). 그 둘은 **각자 자기 파일만** 세서, 이 모듈이 기능
// 폴더 하나를 끌어오면 둘 다 초록인 채 두 화면 중 하나가 이 모듈을 못 쓰게 된다.
//
// owner 타입(`ShellOwner`)이 터미널 기능 폴더에 산다 — **`import type`도 걸린다.** 타입만
// 들어도 경계가 값 차원에서 한 번 뚫리면 다음 사람이 값을 들여온다. 좁히기는 소비자가 한다.
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const countOf = (text: string, literal: string) => text.split(literal).length - 1;

describe("공용 끌기 모듈은 기능 폴더를 모른다", () => {
  const gesture = read("./pointer-drag.ts");

  // **세는 파일이 정말 그 모듈인가를 먼저 묶는다.** 모듈이 옮겨 가고 이 이름의 파일만 남으면
  // 아래 0이 빈 초록이다 — 분할 모듈이 실제로 이 경로를 import하는 것을 알려진 양성으로 센다.
  it("분할 모듈이 이 파일을 import한다", () => {
    expect(countOf(read("../features/works/split-view.ts"), 'from "@/lib/pointer-drag"')).toBeGreaterThan(0);
  });

  it("기능 폴더 import가 0개다", () => {
    // 세는 방법이 새지 않는지 — 기능 폴더를 부르는 것이 확실한 화면에서 같은 리터럴이 잡힌다.
    expect(countOf(read("../features/works/WorksPage.tsx"), "@/features/")).toBeGreaterThan(0);

    // **주석에 적어도 빨개진다** — 리터럴을 세서 그렇고, 이웃 검사들과 같은 성질을 일부러 둔다.
    expect(countOf(gesture, "@/features/")).toBe(0);
    expect(countOf(gesture, "../features")).toBe(0);
  });

  // 위 둘은 **직접** 부르는 것만 잡는다. 기능 폴더 밖 모듈이 이미 기능 폴더를 부른다
  // (`components/shell/shell-signal.tsx` → `features/terminal`) — 이 모듈이 그런 것을 들이면
  // 위 0도 이웃 검사 둘도 초록인 채 경계가 뚫린다. 그래서 **허용 목록**으로 닫는다: 모든
  // `from "…"`이 목록 안의 것이어야 한다. 새 의존은 무엇이든 여기서 빨개지고, 목록을 넓히는
  // 사람이 그 모듈이 기능 폴더를 안 부르는지를 본다.
  it("import는 허용 목록 안의 것뿐이다", () => {
    const allowed = ['from "@tanstack/react-store"'];
    const allowedCount = allowed.reduce((sum, literal) => sum + countOf(gesture, literal), 0);
    // 알려진 양성 — 세는 방법이 새면 둘 다 0이라 아래 등식이 빈 초록이다.
    expect(allowedCount).toBeGreaterThan(0);
    expect(countOf(gesture, 'from "')).toBe(allowedCount);
    expect(countOf(gesture, "from '")).toBe(0);
    expect(countOf(gesture, "import(")).toBe(0);
    expect(countOf(gesture, "require(")).toBe(0);
  });
});

// 한 눌림을 두 소비자가 나눠 본다(UI개선 스펙 S10) — 탭 줄은 「몇 번째 틈」을, 본문
// 받침은 「어느 절반」을 적는다. **둘이 동시에 켜지면 놓은 곳이 이긴다가 깨진다**: 떼는 순간
// 두 소비자가 각자 제 값을 보고 순서도 바꾸고 분할도 켠다. 그 불변식을 **값을 적는 유일한
// 자리**(이 모듈의 `hover`)에 건다 — 적는 함수 셋이 모두 거기를 지난다.
describe("한 눌림의 두 소비자", () => {
  const shell: DragSource = { kind: "shell", owner: "atelier:", shellId: 1 };

  beforeEach(() => {
    dragStore.setState(() => ({ source: null, half: null, slot: null }));
  });

  it("끄는 중이면 틈을 적는다", () => {
    dragStore.setState(() => ({ source: shell, half: null, slot: null }));
    hoverSlot(2);
    expect(dragStore.state.slot).toBe(2);
    hoverSlot(null);
    expect(dragStore.state.slot).toBeNull();
  });

  // 문턱 전에는 드래그가 아니다 — 누른 채 탭 위를 조금 움직여도 틈이 서면 안 된다. Esc로
  // 취소한 뒤(상태가 비었다) 손을 떼기 전까지 움직여도 마찬가지다.
  it("끄는 중이 아니면 틈을 안 적는다", () => {
    const before = dragStore.state;
    hoverSlot(2);
    expect(dragStore.state).toBe(before);
  });

  // 두 방향을 한 표에 둔다 — 한쪽 적는 함수만 상대를 끄면 다른 쪽 줄이 빨개진다.
  it.each([
    { name: "틈이 켜지면 절반이 꺼진다", from: { half: "left", slot: null }, act: () => hoverSlot(1), to: { half: null, slot: 1 } },
    { name: "절반이 켜지면 틈이 꺼진다", from: { half: null, slot: 2 }, act: () => hoverHalf("right"), to: { half: "right", slot: null } },
    { name: "틈을 끄면 절반은 그대로다", from: { half: "left", slot: null }, act: () => hoverSlot(null), to: { half: "left", slot: null } },
    { name: "절반을 끄면 틈은 그대로다", from: { half: null, slot: 2 }, act: () => clearHalf(), to: { half: null, slot: 2 } },
  ] as const)("$name", ({ from, act, to }) => {
    dragStore.setState(() => ({ source: shell, ...from }));
    act();
    expect(dragStore.state).toMatchObject(to);
  });

  // 포인터 이동마다 새 객체를 내면 구독한 화면이 그 빈도로 다시 그려진다 — 본문엔 마크다운
  // 트리가 통째로 들어 있다.
  it.each([
    { name: "같은 틈", from: { half: null, slot: 1 }, act: () => hoverSlot(1) },
    { name: "같은 절반", from: { half: "right", slot: null }, act: () => hoverHalf("right") },
    { name: "이미 꺼진 절반", from: { half: null, slot: 1 }, act: () => clearHalf() },
  ] as const)("$name이면 같은 상태다", ({ from, act }) => {
    dragStore.setState(() => ({ source: shell, ...from }));
    const before = dragStore.state;
    act();
    expect(dragStore.state).toBe(before);
  });

  // **적는 자리가 이 모듈 하나인가.** 다른 모듈이 스토어를 직접 고치면 위 표를 안 지나서
  // 두 값이 함께 켜질 수 있다. fail-closed: 파일을 못 읽으면 빨갛고, 이 모듈의 양성이 먼저 선다.
  it("드래그 상태를 고치는 곳이 이 모듈뿐이다", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const sources = (function walk(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((entry: Dirent) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return walk(path);
        return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
      });
    })(root);
    expect(sources.length).toBeGreaterThan(50);
    const writers = sources
      .filter((path) => readFileSync(path, "utf8").includes("dragStore.setState"))
      .map((path) => relative(root, path).split("\\").join("/"));
    expect(writers).toEqual(["lib/pointer-drag.ts"]);
  });
});

// 본문 절반(분할 겹판)처럼 **탭만 받는 쪽**이 읽는 판정(spec 레이아웃 티켓 13). 「작업 행이 아니면 탭」으로
// 거르면 원천 종류가 늘어나는 날 새 종류가 탭으로 읽힌다 — 편집기 항목을 끄는 순간 분할 겹판이 선다. 그래서
// 탭 종류로 좁힌다.
describe("탭 끌기 판정", () => {
  const state = (source: DragState["source"]): DragState => ({ source, half: null, slot: null });

  it.each([
    { name: "문서 칸", source: { kind: "spec", owner: "atelier:", shellId: null } as DragSource },
    { name: "셸 칸", source: { kind: "shell", owner: "maison:", shellId: 2 } as DragSource },
  ])("$name은 탭이다", ({ source }) => {
    expect(tabDragOf(state(source))).toBe(source);
  });

  it.each([
    { name: "작업 행", source: { kind: "work", slug: "a" } as RowDragSource },
    { name: "편집기 항목", source: { kind: "entry", path: [2, 0] } as EntryDragSource },
    { name: "끄는 것이 없음", source: null },
  ])("$name은 탭이 아니다", ({ source }) => {
    expect(tabDragOf(state(source))).toBeNull();
  });
});

// 놓을 때 탭 줄이 읽는 몫 — 터미널 스토어가 드래그 상태의 모양을 몰라도 되게 여기서 꺼낸다.
describe("탭 줄에 놓인 셸", () => {
  const shell: DragSource = { kind: "shell", owner: "atelier:", shellId: 7 };

  it.each([
    { name: "셸을 틈 위에서 놓으면 그 둘이다", state: { source: shell, half: null, slot: 3 }, want: { shellId: 7, slot: 3 } },
    { name: "틈이 없으면 없다", state: { source: shell, half: "left", slot: null }, want: null },
    { name: "끄는 중이 아니면 없다", state: { source: null, half: null, slot: null }, want: null },
    { name: "문서 칸이면 없다", state: { source: { kind: "spec", owner: "atelier:", shellId: null }, half: null, slot: 0 }, want: null },
  ] as const)("$name", ({ state, want }) => {
    expect(shellMoveOf(state)).toEqual(want);
  });
});

// **끄는 셸이 사라지면 끌기를 거둔다**(결정 48 · UI개선 스펙 S8). 셸이 사라지는 길(종료 · `×`·⌘W · 아카이빙)은
// 모두 터미널 스토어의 구독이 이것 하나로 모은다 — 그 구독은 xterm을 들여 노드에서 못 부르므로(L3
// `tab-order.spec.ts`가 두 화면에서 잰다), 여기서는 **판정과 거두는 길**을 잰다: 문턱 뒤 · 문턱 전 · 살아
// 있는 셸 · 셸이 아닌 원천. 창과 body는 이 몸짓이 쓰는 만큼만 세운다(리스너 · 클래스 목록).
describe("끄는 셸이 사라지면", () => {
  const classes = new Set<string>();
  let target: EventTarget;

  const pointer = (type: string, clientX: number, clientY = 0) =>
    target.dispatchEvent(Object.assign(new Event(type), { clientX, clientY }));

  beforeEach(() => {
    target = new EventTarget();
    classes.clear();
    // 클릭 삼키기를 걷는 타이머는 곧바로 돈다 — 진짜 타이머면 창을 걷은 뒤에 돌아 없는 `window`를 부른다.
    vi.stubGlobal("window", Object.assign(target, { setTimeout: (run: () => void) => run() }));
    vi.stubGlobal("document", {
      body: { classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name) } },
    });
    dragStore.setState(() => ({ source: null, half: null, slot: null }));
    return () => {
      // 다음 검사로 눌림이 새지 않게 손을 뗀다 — 이미 거둬졌으면 아무도 안 듣는다.
      pointer("pointerup", 0);
      vi.unstubAllGlobals();
    };
  });

  const shell: DragSource = { kind: "shell", owner: "maison:", shellId: 3 };
  const gone = () => false;

  function arm(source: DragSource | RowDragSource) {
    const calls: string[] = [];
    armDrag(source, { clientX: 0, clientY: 0 }, {
      drop: () => calls.push("drop"),
      end: () => calls.push("end"),
    });
    return calls;
  }

  it("문턱을 넘은 끌기를 거둔다 — 표시를 걷고, 떼도 놓지 않는다", () => {
    const calls = arm(shell);
    pointer("pointermove", 20);
    expect(dragStore.state.source).toBe(shell);
    expect(classes.has("dragging-row")).toBe(true);

    cancelGoneShellDrag((id) => id !== 3);

    expect(dragStore.state.source).toBeNull();
    expect(classes.has("dragging-row")).toBe(false);
    // 거둔 뒤 움직여도 다시 안 선다.
    pointer("pointermove", 40);
    expect(dragStore.state.source).toBeNull();
    pointer("pointerup", 40);
    expect(calls).toEqual(["end"]);
  });

  // 누른 뒤 5px 전에 셸이 끝났다 — 남은 눌림이 다음 이동에서 죽은 id로 끌기를 시작하면 안 된다.
  it("문턱 전의 눌림도 거둔다 — 그 뒤 움직여도 끌기가 안 선다", () => {
    const calls = arm(shell);
    cancelGoneShellDrag(gone);

    pointer("pointermove", 20);
    expect(dragStore.state.source).toBeNull();
    expect(classes.has("dragging-row")).toBe(false);
    pointer("pointerup", 20);
    expect(calls).toEqual([]);
  });

  it("셸이 살아 있으면 끌기가 산다", () => {
    const calls = arm(shell);
    cancelGoneShellDrag((id) => id === 3);
    pointer("pointermove", 20);
    cancelGoneShellDrag((id) => id === 3);
    expect(dragStore.state.source).toBe(shell);
    pointer("pointerup", 20);
    expect(calls).toEqual(["drop", "end"]);
  });

  // 셸이 없는 원천(문서 칸 · 작업 행)은 셸 목록과 무관하다 — 「없다」고 답해도 거두지 않는다.
  it.each([
    { name: "문서 칸", source: { kind: "spec", owner: "atelier:", shellId: null } as DragSource },
    { name: "작업 행", source: { kind: "work", slug: "a" } as RowDragSource },
  ])("$name 끌기는 거두지 않는다", ({ source }) => {
    const calls = arm(source);
    cancelGoneShellDrag(gone);
    pointer("pointermove", 20);
    cancelGoneShellDrag(gone);
    expect(dragStore.state.source).toBe(source);
    pointer("pointerup", 20);
    expect(calls).toEqual(["drop", "end"]);
  });
});

describe("드래그 임계값", () => {
  // 안 두면 그냥 클릭이 드래그로 읽혀 탭·행을 못 누른다(결정 86).
  it("작은 흔들림은 클릭이다", () => {
    expect(farEnough(0, 0)).toBe(false);
    expect(farEnough(4, 0)).toBe(false);
    expect(farEnough(0, -4)).toBe(false);
    expect(farEnough(3, 3)).toBe(false);
  });

  // **축 하나가 아니라 거리다** — 대각선으로 4px씩 움직인 것은 5.66px이라 드래그다.
  it("거리로 잰다", () => {
    expect(farEnough(DRAG_THRESHOLD, 0)).toBe(true);
    expect(farEnough(-DRAG_THRESHOLD, 0)).toBe(true);
    expect(farEnough(0, DRAG_THRESHOLD)).toBe(true);
    expect(farEnough(4, 4)).toBe(true);
  });
});
