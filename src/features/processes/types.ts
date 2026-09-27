// `Processes` 화면의 스냅샷(프로세스 결정 10 · 티켓 26). Rust의 `processes::screen::ScreenSnapshot`과 **칸 이름으로만** 이어진다 —
// 와이어 모양은 Rust 쪽 검사(`the_snapshot_crosses_the_wire_in_the_shape_the_frontend_reads`)가 글자로 못박는다.

import type { CleanupReason } from "@/features/terminal/types";

/** 프로세스 하나의 신원 — pid와 커널이 준 시작 시각(에포크 µs)의 쌍(프로세스 결정 3). pid만으로는 재사용을 못 가른다. */
export interface ProcessIdentity {
  pid: number;
  startedUs: number;
}

/**
 * 프로세스 하나의 지표(프로세스 결정 10 · 프로세스 스펙 S37 · S38 · 티켓 28). 못 읽은 것은 비었다 — 화면이 「—」로 세운다(macOS
 * 밖에서는 늘 빈다).
 */
export interface ProcessMetrics {
  /** `phys_footprint`(바이트) — 활성 상태 보기의 「메모리」 열과 같은 값이다. 못 읽었으면 `null`. */
  memory: number | null;
  /** CPU%(한 코어를 다 쓰면 100 — 여러 코어면 넘는다). 첫 표본이거나 못 읽었으면 `null`. */
  cpu: number | null;
  /** TCP LISTEN 로컬 포트 — 오름차순, 겹침 없음. */
  ports: number[];
}

/** 스냅샷의 한 행. [끝내기]가 끝내기에 되돌려 줄 값이 이 신원이다 — 「화면에 보인 표본의 신원」. */
export interface ProcessRow {
  id: ProcessIdentity;
  ppid: number;
  /** 커널 이름 — 실제로 실행된 파일의 이름이다. */
  name: string;
  /** 부른 이름(argv[0], 경로째). env를 못 읽은 행은 `null`. */
  argv0: string | null;
  /** 명령줄 전체. env를 못 읽은 행은 `null`. */
  command: string | null;
  metrics: ProcessMetrics;
}

/** 판정의 묶음 — Rust `verdict::Verdict`의 칸 그대로다. 각 칸의 뜻은 그쪽 머리말이 든다. */
export interface ProcessGroups {
  /** 셸 키마다 그 셸의 자손. 셸 자신은 안 든다. */
  descendants: Record<string, ProcessRow[]>;
  exceptions: ProcessRow[];
  /** 셸 도우미의 신원 — 묶음이 아니라 표시다. 자손 행과 신원으로 짝짓는다. */
  helpers: ProcessIdentity[];
  orphans: { confirmed: Record<string, ProcessRow[]>; unknown: Record<string, ProcessRow[]> };
  otherInstances: Record<string, ProcessRow[]>;
}

/**
 * 풀에 앉은 셸 하나. 셸 키는 스냅샷의 셸을 스토어의 셸(`Shell.shellKey`)과 잇는 값이고, pty id는 스토어가 모르는 셸을
 * 닫는 값이다(`pty_kill`).
 */
export interface PoolShell {
  ptyId: number;
  shellKey: string;
  /**
   * 셸이 마지막으로 무언가를 찍은 때(에포크 ms). 셸 행의 「조용함」 경과가 이 값에서 잰다(티켓 27) — 사람이 친 글자의 메아리도
   * 끝난 명령 뒤의 프롬프트도 출력이라, 이 값 뒤로는 셸에 아무 일이 없었다. 아직 아무것도 안 찍었으면 띄운 때다.
   */
  lastOutputMs: number;
  /** 셸 프로세스 **자신의** 지표. 판정은 셸 자신을 행으로 안 싣는다 — 셸 행의 트리 합은 화면이 이것과 자손을 더해 짓는다. */
  metrics: ProcessMetrics;
}

/**
 * 다른 인스턴스 하나 — **지금 떠 있는 다른 아틀리에 실행**(CONTEXT 「다른 인스턴스」 · 프로세스 스펙 S54 · 티켓 31). 화면이 실행마다
 * 빌드 종류와 버전을 머리로 세우고, 그 밑에 그 실행의 셸 키가 낸 행(`verdict.otherInstances`)을 보인다. 보기만 한다.
 */
export interface OtherInstance {
  generation: string;
  /** 빌드 종류 — `pnpm tauri dev`면 `dev`, 설치본이면 `release`. 그 실행의 기록을 못 읽었으면 `null`. */
  build: "dev" | "release" | null;
  /** 앱 버전. `build`와 같이 빈다. */
  version: string | null;
  /** 이 실행의 셸 키 중 다른 인스턴스 묶음에 행이 선 것. */
  shellKeys: string[];
}

export interface ProcessSnapshot {
  /** 판정 결과. */
  verdict: ProcessGroups;
  /** 앱에 떠 있는 셸 — 두 세계의 것이 함께, pty id 순. */
  pool: PoolShell[];
  /** 다른 인스턴스 묶음의 행을 낸 실행들 — 세대 순(티켓 31). */
  instances: OtherInstance[];
}

/**
 * nav 메타의 요약(프로세스 결정 10 · 11 · 티켓 29) — 요약 카드(티켓 30)도 같은 장을 읽는다. Rust의 `processes::summary::Summary`와 **칸
 * 이름으로만** 이어진다 — 와이어 모양은 Rust 쪽 검사(`the_summary_crosses_the_wire_in_the_shape_the_nav_reads`)가 글자로 못박는다.
 *
 * 화면이 닫혀 있어도 Rust가 10초마다 모은다(배경 표본). 프런트는 nav 메타를 위해 10초마다 묻는다(`useProcessSummary`).
 */
export interface ProcessSummary {
  /**
   * 앱 전체 메모리 합계(`phys_footprint`, 바이트) — 앱 본체 + 이 실행의 셸과 자손. 예외 · 다른 인스턴스 · 고아는 안 든다. 아무것도
   * 못 읽었으면(macOS 밖) `null`이고, nav 메타는 숫자를 안 세운다.
   */
  total: number | null;
  /** 합계에 드는 것의 CPU%를 더한 것(한 코어 = 100). 배경 표본의 첫 장이거나 못 쟀으면 `null`(카드의 「—」). */
  cpu: number | null;
  /** 앱 본체의 메모리 — Rust 본체 + 웹뷰(WebContent) 중 읽은 것(프로세스 스펙 S39). 못 읽었으면 `null`. */
  app: number | null;
  /** 앱 본체에 웹뷰(WebContent)를 안 셌다(프로세스 스펙 S39) — 요약 카드가 「웹뷰 제외」를 붙인다. */
  webviewExcluded: boolean;
  /** 출처 불명의 신원 — 수가 아니라 신원이다(티켓 29): `●`는 본 것과 견줘 새로 생긴 것에만 선다. 수는 이 목록의 길이다. */
  unknown: ProcessIdentity[];
  /** `●`를 켜는 정리 기록(사람 손 없이 끝냄 · 못 끝냄) 중 가장 새것의 번호. 없으면 `null`. 무엇이 켜는 기록인지는 Rust가 가른다. */
  recordHead: number | null;
}

/**
 * 추이의 한 점(티켓 30) — 배경 표본이 합계를 읽은 때(에포크 ms)와 그 합계(바이트). Rust의 `processes::summary::Point`와 칸 이름으로
 * 이어진다. 추이 IPC는 이것을 오래된 것부터 1시간치(360점)까지 돌려준다.
 */
export interface TrendPoint {
  at: number;
  total: number;
}

/**
 * 정리 기록의 까닭 — 정의는 `features/terminal/types.ts`에 산다(닫기 IPC의 까닭 `CloseReason`이 이것을 좁힌다). 이 기능의
 * 화면과 검사는 여기서 가져간다.
 */
export type { CleanupReason };

/** 끝낸 것의 결과 — Rust `ending::Outcome`의 와이어 글자다. 끝남(TERM) · 강제(KILL) · 못 끝냄 · 이미 없음. */
export type CleanupOutcome = "ended" | "forced" | "survived" | "gone";

/**
 * 정리 기록의 대상 하나(Rust `cleanup_log::Target`). 셸 자신은 안 든다 — 끝내기의 대상이 아니다. 셸 도우미는 적는 사건이면 함께
 * 든다(도우미만 끝난 사건은 안 적는다 — 프로세스 스펙 P1).
 */
export interface CleanupTarget {
  pid: number;
  /** 커널 이름. */
  name: string;
  /** 명령줄의 앞 200자 — Rust가 적을 때 잘랐다. 수집이 argv를 못 읽은 행이면 없다. */
  command: string | null;
  outcome: CleanupOutcome;
}

/**
 * 정리 기록의 사건 하나(Rust `cleanup_log::Event` · 티켓 11 · 32). 와이어 모양은 Rust 쪽 검사
 * (`an_event_crosses_the_wire_in_the_shape_the_screen_will_read`)가 글자로 못박는다. 정리 기록 IPC가 새것부터 최근 100건을 준다.
 */
export interface CleanupEvent {
  /**
   * 기록 번호 — 파일 안에서 오르기만 한다(티켓 29): 가장 큰 번호 + 1과 사건 시각(ms) 중 큰 것이라 파일을 잃어도 옛 번호로 안 돌아간다.
   * 번호가 없던 판의 줄은 0이다.
   */
  id: number;
  /** 끝내기가 **끝난** 시각(에포크 ms). */
  at: number;
  reason: CleanupReason;
  /** 셸 하나를 닫은 사건의 셸 키. 앱 종료 · 시작 정리는 없다. */
  shellKey: string | null;
  /** 그 셸의 주인(`atelier:<slug>` 꼴). 닫기 IPC로 온 사건에만 있다. */
  owner: string | null;
  targets: CleanupTarget[];
}
