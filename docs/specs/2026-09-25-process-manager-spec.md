# 프로세스 관리 스펙 — 정리 · 모니터링 · 훅 고도화 · 전환 성능

> 상태: 구현 · 코드 리뷰 · 리팩터 끝, develop PR · v0.17.0 릴리즈 대기 (2026-09-28). 지난 상태: 설계 확정, 판 01 착수 전 (2026-09-25)
> 작성일: 2026-09-25 · 구현 뒤 고침: 2026-09-28
> 브랜치: `feat/process-manager`
> 코드 기준: origin/develop `857c493` (v0.14.1). 구현 뒤 develop을 두 번 받았다 — 머지 커밋 `3205a67`(v0.15.0) · `9d47e91`(v0.16.0)
> 설계 기록: Atelier work `process-manager`(조사 네 편 · 결정 19개). 이 문서는 저장소만 보는 사람을 위한 자기완결 요약이다. 구현이 설계와 달라진 것은 같은 폴더의 구현 스펙 사본(`2026-09-25-process-manager-implementation-spec.md`) 「3판에서 바뀐 것 — 구현 뒤」에 모였다. 아래 「구현 뒤:」 줄은 그 요약이다.

## 1. 왜

사용자 보고(2026-09-25):

1. **고아 프로세스가 쌓여 컴퓨터가 느려진다.** work를 아카이브해 셸이 붕 뜬 경우, 중간에 죽은 테스트 프로세스 등이 샌다.
2. **work나 「확인할 것」 항목을 눌러도 이동하지 않거나 느리다.**
3. **「확인할 것」이 이상하다.** 알림을 눌러도 그 셸로 가지 않고, 안 도는데 「도는 중」으로 뜬다.

원인(코드 · 실측으로 확인, `857c493` 기준):

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
| **고아** | 표식을 물었는데 그 표식의 셸이 이미 없는 프로세스. 확정 고아와 출처 불명을 함께 부르는 말이다 |
| **확정 고아** | 인스턴스 기록상 그 인스턴스가 죽었거나, 살아 있는데 그 셸이 목록에 없는 고아 |
| **출처 불명** | 인스턴스 기록이 없는 세대의 표식을 문 프로세스. 자동으로 건드리지 않는다 |
| **다른 인스턴스** | 지금 떠 있는 다른 아틀리에 실행(dev 빌드와 설치본을 함께 띄웠을 때의 저쪽). 그 실행의 셸에서 뜬 것은 고아가 아니다. 보기만 한다 |
| **주인 잃은 셸** | owner work가 MCP로 아카이브 · 삭제됐는데 조용하지 않아 남겨 둔 셸 |
| **화면 밖 셸** | 앱의 셸 풀에는 있는데 화면이 모르는 셸(스냅샷 두 장에 연달아). 닫을 자리가 없어 `Processes`에서 닫는다 |
| **예외** | 이름 목록에 든 실행 파일과 그 자손. 정리 대상에서 빠진다 |
| **셸 도우미** | 셸에 사람이 처음 입력하기 전에 뜬 프로세스(p10k의 `gitstatusd` 등). 셸과 함께 끝나지만 확인 창의 수와 「조용함」에 안 든다 |
| **조용한 셸** | 명령도 없고 이 셸에서 띄운 프로세스도 없는 셸(셸 도우미는 세지 않는다). 그것을 못 알아내면 조용한 셸이 아니다 |
| **정리 기록** | 앱이 무엇을 언제 왜 끝냈는지 남긴 것 — 사건마다 까닭 · 대상 · 결과(끝남 · 강제로 끝남 · 이미 없음 · 못 끝냄) |

`CONTEXT.md`에 올렸다(판 01 · 04). 띠의 이름은 develop의 「알림 띠」다 — 「확인할 것」은 띠 안 한 줄의 상태 이름이다.

## 4. 설계

### A. 정리

1. **셸을 닫으면 그 셸에서 나온 것 전부를 끝낸다.**
   - 대상: 셸의 PID 트리 + 그 셸의 표식을 문 프로세스(부모가 먼저 죽어 launchd로 넘어간 것 포함) − 예외.
   - 순서: SIGTERM → 2초 → **신원(pid + 시작 시각)이 같은** 생존자만 SIGKILL.
   - 표식은 `KERN_PROCARGS2`로 읽는다(`pty.rs`가 이미 argv를 읽는 경로). `/bin/zsh` 같은 시스템 바이너리는 env가 안 읽히므로 트리로 잡는다.
   - 닫기 확인 창: foreground가 셸이어도 자손이 있으면 묻는다(해요체). 명령이 돌면 명령 문구 아래에 「이 셸에서 띄운 프로세스 N개도 함께 끝나요.」, 명령 없이 자손만 있으면 「이 셸에서 띄운 프로세스 N개가 아직 돌아요. 닫을까요?」. 셸 도우미는 N에 안 든다.
   - 앱 종료 · 새로고침 · UI 아카이브 · 삭제도 같은 규칙이다. 종료 · 아카이브 · 삭제의 확인 창도 셸 수 바로 뒤에 띄운 프로세스 수를 말한다.
   - 구현 뒤: 셸이 스스로 끝날 때도 그 셸의 표식 생존자를 끝낸다. 한 신원에 SIGTERM은 한 번이다 — 진행 중인 끝내기가 이미 보낸 신원은 다른 길이 다시 안 보낸다.
2. **예외 목록**: 기본 `tmux`, `gpg-agent`, `ssh-agent`, `colima`, `limactl`, `docker` 계열(`docker*` · `com.docker.*`). 설정 › 터미널에서 고친다(「셸을 닫아도 남길 프로세스」).
   - 구현 뒤: 예외는 **우리 셸 트리 · 표식 안에서만** 가른다. 앱 밖에서 띄운 tmux, launchd의 `ssh-agent`는 판정 밖이라 `Processes`의 예외 묶음에도 안 선다.
3. **MCP 아카이브 · 삭제**: 앱이 `works:changed` 뒤 owner work가 사라진 셸을 찾는다. 조용한 셸은 바로 닫고, 조용하지 않은 셸(닫기 전 답을 모르는 셸 포함)은 「주인 잃은 셸」로 남겨 토스트로 알린다 — 「아카이브된 작업의 셸 N개에 아직 도는 것이 있어요」(Maison은 「Room」) [모두 닫기] [보기]. 이유: MCP 아카이브를 부르는 claude가 대개 그 셸 안에 있다.
   - 토스트는 세계마다 하나이고, 주인 잃은 셸이 닫히거나 스스로 끝나면 N이 따라온다. 기다렸다 저절로 닫지 않는다.
4. **인스턴스 기록**: `~/.atelier/instances/<세대>.json` = {앱 신원(pid + 시작 시각), 빌드, 버전, 살아 있는 셸 키, 갱신 시각}. dev 빌드와 설치본이 동시에 떠도 서로를 고아로 오판하지 않게 한다.
5. **시작 시 정리**: 확정 고아를 A-1의 순서로 끝내고 토스트 「지난 실행에서 남은 프로세스 N개를 정리했어요 [보기]」. 정리 기록은 파일(`~/.atelier/cleanup-log.json`)에 최근 100건.
   - 구현 뒤: 앱이 물려받은 셸 키를 낸 실행의 기록은 죽었어도 지우지 않는다 — 설치본 셸에서 띄운 dev 앱과 vite가, 설치본이 다시 뜰 때 정리된다.
6. **안 쓴 자동 셸 회수**: 터미널 탭에 들어가 자동으로 뜬 셸이 **키 입력을 한 번도 안 받은 채** 화면을 떠나면 닫는다. 앱 전체 셸 상한은 두지 않는다.

### B. 모니터링 — `Processes`

- main nav 항목(`Terminal` 다음, `Archive` 앞). 두 세계 모두(`/processes` · `/maison/processes`, 같은 화면)에 서고 **앱 전체**를 보여 준다. 지금 세계가 맨 위다.
- nav 메타: 평소엔 메모리 합계, 주인 잃은 셸 · 출처 불명 · 앱이 사람 손 없이 끝낸(또는 못 끝낸) 정리 기록이 있으면 앞에 `●`(`--signal-wait` 앰버). 화면을 보면 꺼지고, 본 것은 앱을 껐다 켜도 남는다.
- 화면:
  - 요약 카드: 앱 합계 메모리 + 지난 1시간 추이, CPU, 셸 수 · 도는 중 · 주인 잃은 셸 · 확정 고아 · 출처 불명, 앱 본체
  - 세계별 work → 셸 → 자손 트리: 명령 · 상태 · 경과 · 메모리 · CPU · 듣는 포트, [이동] [닫기] [끝내기]. 셸 도우미는 옅은 줄이다
  - 묶음: 주인 잃은 셸 [모두 닫기] · 화면 밖 셸 [닫기] · 확정 고아/출처 불명 [정리](출처 불명은 한 번 더 묻는다) · 다른 인스턴스(보기 전용, 빌드와 버전) · 예외(보기 전용) · 정리 기록(최근 100건, 펼치면 대상)
  - [조용한 셸 모두 닫기]
- 수집(Rust, macOS):
  - `libproc`(`proc_listallpids` · `proc_pid_rusage`) — 이 맥 전체 889개를 1.3ms에 훑었다(설계 때 실측). 구현 뒤 스냅샷 한 장은 release p50 2.06ms다.
  - 메모리 값은 `phys_footprint`(활성 상태 보기의 「메모리」 열과 같다). RSS는 공유 메모리를 겹쳐 세서 부풀린다.
  - CPU는 두 표본 사이 CPU 시간 차이를 벽시계로 나눈 것이다. Apple Silicon의 mach 시간 단위를 타임베이스(이 맥 125/3)로 ns로 바꾼다. 눈금은 한 코어 = 100이다.
  - 합계는 10초마다 백그라운드로 모아 메모리에 1시간치. 셸 · 프로세스별 값은 화면이 열려 있을 때만 2초마다.
  - 포트는 우리 트리의 프로세스만 본다(`lsof`를 띄우지 않는다).
  - 앱 본체 = Rust 본체 + WebView(WebContent) 프로세스다. 구현 뒤: 귀속이 된다 — 비공개 SPI가 WebContent의 pid를 준다(티켓 30). 못 물었거나 못 읽었을 때만 요약에 「웹뷰 제외」가 선다. GPU · Networking 프로세스는 세지 않는다(툴팁에 적는다).
- [끝내기]는 앱 창으로 확인하고, 화면에 보인 표본의 신원을 A-1의 순서로 끝낸다.

### C. 훅

1. **이벤트**

   | 에이전트 | 지금 | 더함 |
   |---|---|---|
   | claude | UserPromptSubmit, PermissionRequest, Elicitation, Stop, SessionEnd | PreToolUse, PostToolUse, PostToolUseFailure, StopFailure, SubagentStart, SubagentStop |
   | codex | UserPromptSubmit, PermissionRequest, Stop, Interrupt, SessionEnd | PreToolUse, PostToolUse, SubagentStart, SubagentStop |

   - claude의 도구 이벤트 셋은 `async: true`로 등록한다. 처리기는 셸마다 잠금 파일을 쥐고 **자기가 시작한 시각이 상태 파일의 것보다 같거나 새로울 때만** 쓴다(비동기 순서 뒤집힘 방지). 막힌 옛 사건도 서브에이전트 집합과 멈춤(`stopped`)은 접는다.
   - 구현 뒤: python 스크립트(호출당 약 20ms)를 zsh 처리기(`atelier-hook.zsh`, `/bin/zsh -f` + 내장 모듈)로 바꿨다(티켓 19). claude는 셸 없이 부르는 `args` 꼴로 건다 — 그 모양으로 p50 2.8~3.3ms다. codex 꼴의 값은 PR 본문의 계측을 본다.
   - 더하지 않음: `Notification`, `SessionStart`, `PermissionDenied`, `TeammateIdle`, `TaskCompleted`.
2. **전이 표**

   | 입력 | 상태 |
   |---|---|
   | UserPromptSubmit | 도는 중 |
   | PreToolUse · PostToolUse(도구) | 도는 중. 기다림을 푼다 — 단 **그 기다림을 낸 에이전트와 다른 에이전트**(페이로드의 `agent_id`)의 도구면 그대로 둔다(구현 뒤) |
   | PermissionRequest · Elicitation · AskUserQuestion 도구 | 기다림 |
   | (승인 추론) 권한 창의 기다림에서 확정 키 — `1`, 창이 열린 뒤 첫 Enter, 처음 자리에서 연 고치기 칸의 Enter | 도는 중(도구와 같다). 물음 창과 어느 창인지 모르는 요청의 키는 안 읽는다(구현 뒤, P7 (가)) |
   | Stop | 확인할 것(그 셸을 보면 꺼짐). 서브에이전트가 돌고 있으면 도는 중(서브에이전트 N) |
   | StopFailure | 확인할 것 + 「오류로 끝남」 |
   | 중단(추론 · `PostToolUseFailure.is_interrupt` · codex `Interrupt`) | 없음 |
   | SessionEnd(`/clear`) | 없음 |
   | SessionEnd(그 밖) · 에이전트 프로세스가 foreground에서 사라짐 | 도는 중 · 기다림은 지움, **안 본 완료는 남김**. 직전이 도는 중이고 멈춘 턴(`stopped`)이면 **확인할 것을 새로 세운다**(구현 뒤 — `claude -p`는 Stop이 디바운스에 삼켜진다) |

   - 셸 상태의 칸은 아홉이다: 서브에이전트 수, 기다림을 낸 서브에이전트, 기다림이 선 창(권한 창 · 물음 창)을 더했다.
3. **중단 추론**: 「도는 중」일 때 xterm에서 Esc · Ctrl-C를 보면 그 순간의 상태를 기준값으로 잡고, 500ms 안에 상태가 안 바뀌면 중단으로 본다. 그 사이 훅이 오면 버린다. **TTL은 없다.** 에이전트 사라짐은 한 박자(300ms) 늦게 앉히고, 그 뒤로는 OSC · 벨이 다시 말할 수 있다.
4. **자동 갱신**: 앱이 뜰 때 우리 훅이 하나라도 설치돼 있으면 지금 목록으로 맞춘다(`.bak`, 바뀐 게 없으면 안 씀, 갱신했으면 토스트 「에이전트 훅을 새 목록으로 맞췄어요」). 설치한 적 없으면 안 건드린다. 「설치됨」은 지금 목록 전부일 때, 일부면 「업데이트 필요」. 두 빌드가 서로 되쓰지 않게 명령줄에 목록 판을 싣고, 파일의 판이 더 새로우면 맞추지 않는다.
   - 구현 뒤: 데이터 루트를 옮긴 실행(`ATELIER_HOME`)은 맞추지 않는다. 설정의 [설치] 버튼도 같은 갱신 모드다.
5. **알림 → 셸**: 판 03 선행 시험의 판정은 「안 됨」이다(S33) — 알림 클릭은 지금처럼 창만 앞으로 가져오고, 알림에 셸 키를 싣지 않았다(S34). 셸 키는 셸 띄우기 IPC의 답에만 선다.
   - 그 자리를 단축키 **⌘J 「방금 부른 셸로」**(P3 · S59)가 맡는다. 가장 최근에 부르는 상태(기다림 · 확인할 것)에 들어선 셸로 간다 — OS 알림이 안 울렸어도, 보고 있어서 곧바로 본 것이 됐어도 같다. 메뉴 항목으로도 선다.
   - 그 셸이 닫혔으면 다른 셸로 대신 가지 않고 「그 셸은 닫혔어요」 토스트로 끝낸다. 확인 창 · 검색 팔레트가 떠 있으면 안 돈다.
6. 전송은 지금의 파일(`~/.atelier/shells/<셸>.json`) + 감시를 유지한다.

### D. 성능 · 이동

1. **목록 조회**
   - `works:changed`를 앱 루트에서 한 번만 듣는다. 조회 중에 온 이벤트는 표시만 하고 끝난 뒤 한 번 다시 읽는다. 「조회 중」은 두 세계의 work 목록 · 아카이브 목록 조회만 센다.
   - Rust: `git --no-optional-locks status`, 워크트리별 git을 상한 4~8로 병렬 + `spawn_blocking`.
   - works 목록은 `refetchOnWindowFocus`를 끈다.
   - 하지 않음: `--untracked-files=no` · `gix`(dirty의 뜻이 바뀌어 아카이브 게이트와 어긋난다), `core.fsmonitor` 강제.
   - 구현 뒤 계측: 이벤트 한 번에 도는 `list_works`는 4 → 1번(저쪽 세계에 셸이 있으면 2). 한 번의 시간은 워크트리 21개에서 196ms → 80ms.
2. **포커스**: 셸로 가는 클릭(띠 · [이동] · ⌘J · 탭 클릭)은 모두 스토어의 `selectShellWithFocus`(포커스 요청 → 켜기)를 부른다. 이미 붙어 있으면 곧바로 `term.focus()`, 아니면 다음 `openOrReattach`가 한 번 소비한다. 화면을 옮기는 길은 켜기와 요청을 **이동이 닿은 순간**에 한다 — spec 레이아웃 편집기의 떠날 때 확인이 이동을 막으면 아무것도 안 남긴다. 사이드바 행의 5px 드래그 문턱은 먼저 계측한다(dev 빌드 로그 — 트랙패드 실물 로그는 PR의 사람 확인).
3. **WebGL**: 최근 붙인 셸 **6개**만 `WebglAddon`을 쥐고 나머지는 우리가 dispose한다(WebKit 한도는 프로세스당 16, dispose한 컨텍스트도 GC 전까지 슬롯을 쥔다). 보이는 셸이 잃으면 재시도 3번, 그다음 DOM 렌더러.
   - 구현 뒤 계측(헤드리스 대리): 셸 스물하나를 두 바퀴 오갈 때 빈 화면은 42번 중 10번 → 0번이다. 다만 「too many active WebGL contexts」 콘솔 경고는 여전히 뜬다 — 놓은 컨텍스트의 슬롯은 dispose가 아니라 GC 때 풀리고, 곧바로 푸는 웹 API가 없다. 실물 WKWebView 값은 PR의 사람 확인이다.

## 5. 판

설계는 판마다 PR 하나였다(01 → 02 → 03 → 04). 구현 뒤: 사용자 결정(2026-09-25)으로 판 넷을 이 브랜치에 차례로 모두 커밋하고, 브랜치 전체 코드 리뷰와 리팩터를 거쳐 **PR 하나**로 develop에 올린다. 판 03은 `sidebar-active-band` 머지를 기다리지 않았다 — 그 work은 develop 머지(`3205a67`)로 받았다.

| 판 | 내용 | 티켓 | 완료 기준 |
|---|---|---|---|
| 01 정리 | A 전부 | 01~13 (#279~#291) | claude Bash 도구로 띄운 dev 서버가 셸을 닫으면 끝난다. 강제 종료 뒤 다시 켜면 남은 것이 정리되고 알림이 뜬다. dev와 설치본을 함께 띄워도 서로의 셸을 안 건드린다. MCP로 아카이브해도 대답하던 claude가 안 죽는다. 예외 목록의 tmux가 살아남는다 |
| 02 성능 · 이동 | D 전부 | 14~17 (#292~#295) | `works:changed` 한 번에 `list_works` 한 번. 이미 켜진 셸을 눌러도 포커스가 온다. 셸 20개를 오가도 「too many active WebGL contexts」가 안 뜬다 — 구현 뒤: 화면은 안 비지만 헤드리스 계측의 경고는 남았다(D-3) |
| 03 훅 | C 전부. 알림 클릭(24)은 선행 시험(18)의 「안 됨」으로 코드 없이 닫았다 | 18~25 (#296~#303) | 생각 중 Esc · `/clear` · API 오류 · claude kill 뒤 「도는 중」이 안 남는다. 턴을 마친 셸은 보면 띠에서 꺼진다. 승인 뒤 도구가 돌면 「도는 중」이다 |
| 04 Processes | B 전부 + `CONTEXT.md` 용어 | 26~32 (#304~#310) | 앱이 띄운 셸과 자손이 한 화면에 보이고 숫자가 활성 상태 보기와 맞는다. 고아 · 주인 잃은 셸을 거기서 치울 수 있다 |

## 6. 뒤집는 옛 결정

| 옛 결정 | 출처(아카이브된 work) | 바뀜 |
|---|---|---|
| 새 사실은 훅 · OSC로만, 휴리스틱 · 타이머 금지 | terminal-activity-signal 결정 2 | 키 입력에 묶인 중단 추론만 허용. TTL은 여전히 금지 |
| 전이 표 Stop → 기다림, `/clear` → 도는 중 | terminal-activity-signal 구현-스펙 | C-2 |
| 결정 3의 표 — 나를 기다림 = 턴 종료 뒤 입력 대기 | terminal-activity-signal 결정 3 | 턴 종료는 확인할 것(C-2). 어휘 셋 · 우선순위는 그대로 |
| 오류로 멈추면 Stop이 기다림으로 잡는다 | terminal-activity-signal 결정 12 | StopFailure → 확인할 것 + 「오류로 끝남」. 빨강은 여전히 없다 |
| 훅이 한 번 말한 셸은 OSC · 벨 · 출력을 무시 | terminal-activity-signal 구현-스펙 권위 규칙 | 에이전트 프로세스가 사라지면 풀린다(C-3) |
| 그룹째 거둔다 | in-app-terminal 결정 19 | 트리 + 표식으로 넓힘 |
| 정리 시점은 앱 종료 · 새로고침 둘 | in-app-terminal 결정 18 | 셸 닫기 · 앱 시작을 더한다(A-1 · A-5) |
| 화면을 옮기는 것만으로는 죽지 않는다 | in-app-terminal 결정 20 | 입력 없는 자동 셸만 예외(A-6) |
| MCP 아카이브 셸 정리는 v1의 알려진 대가 | in-app-terminal 결정 26 | A-3으로 갚음 |
| foreground가 셸이 아닐 때만 묻는다 | ux-papercuts 결정 92 | 자손이 있어도 묻는다(A-1) |
| 이 세계의 것만 센다 | `Sidebar.tsx`가 인용하는 결정 10 | `Processes` 메타만 예외(앱 전체) |
| Maison nav = `Terminal` + `Archive` | life-mode 결정 6 | `Processes`가 두 세계 모두에 서며 셋이 된다 |

## 7. 구현 뒤 남은 것

- 데스크톱 앱 · 진짜 claude/codex · 실물 WKWebView로 재는 확인(트랙패드 드래그 로그, ⌘J 메뉴 accelerator, 활성 상태 보기와의 대조 등)은 PR 본문의 사람 확인으로 남았다.
- 스펙에 규칙이 없어 코드가 한쪽으로 둔 물음 넷(아카이브 직후 복원된 slug의 주인 잃은 표시, 아카이브 창의 M에 foreground 명령 그룹, 「조용함」 경과의 근사, 앱 본체 툴팁의 SafariPlatformSupport)은 구현 스펙 사본 Further Notes 「열린 물음(후속)」에 있다. 이 work 밖으로 둔 것은 그 Out of Scope 「구현 뒤 이 work 밖으로 둔 것」에 있다.

## 8. 참고

- orca(`stablyai/orca`, 로컬 클론 `94009f63f`): 자손 스윕 `src/main/pty-descendant-termination.ts`, 중단 추론 `src/main/agent-hooks/server.ts` `inferInterrupt`, Resource Manager `src/main/memory/collector.ts`, 알림 → pane `src/main/ipc/notifications.ts`.
- WebKit `WebKit-7624.5.1.11.3`: WebGL 한도 `Source/WebCore/html/canvas/WebGLRenderingContextBase.cpp`, 버튼 mousedown 포커스 `Source/WebCore/page/EventHandler.cpp`.
- TanStack Query 5.101.2 `query.ts`(cancelRefetch), Tauri 2.11.5 `src/event/mod.rs`(리스너 호출), xterm addon-webgl 0.20.0-beta.298 `WebglRenderer.ts`.
