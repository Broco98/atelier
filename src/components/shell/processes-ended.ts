import type { CleanupReason } from "@/features/processes/types";
import type { AppNotice } from "./app-toast";
import { viewAction } from "./processes-view";

// **앱이 사람 손 없이 끝낸 것의 알림**(프로세스 결정 6 · 프로세스 스펙 S49 · P4 · 티켓 13). 셸 안에서 `exit`나 `^D`로 셸이
// 스스로 끝나면 Rust가 그 셸 키를 문 생존자를 끝내고, 도우미가 아닌 것을 하나라도 끝냈으면 이 이벤트를 쏜다(`pty.rs`의
// `ENDED_EVENT`). 확인 창 없이 자손이 끝나는 길이라 무엇이 사라졌는지 알린다 — 결정 6이 「조용히 자동」을 「사라진 이유를
// 추적할 수 없다」로 기각했다.
//
// **시작 보고처럼 붙잡아 두지 않는다**(`startup-report.ts`와 다르다). 셸은 웹뷰가 뜬 뒤에 띄우므로 셸이 끝나는 것도 웹뷰가
// 떠 있는 동안의 일이다 — 듣는 자리가 이미 서 있다.
//
// **셸 id로 레지스트리를 찾지 않는다**(티켓 13 「스펙과 다른 점」). 종료 프레임을 받은 칸은 그 pty id를 곧바로 지우고(정상
// 종료면 목록에서도 빠진다), pty id에서 칸으로 가는 길은 그 id 하나다 — 이 이벤트가 올 때는 늘 못 찾는다. 문구에 owner가
// 없으니 찾지 않고 띄운다.

/**
 * 듣는 이벤트 이름. Rust의 `pty::ENDED_EVENT`와 **문자열로만** 이어진다 — 어긋나면 dev 서버를 끝내도 화면은 조용하다. 그래서
 * `processes-ended.test.ts`가 그 선언을 읽어 견준다.
 */
export const PROCESSES_ENDED_EVENT = "processes:ended";

/** 이벤트가 싣는 것(`pty.rs`의 `Ended`). 와이어 모양은 Rust 쪽 검사가 글자로 못박는다. */
export interface ProcessesEnded {
  /**
   * 앱이 끝낸 까닭 — 정리 기록의 낱말(`cleanup_log::Reason`)이다. 지금 이 이벤트로 오는 것은 `shellExit` 하나다. 글자 대신 그
   * 타입이라, 아래 `endedNotice`가 견주는 글자가 정리 기록에 없는 낱말로 틀리면 tsc가 운다.
   */
  reason: CleanupReason;
  /** 스스로 끝난 셸의 pty id. 레지스트리를 찾는 데 쓰지 않는다(위 머리말) — 토스트의 id에만 싣는다. */
  shellId: number;
  /** 끝낸 수 — 셸 도우미와 「이미 없음」은 빠졌다. Rust는 0이면 안 쏜다. */
  count: number;
}

/**
 * 이벤트에서 **알릴 말**. 셸 스스로 끝남이 아니거나 끝낸 것이 없으면 아무 말도 없다.
 *
 * **[보기]가 든 동작 토스트다**(프로세스 스펙 S15 · 티켓 32) — 무엇을 끝냈는지는 `Processes`의 정리 기록이 보인다. 누르거나
 * 닫을 때까지 남는다. 판 01~03에서는 버튼 없는 짧은 토스트(1.6초)였다.
 *
 * **셸마다 제 id를 단다.** 같은 셸의 알림이 두 번 와도(듣는 자리가 StrictMode로 잠깐 둘일 때) 매니저가 그 자리를 고쳐
 * 토스트는 하나다. 다른 셸의 알림은 따로 선다.
 */
export function endedNotice(ended: ProcessesEnded): AppNotice | null {
  if (ended.reason !== "shellExit" || ended.count <= 0) return null;
  const id = `processes-ended:${ended.shellId}`;
  return {
    id,
    text: `셸이 끝나면서 그 셸에서 띄운 프로세스 ${ended.count}개를 끝냈어요`,
    actions: [viewAction(id)],
  };
}
