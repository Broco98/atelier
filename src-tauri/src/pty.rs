//! 앱 안 터미널의 PTY 층. 셸을 띄우고, 바이트를 나르고, 닫을 때 그 셸에서 나온 것까지 끝낸다.
//!
//! `watcher.rs`와 같은 자리에 사는 이유도 같다 — 스레드를 들고 사는 데스크톱 전용 배선이고,
//! `atelier-core`는 CLI·MCP와 공유하는 도메인만 담는다. PTY는 MCP가 쓸 일이 없다.
//!
//! 이 파일에는 `#[tauri::command]`가 하나도 없다. 명령은 `commands.rs`에 얇은 위임으로 산다 —
//! `src/tauri-commands.test.ts`가 등록 이름을 `lib.rs`의 `generate_handler!`에서 모으고 그
//! 이름이 `commands.rs`에 `pub async fn`으로 있는지를 문자열로 보기 때문이다. 여기 두면
//! 그 그물이 조용히 꺼진다.

use std::collections::{BTreeMap, HashMap};
use std::ffi::CString;
use std::io::{Read, Write};
use std::os::unix::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use atelier_core::Mode;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter};

use crate::processes::ending::{Claim, Group, InFlight, Outcome};
use crate::processes::snapshot::{self, EnvScope};
use crate::processes::verdict::{self, Inputs, Occasion, ShellEntry};
use crate::processes::{procargs, Identity, Snapshot, SHELL_KEY_ENV};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtySpawned {
    pub id: u32,
    pub shell_name: String,
}

/// 종료 프레임. 출력 프레임과 **같은 채널**로 가므로 마지막 출력보다 늦게 도착하는 것이
/// 보장된다(결정 22). `emit`과 섞으면 그 보장이 끊긴다.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyExit {
    exit_code: u32,
    /// `strsignal()`이 준 사람이 읽는 문자열이다 — macOS에서 `"Terminated: 15"` 꼴이고
    /// `"SIGTERM"`이 아니다. 표시용일 뿐이니 파싱하거나 비교하지 않는다.
    signal: Option<String>,
}

struct Shell {
    /// 셸의 pid. `portable-pty`가 `pre_exec`에서 `setsid()`를 부르므로 이 값이 그대로
    /// 셸의 프로세스 그룹이자 세션 id다.
    pid: Option<u32>,
    /// 셸 키 — 이 셸이 자손에게 물려준 표식의 값(프로세스 결정 3). 닫을 때 그 셸의 트리 밖으로 떨어진
    /// 자손을 이것으로 찾는다.
    key: String,
    /// 셸 프로세스의 신원(pid + 시작 시각). 띄운 직후에 읽어 쥔다 — 닫을 때 판정이 이 신원으로 셸의 PID
    /// 트리를 찾고, 끝내기가 셸 그룹에 신호를 보내기 직전에 셸이 그대로인지 본다. 못 읽었으면(리눅스, 셸이
    /// 뜨자마자 끝남) `None`이고, 그때 셸 그룹에는 지금처럼 그룹 신호만 간다.
    process: Option<Identity>,
    master: Box<dyn MasterPty + Send>,
    /// **수명 내내 여기 산다.** `UnixMasterWriter`의 Drop이 pty에 개행 + `^D`를 써 넣으므로,
    /// 잠깐 꺼내 쓰고 되돌리는 식으로 다루면 그 사이 사용자 셸에 EOF가 들어가 셸이 끝난다.
    /// `take_writer()`가 되돌릴 수 없는 일회성 래치인 것도 같은 이유로 위험하다 — 한 번
    /// 잃으면 그 pty에는 두 번 다시 쓸 수 없고, 새로 여는 수밖에 없다.
    ///
    /// **자기 잠금을 따로 갖는 이유**는 쓰기가 막힐 수 있기 때문이다. 셸이 표준입력을 안
    /// 읽는 동안(큰 붙여넣기 등) pty 버퍼가 차면 `write_all`이 막히는데, 그때 풀 잠금까지
    /// 쥐고 있으면 다른 셸의 resize·kill은 물론 **앱 종료의 동기 회수까지 막혀 앱이 안 닫힌다.**
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    /// 이 셸이 훅으로 남기는 상태 파일. **경로를 들고 다니는 것은 아래 `Drop` 때문이다** —
    /// 거두는 자리에서 데이터 루트를 다시 계산하면 `ATELIER_HOME` 오버라이드가 그 사이에
    /// 바뀌었을 때 남의 파일을 지운다.
    state_file: PathBuf,
}

/// **셸이 사라지면 그 셸이 남긴 말도 사라진다.** 안 지우면 닫힌 셸이 사이드바에서 영영
/// 사람을 부르고, 다음 실행이 같은 PTY 번호를 쓸 때 그 값을 새 셸이 뒤집어쓴다.
///
/// **`Drop`인 것이 요점이다.** 셸이 풀에서 빠지는 자리가 셋이다 — 사용자가 `exit`를 쳐서
/// 리더 스레드가 자기 자리를 치울 때, `×`로 죽일 때(`kill`), 앱이 닫히거나 웹뷰가 다시 뜰
/// 때(`end_for_exit` · `end_for_reload`). 셋 다 결국 이 값을 떨구므로 여기 한 자리에 두면 빠지는 길이 하나 더
/// 생겨도 따라온다. 세 곳에 손으로 적으면 언젠가 한 곳이 빠지고, 그때 나는 것은 조용히
/// 남는 앰버 점 하나다.
impl Drop for Shell {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.state_file);
    }
}

#[derive(Default)]
pub struct PtyPool {
    shells: Mutex<HashMap<u32, Shell>>,
    next_id: AtomicU32,
    /// 진행 중인 끝내기 — 이 풀에서 뺀 셸의 끝내기가 뒤 스레드에서 도는 동안 여기 오른다(프로세스 스펙 S5).
    /// 앱 종료가 마감한다. 풀에 두는 것은 셸을 빼는 모든 길이 풀을 쥐고 있어서다.
    endings: Arc<InFlight>,
}

impl PtyPool {
    /// 잠금이 오염됐다는 것은 다른 스레드가 패닉했다는 뜻이다. 여기서 다시 패닉하면 그
    /// 하나가 앱 전체로 번진다 — 안을 꺼내 이어 간다.
    fn lock(&self) -> MutexGuard<'_, HashMap<u32, Shell>> {
        self.shells.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// 셸 하나를 띄운다. **`mode`는 그 셸이 사는 세계다** — cwd가 없을 때 어디서 뜨는지와,
/// 셸 안에서 뜬 에이전트가 어느 루트를 보는지를 함께 정한다.
pub fn spawn(
    pool: &Arc<PtyPool>,
    mode: Mode,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    on_frame: Channel<InvokeResponseBody>,
) -> Result<PtySpawned, String> {
    let dir = resolve_cwd(mode, cwd)?;
    // **id를 빌더보다 먼저 발급한다.** 셸 ID의 꼬리가 이 번호이고 빌더가 그것을 env에
    // 실어야 하니, 지금까지처럼 프로세스가 뜬 뒤에 발급하면 넘길 것이 없다. 앞으로 당겨도
    // 잃는 것은 「띄우기에 실패한 셸이 번호 하나를 태운다」뿐이다 — 번호는 세는 값이 아니라
    // 가르는 값이라 구멍이 나도 아무 데도 안 걸린다.
    //
    // 발급 자체를 `mint_shell_id`로 뺀 이유는 **검사가 그것을 실행으로 잴 수 있게** 하기
    // 위해서다. `spawn`은 살아 있는 pty와 IPC 채널이 있어야 도는데 헤드리스 검사에는 둘 다
    // 없어서, 여기 인라인으로 두면 「셸마다 다른 값이 난다」를 소스 자리로만 재게 된다 —
    // 그러면 `let id = 0;`으로 굳히는 변형이 조용히 통과한다.
    let (id, shell_id) = mint_shell_id(pool);
    let builder = shell_builder(mode, &dir, &shell_id)?;
    let shell_name = Path::new(&builder.get_shell())
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "shell".to_string());

    let size = PtySize { rows, cols, pixel_width: 0, pixel_height: 0 };
    let pair = native_pty_system()
        .openpty(size)
        .map_err(|e| format!("pty를 열지 못했습니다: {e}"))?;
    let mut child = pair
        .slave
        .spawn_command(builder)
        .map_err(|e| format!("셸을 띄우지 못했습니다: {e}"))?;
    // slave fd를 우리가 쥐고 있으면 셸이 죽어도 master 읽기가 EIO를 못 받아 리더가 영원히
    // 막힌다 → 종료 프레임이 영원히 안 온다. 떨구면 EIO가 `Ok(0)`(EOF)으로 돌아온다.
    drop(pair.slave);

    // 여기서 실패하면 셸은 **이미 떠 있다.** 그대로 `?`로 빠져나가면 아무도 모르는 고아가 된다.
    let mut reader = match pair.master.try_clone_reader() {
        Ok(reader) => reader,
        Err(e) => return Err(abandon(&mut child, e)),
    };
    let writer = match pair.master.take_writer() {
        Ok(writer) => Arc::new(Mutex::new(writer)),
        Err(e) => return Err(abandon(&mut child, e)),
    };
    let pid = child.process_id();
    let process = pid.and_then(snapshot::identity_of);

    // **스레드보다 먼저 풀에 앉힌다.** 아래 스레드는 끝나며 자기 자리를 치우는데
    // (`owner.lock().remove`), 그 치움이 등록보다 **먼저** 돌 수 있다 — `$SHELL`이 즉시
    // 끝나면 그렇다. 그러면 등록이 죽은 셸을 되살리고, 그 pid는 이미 회수돼 재사용
    // 가능한 상태다. 다음 회수가 그 자리에 앉은 남의 프로세스 그룹을 쏜다 —
    // 아래 스레드의 주석이 막으려는 바로 그것이다. 순서를 이렇게 두면 그 창이 닫힌다:
    // 치움은 언제 돌아도 `remove`일 뿐이다.
    // 상태 파일의 자리를 여기서 정해 셸과 함께 들려 보낸다 — 거두는 자리(`Drop`)가 루트를
    // 다시 계산하지 않게.
    let state_file = crate::shells::state_path(&atelier_core::data_root(), &shell_id);
    pool.lock().insert(id, Shell { pid, key: shell_id, process, master: pair.master, writer, state_file });

    // 읽기와 기다리기를 **한 스레드**에 둔다. 「종료 프레임은 마지막 출력 프레임보다 늦게
    // 온다」는 계약이 두 일의 순서에서 공짜로 나온다. 채널도 여기로 옮긴다 — 명령 인자로
    // 받은 채널은 명령이 리턴하는 순간 drop되고, 그 뒤의 send는 조용히 버려진다.
    let owner = Arc::clone(pool);
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                // 바이트 그대로 보낸다. 조각 경계가 멀티바이트 문자를 가르므로 여기서
                // 문자열로 만들면 그 자리가 U+FFFD가 된다 — 개행 없는 62KB 한 줄에서
                // 111조각 중 59조각이 깨지는 것을 실측했다. xterm.js는 바이트를 받으면
                // 경계를 스스로 잇는다.
                Ok(n) => {
                    if on_frame.send(InvokeResponseBody::Raw(buf[..n].to_vec())).is_err() {
                        break;
                    }
                }
                Err(e) => {
                    eprintln!("atelier: pty {id} read failed: {e}");
                    break;
                }
            }
        }
        match child.wait() {
            Ok(status) => {
                let exit = PtyExit {
                    exit_code: status.exit_code(),
                    signal: status.signal().map(str::to_string),
                };
                if let Ok(json) = serde_json::to_string(&exit) {
                    let _ = on_frame.send(InvokeResponseBody::Json(json));
                }
            }
            Err(e) => eprintln!("atelier: pty {id} wait failed: {e}"),
        }
        // **자기 자리를 치운다.** 사용자가 `exit`를 치면 셸은 여기서 끝나는데, 치우지 않으면
        // 죽은 셸이 풀에 남아 fd 둘을 붙잡고 있고 — 더 나쁘게 — 그 pid가 이미 회수돼
        // **재사용 가능한 상태**로 남는다. 다음 회수가 그 자리에 앉은 남의 프로세스 그룹을
        // 쏘게 된다. 이미 회수 경로가 가져갔으면 `remove`는 아무 일도 하지 않는다.
        owner.lock().remove(&id);
        // 채널이 여기서 떨어지며 JS 쪽 콜백이 정리된다.
    });

    Ok(PtySpawned { id, shell_name })
}

pub fn write(pool: &PtyPool, id: u32, data: &str) -> Result<(), String> {
    // 핸들만 꺼내고 풀 잠금은 곧바로 놓는다 — 쓰기가 막혀도 다른 셸과 종료 경로는 돈다.
    let writer = {
        let shells = pool.lock();
        Arc::clone(&shells.get(&id).ok_or_else(|| gone(id))?.writer)
    };
    let mut writer = writer.lock().unwrap_or_else(|e| e.into_inner());
    writer
        .write_all(data.as_bytes())
        .and_then(|()| writer.flush())
        .map_err(|e| format!("터미널에 쓰지 못했습니다: {e}"))
}

pub fn resize(pool: &PtyPool, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let shells = pool.lock();
    let shell = shells.get(&id).ok_or_else(|| gone(id))?;
    let size = PtySize { rows, cols, pixel_width: 0, pixel_height: 0 };
    shell
        .master
        .resize(size)
        .map_err(|e| format!("터미널 크기를 바꾸지 못했습니다: {e}"))
}

/// 이 셸 안에서 **명령이 도는가**(결정 92). 셸이 프롬프트에 서 있으면 터미널을 쥔 그룹이
/// 셸 자신이고, `claude`·빌드·테스트가 돌면 대화형 셸이 그 잡에 새 그룹을 주고 터미널을
/// 넘긴다 — 그 차이가 그대로 답이다.
///
/// **`Err`이 실제로 온다**: 이미 끝난 셸, tcgetpgrp 실패, pid를 못 받은 셸. 프런트는 그때
/// 묻지 않고 닫는다 — 모르는 것을 이유로 닫는 길을 막지 않는다.
///
/// **이 자리는 여전히 닫기 직전 한 번뿐이다 — 그런데 이유가 바뀌었다.** 한때 여기 「값이
/// 매 순간 바뀌므로 구독하거나 상태에 얹지 않는다」고 적혀 있었는데, `adr-04`가 그것을
/// 뒤집었다: 아래 `watch_running`이 같은 판정을 1초마다 재서 프런트 상태에 얹는다. 바뀐
/// 것은 값의 성질이 아니라 목적이다 — 「어느 work에서 무엇이 도는가」는 구독 없이는
/// 답할 수 없다.
///
/// **그렇다고 구독이 이 자리를 대신하지 않는다.** 닫기 판정은 **그 순간의 진실**이어야
/// 하고 구독값은 최대 1초 낡았다. 그래서 이 함수도 그것을 부르는 길(`requestCloseShell`)도
/// 그대로 남는다.
pub fn command_running(pool: &PtyPool, id: u32) -> Result<bool, String> {
    let shells = pool.lock();
    let shell = shells.get(&id).ok_or_else(|| gone(id))?;
    // 이름은 `process_group_leader`지만 속은 `tcgetpgrp`라 **지금 터미널을 쥔 그룹**이다
    // (`groups_of`가 같은 값을 같은 뜻으로 쓴다).
    let foreground = shell
        .master
        .process_group_leader()
        .ok_or_else(|| format!("포그라운드 그룹을 읽지 못했습니다 (id {id})"))?;
    // 셸의 pid가 그대로 그 pgid다 — `portable-pty`가 `pre_exec`에서 `setsid()`를 부른다
    // (`Shell::pid`의 주석).
    let pid = shell.pid.ok_or_else(|| format!("셸의 pid를 모릅니다 (id {id})"))?;
    Ok(command_runs(pid, foreground))
}

/// 포그라운드 그룹이 셸 자신이 아니면 명령이 돈다.
///
/// **한 줄인데 따로 있는 이유는 재기 위해서다.** 위 함수는 살아 있는 pty가 있어야 돌지만
/// 이 판정은 값 둘이면 된다. 뒤집히면 확인 창이 정확히 반대로 산다 — 빈 프롬프트를 닫을
/// 때마다 묻고, `claude`가 도는 칸은 조용히 죽는다.
fn command_runs(shell_pid: u32, foreground: i32) -> bool {
    foreground != shell_pid as i32
}

/// 셸 하나에서 **지금 도는 명령**. `running`이 `None`이면 프롬프트에 서 있다.
///
/// **이름은 원문 그대로 간다**(`claude`·`codex`·`node`·`cargo`). 「claude냐 codex냐」를
/// 여기서 접지 않는 이유는 adr-04가 든다 — 백엔드가 그걸 알면 에이전트가 늘 때마다
/// Rust를 고쳐야 한다. 로고로 바꾸는 판단은 프런트가 든다.
///
/// `id`는 **pty id**다. 프런트 셸 레지스트리의 `id`는 그쪽이 따로 발급하는 다른 번호이고
/// (`shell-registry.ts`의 `openShell`), 그 사이를 잇는 자리는 `terminal-store.ts`다.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct PtyRunning {
    id: u32,
    running: Option<String>,
}

/// 도는 명령이 바뀐 셸이 실려 나가는 이벤트. **배선은 `watcher.rs`의 `works:changed`와 같은
/// 길이다** — 스레드가 emit하고 프런트가 `listen`으로 받는다. 이름을 아는 자리가 여기와
/// `api.ts` 둘뿐이라 문자열이 갈리면 조용히 아무 일도 안 일어난다.
const RUNNING_EVENT: &str = "pty:running";

/// 얼마나 자주 재는가(adr-04). 셸이 명령을 시작하고 끝낼 때 커널이 알려 주는 이벤트가 없어
/// **물어봐야** 알고, `tcgetpgrp`는 syscall 하나라 셸 하나에 초당 1회다. 상한은 화면마다
/// 8개이므로(결정 23) 화면 둘을 열어 둬도 초당 16회다.
const POLL: Duration = Duration::from_secs(1);

/// 한 회차에 잰 것 전부 — pty id마다 「지금 도는 것」이다. 잰 값과 **직전에 쏜 값**이 같은
/// 모양이라야 둘을 그대로 뺄 수 있어서 이름을 붙였다. `HashMap`이 아니라 `BTreeMap`인 것은
/// 나가는 순서가 회차마다 흔들리지 않게 하기 위해서다.
type Running = BTreeMap<u32, Option<String>>;

// **여기서부터는 macOS의 커널 인터페이스다.** `proc_name`도 `KERN_PROCARGS2`도 리눅스
// libc에는 없다. 우리가 파는 것은 macOS 앱 하나뿐이지만(릴리스 워크플로가 만드는 타깃이
// `aarch64-apple-darwin` 하나다) **PR 게이트는 우분투에서 돈다**(verify.yml의 D10 — 공개
// 저장소의 표준 러너가 무료라서다). 그래서 이 크레이트는 리눅스에서 **컴파일은 돼야 한다**.
//
// 리눅스판은 「못 읽었다」로 답한다. `/proc`으로 같은 것을 읽는 길이 있지만 두지 않았다 —
// 아무도 안 켜는 코드는 조용히 썩고, 그것이 맞는지 보는 눈이 여기엔 없다. 못 읽었을 때 무슨
// 일이 나는지는 이미 정해져 있다(`foreground_name`의 되돌아갈 자리): 칸이 셸 이름을 단다.
//
// argv를 읽는 쪽(`KERN_PROCARGS2`)은 `processes::procargs`로 옮겼다. 프로세스 수집이 같은 버퍼에서
// 표식(env)까지 읽기 때문이다. 그 파서를 재는 검사도 거기 있다.
//
// **아래 실물 테스트도 같이 닫힌다.** 그것이 재는 것은 macOS 커널의 성질이라 다른 커널에서는
// 물음 자체가 성립하지 않는다. 그래도 태그마다 돈다 — 릴리스 워크플로의 `pnpm verify`는 macOS
// 러너에서 돌고 거기 L1이 들어 있다.

/// 이 pgid의 프로세스 **이름**. 못 읽으면 `None`이고, 그 경우가 실제로 온다 — 재는 사이에
/// 끝난 프로세스, 권한이 없는 프로세스.
///
/// **`sysctl`이 아니라 `libproc`이다.** 판 spec이 셋(`libproc`·`sysctl`·`ps`) 중 실물로
/// 정하라고 남긴 자리라 재 봤다: `ps`는 1초마다 외부 프로세스를 띄우는 것이라 처음부터
/// 빠지고, `sysctl(KERN_PROC/KERN_PROC_PID)` 길은 `kinfo_proc`이 **libc의 apple 모듈에
/// 없어서**(0.2.186 확인) 그 큰 구조체를 손으로 선언해야 한다 — 커널 레이아웃을 우리가
/// 베껴 드는 것은 조용히 틀릴 자리다. `proc_name`은 libc에 이미 바인딩이 있어 새 의존이
/// 들지 않는다.
///
/// 버퍼가 `pbi_name`(32바이트)보다 커야 `proc_name`이 ENOMEM으로 돌아가지 않는다. 넉넉히
/// 0으로 채워 두는 것은 이름이 버퍼를 꽉 채워 NUL 없이 올 수 있어서다.
#[cfg(target_os = "macos")]
fn process_name(pgid: i32) -> Option<String> {
    if pgid <= 1 {
        return None;
    }
    let mut buf = [0u8; 64];
    // 반환값은 errno가 아니라 **이름의 길이**이고, 못 읽으면 0이다.
    let len = unsafe { libc::proc_name(pgid, buf.as_mut_ptr().cast(), buf.len() as u32) };
    if len <= 0 {
        return None;
    }
    let len = (len as usize).min(buf.len());
    // UTF-8이 아닌 이름은 못 읽은 것으로 센다. U+FFFD를 흘리면 프런트가 그것을 「도는
    // 것의 종류」로 세어 정체 모를 칸이 로고 자리를 차지한다.
    std::str::from_utf8(&buf[..len]).ok().map(str::to_string)
}

#[cfg(not(target_os = "macos"))]
fn process_name(_pgid: i32) -> Option<String> {
    None
}

/// 그 pgid에서 도는 것의 이름. argv를 먼저 보고, 못 얻으면 `p_comm`으로 간다.
///
/// **`proc_name`으로는 못 얻는 이름이 있어서 argv가 먼저다.** 커널이 `p_comm`에 적는 것은 **실제로
/// 실행된 파일**의 이름이라 심링크를 따라간 뒤의 것이 온다 — Claude Code의 네이티브 설치본이
/// 그 자리에 정확히 걸린다: `~/.local/bin/claude`가 `~/.local/share/claude/versions/2.1.251`을
/// 가리키므로 이름이 **`2.1.251`**로 읽힌다(실측: 심링크로 `/bin/sleep`을 부르면 `p_comm`이
/// `sleep`이다). 사람이 친 이름은 argv[0]에 남는다. 이 순서를 재는 실물 검사는 이 파일의
/// `the_shell_tab_names_a_symlinked_command_by_the_link`다.
///
/// 되돌아갈 자리를 남기는 것은 `sysctl`이 실패하는 경우가 실재하기 때문이다 — 재는 사이에
/// 끝난 프로세스, 권한이 없는 프로세스. 그때는 지금까지 하던 그대로가 답이다.
fn foreground_name(pgid: i32) -> Option<String> {
    if pgid <= 1 {
        return None;
    }
    procargs::argv(pgid)
        .as_deref()
        .and_then(procargs::invoked_name)
        .or_else(|| process_name(pgid))
}

/// 읽은 이름을 **어떻게 다루나** — 값 셋만 받는 순수 판정이다.
///
/// **`command_runs`와 같은 이유로 따로 있다**(그 함수 주석). 조립부는 살아 있는 pty가
/// 있어야 돌지만 이 판정은 값 셋이면 되고, 뒤집히면 모든 셸에 늘 로고가 붙거나 아무 셸에도
/// 안 붙는다.
///
/// 이름을 못 읽었으면 `None`이다 — 「무엇인지 모르는 것이 돈다」를 표시할 자리가 화면에
/// 없으므로(로고 하나가 전부다) 조용히 넘어간다.
fn running_command(shell_pid: u32, foreground: i32, name: Option<String>) -> Option<String> {
    if !command_runs(shell_pid, foreground) {
        return None;
    }
    name
}

/// 풀에 있는 셸마다 지금 도는 명령을 **한 번 잰다.**
///
/// **잠금 안에서 풀에 남아 있는 셸만 읽는다 — 그것이 `end`의 순서를 안 건드리는 방법이다.**
/// 포그라운드 그룹은 master fd가 살아 있어야 읽는데, 셸을 거두는 길(`kill` · `end_for_reload` ·
/// `end_for_exit`)은 풀에서 **먼저 빼고**(잠금 안에서) 그 다음에 거둔다. 그러니 우리가 잠금을 쥐고 있는 동안 그 셸은 아직
/// 풀에 있고 master도 살아 있거나, 이미 빠져 우리 눈에 안 보이거나 둘 중 하나다 — 거두는
/// 중인 셸을 읽는 창이 없다.
///
/// 이름은 **셸 자신일 때도 읽는다.** 판정을 여기서 한 번 더 가르면 「도는가」가 두 자리에
/// 살게 되고, 아끼는 것은 셸당 초당 syscall 하나다.
fn measure(pool: &PtyPool) -> Running {
    let shells = pool.lock();
    shells
        .iter()
        .map(|(id, shell)| {
            let running = shell.pid.and_then(|pid| {
                let foreground = shell.master.process_group_leader()?;
                running_command(pid, foreground, foreground_name(foreground))
            });
            (*id, running)
        })
        .collect()
}

/// **재는 것과 쏘는 것을 가르는 자리.** 직전에 쏜 값과 다른 셸만 나온다.
///
/// adr-04가 폴링을 산 값이 이 한 줄에 있다 — 비용은 재기가 아니라 **다시 그리기**에 있다.
/// 안 가르면 사이드바와 탭 줄이 초마다 통째로 다시 그려진다(`shell-registry.ts`의
/// `sameBranch`가 막고 있는 그 문제와 같은 것이다).
fn changes(sent: &Running, now: &Running) -> Vec<PtyRunning> {
    let mut out = Vec::new();
    for (id, running) in now {
        // **직전에 없던 셸은 「아무것도 안 돌던 셸」과 같다.** 프런트도 새 칸을 `null`로
        // 시작하므로(`openShell`), 방금 열린 빈 셸에 `null`을 쏘면 그것이 곧 안 바뀐 값이다.
        if sent.get(id).unwrap_or(&None) != running {
            out.push(PtyRunning { id: *id, running: running.clone() });
        }
    }
    // 풀에서 빠진 셸은 **한 번 더** 쏘아 지운다. 안 그러면 마지막 값이 화면에 굳어 죽은
    // 칸에 로고가 영영 남는다. 돌던 셸만 지우는 것도 같은 이유의 뒷면이다 — 이미 `None`
    // 이던 셸까지 쏘면 안 바뀐 값이 나간다.
    for (id, running) in sent {
        if running.is_some() && !now.contains_key(id) {
            out.push(PtyRunning { id: *id, running: None });
        }
    }
    out
}

/// 도는 명령을 **상시 구독한다**(adr-04). 1초마다 재고 **바뀐 셸만** 실어 쏜다.
///
/// 배선은 `watcher.rs`가 `works:changed`를 쏘고 프런트가 `listen`으로 받는 그 길과 같다 —
/// 스레드 하나가 스스로 돌고, 창을 직접 만지지 않는다.
///
/// **셸이 0개면 아무 일도 안 한다.** 잰 것도 직전도 비어 있어 `changes`가 빈 목록을 주고,
/// 빈 목록은 쏘지 않는다.
pub fn watch_running(app: AppHandle, pool: Arc<PtyPool>) {
    std::thread::spawn(move || {
        // **프런트가 지금 믿고 있는 값**이다. 안 쏜 회차에는 잰 값과 같으므로 그대로
        // 덮어써도 어긋나지 않는다 — 「바뀐 것만 쏜다」가 성립하는 근거가 이 한 줄이다.
        let mut sent = Running::new();
        loop {
            std::thread::sleep(POLL);
            let now = measure(&pool);
            let changed = changes(&sent, &now);
            if !changed.is_empty() {
                let _ = app.emit(RUNNING_EVENT, changed);
            }
            sent = now;
        }
    });
}

/// 셸 하나를 닫는다 — 풀에서 빼고, 그 셸에서 나온 것을 모두 끝낸다(프로세스 결정 3). 예외 목록에 걸린 것과 그
/// 밑은 남긴다(프로세스 결정 5). 셸 탭의 ×, ⌘W, 셸 메뉴의 닫기, UI 아카이브 · 삭제가 모두 이 길을 탄다.
///
/// **판정까지 하고 돌아온다**(프로세스 스펙 S5). 유예와 SIGKILL은 뒤 스레드에서 돌고, 그동안 그 끝내기는
/// 진행 중인 끝내기 목록에 있다 — 유예 중에 앱이 닫히면 종료가 마감한다(`end_for_exit`). 스냅샷 한 장은 ms
/// 단위지만 기다리는 일이라 `commands.rs`가 blocking 풀에서 부른다.
pub fn kill(pool: &PtyPool, id: u32) -> Result<(), String> {
    // **빼기 전에 센다.** 뺀 뒤 목록에 오르기 전에 종료가 오면, 종료는 그 셸을 풀에서도 목록에서도 못 본다.
    // 셈이 먼저 서 있으면 종료가 판정이 끝나기를 기다린다. 뺄 셸이 없으면 셈은 떨어지며 물러난다.
    let claim = pool.endings.claim();
    let shell = pool.lock().remove(&id).ok_or_else(|| gone(id))?;
    end(pool, vec![shell], claim);
    Ok(())
}

/// 웹뷰가 다시 뜰 때 옛 페이지의 셸을 모두 닫는다.
///
/// 정리 시점은 in-app-terminal 결정 18이 앱 종료 · 새로고침 둘로 정했고, 프로세스 결정 3이 셸 닫기를
/// 더했다(앱 시작은 티켓 10). 옛 페이지가 쥐던 채널은 죽었으니 그 셸을 이어 쓸 길이 없다.
///
/// **풀은 그 자리에서 비우고, 끝내기는 셸 닫기와 같은 길로 뒤로 보낸다** — 새로고침은 유예를 기다리지 않는다.
/// 판정은 뺀 셸들을 끝낼 셸로 받으므로, 새 웹뷰가 곧바로 띄운 셸은 거기 들지 않는다.
pub fn end_for_reload(pool: &PtyPool) {
    let claim = pool.endings.claim();
    let shells: Vec<Shell> = pool.lock().drain().map(|(_, shell)| shell).collect();
    // 첫 로드에도 온다 — 그때 풀은 비어 있고, 셈은 떨어지며 물러난다.
    if !shells.is_empty() {
        end(pool, shells, claim);
    }
}

/// 앱이 닫힐 때 — 이 실행이 띄운 것을 모두 끝내고 **나서** 돌아온다(프로세스 결정 3 · 프로세스 스펙 S5).
///
/// 끝낼 것 = 이 세대의 표식을 문 전부 ∪ 풀 셸들의 PID 트리 ∪ 진행 중인 끝내기. 예외 목록에 걸린 것과 그 밑은
/// 빠진다(프로세스 결정 5). 한 번에 판정하고 **동기로** 끝낸다 — 스레드에 넘기면 프로세스가 끝나며 그 스레드도
/// 함께 사라져 아무도 SIGKILL을 못 보낸다. 진행 중인 끝내기는 남은 유예만 기다린다. 다 끝나면 곧바로 나오고,
/// 가장 늦어도 2초 남짓이다.
///
/// 결과(못 끝냄 포함)를 돌려준다 — 「못 끝냄」이 있으면 인스턴스 기록을 남기는 것은 티켓 09다.
pub fn end_for_exit(pool: &PtyPool) -> Vec<(Identity, Outcome)> {
    let shells: Vec<Shell> = pool.lock().drain().map(|(_, shell)| shell).collect();
    let pgids: Vec<i32> = shells.iter().flat_map(groups_of).collect();
    let ending: Vec<ShellEntry> = shells.iter().map(Shell::entry).collect();
    // 이 세대의 표식은 언제 태어난 누가 물었는지 모르니 env를 다 읽는다.
    let snapshot = snapshot::take(EnvScope::All);
    let targets = verdict::at_exit(&Inputs {
        snapshot: &snapshot,
        generation: instance_prefix(),
        shells: &[],
        ending: &ending,
        instances: &[],
        exceptions: &exceptions(),
        app_pid: std::process::id(),
        inherited_key: crate::processes::inherited_key(),
        occasion: Occasion::Normal,
    });
    let groups = groups_led(&shells, &pgids, &snapshot);

    let closing = pool.endings.close(&targets, &groups);
    // writer의 Drop이 개행+^D를 쓰고, master의 Drop이 커널 hangup을 건다. 상태 파일도 여기서 사라진다.
    drop(shells);
    closing.finish()
}

/// 풀에서 뺀 셸들과 그 셸들에서 나온 것을 끝낸다 — 셸 닫기와 새로고침의 길. **순서가 고정이다.**
///
/// 1. 셸마다 그룹을 읽는다. foreground 그룹은 `tcgetpgrp(master)`로만 알 수 있어 master를 떨구기 전이다.
/// 2. 스냅샷을 찍고, **그 뒤에** 풀에 남은 셸 목록을 읽는다(프로세스 스펙 S52). 그 사이에 뜬 셸은 목록에
///    이미 있어, 그 셸의 자손이 누구의 것도 아닌 표식으로 읽히는 창이 없다.
/// 3. 판정 — 뺀 셸들을 「끝낼 셸」로 넘긴다. 끝낼 대상은 그 셸의 PID 트리 ∪ 그 키를 문 것 ∪ 그 트리들이다.
///    부모가 먼저 끝나 launchd 밑으로 넘어간 dev 서버는 트리가 끊겨 표식으로만 잡힌다.
/// 4. 끝내기를 시작해(대상 SIGTERM, 셸 그룹 SIGHUP) 진행 중인 끝내기 목록에 올리고 돌아온다. 셸을 떨구고
///    유예와 SIGKILL을 도는 것은 뒤 스레드다.
///
/// **셸 그룹과 그 순간의 foreground 그룹에 가는 신호는 지금 방어선 그대로 남는다.** 셸 그룹 밖으로 떨어진
/// 자손이 대상 목록으로 더해질 뿐이다. 다른 OS는 스냅샷이 비고 셸의 신원도 몰라, 지금처럼 그룹 신호만 간다.
fn end(pool: &PtyPool, shells: Vec<Shell>, claim: Claim) {
    let pgids: Vec<i32> = shells.iter().flat_map(groups_of).collect();
    let ending: Vec<ShellEntry> = shells.iter().map(Shell::entry).collect();
    // 셸마다 그 셸보다 늦게 태어난 것만 env를 읽는다(프로세스 스펙 S3). 셸 하나라도 신원을 모르면 다 읽는다.
    let scope = ending
        .iter()
        .map(|shell| shell.process.map(|id| id.started_us))
        .collect::<Option<Vec<u64>>>()
        .and_then(|born| born.into_iter().min())
        .map_or(EnvScope::All, EnvScope::BornSince);
    let snapshot = snapshot::take(scope);
    let live: Vec<ShellEntry> = pool.lock().values().map(Shell::entry).collect();
    let exceptions = exceptions();
    let verdict = verdict::judge(&Inputs {
        snapshot: &snapshot,
        generation: instance_prefix(),
        shells: &live,
        ending: &ending,
        instances: &[],
        exceptions: &exceptions,
        app_pid: std::process::id(),
        inherited_key: crate::processes::inherited_key(),
        occasion: Occasion::Normal,
    });
    let targets: Vec<Identity> = ending
        .iter()
        .flat_map(|shell| verdict.descendants.get(shell.key.as_str()).into_iter().flatten())
        .map(|proc| proc.id)
        .collect();
    let groups = groups_led(&shells, &pgids, &snapshot);

    let running = claim.start(&targets, &groups);
    // **셸을 떨구는 것도 뒤 스레드에서 한다.** writer의 Drop은 pty에 개행 + ^D를 쓰는데, 셸이 입력을 안 읽는
    // 채 pty 버퍼가 차 있으면 거기서 막힌다 — 새로고침은 메인 스레드에서 돈다.
    let behind = std::thread::Builder::new().name("atelier-ending".into()).spawn(move || {
        // writer의 Drop이 개행+^D를 쓰고, master의 Drop이 커널 hangup을 건다. 상태 파일도 여기서 사라진다.
        drop(shells);
        // 결과는 아직 읽는 곳이 없다 — SIGKILL에도 남은 것은 끝내기가 한 줄 남긴다. 정리 기록은 티켓 11이다.
        let _ = running.finish();
    });
    // 스레드를 못 띄우면 끝내기는 마감되지 않은 채 목록에 남는다 — 앱 종료가 마감한다.
    if let Err(e) = behind {
        eprintln!("atelier: could not start the ending thread: {e}");
    }
}

/// 예외 목록 — **끝낼 때마다 설정을 새로 읽는다**(프로세스 결정 5 · 프로세스 스펙 S7). 사람이 설정 › 터미널에서
/// 목록을 고치면 다음에 닫는 셸부터 먹는다. 파일이 없거나 깨졌으면 기본 목록이다.
fn exceptions() -> Vec<String> {
    crate::settings::process_exceptions(&atelier_core::data_root())
}

/// 셸들이 거느린 그룹과 그 리더의 신원. 셸 그룹의 리더는 띄울 때 쥔 셸의 신원이고, foreground 그룹의 리더는
/// 스냅샷의 그 행이다. 행이 없으면 신원을 모르는 그룹으로 옛 방어선(그룹이 있는 동안)을 따른다.
fn groups_led(shells: &[Shell], pgids: &[i32], snapshot: &Snapshot) -> Vec<Group> {
    pgids
        .iter()
        .filter_map(|pgid| u32::try_from(*pgid).ok())
        .map(|pgid| {
            let leader = match shells.iter().find(|shell| shell.pid == Some(pgid)) {
                Some(shell) => shell.process,
                None => snapshot.procs.iter().find(|row| row.id.pid == pgid).map(|row| row.id),
            };
            Group { pgid, leader }
        })
        .collect()
}

/// 이 셸이 거느린 프로세스 그룹들. 대화형 셸은 잡 제어를 켜고 **잡마다 새 그룹**을 만들기
/// 때문에 셸의 그룹 하나로는 부족하다 — 그 앞에서 돌던 `claude`가 그대로 남는다.
fn groups_of(shell: &Shell) -> Vec<i32> {
    let mut groups = Vec::new();
    if let Some(pid) = shell.pid {
        groups.push(pid as i32);
    }
    // 이름은 `process_group_leader`지만 속은 `tcgetpgrp`라 **지금 터미널을 쥔 그룹**이다.
    // 셸의 식별자로 쓰면 안 된다 — 셸이 무엇을 돌리느냐에 따라 값이 변한다.
    if let Some(fg) = shell.master.process_group_leader() {
        if !groups.contains(&fg) {
            groups.push(fg);
        }
    }
    groups
}

impl Shell {
    /// 판정이 읽는 셸의 모양. 첫 사람 입력 시각은 아직 모른다(티켓 07 · 08).
    fn entry(&self) -> ShellEntry {
        ShellEntry { key: self.key.clone(), process: self.process, first_input_us: None }
    }
}

/// 띄우자마자 입출력을 못 열었을 때. 회수 배선에 오르기 전이므로 여기서 직접 거둔다.
fn abandon(child: &mut Box<dyn Child + Send + Sync>, e: impl std::fmt::Display) -> String {
    let _ = child.kill();
    let _ = child.wait();
    format!("터미널 입출력을 열지 못합니다: {e}")
}

fn gone(id: u32) -> String {
    format!("이미 끝난 터미널입니다 (id {id})")
}

/// cwd가 「없음」이면 **모드의 홈**이 자리다 — Atelier는 `~/.atelier`, Maison은
/// `~/.atelier/maison`. 최상위 터미널이 그 길로 뜬다.
///
/// 프런트가 `"~/.atelier"`를 박으면 `ATELIER_HOME` 오버라이드가 죽는다. 데이터 루트가
/// 어디인지는 atelier-core만 안다 — 모드별 홈도 마찬가지라 여기서 `maison`을 잇지 않는다.
fn resolve_cwd(mode: Mode, cwd: Option<String>) -> Result<PathBuf, String> {
    cwd_or_mode_home(atelier_core::mode_home(mode), cwd)
}

/// 위 함수의 **판정만** 떼어 놓은 것. 모드의 홈을 값으로 받으므로 테스트가 임시 폴더를
/// 건네 잴 수 있다 — 진짜 홈을 만들지 않고도 「어느 갈래가 폴더를 만드나」를 못박는다.
fn cwd_or_mode_home(home: PathBuf, cwd: Option<String>) -> Result<PathBuf, String> {
    let dir = match cwd {
        // **폴더를 만드는 것은 이 갈래뿐이다.** Maison 홈은 첫 Room이 생기기 전엔 없을 수
        // 있어서, 안 만들면 최상위 터미널이 아래 검사에 걸려 안 뜬다. 명시 cwd에까지
        // 넓히면 아카이브로 사라진 work 폴더가 터미널을 여는 것만으로 빈 폴더로
        // 되살아난다 — 그 순간 아래 방어가 통째로 무의미해진다.
        None => {
            // 실패를 삼킨다. 못 만든 이유는 아래 `is_dir`가 같은 문장으로 말해 준다 —
            // 여기서 따로 오류를 지으면 「폴더가 없습니다」가 두 벌이 된다.
            let _ = std::fs::create_dir_all(&home);
            home
        }
        Some(raw) => atelier_core::expand_home(&raw),
    };
    // `portable-pty`는 없는 cwd를 **아무 신호 없이 홈으로 떨어뜨린다**(`as_command`의
    // `.filter(is_dir).unwrap_or(home)`). 워크트리가 아카이브로 사라진 뒤 터미널이 조용히
    // 홈에서 열리는 사고가 정확히 그 경로다.
    if !dir.is_dir() {
        return Err(format!("폴더가 없습니다: {}", dir.display()));
    }
    Ok(dir)
}

/// 이 셸의 ID — `<앱 인스턴스 접두사>-<PTY id>`.
///
/// **접두사가 실행마다 바뀌는 것이 이 모양의 값이다.** 상태 파일은 셸 ID로 이름 지어지는데,
/// 앱을 껐다 켜면 PTY id는 다시 0부터 나므로 접두사가 없으면 지난 실행이 남긴 파일이 이번
/// 실행의 새 셸에 그대로 붙는다 — 뜨자마자 「나를 기다림」인 셸이 생긴다. 접두사가 갈라
/// 준다.
///
/// 구분자를 **하나만** 둔다. 파일 이름에서 PTY id를 되뽑는 쪽이 뒤에서 한 번만 자르면
/// 되도록.
pub(crate) fn shell_id(pty_id: u32) -> String {
    format!("{}-{pty_id}", instance_prefix())
}

/// 이 실행을 가리키는 접두사. 한 번 잡히면 프로세스가 사는 동안 안 바뀐다.
///
/// **잡히는 순간은 이 함수가 처음 불린 때다** — `OnceLock`이 지연 초기화이기 때문이다.
/// 지금 그 첫 호출자는 `lib.rs`의 `setup`에서 도는 `shells::sweep(&root, instance_prefix())`
/// 라, 값은 사실상 **앱이 뜬 시각**이다. 이 함수가 기대는 성질은 그것이 아니라 「실행끼리
/// 안 겹친다」 하나이므로 첫 호출자가 누구든 다 서지만, 남은 파일을 눈으로 볼 때 시각이
/// 앱을 켠 때와 맞는 것은 그 배선 덕이다.
///
/// **정리(`shells::sweep`)는 접두사를 반드시 이 함수에서 받아야 한다** — 앱 시작 시각을
/// 따로 재면 두 값이 갈라져 살아 있는 셸의 상태 파일을 지운다. 그 둘이 갈리는 순간은
/// `shells.rs`의 `a_sweep_keeps_the_file_a_live_shell_is_named_with`가 값으로 잡는다.
pub(crate) fn instance_prefix() -> &'static str {
    static PREFIX: OnceLock<String> = OnceLock::new();
    PREFIX.get_or_init(|| prefix_at(SystemTime::now()))
}

/// 시각 하나 → 접두사 하나. **시계를 인자로 뺀 것은 검사를 위해서다.** 접두사의 값은
/// 「실행마다 바뀐다」인데, `SystemTime::now()`를 안에서 부르면 그 성질을 헤드리스로 잴
/// 자리가 없어져 고정 문자열로 갈아도 아무 검사가 안 울린다 — 그러면 지난 실행이 남긴
/// 파일이 새 셸에 그대로 붙는다는, 접두사를 둔 이유가 통째로 사라진다.
///
/// 시각을 쓰는 이유는 실행끼리 겹치지 않으면서 **순서가 읽히기** 때문이다 — 남은 파일을
/// 눈으로 볼 때 어느 실행 것인지 안다. 시계가 뒤로 가는 경우(`UNIX_EPOCH` 이전)는 0으로
/// 눕힌다. 그때 두 실행이 같은 접두사를 가질 수 있지만, 그 상황에서 할 수 있는 더 나은
/// 일이 없고 대가는 「지난 파일 몇 개가 안 지워진다」뿐이다.
fn prefix_at(t: SystemTime) -> String {
    let millis = t.duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    format!("{millis}")
}

/// 이 셸의 번호와 ID를 **한 자리에서** 뽑는다. 셸마다 달라야 하는 값이 여기서만 나므로,
/// 「두 번 부르면 둘 다 다르다」를 살아 있는 pty 없이 실행으로 잴 수 있다 — 값이 하나로
/// 굳으면 상태 파일이 겹쳐 두 셸이 서로를 덮어쓴다.
fn mint_shell_id(pool: &PtyPool) -> (u32, String) {
    let id = pool.next_id.fetch_add(1, Ordering::Relaxed);
    (id, shell_id(id))
}

fn shell_builder(mode: Mode, dir: &Path, shell_id: &str) -> Result<CommandBuilder, String> {
    // `$SHELL`이 실행 불가면 크레이트는 `log::warn` 한 줄만 남기고 passwd DB로, 그것도
    // 안 되면 `/bin/sh`로 조용히 내려간다. 구독자를 안 붙였으니 완전히 무음이다.
    if let Some(shell) = std::env::var_os("SHELL") {
        let path = PathBuf::from(&shell);
        if !executable(&path) {
            return Err(format!("$SHELL을 실행할 수 없습니다: {}", path.display()));
        }
    }
    // `new_default_prog()`가 argv0를 `-zsh` 꼴로 세워 **로그인 셸**로 띄운다. `-l` 플래그보다
    // 이쪽이 진짜 터미널이 하는 방식이고, 로그인 셸이라야 `~/.zprofile`이 돌아 PATH가 선다 —
    // Finder로 띄운 앱의 환경은 launchd의 빈약한 것이라 이게 없으면 `claude`를 못 찾는다.
    // (이 빌더에 `arg()`를 부르면 Result가 아니라 패닉이다.)
    let mut cmd = CommandBuilder::new_default_prog();
    cmd.cwd(dir);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    // **방어 겹으로 세지 않는다**(결정 28). 이것은 깜빡임 완화가 아니라 fullscreen 렌더러
    // 스위치이고, 사용자가 셸에서 `/tui`를 한 번 치면 앱이 심은 값이 무의미해지는데 앱은
    // 그것을 모른다. 권장 기본값으로만 둔다 — 셸에서 덮어쓰면 그쪽이 이긴다.
    cmd.env("CLAUDE_CODE_NO_FLICKER", "1");
    // **이 셸만의 ID.** 훅 페이로드에는 tty가 없고 훅 프로세스는 부모 환경을 물려받으니,
    // 셸 안에서 돌아간 훅이 「내가 어느 셸인지」를 아는 길은 이 값 하나뿐이다. 그래서
    // 셸마다 **달라야** 한다 — 값이 하나로 굳으면 상태 파일이 겹쳐 두 셸이 서로를 덮는다.
    //
    // 같은 값이 **셸의 표식**이기도 하다(프로세스 결정 3). 셸에서 뜬 것은 세션을 따로 파도 이 값을
    // 물고 있어, 셸을 닫을 때 트리가 끊긴 자손을 이것으로 찾는다. 읽는 쪽(`processes`의 수집)과는
    // 이름 상수 하나로 이어진다.
    cmd.env(SHELL_KEY_ENV, shell_id);
    // **이 셸이 어느 세계의 것인지.** 셸 → claude·codex → MCP 서버로 상속되어, 생활 쪽
    // 셸에서 뜬 에이전트가 rooms만 보게 된다 (결정 15).
    //
    // **두 모드 다 심는다.** 「없으면 Atelier」는 앱 **밖** 셸을 위한 규칙이고, 앱은 늘
    // 명시한다 — 그래야 값이 있는 셸과 없는 셸이 「앱이 띄운 것인가」로 갈리고, 앱이 심는
    // 쪽에는 「안 심긴 자리」라는 갈래가 아예 없다.
    //
    // **위 셋과 성격이 반대다.** 저것들은 권장 기본값이라 사용자가 셸에서 덮어쓰면 그쪽이
    // 이기지만, 이 값은 앱이 아는 사실이다 — 이 셸이 어느 목록에서 열렸는지는 앱만 알고,
    // 덮어쓴 값은 화면과 어긋난 세계를 가리킬 뿐이다. (앱 밖에서 손으로 넣어 claude를
    // 띄우는 것은 다른 이야기이고 그것도 성립한다 — US 47.)
    //
    // 변수 이름을 여기 적지 않는다. 심는 자리와 읽는 자리는 코어의 상수 하나로만 이어지고,
    // 양쪽에 문자열을 박으면 한쪽 오타가 조용히 Atelier로 눕는다.
    //
    // 이 파일에서 그 상수를 부르는 자리는 **심는 모양뿐이어야 한다** — 다리의
    // `모드를_심는_예외는_심는_자리에만_쓰인다`가 그 수를 센다. 산문으로라도 그 이름을 적으면
    // 수가 어긋나 빨개지는데, 그것이 값이다: 예외가 이름 하나를 통째로 건너뛰면 그 구멍으로
    // 「읽는」 코드가 들어와도 아무도 모른다.
    cmd.env(atelier_core::MODE_ENV, mode.as_str());
    Ok(cmd)
}

fn executable(path: &Path) -> bool {
    let Ok(c) = CString::new(path.as_os_str().as_bytes()) else {
        return false;
    };
    unsafe { libc::access(c.as_ptr(), libc::X_OK) == 0 }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::ffi::OsStr;
    use std::path::{Path, PathBuf};
    use std::time::{Duration, UNIX_EPOCH};

    use atelier_core::Mode;
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};

    /// **닫힌 셸은 자기 상태 파일을 데리고 나간다.** 안 그러면 사이드바에서 죽은 셸이
    /// 영영 사람을 부르고, 다음 실행이 같은 PTY 번호를 쓸 때 그 값을 새 셸이 뒤집어쓴다.
    ///
    /// 살아 있는 pty가 필요하지만 셸을 띄우지는 않는다 — `openpty` 하나면 `Shell`이 선다.
    #[test]
    fn a_closed_shell_takes_its_state_file_with_it() {
        let dir = std::env::temp_dir().join(format!("atelier-pty-drop-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let state = dir.join("1700-9.json");
        std::fs::write(&state, r#"{"agent":"claude"}"#).unwrap();

        let size = PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 };
        let pair = native_pty_system().openpty(size).expect("pty가 열린다");
        let writer = pair.master.take_writer().expect("writer가 나온다");
        let shell = super::Shell {
            pid: None,
            key: "1700-9".to_string(),
            process: None,
            master: pair.master,
            writer: std::sync::Arc::new(std::sync::Mutex::new(writer)),
            state_file: state.clone(),
        };

        drop(shell);

        assert!(!state.exists(), "셸이 닫혔는데 상태 파일이 남았다");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 셸에 심기는 env. **두 모드 모두 값이 명시된다** — 「없으면 Atelier」는 앱 밖 셸의
    /// 규칙이라, 앱이 띄운 셸에 값이 없으면 그 규칙에 기대 조용히 Atelier로 눕는다.
    ///
    /// **소스 스캔이 아니라 값으로 잰다.** 스펙은 기존 `pty.rs`의 소스 스캔 방식을 예로
    /// 들었지만, 그 방식은 살아 있는 pty 없이 못 재는 자리에 쓰는 것이다 —
    /// `CommandBuilder`는 심은 값을 그대로 되돌려 주므로 여기서는 「적혀 있는가」가 아니라
    /// 「무엇이 심겼는가」를 물을 수 있다. 리터럴만 보는 검사는 값을 갈아 끼우는 변형을
    /// 그대로 통과시킨다.
    #[test]
    fn the_builder_plants_the_mode_beside_the_env_it_already_planted() {
        for (mode, planted) in [(Mode::Atelier, "atelier"), (Mode::Maison, "maison")] {
            let cmd = super::shell_builder(mode, Path::new("/"), "1700-0")
                .unwrap_or_else(|e| panic!("빌더를 세우지 못했다 ({mode}): {e}"));

            assert_eq!(
                cmd.get_env(atelier_core::MODE_ENV),
                Some(OsStr::new(planted)),
                "{mode} 셸이 자기 세계를 모른 채 뜬다 — 그 안의 claude가 저쪽 목록을 본다"
            );
            // **기존 셋 옆이다.** 새 값을 심다가 `env_clear`나 덮어쓰기로 저것들을 밀어내면
            // 터미널이 색을 잃고(TERM) claude가 fullscreen 렌더러로 돌아간다.
            assert_eq!(cmd.get_env("TERM"), Some(OsStr::new("xterm-256color")));
            assert_eq!(cmd.get_env("COLORTERM"), Some(OsStr::new("truecolor")));
            assert_eq!(cmd.get_env("CLAUDE_CODE_NO_FLICKER"), Some(OsStr::new("1")));
            let dir = std::ffi::OsString::from("/");
            assert_eq!(cmd.get_cwd(), Some(&dir), "받은 자리를 안 쓴다");
        }
    }

    fn temp_home(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("atelier-pty-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    /// **폴더를 만드는 것은 cwd가 「없음」일 때뿐이다.** 최상위 터미널은 아직 없는 모드
    /// 홈에서도 떠야 하지만(Maison은 첫 Room 전에 홈이 없다), 그 편의를 명시 cwd에까지
    /// 넓히면 아카이브로 사라진 work 폴더가 **터미널을 여는 것만으로** 빈 폴더로
    /// 되살아난다 — 그리고 없는 cwd를 막는 검사가 영영 아무것도 안 막게 된다.
    #[test]
    fn only_the_missing_cwd_branch_creates_a_folder() {
        let home = temp_home("home");
        assert_eq!(
            super::cwd_or_mode_home(home.clone(), None),
            Ok(home.clone()),
            "최상위 터미널이 아직 없는 모드 홈에서 안 뜬다"
        );
        assert!(home.is_dir(), "모드 홈을 안 만들었다");

        let gone = home.join("archived-work");
        let refused = super::cwd_or_mode_home(home.clone(), Some(gone.display().to_string()));
        assert!(refused.is_err(), "없는 명시 cwd가 통과했다 — 셸이 조용히 홈에서 열린다");
        assert!(!gone.exists(), "없는 cwd를 만들어 냈다 — 지운 work가 빈 폴더로 되살아난다");

        let _ = std::fs::remove_dir_all(&home);
    }

    /// 있는 폴더를 명시하면 그대로 쓴다. 위 검사만 두면 「명시 cwd는 늘 거절」로 만들어도
    /// 초록이다 — work 셸이 통째로 안 뜬다.
    #[test]
    fn an_explicit_folder_that_exists_is_used_as_is() {
        let home = temp_home("explicit");
        let work = home.join("reading");
        std::fs::create_dir_all(&work).unwrap();
        assert_eq!(
            super::cwd_or_mode_home(home.clone(), Some(work.display().to_string())),
            Ok(work),
            "있는 폴더를 명시했는데 안 쓴다"
        );
        let _ = std::fs::remove_dir_all(&home);
    }

    /// 결정 92의 판정. 실행으로는 pty가 있어야 재지만 값 둘로는 여기서 전수된다.
    #[test]
    fn a_foreground_group_that_is_not_the_shell_means_a_command_runs() {
        assert!(
            !super::command_runs(4321, 4321),
            "프롬프트에 서 있으면 터미널을 쥔 것이 셸 자신이다 — 물을 것이 없다"
        );
        assert!(
            super::command_runs(4321, 4399),
            "대화형 셸은 잡마다 새 그룹을 만들고 터미널을 그리로 넘긴다"
        );
    }

    /// 위 판정을 **실제로 딛는가**. 조립부는 살아 있는 pty가 있어야 실행으로 재는데 이
    /// seam에는 없어서, `command_running`이 늘 `Ok(false)`를 돌려주게 만들어도 위 테스트가
    /// 초록이었다(실측). `spawn`과 같은 방식으로 자리에서 잰다 — 값 둘을 읽어 판정에
    /// 그대로 넘기는지.
    ///
    /// **무엇을 못 보는지 적어 둔다.** 이것은 리터럴이 **있는가**만 보므로, 부르기는 하되
    /// 값을 갈아 끼우는 변형은 그대로 통과한다 — `.process_group_leader().or(Some(1))`로
    /// 뒤집어도 초록인 것을 실측했다(그러면 죽은 셸이 늘 「명령이 돈다」가 된다). 그 자리는
    /// **살아 있는 pty 없이는 못 잰다.** 여기서 막는 것은 검증 1차가 지목한 회귀 하나
    /// — 판정을 안 딛고 답을 새로 짓는 것 — 이고, 나머지는 실물 확인 몫이다.
    #[test]
    fn command_running_hands_both_values_to_the_verdict() {
        let body = body_of("pub fn command_running(", "\nfn ");

        assert!(
            body.contains("process_group_leader()"),
            "터미널을 쥔 그룹을 안 읽는다 — 판정의 한쪽 값이 없다"
        );
        assert!(
            body.contains("Ok(command_runs(pid, foreground))"),
            "값 둘을 그대로 판정에 넘기지 않는다 — 여기서 답을 새로 지으면 위 전수가 헛돈다"
        );
    }

    /// `spawn`의 풀 등록이 읽기 스레드보다 **앞에** 있어야 한다.
    ///
    /// 실행으로는 못 잡는다 — 뒤집혀도 스레드가 늦게 뜨는 보통의 경우에는 아무 일도
    /// 안 일어나고, 터지는 것은 셸이 즉시 끝나는 순간뿐이다. 그래서 자리로 잰다.
    /// 주석만 두면 뚫린다는 것을 이 저장소가 이미 겪었다.
    #[test]
    fn pool_insert_precedes_the_reader_thread() {
        let spawn_fn = spawn_source();

        let insert = spawn_fn.find("pool.lock().insert(").expect("풀에 앉히는 줄이 있다");
        let thread = spawn_fn.find("std::thread::spawn(").expect("읽기 스레드가 있다");

        assert!(
            insert < thread,
            "등록({insert})이 스레드({thread})보다 뒤에 있다 — 셸이 즉시 끝나면 \
             스레드의 remove가 먼저 돌아 죽은 셸이 되살아나고, 재사용된 pgid를 쏘게 된다"
        );
    }

    /// 셸을 풀에서 빼는 길은 **빼기 전에** 진행 중인 끝내기 목록에 센다(프로세스 스펙 S5).
    ///
    /// 실행으로는 못 잡는다 — 뒤집혀도 터지는 것은 빼기와 목록에 오르기 사이의 ms 창에 앱 종료가 올 때뿐이다.
    /// 그때 종료는 그 셸을 풀에서도 목록에서도 못 보고, 그 셸의 자손에 SIGKILL이 안 간다. 종료가 셈을 기다리는
    /// 것은 `processes::ending`의 `the_exit_waits_for_a_close_still_being_judged`가 잰다.
    #[test]
    fn a_close_is_counted_before_its_shell_leaves_the_pool() {
        for (path, body, leave) in [
            ("kill", body_of("pub fn kill(", "\npub fn "), ".remove(&id)"),
            ("end_for_reload", body_of("pub fn end_for_reload(", "\npub fn "), ".drain()"),
        ] {
            let count = body.find("pool.endings.claim()").unwrap_or_else(|| panic!("{path}가 셈을 안 한다"));
            let left = body.find(leave).unwrap_or_else(|| panic!("{path}가 셸을 안 뺀다"));
            assert!(
                count < left,
                "{path}: 셈({count})이 빼기({left})보다 뒤에 있다 — 그 사이에 앱 종료가 오면 뺀 셸의 자손이 남는다"
            );
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 이 판. 셸마다 **자기만의 ID**가 env에 실린다 — 훅 페이로드엔 tty가 없고 훅 프로세스는
    // 부모 환경을 물려받으니, 「내가 어느 셸인지」를 아는 길이 이 값 하나뿐이다.

    /// 셸 ID의 **모양**. `<앱 인스턴스 접두사>-<PTY id>`이고, 접두사는 한 실행 안에서
    /// 안 바뀐다. 접두사가 실행마다 바뀌는 것이 이 모양의 값이다 — 앱을 껐다 켜면 지난
    /// 실행이 남긴 상태 파일이 새 셸에 안 붙는다.
    ///
    /// 구분자가 **하나**인 것도 함께 잰다. 상태 파일 이름에서 PTY id를 되뽑는 쪽이
    /// 갈라 읽을 자리가 둘이면 어느 쪽이 접두사인지 알 수 없다.
    #[test]
    fn a_shell_id_is_this_runs_prefix_and_the_pty_id() {
        let three = super::shell_id(3);
        // **자는 것이 이 검사의 핵심이다 — 「느린 테스트」로 읽고 걷어 내지 마라.** 아래
        // 마지막 단언이 재려는 것은 접두사의 메모이제이션(`instance_prefix`의 `OnceLock`)인데,
        // 접두사는 **밀리초** 시계라 두 호출을 붙여 부르면 메모이제이션을 걷어 낸 판에서도
        // 두 값이 우연히 같게 나온다(실측: 메모이제이션 없는 판으로 1만 번 돌려 1만 번
        // 통과). 눈금보다 벌려야 그 변형이 빨개진다.
        std::thread::sleep(Duration::from_millis(2));
        let seven = super::shell_id(7);

        let (prefix, id) = three.rsplit_once('-').expect("구분자가 있다");
        assert_eq!(id, "3", "꼬리가 PTY id가 아니다");
        assert_eq!(seven.rsplit_once('-').expect("구분자가 있다").1, "7");
        assert!(!prefix.is_empty(), "접두사가 비었다 — 실행을 못 가른다");
        assert_eq!(
            three.matches('-').count(),
            1,
            "구분자가 하나가 아니다 — 파일 이름에서 PTY id를 되뽑을 자리가 흐려진다"
        );

        assert_eq!(
            seven.rsplit_once('-').expect("구분자가 있다").0,
            prefix,
            "한 실행 안에서 접두사가 바뀌었다 — 같은 실행의 셸들이 남남이 된다"
        );
    }

    /// **id 발급이 빌더 호출보다 앞에 서야 한다.** 빌더가 셸 ID를 인자로 받는데 그 ID의
    /// 꼬리가 PTY id이기 때문이다 — 지금까지처럼 프로세스가 뜬 뒤에 발급하면 넘길 것이
    /// 없다.
    ///
    /// 실행으로는 못 잰다. `spawn`은 살아 있는 pty와 IPC 채널이 있어야 도는데 이 seam에는
    /// 둘 다 없다. 그래서 `pool_insert_precedes_the_reader_thread`와 같은 방식으로
    /// **자리로** 잰다.
    ///
    /// **이 검사가 재는 것은 순서뿐이다.** 「발급이 셸마다 다른 값을 낸다」는 자리로 못 재고,
    /// 아래 `minting_twice_from_one_pool_yields_two_different_shells`가 실행으로 잰다. 여기서
    /// 값을 함께 보는 것은 「발급해 놓고 안 넘긴다」 하나까지다.
    #[test]
    fn the_pty_id_is_minted_before_the_builder_is_built() {
        let spawn_fn = spawn_source();

        let mint = spawn_fn.find("mint_shell_id(pool)").expect("id를 발급하는 줄이 있다");
        let build = spawn_fn.find("shell_builder(").expect("빌더를 세우는 줄이 있다");

        assert!(
            mint < build,
            "발급({mint})이 빌더({build})보다 뒤에 있다 — 빌더에 넘길 셸 ID가 아직 없다"
        );
        assert!(
            spawn_fn.contains("shell_builder(mode, &dir, &shell_id)"),
            "발급된 셸 ID를 빌더에 안 넘긴다 — 발급을 앞으로 당긴 뜻이 사라진다"
        );
    }

    /// **발급이 셸마다 다른 값을 낸다.** 위 검사는 자리와 리터럴만 보므로 `let id = 0;`을
    /// 앞에 두고 발급을 값 버리는 문장으로 남기는 변형이 그대로 통과한다 — 그러면 모든 셸이
    /// `<접두사>-0`을 달고 상태 파일 하나를 서로 덮어쓴다. 그 「다름」은 자리가 아니라
    /// **실행**이 지켜야 한다.
    ///
    /// 살아 있는 pty 없이 잰다. `PtyPool`은 `Default`이고 번호는 `AtomicU32`라 풀 하나만
    /// 있으면 발급 경로가 그대로 돈다 — pty·채널이 필요한 것은 `spawn`의 뒷부분뿐이다.
    #[test]
    fn minting_twice_from_one_pool_yields_two_different_shells() {
        let pool = super::PtyPool::default();
        let (first_id, first) = super::mint_shell_id(&pool);
        let (second_id, second) = super::mint_shell_id(&pool);

        assert_ne!(first_id, second_id, "같은 PTY 번호를 두 번 냈다 — 풀의 칸이 겹친다");
        assert_ne!(first, second, "두 셸이 같은 ID를 받았다 — 상태 파일이 하나로 겹친다");
        assert!(first.ends_with(&format!("-{first_id}")), "셸 ID의 꼬리가 그 셸의 번호가 아니다");
        assert!(second.ends_with(&format!("-{second_id}")));
    }

    /// **값으로** 단언한다. 「`ATELIER_SHELL`이라는 리터럴이 소스에 있는가」만 보는 검사는
    /// 셸마다 **다른** 값이 들어가는지를 못 재는데, 이 판의 신호 길 전체가 기대는 것이
    /// 정확히 그 「다름」이다 — 값이 하나로 굳으면 훅 파일도 하나로 겹쳐 두 셸이 서로의
    /// 상태를 덮어쓴다. 빌더가 받은 것을 그대로 env에서 되읽어 잰다.
    #[test]
    fn each_shell_builder_carries_its_own_shell_id() {
        let dir = std::env::temp_dir();
        // 리터럴 둘을 손으로 먹이면 마지막 `assert_ne!`가 **어떤 구현에서도 참**이라 아무것도
        // 안 잰다. 발급 경로에서 뽑은 값을 먹여야 「다름」이 생산 코드의 성질이 된다.
        let pool = super::PtyPool::default();
        let (_, first) = super::mint_shell_id(&pool);
        let (_, second) = super::mint_shell_id(&pool);
        let one = super::shell_builder(Mode::Atelier, &dir, &first).expect("빌더가 선다");
        let two = super::shell_builder(Mode::Atelier, &dir, &second).expect("빌더가 선다");

        assert_eq!(
            planted(&one).get("ATELIER_SHELL").map(String::as_str),
            Some(first.as_str()),
            "빌더가 받은 셸 ID가 env에 안 실렸다 — 훅이 어느 셸인지 모른다"
        );
        assert_eq!(
            planted(&two).get("ATELIER_SHELL").map(String::as_str),
            Some(second.as_str())
        );
        assert_ne!(
            planted(&one).get("ATELIER_SHELL"),
            planted(&two).get("ATELIER_SHELL"),
            "두 셸에 같은 값이 실렸다 — 상태 파일이 하나로 겹친다"
        );
    }

    /// **접두사의 값은 「실행마다 바뀐다」이다.** 그것이 없으면 지난 실행이 남긴
    /// `~/.atelier/shells/<접두사>-0.json`이 이번 실행의 첫 셸에 그대로 붙어 뜨자마자
    /// 「나를 기다림」인 셸이 생긴다. `instance_prefix`를 고정 문자열로 갈아도 다른 검사는
    /// 전부 초록이므로, 시계를 인자로 뺀 순수 함수 쪽에서 값으로 잰다.
    #[test]
    fn two_different_clocks_give_two_different_prefixes() {
        let early = super::prefix_at(UNIX_EPOCH + Duration::from_millis(1_700_000_000_000));
        let late = super::prefix_at(UNIX_EPOCH + Duration::from_millis(1_700_000_000_001));

        assert_eq!(early, "1700000000000", "접두사가 epoch 밀리초가 아니다");
        assert_ne!(early, late, "다른 시각이 같은 접두사를 냈다 — 실행을 못 가른다");
    }

    /// 시계가 `UNIX_EPOCH` 이전으로 가 있는 경우. 이 가지는 실물에서 거의 안 밟히지만
    /// `unwrap_or(0)`이 조용히 사라지면 `duration_since`가 Err를 내는 자리라 이 함수가
    /// 통째로 무너진다 — 값으로 눕는 것을 못박는다.
    #[test]
    fn a_clock_before_the_epoch_lies_down_at_zero() {
        let before = super::prefix_at(UNIX_EPOCH - Duration::from_secs(1));

        assert_eq!(before, "0", "epoch 이전 시각이 0으로 안 눕었다");
    }

    /// 셸 ID를 더하면서 **먼저 있던 것을 떨어뜨리지 않았는가.** 시그니처가 바뀌는 자리라
    /// 이 셋이 조용히 사라져도 검사가 하나도 안 울렸다 — 그러면 앱 안 셸의 색이 죽고
    /// (`TERM`·`COLORTERM`) claude가 전체 화면 렌더러로 돌아간다(`CLAUDE_CODE_NO_FLICKER`).
    /// 어느 것도 터지지 않고 화면만 나빠지는 종류라 눈으로 늦게 안다.
    #[test]
    fn the_env_that_was_already_there_still_rides_along() {
        let dir = std::env::temp_dir();
        let planted = planted(&super::shell_builder(Mode::Atelier, &dir, "0000-1").expect("빌더가 선다"));

        assert_eq!(planted.get("TERM").map(String::as_str), Some("xterm-256color"));
        assert_eq!(planted.get("COLORTERM").map(String::as_str), Some("truecolor"));
        assert_eq!(planted.get("CLAUDE_CODE_NO_FLICKER").map(String::as_str), Some("1"));
    }

    /// **우리가 심은 것만** 꺼낸다. `get_env`는 빌더가 부모에게서 복사해 온 값도 같이
    /// 돌려주는데, 이 검사가 찾는 이름 셋 중 둘(`TERM`·`COLORTERM`)은 개발자의 터미널에
    /// 같은 값으로 이미 서 있다 — 실제로 `cmd.env("COLORTERM", …)` 줄을 걷어 내고 돌려도
    /// 초록이었다(실측). 그러면 이 검사는 자기 프로세스의 환경을 읽고 스스로 통과한다.
    fn planted(cmd: &CommandBuilder) -> BTreeMap<String, String> {
        cmd.iter_extra_env_as_str().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    /// `spawn`의 본문. 셋 중 둘이 이것을 보므로 표식을 한 자리에만 적는다.
    fn spawn_source() -> &'static str {
        body_of("pub fn spawn(", "\npub fn ")
    }

    /// 소스를 잘라 함수 하나의 본문만 돌려준다. **가드가 여기 사는 것이 요점이다.**
    ///
    /// 이 파일을 읽어 자기 자신을 검사하는 방식은 조용히 새는 자리가 하나 있다: 소스 스캔이
    /// 찾는 리터럴은 그것을 찾는 `assert`의 문자열로도 이 파일에 있으므로, 슬라이스가 테스트
    /// 모듈까지 흘러가면 검사가 제 문장을 읽고 스스로 통과한다. 표식이 사라진 경우는 두
    /// `expect`가 막고, 표식은 있는데 끝이 흘러간 경우는 아래 `assert`가 막는다. 호출자마다
    /// 이 줄을 옮겨 적게 두면 언젠가 한 곳이 빠지므로 — 실제로 이 판에서 한 번 빠졌다 —
    /// 슬라이스를 뽑는 유일한 자리에 둔다.
    fn body_of(start: &str, end: &str) -> &'static str {
        let src = include_str!("pty.rs");
        let body = src
            .split_once(start)
            .expect("여는 표식이 있다")
            .1
            .split_once(end)
            .expect("닫는 표식이 있다")
            .0;
        assert!(
            !body.contains("mod tests"),
            "잘라 낸 자리가 테스트 모듈까지 삼켰다 — 소스 스캔이 제 문자열을 읽고 통과한다"
        );
        body
    }

    // ─────────────────────────────────────────────────────────────────────────
    // adr-04. 「도는가」 옆에 **「무엇이」**가 서고, 그것을 1초마다 재서 바뀔 때만 쏜다.

    /// 이름을 **어떻게 다루나**의 전부. 위 `command_runs`와 같은 이유로 따로 산다 —
    /// 조립부는 살아 있는 pty가 있어야 돌지만 이 판정은 값 셋이면 된다.
    #[test]
    fn a_name_only_counts_while_the_terminal_is_not_the_shells_own() {
        assert_eq!(
            super::running_command(4321, 4321, Some("zsh".to_string())),
            None,
            "프롬프트에 서 있으면 도는 명령이 없다 — 셸 자신의 이름을 도는 것으로 세면 \
             모든 셸에 늘 로고가 붙는다"
        );
        assert_eq!(
            super::running_command(4321, 4399, Some("claude".to_string())),
            Some("claude".to_string()),
            "잡에 넘어간 터미널의 이름이 그대로 답이다"
        );
        assert_eq!(
            super::running_command(4321, 4399, None),
            None,
            "이름을 못 읽는 경우가 실제로 온다(이미 끝난 프로세스·권한) — 조용히 넘어간다"
        );
    }

    /// **재는 것과 쏘는 것을 가른 자리.** 값이 안 바뀌면 이벤트가 안 나가는 것이 adr-04가
    /// 폴링을 산 값이다 — 비용은 재기가 아니라 다시 그리기에 있다. 조립부에 두면 이 성질을
    /// 재려고 1초를 기다려야 하고, 그러면 아무도 안 잰다.
    #[test]
    fn only_the_shells_whose_command_changed_go_out() {
        let sent: BTreeMap<u32, Option<String>> =
            BTreeMap::from([(1, Some("claude".to_string())), (2, None)]);

        assert!(
            super::changes(&sent, &sent.clone()).is_empty(),
            "안 바뀐 값이 나갔다 — 초마다 사이드바와 탭 줄이 통째로 다시 그려진다"
        );

        let now = BTreeMap::from([(1, None), (2, Some("cargo".to_string()))]);
        assert_eq!(
            super::changes(&sent, &now),
            vec![
                super::PtyRunning { id: 1, running: None },
                super::PtyRunning { id: 2, running: Some("cargo".to_string()) },
            ],
            "끝난 것과 시작한 것이 둘 다 나가야 한다"
        );
    }

    /// 방금 열린 셸은 프런트에서도 `null`로 시작한다(`openShell`). 그 칸에 `null`을 쏘는 것은
    /// **안 바뀐 값을 쏘는 것**이라, 셸을 열 때마다 이벤트가 하나씩 헛나간다.
    #[test]
    fn a_shell_that_just_opened_with_nothing_running_is_not_news() {
        let now = BTreeMap::from([(7, None)]);
        assert!(
            super::changes(&BTreeMap::new(), &now).is_empty(),
            "빈 셸이 새로 생긴 것만으로 이벤트가 나갔다"
        );
        assert_eq!(
            super::changes(&BTreeMap::new(), &BTreeMap::from([(7, Some("claude".to_string()))])),
            vec![super::PtyRunning { id: 7, running: Some("claude".to_string()) }],
            "열자마자 돌고 있는 셸은 첫 회차에 나가야 한다"
        );
    }

    /// 거둔 셸은 풀에서 사라진다. 그때 **한 번 더 쏘지 않으면** 마지막 값이 화면에 굳어,
    /// 죽은 칸에 claude 로고가 영영 남는다.
    #[test]
    fn a_shell_that_left_the_pool_is_cleared_once() {
        let sent = BTreeMap::from([(1, Some("claude".to_string())), (2, None)]);
        let now = BTreeMap::new();
        assert_eq!(
            super::changes(&sent, &now),
            vec![super::PtyRunning { id: 1, running: None }],
            "돌던 셸만 지운다 — 이미 null이던 셸까지 쏘면 안 바뀐 값이 나간다"
        );
    }

    /// **실물 증거.** 「pgid로 이름을 읽는다」는 살아 있는 프로세스 없이는 못 잰다 — 위 순수
    /// 판정은 값 셋으로 전수되지만 그 값이 어디서 오는지는 거기 없다.
    ///
    /// **오탐 검사를 겸한다.** 타이틀 추론을 기각한 근거(adr-04)가 「명령줄에 `claude`가 들어
    /// 있다고 claude가 아니다」인데, 말로만 두면 다음 사람이 되돌린다. `/usr/bin/grep claude`는
    /// 명령줄에 그 낱말을 달고 stdin을 기다리며 막혀 있고, 읽히는 이름은 `grep`이다.
    #[cfg(target_os = "macos")]
    #[test]
    fn the_foreground_groups_name_comes_from_a_real_pty() {
        let pair = native_pty_system()
            .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
            .expect("pty를 연다");
        // 인자가 명령줄에 남되 이름은 되지 않는다. 파일 인자를 안 주면 stdin(= 이 pty)을
        // 읽으며 막히므로 재는 동안 살아 있다.
        let mut cmd = CommandBuilder::new("/usr/bin/grep");
        cmd.arg("claude");
        let mut child = pair.slave.spawn_command(cmd).expect("grep을 띄운다");
        // 셸을 띄울 때와 같은 이유로 떨군다 — 우리가 slave를 쥐고 있으면 상대가 죽어도
        // master가 EOF를 못 받는다.
        drop(pair.slave);

        // `portable-pty`가 `pre_exec`에서 setsid + TIOCSCTTY를 부르므로 자식의 pid가 그대로
        // 포그라운드 그룹이 된다(`Shell::pid`의 주석과 같은 성질이다).
        let child_pid = child.process_id().expect("자식의 pid를 받는다") as i32;
        // **함정 둘을 여기서 실측했다.**
        // ① 아직 아무도 안 쥔 pty의 `tcgetpgrp`가 macOS에서 **부르는 쪽의 pgid**를 준다 —
        //    「0보다 크면 됐다」로 기다리면 첫 판에 테스트 바이너리 자신을 읽는다.
        // ② `pre_exec`의 setsid는 **`exec`보다 먼저** 돌아서, 터미널은 이미 넘어왔는데
        //    자식은 아직 부모의 이름을 달고 있다 — 그 창에서 읽어도 우리 이름이 나온다.
        //
        // 그래서 기다리는 조건이 「우리 이름이 아닌 이름이 붙었다」다. **「grep이 될 때까지」로
        // 기다리면 안 된다** — 그러면 아래 단언이 스스로 통과하는 change-detector가 된다.
        let mine = super::process_name(std::process::id() as i32);
        let mut name = None;
        for _ in 0..300 {
            if pair.master.process_group_leader() == Some(child_pid) {
                let read = super::process_name(child_pid);
                if read.is_some() && read != mine {
                    name = read;
                    break;
                }
            }
            std::thread::sleep(Duration::from_millis(10));
        }

        // **거두는 것이 단언보다 먼저다.** 단언이 빨개지면 그 자리에서 패닉이라, 뒤에 둔
        // 정리는 안 돈다 — 막혀 있는 grep이 그대로 남는다.
        crate::processes::ending::signal_group(child_pid as u32, libc::SIGKILL);
        let _ = child.kill();
        let _ = child.wait();

        assert_eq!(
            name.as_deref(),
            Some("grep"),
            "터미널을 쥔 그룹의 프로세스 이름을 못 읽는다 (우리 이름은 {mine:?})"
        );
        assert_ne!(
            name.as_deref(),
            Some("claude"),
            "명령줄의 낱말을 이름으로 집었다 — 타이틀 추론을 기각한 근거가 여기서 무너진다"
        );
    }

    /// **셸 탭이 이름을 고르는 순서를 실물로 못박는다** — argv가 먼저고 `p_comm`은 되돌아갈 자리다.
    ///
    /// 이 순서가 뒤집히면 Claude Code의 네이티브 설치본이 다시 `2.1.251`로 읽혀 탭에도 사이드바에도
    /// 로고가 안 뜬다(`foreground_name`의 주석). 부품(`procargs::argv` · `invoked_name`)을 재는 검사는
    /// `processes::procargs`에 있지만 **부품이 옳아도 조립 순서가 틀리면 그 검사는 초록이다** — 그래서
    /// 셸 탭이 실제로 부르는 이 함수를 여기서 잰다.
    ///
    /// `/bin/sleep`을 `claude`라는 이름의 심링크로 부른다. **둘을 함께 단언하는 것이 핵심이다** —
    /// 같은 pid의 `process_name`이 `sleep`이어야 「argv를 안 보고도 원래 claude였던 것 아닌가」와 갈린다.
    #[cfg(target_os = "macos")]
    #[test]
    fn the_shell_tab_names_a_symlinked_command_by_the_link() {
        // 폴더 이름을 `procargs`의 심링크 검사와 가른다 — 같은 바이너리 안에서 나란히 돌아, 같은 자리면
        // 한쪽의 정리가 다른 쪽이 띄우기 전에 링크를 지운다.
        let dir = std::env::temp_dir().join(format!("atelier-pty-argv-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("임시 폴더를 만든다");
        let link = dir.join("claude");
        let _ = std::fs::remove_file(&link);
        std::os::unix::fs::symlink("/bin/sleep", &link).expect("심링크를 건다");

        let mut child = std::process::Command::new(&link)
            .arg("30")
            .spawn()
            .expect("심링크로 띄운다");
        let pid = child.id() as i32;

        // 커널이 이름을 읽어 줄 때까지 기다린다. **「claude가 될 때까지」로 기다리지 않는다** — 그러면
        // 아래 단언이 스스로 통과한다.
        let mut comm = None;
        for _ in 0..300 {
            comm = super::process_name(pid);
            if comm.is_some() {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        let named = super::foreground_name(pid);

        // **거두는 것이 단언보다 먼저다.** 단언이 빨개지면 그 자리에서 패닉이라, 뒤에 둔 정리는 안 돈다.
        let _ = child.kill();
        let _ = child.wait();
        let _ = std::fs::remove_file(&link);
        let _ = std::fs::remove_dir(&dir);

        assert_eq!(comm.as_deref(), Some("sleep"), "커널은 심링크 뒤의 파일 이름을 준다");
        assert_eq!(
            named.as_deref(),
            Some("claude"),
            "셸 탭이 사람이 부른 이름 대신 실제로 돈 파일의 이름을 골랐다 — argv가 `p_comm`보다 먼저다"
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 프로세스 결정 3. 셸을 닫으면 그 셸에서 나온 것이 모두 끝난다 — 셸 그룹 밖으로 떨어진 것까지. 닫기는 유예를
    // 기다리지 않고 돌아오고, 새로고침 · 앱 종료도 같은 규칙을 탄다(프로세스 스펙 S5).

    /// 안쪽 검사 프로세스를 가르는 변수. 값이 안쪽이 돌 장면(`Scene`)이다.
    #[cfg(target_os = "macos")]
    const POOL_SIDE: &str = "ATELIER_PTY_TEST_POOL_SIDE";

    /// 풀 배선 검사가 안쪽에서 돌리는 장면. 모두 셸 하나를 띄우고, 셸에 한 줄을 쳐 트리가 끊긴 표식 자식을
    /// 띄운 뒤 그 셸을 거두는 길 하나를 부른다.
    #[cfg(target_os = "macos")]
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum Scene {
        /// ×로 닫는다. 자식은 SIGTERM에 끝난다.
        Close,
        /// ×로 닫는다. 자식은 SIGTERM을 무시한다 — 닫기는 유예를 안 기다리고, 자식은 뒤에서 SIGKILL로 끝난다.
        CloseIgnoring,
        /// ×로 닫고 곧바로 앱 종료 길을 부른다(2초 안의 ⌘Q). 자식은 셸 트리에만 있는 시스템 바이너리이고
        /// SIGTERM · SIGHUP을 무시한다.
        CloseThenExit,
        /// 웹뷰를 새로고침한다. 자식은 SIGTERM을 무시한다.
        Reload,
        /// ×로 닫는다. 표식 자식을 둘 띄우고, 하나는 예외 목록에 적은 이름으로 부른다(프로세스 결정 5) — 닫기가
        /// 다른 하나는 끝내고 그것은 남긴다. 목록은 안쪽의 데이터 루트(임시)의 설정 파일에 적는다.
        CloseKeeping,
    }

    #[cfg(target_os = "macos")]
    impl Scene {
        const ALL: [Scene; 5] =
            [Scene::Close, Scene::CloseIgnoring, Scene::CloseThenExit, Scene::Reload, Scene::CloseKeeping];

        fn name(self) -> &'static str {
            match self {
                Scene::Close => "close",
                Scene::CloseIgnoring => "close-ignoring",
                Scene::CloseThenExit => "close-then-exit",
                Scene::Reload => "reload",
                Scene::CloseKeeping => "close-keeping",
            }
        }

        /// 셸에서 띄울 자식의 역할(`processes::testkit`).
        fn role(self) -> &'static str {
            match self {
                Scene::Close | Scene::CloseKeeping => "sleep",
                _ => "ignore-term",
            }
        }
    }

    /// **풀 배선 — ×로 닫기**(티켓 04). 헤드리스 IPC 채널로 셸을 띄우고 `kill`로 닫아 판정까지 간다(프로세스
    /// 스펙 Testing › 판 01). 셸에서 띄운 표식 자식이 제 세션에 있고 부모가 먼저 끝나 launchd 밑으로 넘어갔으면,
    /// 셸 그룹과 foreground 그룹에 보내는 신호는 거기 안 닿는다 — 표식으로 찾아야 끝난다.
    ///
    /// 로그인 셸 rc가 값을 흔들므로 단언은 「표식 자식이 끝났다」 하나다.
    #[cfg(target_os = "macos")]
    #[test]
    fn closing_a_shell_ends_the_child_it_marked_after_its_tree_broke() {
        on_the_pool_side("closing_a_shell_ends_the_child_it_marked_after_its_tree_broke", Scene::Close);
    }

    /// **셸 닫기는 유예를 기다리지 않고 돌아오고, SIGTERM을 무시하는 자식은 뒤에서 2초 뒤 SIGKILL로 끝난다**
    /// (프로세스 스펙 S5). 앵커: 닫기가 돌아온 순간 자식은 아직 살아 있다 — 유예가 뒤에서 흐르는 중이다.
    #[cfg(target_os = "macos")]
    #[test]
    fn closing_returns_before_the_grace_and_sigkill_follows_behind() {
        on_the_pool_side(
            "closing_returns_before_the_grace_and_sigkill_follows_behind",
            Scene::CloseIgnoring,
        );
    }

    /// **셸을 닫은 직후 앱 종료 길을 불러도 그 셸의 자식이 남지 않는다.** 닫기가 뒤로 보낸 유예를 종료가 SIGKILL까지
    /// 마감하고 돌아온다 — 뒤 스레드는 앱과 함께 사라지므로. 자식은 종료의 판정이 다시 못 찾는 것(표식이 안
    /// 읽히고 트리도 끊긴 것)이라, 진행 중인 끝내기 목록만이 그것을 끝낼 수 있다.
    #[cfg(target_os = "macos")]
    #[test]
    fn the_exit_right_after_a_close_leaves_none_of_its_children() {
        on_the_pool_side("the_exit_right_after_a_close_leaves_none_of_its_children", Scene::CloseThenExit);
    }

    /// **새로고침은 풀을 그 자리에서 비우고 멈추지 않으며, 옛 셸의 표식 자식은 뒤에서 끝난다.** 옛 길은 셸 그룹에만
    /// 신호를 보내 제 세션으로 떨어진 자식에 안 닿았다.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_reload_empties_the_pool_at_once_and_ends_the_old_shells_children_behind() {
        on_the_pool_side(
            "a_reload_empties_the_pool_at_once_and_ends_the_old_shells_children_behind",
            Scene::Reload,
        );
    }

    /// **예외 목록에 걸린 이름의 자식은 셸을 닫아도 산다**(프로세스 결정 5 · 티켓 06). 셸에서 표식 자식을 둘 띄우고
    /// 하나를 예외 이름으로 부른다 — 둘 다 트리가 끊겨 표식으로만 잡히는 모양이라, 판정이 예외를 먼저 가르지
    /// 않으면 둘 다 끝난다. 목록은 설정 파일에서 온다: 셸 닫기가 끝낼 때마다 설정을 읽는 길까지 함께 잰다.
    ///
    /// 앵커: 다른 하나(예외가 아닌 표식 자식)는 끝난다 — 닫기가 아무것도 안 끝내도 「남았다」는 참이 된다.
    #[cfg(target_os = "macos")]
    #[test]
    fn closing_a_shell_leaves_the_child_named_on_the_exception_list() {
        on_the_pool_side(
            "closing_a_shell_leaves_the_child_named_on_the_exception_list",
            Scene::CloseKeeping,
        );
    }

    /// 풀 배선 검사의 바깥 — 검사 프로세스를 하나 더 띄워 그 안에서 장면을 돌린다. 안쪽이면 곧바로 장면을 돈다.
    ///
    /// **안쪽 프로세스를 따로 띄우는 이유.** `spawn`은 사용자의 로그인 셸을 rc째 띄운다. 이 프로세스의 env 그대로면
    /// 사용자의 rc가 돌고, 쳐 넣은 줄이 사용자의 히스토리에 남고, 상태 파일 자리가 진짜 데이터 루트다. 안쪽
    /// 프로세스는 임시 HOME · `ATELIER_HOME`과 `/bin/zsh`로 뜬다 — env를 바꾸는 일이 이 검사 하나에 갇혀, 나란히
    /// 도는 다른 검사의 env를 흔들지 않는다. 장면마다 임시 HOME이 따로다(나란히 돈다).
    ///
    /// **안쪽에는 표식을 물려주지 않는다.** 이 검사를 아틀리에 셸에서 돌리면 검사 프로세스가 그 셸의 표식을
    /// 물고 있다. 판정은 그것을 「앱이 물려받은 키」로 읽는다(`processes::inherited_key`) — 어디서 돌리든 같은
    /// 입력(물려받은 키 없음)이 되게 지운다.
    #[cfg(target_os = "macos")]
    fn on_the_pool_side(test: &str, scene: Scene) {
        use std::process::{Command, Stdio};

        if let Some(inner) = std::env::var_os(POOL_SIDE) {
            let inner = Scene::ALL.into_iter().find(|s| inner.to_str() == Some(s.name()));
            return pool_side(inner.expect("모르는 장면이다"));
        }
        // **한 번에 한 장면씩.** 안쪽의 세대는 셸을 처음 띄운 ms라, 나란히 뜬 안쪽 둘이 같은 세대를 받는다(실측 —
        // 넷을 나란히 돌리니 셋이 서로를 남의 것으로 봤다). 그러면 종료 장면이 형제 장면의 자식까지 끝낸다.
        static ONE_AT_A_TIME: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _turn = ONE_AT_A_TIME.lock().unwrap_or_else(|e| e.into_inner());
        let home = std::env::temp_dir()
            .join(format!("atelier-pty-pool-{}-{}", std::process::id(), scene.name()));
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(&home).expect("임시 HOME을 만든다");
        let (_crate, path) = module_path!().split_once("::").expect("모듈 경로에 크레이트가 있다");
        let name = format!("{path}::{test}");
        let mut inner = Command::new(crate::processes::testkit::exe())
            .args(["--exact", &name, "--nocapture", "--test-threads", "1"])
            .env(POOL_SIDE, scene.name())
            .env("HOME", &home)
            .env("ATELIER_HOME", home.join(".atelier"))
            .env("SHELL", "/bin/zsh")
            .env_remove("ZDOTDIR")
            .env_remove(crate::processes::SHELL_KEY_ENV)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("검사 프로세스를 하나 더 띄운다");

        // 안쪽은 스스로 끝난다(자식이 서기를 5초, 끝나기를 5초까지 기다린다). 그래도 멎으면 거둔다.
        let mut status = None;
        for _ in 0..3000 {
            status = inner.try_wait().expect("안쪽 검사를 기다린다");
            if status.is_some() {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        if status.is_none() {
            let _ = inner.kill();
        }
        let output = inner.wait_with_output().expect("안쪽 검사의 출력을 읽는다");
        let _ = std::fs::remove_dir_all(&home);

        assert!(
            status.is_some_and(|s| s.success()),
            "안쪽 검사({})가 실패했다 ({status:?})\n--- stdout\n{}\n--- stderr\n{}",
            scene.name(),
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    /// 풀 배선 검사의 안쪽 — 임시 HOME에서 셸을 띄우고, 셸에 한 줄을 쳐 표식 자식을 띄우고, 장면의 길로 셸을
    /// 거둔다.
    ///
    /// `( … & )`는 서브셸이 자식을 뒤로 띄우고 곧바로 끝나는 모양이다 — 자식의 부모가 launchd(1)로 바뀌어
    /// 트리가 끊긴다. 자식은 스스로 `setsid`한다. 자식이 쥐는 것은 이 셸의 표식뿐이다.
    #[cfg(target_os = "macos")]
    fn pool_side(scene: Scene) {
        use std::collections::HashMap;
        use std::sync::atomic::AtomicBool;
        use std::time::Instant;

        use tauri::ipc::Channel;

        use crate::processes::ending::{self, Group, GRACE};
        use crate::processes::snapshot::{identity_of, take, EnvScope};
        use crate::processes::testkit::{child_args, exe, holds_for, wait_until, CHILD_ROLE};

        let home = PathBuf::from(std::env::var_os("HOME").expect("임시 HOME"));
        let pool = std::sync::Arc::new(super::PtyPool::default());
        let spoke = std::sync::Arc::new(AtomicBool::new(false));
        let heard = std::sync::Arc::clone(&spoke);
        let frames = Channel::new(move |_| {
            heard.store(true, std::sync::atomic::Ordering::Relaxed);
            Ok(())
        });
        let spawned = super::spawn(&pool, Mode::Atelier, Some(home.display().to_string()), 80, 24, frames)
            .expect("셸을 띄운다");
        let key = super::shell_id(spawned.id);

        // 셸이 무언가(프롬프트)를 내보낸 뒤에 친다 — 읽기 전에 쓴 줄을 셸이 버릴 수 있다.
        wait_until(|| spoke.load(std::sync::atomic::Ordering::Relaxed));
        let shell_pid = pool.lock().get(&spawned.id).and_then(|shell| shell.pid);
        let args = child_args().join(" ");
        // 예외 장면의 자식이 부를 이름. 이 검사 프로세스의 pid를 붙여 이 기계의 어떤 실제 이름과도 안 겹치게 한다 —
        // 예외 목록은 안쪽의 데이터 루트(임시 `ATELIER_HOME`)의 설정 파일에만 적는다.
        let keep_name = format!("atelier-keep-{}", std::process::id());
        if scene == Scene::CloseKeeping {
            let mut settings = crate::settings::Settings::default();
            settings.terminal.process_exceptions = Some(vec![keep_name.clone()]);
            crate::settings::write(&atelier_core::data_root(), &settings).expect("임시 데이터 루트에 설정을 쓴다");
        }
        let line = match scene {
            // 표식이 안 읽히는 시스템 바이너리가 셸 밑에서 SIGTERM · SIGHUP을 무시한다. 셸이 끝나면 launchd 밑으로
            // 넘어가 트리도 끊긴다 — 종료의 판정은 그것을 다시 못 찾는다. 그 신원을 쥔 것은 닫기가 뒤로 보낸
            // 끝내기(진행 중인 끝내기)뿐이다. 표식 자식이었다면 종료가 이 세대의 표식으로 다시 찾아 이 장면이
            // 목록 없이도 초록이다(변형으로 확인).
            //
            // 무시는 `/bin/sh -c`로 건다. 대화형 zsh의 서브셸 `( trap '' TERM; exec … )`은 exec한 것에 무시를
            // 물려주지 않았다(실측 — SIGTERM에 곧바로 끝났다).
            Scene::CloseThenExit => "/bin/sh -c \"trap '' TERM HUP; exec /bin/sleep 30\" &\n".to_string(),
            // 같은 자식 둘. 뒤의 것은 zsh의 `ARGV0`로 argv[0]을 예외 이름으로 바꿔 부른다 — 커널 이름은 테스트
            // 바이너리 그대로라, 부른 이름으로 걸리는 길을 탄다(프로세스 스펙 S7).
            Scene::CloseKeeping => {
                let child = |argv0: &str| {
                    format!(
                        "( {CHILD_ROLE}={} {argv0}'{}' {args} </dev/null >/dev/null 2>&1 & )",
                        scene.role(),
                        exe().display()
                    )
                };
                format!("{}; {}\n", child(""), child(&format!("ARGV0={keep_name} ")))
            }
            _ => format!(
                "( {CHILD_ROLE}={} '{}' {args} </dev/null >/dev/null 2>&1 & )\n",
                scene.role(),
                exe().display()
            ),
        };
        super::write(&pool, spawned.id, &line).expect("셸에 한 줄을 친다");

        // 표식 자식: 트리가 끊겼고(부모 1) 제 세션을 열었다(pgid = pid). 시스템 바이너리: 셸의 자식인 `sleep`.
        // 예외 장면은 표식 자식이 둘이라 부른 이름으로 가른다 — 예외 이름으로 부른 것이 `kept`다.
        let invoked_keep = |p: &crate::processes::Proc| {
            p.argv0.as_deref().is_some_and(|argv0| argv0.rsplit('/').next() == Some(keep_name.as_str()))
        };
        let mut child = None;
        let mut kept = None;
        wait_until(|| {
            let procs = take(EnvScope::All).procs;
            let marked = |p: &&crate::processes::Proc| {
                p.shell_key.as_deref() == Some(key.as_str()) && p.ppid == 1 && p.pgid == p.id.pid
            };
            child = procs
                .iter()
                .find(|p| match scene {
                    Scene::CloseThenExit => shell_pid == Some(p.ppid) && p.name == "sleep",
                    _ => marked(p) && !invoked_keep(p),
                })
                .map(|p| p.id);
            kept = procs.iter().filter(marked).find(|p| invoked_keep(p)).map(|p| p.id);
            child.is_some() && (scene != Scene::CloseKeeping || kept.is_some())
        });

        // **거두기 전에 이 세대의 키가 이 검사의 것뿐인지 본다.** 닫기 · 새로고침은 이 기계의 표 전체를 판정해 그
        // 셸 키를 문 것을, 앱 종료는 이 세대의 키를 문 것 전부를 끝낸다 — 구현 세션도 사용자의 셸도 같은 표에
        // 있다. 세대는 이 프로세스가 셸을 처음 띄운 시각(ms)이라 실제 세대와 겹칠 일이 없지만, 겹치면 남을
        // 끝낸다. 그때는 판정 없이 이 셸 그룹만 거둔 뒤 멈춘다.
        let generation = format!("{}-", super::instance_prefix());
        let table = take(EnvScope::All);
        let parents: HashMap<u32, u32> = table.procs.iter().map(|p| (p.id.pid, p.ppid)).collect();
        let from_here = |mut pid: u32| {
            for _ in 0..table.procs.len() {
                if pid == std::process::id() {
                    return true;
                }
                match parents.get(&pid) {
                    Some(&ppid) if ppid > 1 => pid = ppid,
                    _ => return false,
                }
            }
            false
        };
        let foreign: Vec<u32> = table
            .procs
            .iter()
            .filter(|p| p.shell_key.as_deref().is_some_and(|k| k.starts_with(&generation)))
            .filter(|p| Some(p.id) != child && Some(p.id) != kept && !from_here(p.id.pid))
            .map(|p| p.id.pid)
            .collect();
        if !foreign.is_empty() {
            let shells: Vec<super::Shell> = pool.lock().drain().map(|(_, shell)| shell).collect();
            let groups: Vec<Group> = shells
                .iter()
                .filter_map(|shell| Some(Group { pgid: shell.pid?, leader: shell.process }))
                .collect();
            let started = ending::start(&[], &groups);
            drop(shells);
            let _ = started.finish();
            panic!("이 검사의 세대({generation}…)를 이 검사의 트리 밖에서 문 프로세스가 있다 — 거두지 않았다: {foreign:?}");
        }

        let alive = || child.is_some_and(|id| identity_of(id.pid) == Some(id));
        let kept_alive = || kept.is_some_and(|id| identity_of(id.pid) == Some(id));
        let began = Instant::now();
        match scene {
            Scene::Close | Scene::CloseIgnoring | Scene::CloseThenExit | Scene::CloseKeeping => {
                super::kill(&pool, spawned.id).expect("셸을 닫는다");
            }
            Scene::Reload => super::end_for_reload(&pool),
        }
        let closed = began.elapsed();
        let emptied = pool.lock().is_empty();
        if scene == Scene::CloseThenExit {
            let _ = super::end_for_exit(&pool);
        }
        let returned = began.elapsed();
        let alive_on_return = alive();
        let ended = wait_until(|| !alive());
        let ended_after = began.elapsed();
        // 예외 자식에 신호가 갔다면 앵커와 같은 순간(SIGTERM)이다 — 앵커가 끝난 뒤로도 한동안 살아 있는지 본다.
        let survived = scene == Scene::CloseKeeping && holds_for(Duration::from_millis(500), kept_alive);

        // **거두는 것이 단언보다 먼저다.** 이 검사가 띄운 자식이고, 신원을 방금 다시 봤다.
        if let Some(id) = child.filter(|_| alive()) {
            unsafe { libc::kill(id.pid as i32, libc::SIGKILL) };
        }
        if let Some(id) = kept.filter(|_| kept_alive()) {
            unsafe { libc::kill(id.pid as i32, libc::SIGKILL) };
        }

        assert!(child.is_some(), "셸에서 띄운 자식이 5초 안에 서지 않았다");
        assert!(emptied, "셸을 거두는 길이 돌아왔는데 풀에 셸이 남았다");
        assert!(ended, "셸을 거뒀는데 그 셸의 표식을 문 자식이 5초가 지나도 살아 있다");
        if scene == Scene::Close {
            return;
        }
        if scene == Scene::CloseKeeping {
            assert!(kept.is_some(), "예외 이름({keep_name})으로 부른 자식이 5초 안에 서지 않았다");
            assert!(survived, "셸을 닫았더니 예외 목록에 적은 이름({keep_name})의 자식까지 끝났다");
            return;
        }
        assert!(closed < GRACE / 2, "{}: 거두는 길이 유예를 기다렸다 ({closed:?})", scene.name());
        if scene == Scene::CloseThenExit {
            assert!(!alive_on_return, "종료 길이 돌아왔는데 방금 닫은 셸의 자식이 살아 있다 ({returned:?})");
        } else {
            assert!(alive_on_return, "SIGTERM을 무시하는 자식이 거두는 길이 돌아온 순간 이미 없다 — 유예가 안 흘렀다");
            assert!(ended_after >= GRACE, "SIGTERM을 무시하는 자식이 유예 전에 끝났다 ({ended_after:?})");
        }
    }
}
