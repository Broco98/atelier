/// <reference types="node" />
// 소스 스캔 몇 건 때문에 Node 타입을 끌어온다 — 근거는 src/tauri-commands.test.ts 머리말과 같다.
import { readdirSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "@/routeTree.gen";
import { announceStay, navigateThen, whenArrived } from "./arrival";

// 이동이 닿으면 할 일(develop 머지 — 셸로 가는 길이 셸을 켜고 포커스를 요청하는 때, 토스트의 [보기]가 그 토스트를 내리는 때).
// 진짜 라우터를 메모리 히스토리로 띄워 「언제 부르는가」만 본다 — 막기가 없을 때 `navigate` 안에서 곧바로, 주소가 그대로인
// 이동에도, 막혀 머물면 안, 다른 데 먼저 닿으면 안, 같은 칸에 새 요청이 오면 앞의 것은 안, 칸이 다르면 둘 다.
//
// **막기 자체는 이 층에 없다.** 히스토리는 `document`가 있을 때만 막기를 부르고 Vitest 기본 환경(node)에는 그것이 없다. 막는
// 쪽이 하는 일(`announceStay`)을 여기서 손으로 부르고, 편집기의 진짜 막기를 지나는 ⌘J와 [보기]는 L3(`shell-recall.spec.ts` ·
// `processes-view.spec.ts`)가 잰다.
//
// isServer · origin을 넘기는 까닭은 `router.test.ts` 머리말과 같다 — node에서 라우터가 제가 클라이언트인 줄 알게 한다.

// 앱의 라우트 트리를 그대로 쓰되, 데이터를 안 부르는 세 화면 사이만 오간다 — 셸로 가는 길의 목적지(작업 화면의 검색 값)가
// 닿은 주소와 같게 지어지는지는 그 길을 도는 L3가 잰다.
function setup() {
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/terminal"] }),
    isServer: false,
    origin: "http://localhost",
    context: { queryClient: new QueryClient() },
  });
}

afterEach(() => {
  // 모듈 값이라 검사끼리 새지 않게 비운다 — 기다리는 것이 없으면 아무 일도 안 한다.
  announceStay();
});

describe("이동이 닿으면 할 일", () => {
  it("막기가 없으면 이동을 거는 그 자리에서 부른다 — 새 화면이 서기 전이다", async () => {
    const router = setup();
    await router.load();
    const arrive = vi.fn();

    whenArrived(router, router.buildLocation({ to: "/processes" }).href, arrive, "shell");
    const done = router.navigate({ to: "/processes" });
    expect(arrive).toHaveBeenCalledTimes(1);
    await done;
    expect(router.state.location.pathname).toBe("/processes");
  });

  it("주소가 그대로인 이동(보고 있는 화면)에도 부른다", async () => {
    const router = setup();
    await router.load();
    const arrive = vi.fn();

    whenArrived(router, router.buildLocation({ to: "/terminal" }).href, arrive, "shell");
    await router.navigate({ to: "/terminal" });
    expect(arrive).toHaveBeenCalledTimes(1);
  });

  it("막혀 머물면 거둔다 — 뒤에 같은 주소에 닿아도 안 부른다", async () => {
    const router = setup();
    await router.load();
    const arrive = vi.fn();

    whenArrived(router, router.buildLocation({ to: "/processes" }).href, arrive, "shell");
    // 막는 쪽이 [계속 편집]에서 하는 일. 막힌 이동은 히스토리에 안 적혀 라우터가 안 돈다.
    announceStay();
    // 사람이 뒤에 다른 길로 같은 화면에 간다(「앱으로 돌아가기」가 들어오기 전의 그 화면으로).
    await router.navigate({ to: "/processes" });
    expect(arrive).not.toHaveBeenCalled();
  });

  it("다른 주소에 먼저 닿으면 할 일 없이 거둔다 — 뒤에 그 주소에 닿아도 안 부른다", async () => {
    const router = setup();
    await router.load();
    const arrive = vi.fn();

    whenArrived(router, router.buildLocation({ to: "/processes" }).href, arrive, "shell");
    await router.navigate({ to: "/terminal" });
    await router.navigate({ to: "/processes" });
    expect(arrive).not.toHaveBeenCalled();
  });

  it("한 번만 부른다 — 떠났다가 다시 와도 또 부르지 않는다", async () => {
    const router = setup();
    await router.load();
    const arrive = vi.fn();

    whenArrived(router, router.buildLocation({ to: "/processes" }).href, arrive, "shell");
    await router.navigate({ to: "/processes" });
    await router.navigate({ to: "/terminal" });
    await router.navigate({ to: "/processes" });
    expect(arrive).toHaveBeenCalledTimes(1);
  });

  it("새 요청이 앞의 것을 덮는다 — 앞의 할 일은 안 부른다", async () => {
    const router = setup();
    await router.load();
    const first = vi.fn();
    const second = vi.fn();

    whenArrived(router, router.buildLocation({ to: "/processes" }).href, first, "shell");
    whenArrived(router, router.buildLocation({ to: "/processes" }).href, second, "shell");
    await router.navigate({ to: "/processes" });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  // 칸은 길마다 하나다 — 셸로 가는 길(⌘J)과 토스트의 [보기]. 한 칸에 둘을 두면 뒤의 요청이 앞의 것(셸 켜기 · 토스트 내리기)을
  // 소리 없이 지운다.
  it("칸이 다르면 서로 덮지 않는다 — 닿으면 둘 다 부른다", async () => {
    const router = setup();
    await router.load();
    const shell = vi.fn();
    const processes = vi.fn();

    whenArrived(router, router.buildLocation({ to: "/processes" }).href, shell, "shell");
    whenArrived(router, router.buildLocation({ to: "/processes" }).href, processes, "processes");
    await router.navigate({ to: "/processes" });
    expect(shell).toHaveBeenCalledTimes(1);
    expect(processes).toHaveBeenCalledTimes(1);
  });

  it("머묾은 모든 칸을 거둔다", async () => {
    const router = setup();
    await router.load();
    const shell = vi.fn();
    const processes = vi.fn();

    whenArrived(router, router.buildLocation({ to: "/processes" }).href, shell, "shell");
    whenArrived(router, router.buildLocation({ to: "/processes" }).href, processes, "processes");
    announceStay();
    await router.navigate({ to: "/processes" });
    expect(shell).not.toHaveBeenCalled();
    expect(processes).not.toHaveBeenCalled();
  });

  it("머묾은 기다리는 것이 없으면 아무 일도 안 한다", () => {
    expect(() => announceStay()).not.toThrow();
  });
});

describe("걸고 이동한다(navigateThen)", () => {
  // 코드 리뷰 표준 57 — 「목적지를 짓고 → 닿음을 걸고 → 이동한다」가 셸로 가는 길과 토스트의 [보기]에 두 벌이었다. 한 함수가 든다.
  it("닿으면 이동 안에서 곧바로 부른다 — 새 화면이 서기 전이다", async () => {
    const router = setup();
    await router.load();
    const arrive = vi.fn();

    navigateThen(router, { to: "/processes" }, arrive, "shell");
    // 이동을 이미 걸었다 — 막기가 없으니 닿음이 그 안에서 왔다.
    expect(arrive).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(router.state.location.pathname).toBe("/processes"));
  });

  it("막혀 머물면 안 부른다 — 뒤에 같은 주소에 닿아도", async () => {
    const router = setup();
    await router.load();
    // 막기가 물은 채 머무는 이동을 흉내 낸다 — 이동이 히스토리에 안 적혀 라우터가 안 돈다(이 층에는 막기가 없다 — 머리말).
    const stuck = { ...router, navigate: () => Promise.resolve() } as unknown as typeof router;
    const arrive = vi.fn();

    navigateThen(stuck, { to: "/processes" }, arrive, "shell");
    announceStay();
    await router.navigate({ to: "/processes" });
    expect(arrive).not.toHaveBeenCalled();
  });
});

// **이동을 거는 자리와 막는 자리**(develop 머지 · 코드 리뷰 표준 57). 두 약속이 소스에 있어야 한다 — 어기면 막힌 이동 뒤에 부수
// 효과가 남는데, 그 실패는 막기가 있는 화면(spec 레이아웃 편집기)에서만 L3로 드러난다.
describe("이동을 거는 자리와 막는 자리", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const read = (path: string) => readFileSync(root + path, "utf8");
  const countOf = (text: string, literal: string) => text.split(literal).length - 1;
  /** src의 앱 소스 전부(검사 파일은 뺀다) — 새 자리가 생겨도 목록을 손으로 늘리지 않는다. */
  const sources = readdirSync(root, { recursive: true, encoding: "utf8" })
    .map((file) => file.split("\\").join("/"))
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file));

  // 거는 쪽은 순서를 손으로 적지 않는다 — `navigateThen` 하나를 부른다. **src 전부를 훑는다**: 순서를 손으로 적어 틀린 자리가 앞서
  // 둘이었고(bf462b5 · 4151e68), 셋째 자리가 어느 파일에 설지는 미리 모른다. 닿음을 거는 것(`whenArrived(`)은 `navigateThen`의 몸통
  // 밖에 없어야 하고, `navigateThen`을 부르는 파일은 목적지를 따로 짓지 않는다(`buildLocation(`).
  it("이동을 걸고 닿음을 기다리는 자리는 모두 navigateThen을 부른다", () => {
    const callers = sources.filter((file) => read(file).includes("navigateThen("));
    // 앵커 — 셸로 가는 길과 토스트의 [보기]가 부른다. 없으면 아래가 아무것도 안 잰다.
    expect(callers).toEqual(
      expect.arrayContaining(["components/shell/useGoToShell.ts", "components/shell/AppShell.tsx", "lib/arrival.ts"]),
    );
    for (const file of sources.filter((one) => one !== "lib/arrival.ts")) {
      expect(countOf(read(file), "whenArrived("), `${file}가 닿음을 손으로 건다`).toBe(0);
    }
    for (const file of callers.filter((one) => one !== "lib/arrival.ts")) {
      expect(countOf(read(file), "buildLocation("), `${file}가 목적지를 따로 짓는다`).toBe(0);
    }
  });

  // 셸로 가는 길 — 주인 잃은 셸 갈림이 켜기 · 포커스 요청보다 먼저이고(붙을 화면이 없는 셸에 기다림이 안 남는다), 켜기와 요청은
  // 닿은 순간에 한다(막힌 이동 뒤에 안 남는다 — bf462b5 · 4151e68).
  it("셸로 가는 길은 주인 잃은 셸을 먼저 가르고, 켜기와 포커스 요청을 닿은 순간에 한다", () => {
    const source = read("components/shell/useGoToShell.ts");
    const 갈림 = source.indexOf("if (isOwnerlessShell(id))");
    const 켜기 = source.indexOf("selectShellWithFocus(id)");
    expect(갈림).toBeGreaterThan(-1);
    expect(켜기, "주인 잃은 셸 갈림 앞에서 셸을 켠다").toBeGreaterThan(갈림);
    expect(countOf(source, "selectShellWithFocus(")).toBe(1);
    expect(source).toContain('navigateThen(router, target, () => selectShellWithFocus(id), "shell")');
  });

  // **라우터의 막기를 세우는 자리는 막는 순간 알린다**(`announceStay`). 라우터의 막기는 막았다는 것을 이동을 건 쪽에 알리지
  // 않는다 — 안 알리면 [계속 편집] 뒤에 기다리던 일(⌘J의 셸 켜기와 포커스 요청, [보기]의 토스트 내리기)이 남아 다음에 같은
  // 화면에 닿는 이동에서 되살아난다. 막기를 새로 세우는 자리가 이것을 잊으면 여기가 빨개진다(구현 기록 「머지」의 남은 것).
  // 파일마다 **막기 수만큼** 알리는지 센다 — 「파일 어딘가에 하나」면 한 파일에 막기가 둘이고 하나만 알릴 때 못 가린다.
  it("라우터의 막기를 세우는 자리는 모두 announceStay를 부른다", () => {
    const blocksIn = (source: string) => source.match(/useBlocker\(|<Block[\s>]/g)?.length ?? 0;
    const blockers = sources.filter((file) => blocksIn(read(file)) > 0);
    // 앵커 — 막기가 적어도 하나 있다(spec 레이아웃 편집기의 떠날 때 확인). 없으면 아래가 아무것도 안 잰다.
    expect(blockers).toContain("features/spec-layout/leave.ts");
    for (const file of blockers) {
      const source = read(file);
      expect(countOf(source, "announceStay()"), `${file}가 라우터의 막기를 세우고 머물 때 알리지 않는다`).toBeGreaterThanOrEqual(
        blocksIn(source),
      );
    }
  });
});
