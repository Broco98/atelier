import { describe, expect, it } from "vitest";
import { SHORT_TOAST_MS, toastOptionsOf } from "./app-toast";

// 이 work의 토스트가 **얼마나 서 있는가**(프로세스 스펙 P2). 매니저에 넘기는 모양만 값으로 본다 — 화면에
// 서는 것과 사라지는 것은 L3가(`e2e/startup-report.spec.ts`) 브라우저에서 잰다.

describe("토스트의 수명", () => {
  it("버튼 없는 토스트는 짧게 선다 — 복사 토스트와 같은 시간이다", () => {
    expect(SHORT_TOAST_MS).toBe(1600);
    const options = toastOptionsOf({ text: "지난 실행에서 남은 프로세스 2개를 정리했어요" });
    expect(options.timeout).toBe(SHORT_TOAST_MS);
    expect(options.title).toBe("지난 실행에서 남은 프로세스 2개를 정리했어요");
    expect(options.actionProps).toBeUndefined();
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
      action: { label: "모두 닫기", run: () => (ran += 1) },
    });
    expect(options.id).toBe("orphan-shells");
    expect(options.timeout).toBe(0);
    expect(options.actionProps?.children).toBe("모두 닫기");
    options.actionProps?.onClick?.({} as never);
    expect(ran).toBe(1);
  });
});
