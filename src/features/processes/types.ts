// `Processes` 화면의 스냅샷(프로세스 결정 10 · 티켓 26). Rust의 `processes::screen::ScreenSnapshot`과 **칸 이름으로만** 이어진다 —
// 와이어 모양은 Rust 쪽 검사(`the_snapshot_crosses_the_wire_in_the_shape_the_frontend_reads`)가 글자로 못박는다.

/** 프로세스 하나의 신원 — pid와 커널이 준 시작 시각(에포크 µs)의 쌍(프로세스 결정 3). pid만으로는 재사용을 못 가른다. */
export interface ProcessIdentity {
  pid: number;
  startedUs: number;
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
}

export interface ProcessSnapshot {
  /** 판정 결과. */
  verdict: ProcessGroups;
  /** 앱에 떠 있는 셸 — 두 세계의 것이 함께, pty id 순. */
  pool: PoolShell[];
}
