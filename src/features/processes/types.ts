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
  /**
   * CPU% — **맥 전체가 100이다**(S37 · restart 03-5 — 코어 열 개인 맥에서 한 코어를 다 쓰면 10). 활성 상태 보기의 「% CPU」는 이 값 ×
   * 코어 수(`MacMeasure.cores`)다. 첫 표본이거나 못 읽었으면 `null`.
   */
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
  /**
   * **채팅마다 그 Runtime과 Runtime이 띄운 것**(restart 03-7) — 열쇠는 채팅 id다. 이 실행의 엔진이 띄운 Runtime(그 Runtime 키를 문 앱의
   * 자식)과 그 자손, 부모가 먼저 죽어 Runtime 키로 묶인 dev 서버가 든다.
   */
  chats: Record<string, ProcessRow[]>;
  /**
   * **엔진의 몫** — 채팅의 Runtime과 그 프로세스 그룹(MCP · Codex의 app-server). 엔진이 채팅을 닫거나 앱을 끌 때 그룹째 끝내므로 화면은
   * [끝내기]를 안 세운다. 묶음이 아니라 표시다 — `chats`의 행과 신원으로 짝짓는다.
   */
  runtimes: ProcessIdentity[];
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
 * 빌드 종류와 버전을 머리로 세우고, 그 밑에 그 실행의 키(셸 · 채팅)가 낸 행(`verdict.otherInstances`)을 보인다. 보기만 한다.
 */
export interface OtherInstance {
  generation: string;
  /** 빌드 종류 — `pnpm tauri dev`면 `dev`, 설치본이면 `release`. 그 실행의 기록을 못 읽었으면 `null`. */
  build: "dev" | "release" | null;
  /** 앱 버전. `build`와 같이 빈다. */
  version: string | null;
  /** 이 실행의 키(셸 키 · Runtime 키 — restart 03-7) 중 다른 인스턴스 묶음에 행이 선 것. */
  keys: string[];
}

/**
 * **맥 전체 한 표본**(restart 03-5) — Rust `processes::machine::Machine`. 맥 전체를 100으로 잡는 눈금의 분모다. macOS 밖에서는 이
 * 값 자체가 없다(`null` — 「측정 안 됨」).
 */
export interface MacMeasure {
  /** 맥 전체 CPU% — 맥 전체 = 100. 첫 표본이거나 tick이 안 흘렀으면 `null`(「—」 — 두 번 재야 안다). */
  cpu: number | null;
  /** 맥 전체 메모리(바이트) — active + wired + compressed. 못 읽었으면 `null`. */
  memory: number | null;
  /** 이 맥의 코어 수 — 맥 전체 눈금의 CPU%에 곱하면 활성 상태 보기 눈금이다. */
  cores: number;
}

/**
 * **아틀리에 합계**(티켓 29 · 30 · restart 03-5) — Rust `processes::summary::Totals`. 요약(10초)은 칸을 펼쳐 싣고(`ProcessSummary`), 화면
 * 스냅샷(2초)은 `atelier` 칸에 싣는다 — 같은 함수가 짓는다.
 */
export interface AtelierTotals {
  /**
   * 앱 전체 메모리 합계(`phys_footprint`, 바이트) — 앱 본체 + 이 실행의 셸과 자손 + 고아 · 예외 · 다른 인스턴스(restart 03-6). 아무것도
   * 못 읽었으면(macOS 밖) `null`이고, nav 메타는 숫자를 안 세운다.
   */
  total: number | null;
  /** 합계에 드는 것의 CPU%를 더한 것(맥 전체 = 100). 첫 표본이거나 못 쟀으면 `null`(「—」). */
  cpu: number | null;
  /** 앱 본체의 메모리 — Rust 본체 + 웹뷰(WebContent · WebKit 도우미 — restart 03-8) 중 읽은 것(프로세스 스펙 S39). 못 읽었으면 `null`. */
  app: number | null;
  /** 앱 본체에 웹뷰(WebContent)를 안 셌다(프로세스 스펙 S39) — 요약 카드가 「웹뷰 제외」를 붙인다. */
  webviewExcluded: boolean;
}

export interface ProcessSnapshot {
  /** 판정 결과. */
  verdict: ProcessGroups;
  /** 앱에 떠 있는 셸 — pty id 순. */
  pool: PoolShell[];
  /** 다른 인스턴스 묶음의 행을 낸 실행들 — 세대 순(티켓 31). */
  instances: OtherInstance[];
  /**
   * `●`를 켜는 정리 기록 중 가장 새것의 번호 — 요약의 `recordHead`와 같은 값이다(Rust `cleanup_log::look_head`). 화면이 보는 동안
   * 출처 불명과 함께 본 것으로 앉힌다(티켓 29 · S41 — `lookSourceOf`). 없으면 `null`.
   */
  recordHead: number | null;
  /** 이 장을 잰 시각(에포크 ms) — 머리의 「…에 잰 값」(restart 03-5 · 스토리 129). */
  measuredAt: number;
  /** 이 장에서 지표를 못 읽은 것의 수 — 까닭마다(restart 03-9 · 스토리 133). 그 몫은 시스템 · 못 읽음에 든다. */
  unread: Unread;
  /**
   * 맥 전체 — 줄과 같은 순간에 읽었다(restart 03-5 「한 표본」). macOS 밖이면 `null`이다 — 화면이 「측정 안 됨」으로 말한다.
   */
  mac: MacMeasure | null;
  /** 아틀리에 합계 — 줄과 같은 표본에서 지었다. 화면을 보는 동안 메모리 카드가 이것을 읽는다(10초 요약이 아니라). */
  atelier: AtelierTotals;
  /** 아틀리에 앱의 줄 — 앱 본체와 웹뷰(restart 03-6). 판정의 행이 아니라 따로 온다. */
  body: BodyRows;
  /** 맥 전체의 나눔 — 다른 앱의 줄, 시스템 · 못 읽음, 합계(restart 03-6). 아틀리에의 몫은 `atelier`다. */
  breakdown: Breakdown;
}

/**
 * **못 읽은 것의 수 — 까닭마다**(restart 03-9 · 스토리 133) — Rust `processes::metrics::Unread`. 우리 트리와 다른 앱 가운데 지표를 못 읽은
 * 것이다. 그 몫은 맥 전체에서 읽은 합을 뺀 「시스템 · 못 읽음」에 든다. macOS 밖은 아무것도 안 읽어 늘 0이다.
 */
export interface Unread {
  /** 커널이 읽기를 거절했다 — 남의 uid(`sudo` 밑의 것). */
  denied: number;
  /** 그사이 끝났다 — 표를 찍은 뒤 읽기 전에 끝난 것, 좀비, pid가 남에게 넘어간 것. */
  gone: number;
  /** 그 밖의 까닭 — 커널이 다른 오류를 줬다. */
  other: number;
}

/**
 * **아틀리에 앱의 줄**(restart 03-6 · 시안 Processes 「아틀리에 앱」) — Rust `processes::screen::BodyRows`. 앱 본체(Rust)와 웹뷰(WebContent ·
 * WebKit 도우미 — restart 03-8)의 지표다. 아틀리에 합계의 앱 본체(`AtelierTotals.app`)가 이 둘이다. 웹뷰를 못 물었거나 못 읽었고 도우미도
 * 없으면 그 줄이 빈다(「—」).
 */
export interface BodyRows {
  rust: ProcessMetrics;
  /** WebContent와 앱이 책임지는 WebKit 도우미(GPU · Networking — restart 03-8)의 합. */
  webview: ProcessMetrics;
  /**
   * 웹뷰 줄에 함께 센 WebKit 도우미의 갈래(`GPU` · `Networking`) — 이 표본에서 읽은 것만, 갈래 순(Rust `webkit::Helper::kind`). 책임
   * 프로세스를 묻는 함수가 없거나 앱이 제 책임 프로세스가 아니면(셸에서 띄운 개발 빌드) 빈다 — 그 도우미는 「다른 앱」에 있다.
   */
  webkit: string[];
}

/**
 * **다른 앱 한 줄**(restart 03-6) — Rust `processes::apps::OtherApp`. 이 맥의 같은 uid 프로세스 중 우리 트리 밖의 것을 실행 파일의 앱
 * 번들(가장 바깥 `.app`)로 묶었다. 보기만 한다 — 끝내기가 없다.
 */
export interface OtherApp {
  /** 앱 번들 이름. 번들 밖의 프로세스(데몬 · 명령줄 도구)를 모은 줄은 `null`이다 — 화면의 「그 밖의 프로세스」. */
  name: string | null;
  /** 이 줄에 든 프로세스 수 — 읽은 것만이다. */
  processes: number;
  /** 읽은 것의 메모리(`phys_footprint`) 합(바이트). */
  memory: number;
  /** 읽은 것의 CPU% 합(맥 전체 = 100). 하나도 못 쟀으면(첫 표본) `null`. */
  cpu: number | null;
}

/** 한 줄의 몫 — CPU%(맥 전체 = 100)와 메모리(바이트). 못 잰 칸은 `null`(「—」)이다. */
export interface Share {
  cpu: number | null;
  memory: number | null;
}

/**
 * **맥 전체의 나눔**(restart 03-6 · 스펙 「합이 맞는다」) — Rust `processes::breakdown::Breakdown`. 줄(아틀리에 · 다른 앱 · 시스템 · 못
 * 읽음)을 반올림 전 값으로 더하면 합계다.
 */
export interface Breakdown {
  apps: OtherApp[];
  /** 시스템 · 못 읽음 — 맥 전체 측정값 − 읽은 합(아틀리에 + 다른 앱). 남의 uid와 못 읽은 프로세스가 여기 든다. 0 아래로 안 내려간다. */
  system: Share;
  /** 합계 — 읽은 합이 안 넘은 칸은 맥 전체 측정값이고, 넘은 칸은 읽은 합이다. 머리 숫자가 이것의 CPU다. */
  total: Share;
  /** 읽은 합이 맥 전체 측정값을 넘은 칸 — 그 칸의 시스템 · 못 읽음은 0이고 합계는 읽은 합이다. */
  over: { cpu: boolean; memory: boolean };
}

/**
 * nav 메타의 요약(프로세스 결정 10 · 11 · 티켓 29). Rust의 `processes::summary::Summary`와 **칸 이름으로만** 이어진다 — 와이어 모양은
 * Rust 쪽 검사(`the_summary_crosses_the_wire_in_the_shape_the_nav_reads`)가 글자로 못박는다. 아틀리에 합계의 칸(`AtelierTotals`)을
 * 펼쳐 싣는다.
 *
 * 화면이 닫혀 있어도 Rust가 10초마다 모은다(배경 표본). 프런트는 nav 메타를 위해 10초마다 묻는다(`useProcessSummary`). **화면을 보는
 * 동안의 머리 · 메모리 카드는 이것이 아니라 2초 스냅샷을 읽는다**(restart 03-5 「한 표본」).
 */
export interface ProcessSummary extends AtelierTotals {
  /** 맥 전체 — 같은 배경 표본에서 읽었다(restart 03-5). macOS 밖이면 `null`. */
  mac: MacMeasure | null;
  /** 출처 불명의 신원 — 수가 아니라 신원이다(티켓 29): `●`는 본 것과 견줘 새로 생긴 것에만 선다. 수는 이 목록의 길이다. */
  unknown: ProcessIdentity[];
  /** `●`를 켜는 정리 기록(사람 손 없이 끝냄 · 못 끝냄) 중 가장 새것의 번호. 없으면 `null`. 무엇이 켜는 기록인지는 Rust가 가른다. */
  recordHead: number | null;
}

/**
 * 추이의 한 점(티켓 30 · restart 03-5) — 배경 표본이 읽은 때(에포크 ms)와 그 표본의 **맥 전체 CPU와 아틀리에 CPU**(둘 다 맥 전체 =
 * 100). 한때 메모리 합계였다. Rust의 `processes::summary::Point`와 칸 이름으로 이어진다. 추이 IPC는 이것을 오래된 것부터 1시간치(360점)까지
 * 돌려준다. CPU를 못 잰 표본(첫 표본 · macOS 밖)은 점이 없다.
 */
export interface TrendPoint {
  at: number;
  mac: number;
  atelier: number;
}

/**
 * 정리 기록의 까닭 — 정의는 `features/terminal/types.ts`에 산다(닫기 IPC의 까닭 `CloseReason`이 이것을 좁힌다). 이 기능의
 * 화면과 검사는 여기서 가져간다.
 */
export type { CleanupReason };

/** 끝낸 것의 결과 — Rust `ending::Outcome`의 와이어 글자다. 끝남(TERM) · 강제(KILL) · 못 끝냄 · 이미 없음. */
export type CleanupOutcome = "ended" | "forced" | "survived" | "gone";

/**
 * **신원 목록 끝내기의 답 한 줄**(restart 03-10 · Rust `ending::EndResult`) — 대상 하나와 그 결과. 끝내기 IPC가 그 끝내기가 맡은 대상마다
 * 돌려준다 — 진행 중인 끝내기가 이미 SIGTERM을 보낸 신원은 답에 없다(그 결과는 그것을 맡은 끝내기의 것이다). 와이어 모양은 Rust 쪽
 * 검사(`an_end_result_crosses_the_wire_in_the_shape_the_screen_reads`)가 글자로 못박는다.
 */
export interface EndResult {
  id: ProcessIdentity;
  outcome: CleanupOutcome;
}

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
  /**
   * 그 셸의 주인 — slug, 최상위 터미널이면 `""`(ui-refresh 결정 23). 옛 판이 적은 줄은 `atelier:<slug>` 꼴로 남는다 — 아무도
   * 해석하지 않는다. 닫기 IPC로 온 사건에만 있다.
   */
  owner: string | null;
  targets: CleanupTarget[];
}
