import { describe, expect, it } from "vitest";
import { SHORT_TOAST_MS, toastActionsOf, toastOptionsOf } from "./app-toast";

// 이 work의 토스트가 **얼마나 서 있는가**(프로세스 스펙 P2). 매니저에 넘기는 모양만 값으로 본다 — 화면에
// 서는 것과 사라지는 것은 L3가(`e2e/startup-report.spec.ts`) 브라우저에서 잰다.

describe("토스트의 수명", () => {
  it("버튼 없는 토스트는 짧게 선다 — 복사 토스트와 같은 시간이다", () => {
    expect(SHORT_TOAST_MS).toBe(1600);
    const options = toastOptionsOf({ text: "지난 실행에서 남은 프로세스 2개를 정리했어요" });
    expect(options.timeout).toBe(SHORT_TOAST_MS);
    expect(options.title).toBe("지난 실행에서 남은 프로세스 2개를 정리했어요");
    expect(toastActionsOf(options.data)).toEqual([]);
  });

  it("짧은 토스트도 id를 주면 그 id로 선다", () => {
    expect(toastOptionsOf({ id: "startup-cleanup", text: "정리" }).id).toBe("startup-cleanup");
    expect(toastOptionsOf({ text: "정리" }).id).toBeUndefined();
  });

  // **동작 토스트는 누르거나 닫을 때까지 남는다.** 1.6초 뒤에 사라지면 [모두 닫기]를 누를 틈이 없다.
  // 자기 id를 쓰는 것은 같은 알림이 다시 올 때 새로 쌓이지 않고 그 자리를 고치게 하려는 것이다.
  it("동작 토스트는 자기 id로 서고 저절로 내려가지 않는다", () => {
    let ran = 0;
    const options = toastOptionsOf({
      id: "orphan-shells",
      text: "아카이브된 작업의 셸 2개에 아직 도는 것이 있어요",
      actions: [{ label: "모두 닫기", run: () => (ran += 1) }],
    });
    expect(options.id).toBe("orphan-shells");
    expect(options.timeout).toBe(0);
    const [only] = toastActionsOf(options.data);
    expect(only.label).toBe("모두 닫기");
    only.run();
    expect(ran).toBe(1);
  });

  // 주인 잃은 셸 토스트(티켓 12)에 [보기]가 붙어 버튼이 둘이 됐다(티켓 32 · 프로세스 스펙 S15). Base UI의 동작 칸은 하나라
  // (`actionProps`) 버튼들은 토스트의 데이터에 싣고 목록이 그린다(`AppToasts`). 차례는 받은 그대로다 — 앞이 주된 동작이다.
  it("버튼이 여럿인 동작 토스트는 받은 차례로 버튼을 든다", () => {
    const ran: string[] = [];
    const options = toastOptionsOf({
      id: "orphans:atelier",
      text: "아카이브된 작업의 셸 1개에 아직 도는 것이 있어요",
      actions: [
        { label: "모두 닫기", run: () => ran.push("모두 닫기") },
        { label: "보기", run: () => ran.push("보기") },
      ],
    });
    expect(options.timeout).toBe(0);
    const actions = toastActionsOf(options.data);
    expect(actions.map((action) => action.label)).toEqual(["모두 닫기", "보기"]);
    actions[1].run();
    expect(ran).toEqual(["보기"]);
  });

  // 목록은 매니저가 준 것만 그린다 — 데이터가 이 모양이 아니면(다른 자리가 같은 매니저에 데이터를 실은 날) 버튼 없이 선다.
  it("모양이 아닌 데이터에서는 버튼을 안 읽는다", () => {
    expect(toastActionsOf(undefined)).toEqual([]);
    expect(toastActionsOf({ actions: "보기" })).toEqual([]);
  });
});
