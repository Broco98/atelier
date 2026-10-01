import { afterEach, describe, expect, it, vi } from "vitest";
import { appToasts } from "./app-toast";
import { onViewProcesses, processesAddress, viewAction, viewProcesses } from "./processes-view";

// **`Processes`로 가는 문 하나**(프로세스 스펙 S15 · 티켓 32). 토스트의 [보기] 셋(시작 정리 · 주인 잃은 셸 · 셸 스스로 끝남)과 띠의 주인 잃은
// 셸 줄이 이 문을 지난다. 토스트는 스토어 · 순수 모듈이 짓고 라우터는 앱 셸이 쥐어서, 앱 셸이 가는 길을 걸고(`onViewProcesses`) 나머지는
// 문을 두드린다. 화면이 실제로 옮겨 가는지는 L3가 잰다(`processes-view.spec.ts`).

afterEach(() => vi.restoreAllMocks());

describe("Processes로 가는 문", () => {
  it("건 길로 간다 — 마지막에 건 것 하나다", () => {
    const went: string[] = [];
    const stopA = onViewProcesses(() => went.push("a"));
    const stopB = onViewProcesses(() => went.push("b"));
    viewProcesses();
    stopB();
    stopA();
    expect(went).toEqual(["b"]);
  });

  // StrictMode(dev)는 앱 셸의 이펙트를 걸었다 풀었다 다시 건다. 먼저 건 것을 푸는 손이 나중에 건 길을 떼면 [보기]가 아무 데도 안 간다.
  it("풀기는 제가 건 길만 뗀다", () => {
    const went: string[] = [];
    const stopOld = onViewProcesses(() => went.push("old"));
    const stopNew = onViewProcesses(() => went.push("new"));
    stopOld();
    viewProcesses();
    stopNew();
    expect(went).toEqual(["new"]);
  });

  it("건 길이 없으면 아무 일도 없다 — 던지지 않는다", () => {
    expect(() => viewProcesses()).not.toThrow();
  });

  // 화면은 앱 전체를 보인다(프로세스 결정 9). 어느 화면에서 불러도 같은 주소다 — 설정(`/settings`)도 그렇다.
  it("어느 화면에서든 `Processes` 주소로 간다", () => {
    expect(processesAddress("/works/plain-work")).toBe("/processes");
    expect(processesAddress("/terminal")).toBe("/processes");
    expect(processesAddress("/settings/terminal")).toBe("/processes");
  });
});

// [보기]는 **닿은 순간에** 토스트를 내린다(develop 머지). 앱 토스트는 설정 화면에도 서고, spec 레이아웃 편집기의 떠날 때 확인이 이동을
// 막을 수 있다 — 먼저 내리면 [계속 편집]으로 머물 때 누를 때까지 남는 동작 토스트가 사라진다. 길(앱 셸)이 닿음을 알리는 것은
// `arrived`를 부르는 것이고, 진짜 라우터와 진짜 막기를 지나는 것은 L3가 잰다(`processes-view.spec.ts`의 편집기 둘).
describe("토스트의 [보기]", () => {
  it("누르면 Processes로 가고, 닿으면 그 토스트를 내린다", () => {
    const closed = vi.spyOn(appToasts, "close").mockImplementation(() => {});
    let viewed = 0;
    const stop = onViewProcesses((arrived) => {
      viewed += 1;
      expect(closed, "닿기 전에 토스트를 내렸다").not.toHaveBeenCalled();
      arrived();
    });
    const action = viewAction("startup:cleanup");
    expect(action.label).toBe("보기");
    action.run();
    stop();
    expect(closed).toHaveBeenCalledWith("startup:cleanup");
    expect(viewed).toBe(1);
  });

  it("이동이 막혀 닿지 않으면 토스트를 내리지 않는다", () => {
    const closed = vi.spyOn(appToasts, "close").mockImplementation(() => {});
    let viewed = 0;
    // 막힌 길 — 이동은 걸었지만 닿지 않아 `arrived`를 안 부른다.
    const stop = onViewProcesses(() => (viewed += 1));
    viewAction("processes-ended:3").run();
    stop();
    expect(viewed).toBe(1);
    expect(closed).not.toHaveBeenCalled();
  });

  it("건 길이 없으면 토스트를 내리지 않는다 — 가지도 않았다", () => {
    const closed = vi.spyOn(appToasts, "close").mockImplementation(() => {});
    viewAction("startup:cleanup").run();
    expect(closed).not.toHaveBeenCalled();
  });
});
