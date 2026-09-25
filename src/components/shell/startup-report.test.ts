import { afterEach, describe, expect, it, vi } from "vitest";
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

  // 훅 갱신 토스트는 티켓 21이 붙인다 — 그 전에 이 칸이 말을 만들면 21의 L3가 바꾸기 전에도 초록이다.
  it("훅 갱신 칸은 아직 말하지 않는다", () => {
    expect(startupNotices(report(0, ["claude"]))).toEqual([]);
  });

  // **같은 보고를 두 번 알려도 토스트는 하나다** — 알리는 자리가 이펙트라 StrictMode(dev)에서 두 번 돈다.
  // 토스트 매니저는 같은 id를 받으면 새로 세우지 않고 그 자리를 고친다(Base UI `addToast`). 그래서 말마다
  // id가 붙어 있고, 두 번 불러도 같은 id다.
  it("말마다 늘 같은 id를 단다", () => {
    const [first] = startupNotices(report(2));
    const [again] = startupNotices(report(2));
    expect(first.id).toBeTruthy();
    expect(again.id).toBe(first.id);
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
