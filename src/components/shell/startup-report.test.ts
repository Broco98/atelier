import { afterEach, describe, expect, it, vi } from "vitest";
import { onViewProcesses } from "./processes-view";
import {
  loadStartupReport,
  startupNotices,
  startupReportStore,
  type StartupReport,
} from "./startup-report";

// 시작 보고(프로세스 관리 티켓 02 · 프로세스 결정 6 · 프로세스 스펙 S11). 화면에 서는 것 — 어느 화면에서든,
// 한 번만 — 은 L3가(`e2e/startup-report.spec.ts`), 여기는 **보고 → 알릴 말**과 **묻는 길의 두 끝**을 값으로 본다.

const report = (cleaned: number, hooksUpdated: string[] = []): StartupReport => ({
  cleaned: Array.from({ length: cleaned }, (_, i) => ({ pid: 100 + i, name: "node" })),
  hooksUpdated,
});

afterEach(() => {
  startupReportStore.setState(() => null);
  vi.restoreAllMocks();
});

describe("시작 보고가 알리는 말", () => {
  it("끝낸 것이 있으면 그 수를 말한다", () => {
    expect(startupNotices(report(3)).map((notice) => notice.text)).toEqual([
      "지난 실행에서 남은 프로세스 3개를 정리했어요",
    ]);
    expect(startupNotices(report(1)).map((notice) => notice.text)).toEqual([
      "지난 실행에서 남은 프로세스 1개를 정리했어요",
    ]);
  });

  it("끝낸 것이 없으면 아무 말도 안 한다", () => {
    expect(startupNotices(report(0))).toEqual([]);
  });

  // 판 04(티켓 32 · 프로세스 스펙 S15)가 정리 토스트에 [보기]를 붙였다 — 무엇을 끝냈는지 정리 기록으로 가는 길이다. 버튼이 든
  // 토스트라 누를 때까지 남는다(`toastOptionsOf`). 누르면 그 토스트를 내리고 `Processes`로 간다(`viewProcesses`).
  it("정리의 말에는 [보기]가 붙고, 누르면 `Processes`로 간다", () => {
    const [cleanup] = startupNotices(report(2));
    if (!("actions" in cleanup)) throw new Error("정리의 말에 버튼이 없다");
    expect(cleanup.actions.map((action) => action.label)).toEqual(["보기"]);
    let viewed = 0;
    const stop = onViewProcesses(() => (viewed += 1));
    cleanup.actions[0].run();
    stop();
    expect(viewed).toBe(1);
  });

  // 앱이 뜰 때 이미 깔린 훅을 지금 목록으로 맞췄으면 한 번 알린다(프로세스 결정 15 · 프로세스 스펙 S36 · 티켓 21).
  // 어느 에이전트를 맞췄는지는 안 적는다 — 둘을 맞춰도 말은 하나다. 동작 버튼 없는 짧은 토스트다 — `Processes`에 볼 것이 없다.
  it("훅을 맞춘 에이전트가 있으면 한 번 말한다", () => {
    for (const agents of [["claude"], ["codex"], ["claude", "codex"]]) {
      const notices = startupNotices(report(0, agents));
      expect(notices.map((notice) => notice.text)).toEqual(["에이전트 훅을 새 목록으로 맞췄어요"]);
      expect(notices[0]).not.toHaveProperty("actions");
    }
  });

  it("정리와 훅 맞춤이 함께면 둘 다 말한다", () => {
    expect(startupNotices(report(2, ["claude"])).map((notice) => notice.text)).toEqual([
      "지난 실행에서 남은 프로세스 2개를 정리했어요",
      "에이전트 훅을 새 목록으로 맞췄어요",
    ]);
  });

  // **같은 보고를 두 번 알려도 토스트는 하나다** — 알리는 자리가 이펙트라 StrictMode(dev)에서 두 번 돈다.
  // 토스트 매니저는 같은 id를 받으면 새로 세우지 않고 그 자리를 고친다(Base UI `addToast`). 그래서 말마다
  // id가 붙어 있고, 두 번 불러도 같은 id다. 두 말의 id는 서로 달라야 한다 — 같으면 뒤의 말이 앞의 토스트를 고쳐 하나만 선다.
  it("말마다 늘 같은 id를 단다", () => {
    const first = startupNotices(report(2, ["claude"]));
    const again = startupNotices(report(2, ["claude"]));
    expect(first.map((notice) => notice.id)).toEqual(again.map((notice) => notice.id));
    for (const notice of first) expect(notice.id).toBeTruthy();
    expect(new Set(first.map((notice) => notice.id)).size).toBe(2);
  });
});

describe("앱이 뜰 때 한 번 묻는 길", () => {
  it("받은 보고를 스토어에 둔다 — 셸이 거기서 읽는다", async () => {
    const got = report(2);
    await loadStartupReport(async () => got);
    expect(startupReportStore.state).toEqual(got);
  });

  // L4의 다리는 이 명령을 「앱 안에서만」으로 거절한다(`atelier-test-bridge`). 부팅 때 부르는 설정 읽기와
  // 같은 처지라 같은 규칙이다 — 알릴 것이 없을 뿐 앱은 선다.
  it("거절되면 던지지 않고 비워 둔다", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      loadStartupReport(() => Promise.reject("이 커맨드는 다리로 탈 수 없습니다")),
    ).resolves.toBeUndefined();
    expect(startupReportStore.state).toBeNull();
  });
});
