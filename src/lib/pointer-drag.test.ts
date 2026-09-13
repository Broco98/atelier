/// <reference types="node" />
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { beforeEach, describe, expect, it } from "vitest";
import { dragStore, hoverSlot } from "./pointer-drag";
import type { DragSource } from "./pointer-drag";

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

// 한 눌림을 두 소비자가 나눠 본다(ui-improvement 스펙 S10) — 탭 줄은 「몇 번째 틈」을, 본문
// 받침은 「어느 절반」을 적는다. **둘이 동시에 켜지면 놓은 곳이 이긴다가 깨진다**: 떼는 순간
// 두 소비자가 각자 제 값을 보고 순서도 바꾸고 분할도 켠다. 그 불변식을 값을 적는 자리에 건다.
describe("탭 줄의 틈", () => {
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
  it("끄는 중이 아니면 아무것도 안 적는다", () => {
    const before = dragStore.state;
    hoverSlot(2);
    expect(dragStore.state).toBe(before);
  });

  it("틈이 켜지면 절반이 꺼진다", () => {
    dragStore.setState(() => ({ source: shell, half: "left", slot: null }));
    hoverSlot(1);
    expect(dragStore.state).toMatchObject({ half: null, slot: 1 });
  });

  // 포인터 이동마다 새 객체를 내면 구독한 화면이 그 빈도로 다시 그려진다(`hoverHalf`와 같은 이유).
  it("같은 틈이면 같은 상태다", () => {
    dragStore.setState(() => ({ source: shell, half: null, slot: 1 }));
    const before = dragStore.state;
    hoverSlot(1);
    expect(dragStore.state).toBe(before);
  });
});
