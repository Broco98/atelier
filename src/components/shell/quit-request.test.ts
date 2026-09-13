/// <reference types="node" />
// 소스 스캔 한 건 때문에 Node 타입을 끌어온다 — 근거는 src/tauri-commands.test.ts 머리말과 같다.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it } from "vitest";
import { askDialog, dialogStore } from "@/components/ui/confirm-store";
import type { QuitCounts } from "@/features/terminal/shell-registry";
import { QUIT_REQUESTED_EVENT, QUIT_TITLE, requestQuit } from "./quit-request";

// 종료 확인(결정 14·15 · #223). 브라우저를 거쳐 창이 뜨고 키가 먹는 것은 L3가
// (`e2e/quit-confirm.spec.ts`), 무엇을 세는지는 `shell-registry.test.ts`가, 여기는 **「묻는 중」
// 표시가 내려가는 길**을 값으로 본다 —
// 안전판이 없어서(결정 31) 표시가 한 번이라도 선 채 남으면 그 뒤로 앱을 끌 길이 강제 종료뿐이다.

// **떠 있는 창을 다 접고, 표시가 내려갈 틈을 준다.** 모듈 수준 표시는 테스트 사이에도 살아 있어서,
// 한 테스트가 창을 남기면 다음 테스트의 요청이 전부 무시된다.
afterEach(async () => {
  while (dialogStore.state) {
    dialogStore.state.answer(false);
    await settle();
  }
});

/** 답이 풀릴 때까지 마이크로태스크를 넘긴다 — 세기가 끝나야 창이 선다. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("묻는 중 표시", () => {
  const counter = (counts: QuitCounts = { live: 1, running: 0 }) => {
    let calls = 0;
    return {
      calls: () => calls,
      fn: async () => {
        calls += 1;
        return counts;
      },
    };
  };
  const quitter = () => {
    let calls = 0;
    return {
      calls: () => calls,
      fn: async () => {
        calls += 1;
      },
    };
  };

  it("창이 「Atelier 종료」이고 기본 포커스가 취소다", async () => {
    void requestQuit(counter().fn, quitter().fn);
    await settle();
    expect(dialogStore.state?.title).toBe("Atelier 종료");
    expect(dialogStore.state?.confirm).toBe("종료");
    expect(dialogStore.state?.danger).toBe(true);
    expect(dialogStore.state?.focus).toBe("cancel");
  });

  // **세는 동안은 창이 아직 없다** — 「창이 떠 있나」로는 둘째 요청을 못 막는다.
  it("세는 동안의 둘째 요청은 무시된다", async () => {
    const count = counter();
    // 둘째 약속을 기다리지 않는다 — 무시되지 않은 변형에서는 그것이 창의 답을 기다려 여기서 멈춘다.
    void requestQuit(count.fn, quitter().fn);
    void requestQuit(count.fn, quitter().fn);
    await settle();
    expect(count.calls()).toBe(1);
  });

  it("창이 떠 있을 때의 요청도 창을 안 바꾼다", async () => {
    const count = counter();
    void requestQuit(count.fn, quitter().fn);
    await settle();
    const shown = dialogStore.state;
    void requestQuit(count.fn, quitter().fn);
    await settle();
    expect(dialogStore.state).toBe(shown);
    expect(count.calls()).toBe(1);
  });

  it("「종료」면 끄고, 「취소」면 안 끈다", async () => {
    const yes = quitter();
    const asked = requestQuit(counter().fn, yes.fn);
    await settle();
    dialogStore.state!.answer(true);
    await asked;
    expect(yes.calls()).toBe(1);

    const no = quitter();
    const declined = requestQuit(counter().fn, no.fn);
    await settle();
    dialogStore.state!.answer(false);
    await declined;
    expect(no.calls()).toBe(0);
  });

  it("취소 뒤의 다음 요청에 다시 묻는다", async () => {
    const count = counter();
    const first = requestQuit(count.fn, quitter().fn);
    await settle();
    dialogStore.state!.answer(false);
    await first;

    const again = requestQuit(count.fn, quitter().fn);
    await settle();
    expect(count.calls()).toBe(2);
    expect(dialogStore.state?.title).toBe(QUIT_TITLE);
    dialogStore.state!.answer(false);
    await again;
  });

  // 다른 물음이 종료 확인을 밀어내면 그 약속은 「아니오」로 풀린다 — **그 자리에서 표시가 내려가야**
  // 다음 종료 요청이 산다. 버튼 핸들러에서 내리면 이 길이 빠진다.
  it("다른 물음에 밀려나도 표시가 내려간다", async () => {
    const count = counter();
    const quit = quitter();
    const first = requestQuit(count.fn, quit.fn);
    await settle();
    const other = askDialog({ title: "셸 닫기", body: "나", confirm: "닫기" });
    await first;
    expect(quit.calls()).toBe(0);
    dialogStore.state!.answer(false);
    await other;

    const again = requestQuit(count.fn, quit.fn);
    await settle();
    expect(count.calls()).toBe(2);
    dialogStore.state!.answer(false);
    await again;
  });

  // **끄기가 거절되면 앱은 안 꺼진 채 창만 닫힌다.** 사람은 꺼지는 중이라 믿고 기다리므로 못 껐다는
  // 것을 앱의 오류 창으로 알려야 하고, 약속은 던지지 않고 풀려야 한다 — 부르는 쪽(AppShell)이
  // `void`로 버려서, 던지면 아무도 못 받는 거절이 된다. 그리고 다음 요청에 다시 물어 다시 꺼야 한다.
  it("끄기가 거절되면 오류 창을 띄우고, 다음 요청에 다시 물어 다시 끈다", async () => {
    const count = counter();
    let attempts = 0;
    const failingQuit = async () => {
      attempts += 1;
      throw "종료 명령이 거절되었습니다";
    };
    let outcome: "pending" | "resolved" | "rejected" = "pending";
    const asked = requestQuit(count.fn, failingQuit).then(
      () => (outcome = "resolved"),
      () => (outcome = "rejected"),
    );
    await settle();
    dialogStore.state!.answer(true);
    await settle();

    expect(attempts).toBe(1);
    expect(dialogStore.state?.title).toBe("오류");
    expect(dialogStore.state?.notice).toBe(true);
    expect(dialogStore.state?.body).toContain("종료 명령이 거절되었습니다");
    dialogStore.state!.answer(true);
    await asked;
    expect(outcome).toBe("resolved");

    const again = requestQuit(count.fn, failingQuit).catch(() => undefined);
    await settle();
    expect(count.calls()).toBe(2);
    expect(dialogStore.state?.title).toBe(QUIT_TITLE);
    dialogStore.state!.answer(true);
    await settle();
    expect(attempts).toBe(2);
    dialogStore.state?.answer(true);
    await again;
  });

  it("세기가 던져도 표시가 내려간다", async () => {
    const thrown = requestQuit(() => Promise.reject(new Error("세기 실패")), quitter().fn);
    await expect(thrown).rejects.toThrow("세기 실패");

    const count = counter();
    const again = requestQuit(count.fn, quitter().fn);
    await settle();
    expect(count.calls()).toBe(1);
    dialogStore.state!.answer(false);
    await again;
  });
});

// 이벤트 이름은 **두 언어가 문자열로만** 잇는다. 어긋나면 빨간 버튼이 창을 막고(`prevent_close`)
// 프런트는 아무것도 못 들어 **앱을 끌 길이 강제 종료뿐이 된다.** 상수를 못 찾으면 던진다(fail-closed).
describe("종료 요청 이벤트", () => {
  it("Rust가 쏘는 이름과 프런트가 듣는 이름이 같다", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../../src-tauri/src/quit.rs", import.meta.url)),
      "utf8",
    );
    const declared = /pub const REQUESTED_EVENT: &str = "([^"]+)";/.exec(source);
    if (!declared) throw new Error("quit.rs에서 REQUESTED_EVENT 선언을 못 찾았다");
    expect(declared[1]).toBe(QUIT_REQUESTED_EVENT);
  });
});
