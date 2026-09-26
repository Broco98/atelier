import { invoke } from "@tauri-apps/api/core";
import { Store } from "@tanstack/react-store";
import type { AppNotice } from "./app-toast";

// **시작 보고** — 앱이 뜰 때 한 일(프로세스 결정 6 · 프로세스 스펙 S11). Rust가 붙잡아 두고
// (`src-tauri/src/startup.rs`) 프런트는 부팅 때 **한 번** 묻는다. 이벤트로 받지 않는 것은 앱이 뜨는 순간의
// 일이 웹뷰가 `listen`을 걸기 전에 끝날 수 있어서다 — 그 이벤트는 아무도 못 듣고 지나간다.

/** 시작 정리가 끝낸 프로세스 하나(`startup.rs`의 `Cleaned`). */
export interface CleanedProcess {
  pid: number;
  name: string;
}

/**
 * 앱이 뜰 때 한 일(`startup.rs`의 `StartupReport`). 두 언어가 **필드 이름으로만** 이어진다 — 와이어 모양은
 * Rust 쪽 검사(`the_report_crosses_the_wire_in_the_shape_the_frontend_reads`)가 글자로 못박는다.
 */
export interface StartupReport {
  /** 시작 정리가 실제로 끝낸 것(끝남 · 강제). 「이미 없음」은 안 실린다 — 수가 곧 이 목록의 길이다. */
  cleaned: CleanedProcess[];
  /** 앱이 뜰 때 이미 깔린 훅을 지금 목록으로 맞춘 에이전트(`claude` · `codex`) — 실제로 설정을 고쳐 쓴 것만이다. */
  hooksUpdated: string[];
}

/**
 * 받아 둔 보고. **`null`은 「아직 안 왔거나 영영 안 온다」**다 — 어느 쪽이든 알릴 것이 없다.
 *
 * 스토어에 두는 것은 **묻는 때와 알리는 때가 다르기 때문이다.** 묻는 것은 React보다 먼저(`main.tsx`)이고,
 * 토스트는 앱 셸이 선 뒤에야 설 자리가 있다 — 토스트 매니저는 구독자가 없을 때 온 것을 버린다(Base UI
 * `createToastManager`). 그래서 답을 여기 두고, 앱 셸이 서서 읽는다(`AppShell`).
 */
export const startupReportStore = new Store<StartupReport | null>(null);

/**
 * 앱이 뜰 때 **한 번** 묻는다(`main.tsx`의 모듈 최상위). 이펙트에 두지 않는 것은 StrictMode가 이펙트를 두 번
 * 돌려 묻는 것도 두 번이 되기 때문이다 — 그 짝으로 토스트가 두 번 설 수 있다.
 *
 * **답이 늦게 올 수 있다.** Rust는 시작 때 할 일(시작 정리 — 지난 실행이 남긴 확정 고아를 끝낸다)이 모두 끝난 뒤에
 * 답한다. SIGTERM을 무시하는 고아가 있으면 유예 2초를 넘겨 온다 — 화면은 그동안 그대로 서고, 토스트만 그만큼 늦게 선다.
 *
 * **거절돼도 던지지 않는다.** L4의 다리는 이 명령을 「앱 안에서만」으로 거절하고(`atelier-test-bridge`),
 * 실물에서도 알릴 것을 못 받았을 뿐 앱은 서야 한다 — 부팅 때의 설정 읽기(`loadTerminalSettings`)와 같은
 * 판단이다. 이유만 콘솔에 남긴다.
 *
 * `read`는 검사가 갈아 끼우는 자리다(`startup-report.test.ts`).
 */
export async function loadStartupReport(
  read: () => Promise<StartupReport> = () => invoke<StartupReport>("startup_report"),
): Promise<void> {
  try {
    const report = await read();
    startupReportStore.setState(() => report);
  } catch (error) {
    console.warn("atelier: 시작 보고를 못 받았다 — 알릴 것 없이 간다", error);
  }
}

/**
 * 보고에서 **알릴 말** — 둘이다.
 *
 * - 시작 정리: 끝낸 것이 없으면 아무 말도 없다(스토리 21) — 전부 「이미 없음」이었어도 그렇다.
 * - 훅 맞춤(프로세스 결정 15 · 프로세스 스펙 S36): 이미 깔린 훅을 실제로 고쳐 쓴 에이전트가 있으면 한 번 말한다. 어느
 *   에이전트인지는 안 적는다 — 둘을 맞춰도 말은 하나다. 목록이 다른 두 빌드를 번갈아 켜도 Rust가 새로운 판의 파일을 안
 *   되쓰므로(P5) 이 칸은 비고, 토스트는 켤 때마다 서지 않는다.
 *
 * 둘 다 동작 버튼 없는 짧은 토스트다.
 *
 * **말마다 늘 같은 id를 단다.** 알리는 자리가 이펙트라 StrictMode(dev)에서 두 번 돌고, 토스트 매니저는 같은
 * id를 받으면 새로 세우지 않고 그 자리를 고친다 — 두 번 알려도 토스트는 하나다. 두 말의 id는 서로 다르다 — 같으면 뒤의 말이
 * 앞의 토스트를 고쳐 하나만 선다.
 *
 * [보기]는 판 04가 정리 토스트에 붙인다(프로세스 스펙 S15) — 그때부터 정리 토스트는 누를 때까지 남는 동작 토스트가 된다.
 */
export function startupNotices(report: StartupReport): AppNotice[] {
  const notices: AppNotice[] = [];
  const count = report.cleaned.length;
  if (count > 0) {
    notices.push({ id: "startup:cleanup", text: `지난 실행에서 남은 프로세스 ${count}개를 정리했어요` });
  }
  if (report.hooksUpdated.length > 0) {
    notices.push({ id: "startup:hooks", text: "에이전트 훅을 새 목록으로 맞췄어요" });
  }
  return notices;
}
