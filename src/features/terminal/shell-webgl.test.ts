/// <reference types="node" />
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import {
  attachWebgl,
  closeWebgl,
  failWebgl,
  loseWebgl,
  NO_WEBGL_SEATS,
  WEBGL_HOLDERS,
  WEBGL_RELOADS,
} from "./shell-webgl";
import type { WebglSeats } from "./shell-webgl";

// 어느 셸이 WebGL을 쥐나(티켓 17 · 프로세스 결정 18 ③ · 프로세스 스펙 S23 · S24). 순수 모듈이라 기본 환경(node)에서
// 돈다 — addon을 싣고 놓는 자리와 다음 프레임 대기는 스토어에 남고, 여기서는 「붙음 순서 → 놓을 셸」과 「잃음 → 다음에
// 할 일」을 값으로 잰다. 실물(셸 스무 개를 오가도 화면이 안 빈다)은 구현 기록 17절의 계측이 본다.

/** 붙음을 차례로 태워 붙음마다 놓은 셸을 모은다 — 「붙음 순서 → 놓을 셸」. */
function releasesOf(order: number[], limit: number, from: WebglSeats = NO_WEBGL_SEATS) {
  let seats = from;
  const released: number[][] = [];
  for (const id of order) {
    const plan = attachWebgl(seats, id, limit);
    seats = plan.seats;
    released.push(plan.kind === "load" ? [...plan.release] : []);
  }
  return { seats, released };
}

/** 셸 1..n을 차례로 붙인 자리. */
const seatsAfter = (n: number, limit: number) =>
  releasesOf(
    Array.from({ length: n }, (_, index) => index + 1),
    limit,
  ).seats;

describe("붙인 순서 LRU — 붙음 순서 → 놓을 셸", () => {
  it.each([6, 7, 8])("N=%i — N개까지는 아무것도 놓지 않고, N+1번째가 붙으면 가장 오래 안 붙은 셸을 놓는다", (limit) => {
    const order = Array.from({ length: limit + 2 }, (_, index) => index + 1);
    const { seats, released } = releasesOf(order, limit);

    expect(released.slice(0, limit)).toEqual(Array.from({ length: limit }, () => []));
    // N+1번째는 첫째를, N+2번째는 둘째를 놓는다 — 앞에서부터 붙었으니 가장 오래 안 붙은 순서다.
    expect(released.slice(limit)).toEqual([[1], [2]]);
    // 쥔 셸은 늘 N개이고, 가장 최근에 붙은 셸이 맨 앞이다.
    expect(seats.holders).toEqual(order.slice(2).reverse());
  });

  it("붙는 셸마다 새로 싣는다 — 쥔 셸이 N개가 될 때까지", () => {
    let seats = NO_WEBGL_SEATS;
    for (const id of [1, 2, 3]) {
      const plan = attachWebgl(seats, id, 6);
      expect(plan.kind).toBe("load");
      seats = plan.seats;
    }
  });

  it("이미 쥔 셸이 다시 붙으면 놓는 것 없이 맨 앞으로 간다", () => {
    const plan = attachWebgl(seatsAfter(6, 6), 1, 6);

    // 새로 싣지 않는다 — 이미 쥐고 있다.
    expect(plan.kind).toBe("hold");
    expect(plan.seats.holders).toEqual([1, 6, 5, 4, 3, 2]);
    // 맨 앞으로 갔으니 다음 새 셸이 놓는 것은 이제 1이 아니라 2다.
    expect(releasesOf([7], 6, plan.seats).released).toEqual([[2]]);
  });

  it("맨 앞의 셸이 다시 붙어도 목록이 그대로다", () => {
    const seats = seatsAfter(3, 6);
    const plan = attachWebgl(seats, 3, 6);
    expect(plan.kind).toBe("hold");
    expect(plan.seats.holders).toEqual([3, 2, 1]);
  });

  it("닫힌 셸은 목록에서 빠지고, 그 자리만큼 다음 셸이 놓지 않고 싣는다", () => {
    const closed = closeWebgl(seatsAfter(6, 6), 3);
    expect(closed.holders).toEqual([6, 5, 4, 2, 1]);

    const { released, seats } = releasesOf([7, 8], 6, closed);
    // 7은 닫힌 3의 자리에 앉는다. 8은 다시 N+1번째라 가장 오래 안 붙은 1을 놓는다.
    expect(released).toEqual([[], [1]]);
    expect(seats.holders).toEqual([8, 7, 6, 5, 4, 2]);
  });

  it("쥐지 않은 셸이 닫혀도 목록이 그대로다", () => {
    const seats = seatsAfter(3, 6);
    expect(closeWebgl(seats, 9).holders).toEqual([3, 2, 1]);
  });

  // 싣다가 던졌다(WebGL2를 못 얻음) — 그 셸은 쥐지 않는다. 남기면 쥐지도 않은 셸이 자리를 차지해, 쥔 셸이 N보다
  // 적은데 새 셸이 남의 addon을 놓는다.
  it("싣지 못한 셸은 목록에서 빠지고 예산을 안 쓴다", () => {
    const failed = failWebgl(seatsAfter(6, 6), 6);
    expect(failed.holders).toEqual([5, 4, 3, 2, 1]);
    expect(releasesOf([7], 6, failed).released).toEqual([[]]);
    // 다시 붙으면 또 싣는다 — 예산은 컨텍스트를 잃은 것만 센다.
    expect(attachWebgl(failed, 6, 6).kind).toBe("load");
  });
});

describe("N(프로세스 스펙 S23)", () => {
  // 6~8을 재 보고 6을 골랐다(구현 기록 17절): 오래 안 본 셸로 돌아갈 때 다시 싣는 값은 동기 3ms 남짓 · 프레임 하나
  // 10ms 남짓으로 작고, 쥔 셸 하나가 GPU 메모리 20MB 안팎을 더 든다. 「N이 작을수록 WebKit이 한도에 늦게 닿는다」는 근거로 삼지
  // 않는다 — 잰 것이 거꾸로다: N이 작으면 다시 싣는 전환이 잦아 놓은 컨텍스트가 빨리 쌓이고, 한도 경고는 N=6에서 가장 많았다
  // (44~46번, 7 · 8은 23~38번). 보이는 셸이 잃은 것은 어느 N에서도 0이라 경고 수는 고르는 잣대가 아니다.
  // **값을 바꾸면 다시 재고 그 절을 고친다** — 그래서 범위가 아니라 값으로 문다.
  it("동시에 WebGL을 쥐는 셸은 여섯이다", () => {
    expect(WEBGL_HOLDERS).toBe(6);
  });

  it("기본 상한이 그 값이다", () => {
    const order = Array.from({ length: WEBGL_HOLDERS + 1 }, (_, index) => index + 1);
    let seats = NO_WEBGL_SEATS;
    const released: number[][] = [];
    for (const id of order) {
      const plan = attachWebgl(seats, id);
      seats = plan.seats;
      released.push(plan.kind === "load" ? [...plan.release] : []);
    }
    expect(released[released.length - 1]).toEqual([1]);
    expect(released.slice(0, -1).flat()).toEqual([]);
  });
});

describe("재시도 예산(프로세스 스펙 S24)", () => {
  it("셸마다 세 번이다", () => {
    expect(WEBGL_RELOADS).toBe(3);
  });

  it("보이는 셸의 손실에 세 번까지 다시 싣고, 넷째는 DOM에 머문다", () => {
    let seats = attachWebgl(NO_WEBGL_SEATS, 1, 6).seats;
    const nexts: string[] = [];
    for (let loss = 1; loss <= 4; loss++) {
      const lost = loseWebgl(seats, 1, true);
      nexts.push(lost.next);
      seats = lost.seats;
      // 다시 싣기는 다시 붙는 것과 같은 길이다 — 잃은 셸은 더는 쥐지 않으니 새로 싣는다.
      if (lost.next === "reload") {
        const plan = attachWebgl(seats, 1, 6);
        expect(plan.kind).toBe("load");
        seats = plan.seats;
      }
    }
    expect(nexts).toEqual(["reload", "reload", "reload", "stayDom"]);

    // 앱이 다시 뜰 때까지 DOM이다 — 다시 붙어도 싣지 않고, 자리도 차지하지 않는다.
    const after = attachWebgl(seats, 1, 6);
    expect(after.kind).toBe("dom");
    expect(after.seats.holders).toEqual([]);
  });

  it("숨은 셸의 손실은 예산을 쓰지 않고, 다시 붙을 때 새로 싣는다", () => {
    let seats = attachWebgl(NO_WEBGL_SEATS, 1, 6).seats;
    for (let loss = 1; loss <= WEBGL_RELOADS + 3; loss++) {
      const lost = loseWebgl(seats, 1, false);
      expect(lost.next).toBe("onAttach");
      const plan = attachWebgl(lost.seats, 1, 6);
      expect(plan.kind).toBe("load");
      seats = plan.seats;
    }
    // 숨은 채 잃은 것이 쌓여도 보이는 셸의 첫 손실은 여전히 다시 싣는다.
    expect(loseWebgl(seats, 1, true).next).toBe("reload");
  });

  it("예산은 셸마다다 — 한 셸이 다 써도 다른 셸은 다시 싣는다", () => {
    let seats = releasesOf([1, 2], 6).seats;
    for (let loss = 1; loss <= WEBGL_RELOADS + 1; loss++) {
      seats = loseWebgl(seats, 1, true).seats;
      seats = attachWebgl(seats, 1, 6).seats;
    }
    expect(attachWebgl(seats, 1, 6).kind).toBe("dom");
    expect(loseWebgl(seats, 2, true).next).toBe("reload");
  });

  // 잃은 셸은 더는 쥐지 않는다 — 목록에 남기면 쥐지도 않은 셸 때문에 다른 셸이 addon을 잃는다.
  it("잃은 셸은 목록에서 빠지고, 그 자리만큼 다음 셸이 놓지 않고 싣는다", () => {
    const lost = loseWebgl(seatsAfter(6, 6), 3, false);
    expect(lost.seats.holders).toEqual([6, 5, 4, 2, 1]);
    expect(releasesOf([7], 6, lost.seats).released).toEqual([[]]);
  });

  // 예산을 다 쓴 셸은 자리를 안 차지한다 — 붙어도 다른 셸의 addon을 놓지 않는다.
  it("DOM에 머무는 셸이 붙어도 쥔 셸을 놓지 않는다", () => {
    let seats = attachWebgl(NO_WEBGL_SEATS, 9, 6).seats;
    for (let loss = 1; loss <= WEBGL_RELOADS + 1; loss++) {
      seats = loseWebgl(seats, 9, true).seats;
      seats = attachWebgl(seats, 9, 6).seats;
    }
    seats = releasesOf([1, 2, 3, 4, 5, 6], 6, seats).seats;
    const plan = attachWebgl(seats, 9, 6);
    expect(plan.kind).toBe("dom");
    expect(plan.seats.holders).toEqual([6, 5, 4, 3, 2, 1]);
  });

  it("닫힌 셸의 예산은 잊는다", () => {
    let seats = attachWebgl(NO_WEBGL_SEATS, 1, 6).seats;
    seats = loseWebgl(seats, 1, true).seats;
    expect(seats.losses.get(1)).toBe(1);
    expect(closeWebgl(seats, 1).losses.has(1)).toBe(false);
  });
});

// 스토어는 xterm을 들여 노드에서 못 부른다 — 배선은 소스로 못박는다(`shell-focus.test.ts`의 「포커스를 주는 자리가
// 배선돼 있다」와 같은 까닭). 이름이 있는지가 아니라 **표현식을 통째로** 본다.
describe("WebGL을 싣는 자리가 배선돼 있다", () => {
  const store = readFileSync(fileURLToPath(new URL("./terminal-store.ts", import.meta.url)), "utf8");
  const countOf = (text: string, literal: string) => text.split(literal).length - 1;

  // 싣는 자리는 셸을 열거나 다시 붙이는 함수 안, 포커스 줄 바로 위 하나다 — 붙음 · 글꼴이 늦게 온 길 · 다시 싣기가 다
  // 여기를 지난다. addon을 만드는 곳이 LRU 밖에 하나 더 생기면 N이 새어 나간다.
  it("addon을 만드는 자리가 하나이고, 붙는 순간 LRU를 지나 포커스 줄 위에서 싣는다", () => {
    expect(countOf(store, "new WebglAddon(")).toBe(1);
    expect(store).toMatch(/holdWebgl\(instance\);\n\s+refit\(instance\);\n\s+if \(give\) instance\.term\.focus\(\);/);
    expect(store).toContain("const plan = attachWebgl(webglSeats, instance.id);");
  });

  it("잃음은 보이는지를 싣고 예산에 묻고, 다시 싣기는 다음 프레임에 붙음과 같은 길로 간다", () => {
    expect(store).toContain("const lost = loseWebgl(webglSeats, instance.id, isAttached(instance));");
    expect(store).toMatch(/requestAnimationFrame\(\(\) => \{\n\s+if \(isAttached\(instance\)\) holdWebgl\(instance\);/);
  });

  // 숨었다 돌아온 셸은 바뀐 것이 없으면 xterm이 다시 안 그린다 — 그러면 WebKit이 잃힐 것을 고르는 순서(가장 오래 안
  // 그림)가 우리 순서(가장 오래 안 붙음)와 갈려 쥔 셸이 놓은 컨텍스트보다 먼저 잃힐 수 있다.
  it("이미 쥔 셸이 다시 붙으면 한 번 그린다", () => {
    expect(store).toMatch(/if \(plan\.kind === "hold"\) \{\n(\s+\/\/.*\n)*\s+instance\.term\.refresh\(0, instance\.term\.rows - 1\);\n\s+return;/);
  });

  it("셸이 닫히면 · 싣지 못하면 목록에서 뺀다", () => {
    expect(store).toContain("webglSeats = closeWebgl(webglSeats, instance.id);");
    expect(store).toContain("webglSeats = failWebgl(webglSeats, instance.id);");
  });
});
