import { askDanger, showProblem } from "@/components/ui/confirm-store";
import { settingsApi } from "@/features/settings/api";
import { exceptionsWith } from "@/features/settings/process-exceptions";
import { saveSettingsSection } from "@/features/settings/save-section";
import { queryClient } from "@/query-client";
import { processesApi } from "./api";
import { snapshotQuery } from "./hooks";
import type { Ask } from "./process-groups";
import type { ProcessIdentity } from "./types";

// **`Processes`의 동작 셋**(티켓 31) — 신원 목록 끝내기([끝내기] · [정리]), 물은 뒤에 끝내기, 「예외로 두기」. 무엇을 넘길지(신원 ·
// 이름)와 확인 창의 말은 순수 모듈이 짓는다(`process-groups.ts`) — 여기는 IPC와 창과 캐시만 잇는다.
//
// 끝낸 뒤 · 예외에 더한 뒤 **스냅샷을 곧바로 다시 묻는다** — 박자(2초)를 기다리면 누른 행이 그만큼 그대로 서서 안 먹힌 것처럼 읽힌다.

/**
 * 신원 목록을 끝낸다(프로세스 결정 6 · 기본값 [끝내기]). 백엔드가 신호까지 보내고 돌아온다 — 유예와 SIGKILL은 거기서 뒤에 돈다.
 * 정리 기록에 까닭 「손으로」로 남고 `●`를 켜지 않는다(29). 못 부르면 문제 창을 띄운다.
 */
export async function endProcesses(targets: ProcessIdentity[]): Promise<void> {
  if (targets.length === 0) return;
  try {
    await processesApi.end(targets);
  } catch (e) {
    await showProblem(`프로세스를 끝내지 못했습니다: ${e}`);
    return;
  }
  void queryClient.invalidateQueries({ queryKey: snapshotQuery.queryKey });
}

/** 앱 확인 창(`askDanger`)을 거친 뒤 끝낸다 — 자손 행 [끝내기]와 출처 불명 [정리]. 취소하면 아무것도 안 부른다. */
export async function askThenEnd(ask: Ask, targets: ProcessIdentity[]): Promise<void> {
  if (!(await askDanger(ask.title, ask.body, ask.confirm))) return;
  await endProcesses(targets);
}

/**
 * **「예외로 두기」** — 그 이름을 설정의 예외 목록에 더한다(프로세스 스펙 S7). 새 IPC 없이 지금의 설정 저장을 그대로 쓴다
 * (`saveSettingsSection`) — 줄 안에서 **쓰는 순간의 터미널 구획**을 받아 예외 목록 칸만 고친다(그사이 설정 화면이 저장한 다른 칸을 안
 * 덮는다). 목록이 `null`이면 기본 목록 + 그 이름이다 — 기본 목록은 판정이 쓰는 Rust 상수라 IPC로 받는다.
 */
export async function keepAsException(name: string): Promise<void> {
  try {
    const defaults = await settingsApi.defaultExceptions();
    await saveSettingsSection("terminal", (terminal) => ({
      ...terminal,
      processExceptions: exceptionsWith(terminal.processExceptions, defaults, name),
    }));
  } catch (e) {
    await showProblem(`예외 목록에 더하지 못했습니다: ${e}`);
    return;
  }
  void queryClient.invalidateQueries({ queryKey: snapshotQuery.queryKey });
}
