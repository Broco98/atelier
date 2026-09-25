# 프로세스 관리 스펙 — 정리 · 모니터링 · 훅 고도화 · 전환 성능

> 상태: 설계 확정, 판 01 착수 전 (2026-09-25)
> 작성일: 2026-09-25
> 브랜치: `feat/process-manager`
> 코드 기준: origin/develop `857c493` (v0.14.1)
> 설계 기록: Atelier work `process-manager`(조사 네 편 · 결정 19개). 이 문서는 저장소만 보는 사람을 위한 자기완결 요약이다.

## 1. 왜

사용자 보고(2026-09-25):

1. **고아 프로세스가 쌓여 컴퓨터가 느려진다.** work를 아카이브해 셸이 붕 뜬 경우, 중간에 죽은 테스트 프로세스 등이 샌다.
2. **work나 「확인할 것」 항목을 눌러도 이동하지 않거나 느리다.**
3. **「확인할 것」이 이상하다.** 알림을 눌러도 그 셸로 가지 않고, 안 도는데 「도는 중」으로 뜬다.

원인(코드 · 실측으로 확인):

| 보고 | 원인 |
|---|---|
| 1 | 셸을 거둘 때 신호가 가는 곳이 **프로세스 그룹 둘**(셸 · foreground)뿐이다(`src-tauri/src/pty.rs` `reap` · `groups_of`). claude Bash 도구의 자식은 **별도 세션 · 제어 tty 없음**이라 안 닿는다. 회수는 정상 종료 · 새로고침 때만 돌고(`lib.rs` `RunEvent::Exit` · `PageLoadEvent::Started`), PID는 메모리에만 있다. MCP `atelier_archive_work`는 앱의 PTY에 손이 안 닿는다(셸을 닫는 곳은 `WorksPage.tsx`의 UI 아카이브 하나) |
| 2 | `works:changed` 리스너가 다섯 곳이라 이벤트 한 번에 `list_works`(워크트리마다 `git status`)가 최대 4번 돈다. `invoke`는 취소가 없어 Rust가 매번 끝까지 돈다. 이미 켜진 셸을 다시 누르면 WebKit이 mousedown에서 포커스를 비우고, 되찾는 길(`TerminalPane.tsx`의 `[activeId]` 이펙트)이 안 돈다 |
| 3 | OS 알림 클릭을 `tauri-plugin-notification` 2.4가 데스크톱에서 돌려주지 않는다. claude는 생각 중 Esc · Ctrl-C에 오는 훅이 없고(Claude Code 2.1.282의 `Stop`에 `is_interrupt` 없음), `/clear`는 전이 표가 일부러 「도는 중」으로 바꾼다. 훅이 한 번 말한 셸은 그 뒤 벨 · OSC로 못 푼다. Stop이 「기다림」이라 턴을 마친 셸이 보고 나서도 띠에 남는다 |

## 2. 범위

**포함**: A 정리 · B 모니터링(`Processes` 화면) · C 훅 고도화 · D 성능 · 이동(① 목록 조회 증폭 ② 포커스 ③ WebGL 컨텍스트).

**제외**: PTY 출력 배칭(`terminal-output-batching` work의 몫), 워처 경로 페이로드(`watcher-changed-paths`), 셸 영속(재시작 뒤 셸 유지), 외부 터미널 앱에서 띄운 프로세스, macOS 외 OS의 기능(컴파일만 된다).

## 3. 용어

| 말 | 뜻 |
|---|---|
| **우리 프로세스** | 살아 있는 셸의 PID 트리 + env `ATELIER_SHELL=<세대>-<번호>`를 문 프로세스. 세대는 앱 인스턴스가 뜬 시각(ms)이다 |
| **고아** | 표식을 물었는데 그 표식의 셸이 이미 없는 프로세스 |
| **확정 고아** | 인스턴스 기록상 그 인스턴스가 죽었거나, 살아 있는데 그 셸이 목록에 없는 고아 |
| **출처 불명** | 인스턴스 기록이 없는 세대의 표식을 문 프로세스. 자동으로 건드리지 않는다 |
| **주인 잃은 셸** | owner work가 MCP로 아카이브 · 삭제됐는데 무언가 도는 중이라 남겨 둔 셸 |
| **예외** | 이름 목록에 든 실행 파일과 그 자손. 정리 대상에서 빠진다 |
| **조용한 셸** | foreground가 셸이고 자손이 없는 셸 |

`CONTEXT.md`에 올린다(판 01 · 04).

## 4. 설계

### A. 정리

1. **셸을 닫으면 그 셸에서 나온 것 전부를 끝낸다.**
   - 대상: 셸의 PID 트리 + 그 셸의 표식을 문 프로세스(부모가 먼저 죽어 launchd로 넘어간 것 포함) − 예외.
   - 순서: SIGTERM → 2초 → **신원(pid + 시작 시각)이 같은** 생존자만 SIGKILL.
   - 표식은 `KERN_PROCARGS2`로 읽는다(`pty.rs`가 이미 argv를 읽는 경로). `/bin/zsh` 같은 시스템 바이너리는 env가 안 읽히므로 트리로 잡는다.
   - 닫기 확인 창: foreground가 셸이어도 자손이 있으면 「이 셸에서 띄운 프로세스 N개도 함께 끝납니다」.
   - 앱 종료 · 새로고침 · UI 아카이브도 같은 규칙.
2. **예외 목록**: 기본 `tmux`, `gpg-agent`, `ssh-agent`, `colima`, `limactl`, `docker` 계열. 설정 › 터미널에서 고친다.
3. **MCP 아카이브 · 삭제**: 앱이 `works:changed` 뒤 owner work가 사라진 셸을 찾는다. 조용한 셸은 바로 닫고, 도는 셸은 「주인 잃은 셸」로 남겨 토스트로 알린다(「[모두 닫기] [보기]」). 이유: MCP 아카이브를 부르는 claude가 대개 그 셸 안에 있다.
4. **인스턴스 기록**: `~/.atelier/instances/<세대>.json` = {pid, 시작 시각, 살아 있는 셸 목록}. dev 빌드와 설치본이 동시에 떠도 서로를 고아로 오판하지 않게 한다.
5. **시작 시 정리**: 확정 고아를 A-1의 순서로 끝내고 토스트 「지난 실행에서 남은 프로세스 N개를 정리했어요 [보기]」. 정리 기록은 파일에 최근 100건.
6. **안 쓴 자동 셸 회수**: 터미널 탭에 들어가 자동으로 뜬 셸이 **키 입력을 한 번도 안 받은 채** 화면을 떠나면 닫는다. 앱 전체 셸 상한은 두지 않는다.

### B. 모니터링 — `Processes`

- main nav 항목. 두 세계 모두(`/processes` · `/maison/processes`, 같은 화면)에 서고 **앱 전체**를 보여 준다. 지금 세계가 맨 위다.
- nav 메타: 평소엔 메모리 합계, 주인 잃은 셸 · 출처 불명 · 새 정리 기록이 있으면 앞에 `●`(`--signal-*` 토큰). 화면을 보면 꺼진다.
- 화면:
  - 요약: 앱 합계 메모리 + 1시간 추이, CPU, 셸 수 · 도는 중 · 주인 잃은 셸 · 고아, 앱 본체
  - 세계별 셸 → 자손 트리: 명령 · 상태 · 경과 · 메모리 · CPU · 듣는 포트, [이동] [닫기] [끝내기]
  - 묶음: 주인 잃은 셸 [모두 닫기] · 고아/출처 불명 [정리] · 다른 인스턴스(보기 전용) · 예외(보기 전용) · 정리 기록
  - [조용한 셸 모두 닫기]
- 수집(Rust, macOS):
  - `libproc`(`proc_listallpids` · `proc_pid_rusage`) — 이 맥 전체 889개를 1.3ms에 훑었다(실측).
  - 메모리 값은 `phys_footprint`(활성 상태 보기의 「메모리」 열과 같다). RSS는 공유 메모리를 겹쳐 세서 부풀린다.
  - 합계는 10초마다 백그라운드로 모아 메모리에 1시간치. 셸 · 프로세스별 값은 화면이 열려 있을 때만 2초마다.
  - 포트는 우리 트리의 프로세스만 본다(`lsof`를 띄우지 않는다).
  - WebView(WebContent) 귀속은 확인이 필요하다 — 못 하면 앱 본체는 Rust 프로세스만.
- [끝내기]는 앱 창으로 확인하고 A-1의 순서로 끝낸다.

### C. 훅

1. **이벤트**

   | 에이전트 | 지금 | 더함 |
   |---|---|---|
   | claude | UserPromptSubmit, PermissionRequest, Elicitation, Stop, SessionEnd | PreToolUse, PostToolUse, PostToolUseFailure, StopFailure, SubagentStart, SubagentStop |
   | codex | UserPromptSubmit, PermissionRequest, Stop, Interrupt, SessionEnd | PreToolUse, PostToolUse, SubagentStart, SubagentStop |

   - claude의 도구 이벤트 셋은 `async: true`로 등록한다. 훅 스크립트는 **자기가 시작한 시각이 상태 파일의 것보다 새로울 때만** 쓴다(비동기 순서 뒤집힘 방지).
   - 지금 python 스크립트는 호출당 약 20ms다 — 셸 또는 네이티브로 가볍게 다시 쓴다.
   - 더하지 않음: `Notification`, `SessionStart`, `PermissionDenied`, `TeammateIdle`, `TaskCompleted`.
2. **전이 표**

   | 입력 | 상태 |
   |---|---|
   | UserPromptSubmit · PreToolUse · PostToolUse | 도는 중 |
   | PermissionRequest · Elicitation · AskUserQuestion 도구 | 기다림 |
   | Stop | 확인할 것(그 셸을 보면 꺼짐). 서브에이전트가 돌고 있으면 도는 중(서브에이전트 N) |
   | StopFailure | 확인할 것 + 「오류로 끝남」 |
   | 중단(추론 · `PostToolUseFailure.is_interrupt` · codex `Interrupt`) | 없음 |
   | SessionEnd(`/clear`) | 없음 |
   | SessionEnd(그 밖) · 에이전트 프로세스가 foreground에서 사라짐 | 도는 중 · 기다림은 지움, **안 본 완료는 남김** |

3. **중단 추론**: 「도는 중」일 때 xterm에서 Esc · Ctrl-C를 보면 그 순간의 상태를 기준값으로 잡고, 500ms 안에 상태가 안 바뀌면 중단으로 본다. 그 사이 훅이 오면 버린다. **TTL은 없다.**
4. **자동 갱신**: 앱이 뜰 때 우리 훅이 하나라도 설치돼 있으면 지금 목록으로 맞춘다(`.bak`, 바뀐 게 없으면 안 씀, 갱신했으면 알림). 설치한 적 없으면 안 건드린다. 「설치됨」은 지금 목록 전부일 때, 일부면 「업데이트 필요」.
5. **알림 → 셸**: 알림에 셸 키를 싣는다. 판 03 첫 단계에서 네이티브 클릭(`mac-notification-sys` `wait_for_click` 또는 `UNUserNotificationCenter`)을 설치본 · dev 빌드 양쪽으로 시험해, 되면 클릭 → `focusShell`. 단축키 「방금 알린 셸로」는 어느 쪽이든 넣는다. 셸이 없으면 토스트로 끝낸다.
6. 전송은 지금의 파일(`~/.atelier/shells/<셸>.json`) + 감시를 유지한다.

### D. 성능 · 이동

1. **목록 조회**
   - `works:changed`를 앱 루트에서 한 번만 듣는다. 조회 중에 온 이벤트는 표시만 하고 끝난 뒤 한 번 다시 읽는다.
   - Rust: `git --no-optional-locks status`, 워크트리별 git을 상한 4~8로 병렬 + `spawn_blocking`.
   - works 목록은 `refetchOnWindowFocus`를 끈다.
   - 하지 않음: `--untracked-files=no` · `gix`(dirty의 뜻이 바뀌어 아카이브 게이트와 어긋난다), `core.fsmonitor` 강제.
2. **포커스**: `focusShell(id)` 요청 — 이미 붙어 있으면 즉시 `term.focus()`, 아니면 다음 `openOrReattach`가 한 번 소비한다. 띠 · [이동] · 알림 · 단축키 · 탭 클릭이 모두 부른다. 사이드바 행의 5px 드래그 문턱은 먼저 계측한다(dev 빌드 로그).
3. **WebGL**: 최근 붙인 셸 6~8개만 `WebglAddon`을 쥐고 나머지는 우리가 dispose한다(WebKit 한도는 프로세스당 16, dispose한 컨텍스트도 GC 전까지 슬롯을 쥔다). 보이는 셸이 잃으면 재시도 3번, 그다음 DOM 렌더러.

## 5. 판

판마다 PR 하나. 01 → 02 → 03 → 04.

| 판 | 내용 | 완료 기준 |
|---|---|---|
| 01 정리 | A 전부 | claude Bash 도구로 띄운 dev 서버가 셸을 닫으면 끝난다. 강제 종료 뒤 다시 켜면 남은 것이 정리되고 알림이 뜬다. dev와 설치본을 함께 띄워도 서로의 셸을 안 건드린다. MCP로 아카이브해도 대답하던 claude가 안 죽는다. 예외 목록의 tmux가 살아남는다 |
| 02 성능 · 이동 | D 전부 | `works:changed` 한 번에 `list_works` 한 번. 이미 켜진 셸을 눌러도 포커스가 온다. 셸 20개를 오가도 「too many active WebGL contexts」가 안 뜬다 |
| 03 훅 | C 전부. **`sidebar-active-band` 머지 뒤** | 생각 중 Esc · `/clear` · API 오류 · claude kill 뒤 「도는 중」이 안 남는다. 턴을 마친 셸은 보면 띠에서 꺼진다. 승인 뒤 도구가 돌면 「도는 중」이다 |
| 04 Processes | B 전부 + `CONTEXT.md` 용어 | 앱이 띄운 셸과 자손이 한 화면에 보이고 숫자가 활성 상태 보기와 맞는다. 고아 · 주인 잃은 셸을 거기서 치울 수 있다 |

## 6. 뒤집는 옛 결정

| 옛 결정 | 출처(아카이브된 work) | 바뀜 |
|---|---|---|
| 새 사실은 훅 · OSC로만, 휴리스틱 · 타이머 금지 | terminal-activity-signal 결정 2 | 키 입력에 묶인 중단 추론만 허용. TTL은 여전히 금지 |
| 전이 표 Stop → 기다림, `/clear` → 도는 중 | terminal-activity-signal 구현-스펙 | C-2 |
| 그룹째 거둔다 | in-app-terminal 결정 19 | 트리 + 표식으로 넓힘 |
| MCP 아카이브 셸 정리는 v1의 알려진 대가 | in-app-terminal 결정 26 | A-3으로 갚음 |
| 이 세계의 것만 센다 | `Sidebar.tsx`가 인용하는 결정 10 | `Processes` 메타만 예외(앱 전체) |

## 7. 참고

- orca(`stablyai/orca`, 로컬 클론 `94009f63f`): 자손 스윕 `src/main/pty-descendant-termination.ts`, 중단 추론 `src/main/agent-hooks/server.ts` `inferInterrupt`, Resource Manager `src/main/memory/collector.ts`, 알림 → pane `src/main/ipc/notifications.ts`.
- WebKit `WebKit-7624.5.1.11.3`: WebGL 한도 `Source/WebCore/html/canvas/WebGLRenderingContextBase.cpp`, 버튼 mousedown 포커스 `Source/WebCore/page/EventHandler.cpp`.
- TanStack Query 5.101.2 `query.ts`(cancelRefetch), Tauri 2.11.5 `src/event/mod.rs`(리스너 호출), xterm addon-webgl 0.20.0-beta.298 `WebglRenderer.ts`.
