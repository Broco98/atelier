import { invoke, type Channel } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Mode } from "@/mode";
import type { ShellOwner } from "./shell-registry";
import type {
  CloseCheck,
  CloseReason,
  PtyFrame,
  PtyRunning,
  PtySpawned,
  ShellAttention,
} from "./types";

// `cwd`에 `null`을 주면 백엔드가 데이터 루트를 쓴다. 여기서 `"~/.atelier"`를 박으면
// `ATELIER_HOME` 오버라이드가 죽는다 — 그 자리가 어디인지는 atelier-core만 안다.
//
// **모드를 싣는 것은 `spawn` 하나다**(결정 10). 나머지는 이미 뜬 셸을 id로 가리키고 그
// 셸의 세계는 뜰 때 pty에 굳는다 — `commands.rs`가 같은 이유를 같은 말로 적어 두었고,
// 인자를 더하면 「id와 모드가 어긋나면 어느 쪽이 이기나」라는 답 없는 갈래가 생긴다.
//
// **인자 객체가 평평해야 한다.** `tauri-commands.test.ts`의 인자 대조가 중첩 `{}`를 만나면
// 그 호출을 통째로 못 보고 넘어간다(`features/works/api.ts`가 같은 이유를 적어 뒀다).
export const terminalApi = {
  spawn: (
    mode: Mode,
    cwd: string | null,
    cols: number,
    rows: number,
    onFrame: Channel<PtyFrame>,
  ) => invoke<PtySpawned>("pty_spawn", { mode, cwd, cols, rows, onFrame }),
  write: (id: number, data: string) => invoke<void>("pty_write", { id, data }),
  resize: (id: number, cols: number, rows: number) =>
    invoke<void>("pty_resize", { id, cols, rows }),
  // 화면을 옮기는 것만으로는 죽이지 않는다(결정 20) — 언마운트 정리에는 없다. 프로세스 결정 7이 입력 없는
  // 자동 셸만 예외로 두었다: 그 셸은 화면을 떠나면 닫힌다(`closeUnusedShells`).
  // 부르는 곳: `×`(판 02), 아카이빙·삭제가 성공한 뒤의 회수(결정 26), 그 떠남, 그리고 MCP로 아카이브된 work의 조용한
  // 셸과 주인 잃은 셸의 [모두 닫기](티켓 12). 결정 26은 MCP 길의 셸을 「알려진 대가」로 남겼는데, 프로세스 결정 4가
  // 이렇게 고쳤다 — 목록 재조회로 알아채 조용한 셸은 닫고 나머지는 주인 잃은 셸로 남긴다(`settleOwners`). 판 04의
  // `Processes`가 둘을 더한다(티켓 32): 머리의 [조용한 셸 모두 닫기]와 화면 밖 셸의 [닫기]. 모두 스토어의 한 줄
  // (`killPty`)을 지난다.
  //
  // **까닭과 셸의 주인을 싣는다**(티켓 11) — 백엔드가 그 닫기가 끝낸 것을 정리 기록에 이 까닭으로 적는다. 까닭은 부르는
  // 자리가 고르지 않고 표 한 곳(`CLOSE_REASONS`)이 고른다. 주인은 Rust 풀이 모르는 값이라(셸을 띄울 때 안 넘긴다) 여기서
  // 싣는다 — 모드와 달리 셸을 가리키는 값이 아니라 기록에 적을 값이라, 위 「id와 모드가 어긋나면」 갈래가 없다.
  // **주인을 모르면 `null`이다** — 화면 밖 셸(프로세스 스펙 S42)은 스토어에 칸이 없어 주인도 없다. 지어내지 않는다: 백엔드는
  // 그 사건을 주인 없이 적는다.
  kill: (id: number, reason: CloseReason, owner: ShellOwner | null) =>
    invoke<void>("pty_kill", { id, reason, owner }),
  // 셸의 **첫 사람 입력**을 한 번 알린다(프로세스 결정 7 · 프로세스 스펙 P1). `at`은 사람 입력을 본 순간의 에포크
  // ms다 — 백엔드는 그 셸의 자손 중 이 순간 전에 태어난 것을 셸 도우미로 가른다(티켓 08). 무엇이 사람 입력인지는
  // `shell-input.ts`가, 시각을 찍는 것은 터미널 스토어가 한다.
  firstInput: (id: number, at: number) => invoke<void>("pty_first_input", { id, at }),
  // 셸을 닫기 직전에 묻는다 — **명령이 도는가**(포그라운드 그룹이 셸 자신이 아닌가, ux-papercuts 결정 92)와 **함께
  // 끝날 프로세스 수**다. 프로세스 결정 3이 결정 92의 「foreground가 셸이 아닐 때만 묻는다」를 「자손이 있으면
  // foreground가 셸이어도 묻는다」로 넓혀서 수가 더해졌다.
  //
  // **이 값을 구독하는 곳은 여전히 없다 — 그런데 이유가 바뀌었다.** 한때 여기 「매 순간
  // 바뀌는 값이라 구독하지 않는다」고 적혀 있었는데, adr-04가 그것을 뒤집어 아래
  // `onPtyRunning`이 명령 판정을 1초마다 실어 온다. 그래도 **이 자리는 그대로다**: 닫기
  // 판정은 그 순간의 진실이어야 하고 구독값은 최대 1초 낡았다. 묻는 자리는 여전히
  // 닫기 직전 한 번뿐이다(`requestCloseShell`).
  closeCheck: (id: number) => invoke<CloseCheck>("pty_close_check", { id }),
  // 셸 여럿에 같은 것을 **한 번에** 묻는다 — 백엔드는 스냅샷 한 장으로 셸마다 답한다(티켓 08). 종료 확인 창과
  // 아카이브 확인 창이 「(띄운 프로세스 M개 포함)」을 셀 때 부른다. 셸마다 위 물음을 부르면 스냅샷이 셸 수만큼이다.
  //
  // 답은 **pty id → 그 셸의 답**이고, 답한 셸만 실린다 — 못 읽은 셸(이미 끝남 등)은 빠진다. JSON이라 키는
  // 문자열로 오지만 수로 찾아도 맞는다.
  closeChecks: (ids: number[]) =>
    invoke<Record<number, CloseCheck>>("pty_close_checks", { ids }),
};

/**
 * 백엔드의 폴링 스레드가 쏘는 이벤트 이름. **양쪽이 이 문자열로만 이어져 있다** —
 * 한쪽을 고치면 컴파일도 타입 검사도 통과하고 아무 일도 안 일어난다. 그 연결은
 * `shell-registry.test.ts`가 `pty.rs`와 이 파일을 함께 읽어 못박는다.
 */
const PTY_RUNNING = "pty:running";

/**
 * 도는 명령이 **바뀐 셸만** 실려 온다(adr-04). 배선은 `watcher.rs`가 `works:changed`를 쏘고
 * 프런트가 `listen`으로 받는 그 길과 같다.
 *
 * **`terminalApi` 안이 아니라 곁에 선다** — 저쪽은 우리가 부르는 invoke의 목록이고
 * 이것은 백엔드가 먼저 말을 거는 통로라, 한 객체에 섞으면 방향이 갈린 둘이 같은 것처럼
 * 읽힌다.
 */
export function onPtyRunning(listener: (changed: PtyRunning[]) => void): Promise<UnlistenFn> {
  return listen<PtyRunning[]>(PTY_RUNNING, (event) => listener(event.payload));
}

/**
 * 셸이 훅으로 말한 것이 오는 이벤트 이름. 위 `PTY_RUNNING`과 같은 성질이다 — 문자열
 * 하나가 두 언어를 잇고, 갈리면 아무 일도 안 일어난다.
 */
const SHELL_ATTENTION = "shell:attention";

/**
 * 셸이 스스로 말한 것이 **바뀐 셸만** 실려 온다. 통로의 모양은 위 `onPtyRunning`과 같다 —
 * 백엔드의 스레드 하나가 emit하고 여기가 `listen`으로 받는다. 다른 것은 재는 쪽이다:
 * 저쪽은 1초마다 앱이 물어서 알고, 이쪽은 에이전트가 훅으로 말해 줘서 안다.
 */
export function onShellAttention(
  listener: (changed: ShellAttention[]) => void,
): Promise<UnlistenFn> {
  return listen<ShellAttention[]>(SHELL_ATTENTION, (event) => listener(event.payload));
}
