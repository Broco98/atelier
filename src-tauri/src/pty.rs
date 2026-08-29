//! 앱 안 터미널의 PTY 층. 셸을 띄우고, 바이트를 나르고, pty 세션째 거둔다.
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
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter};

/// SIGHUP을 보낸 뒤 SIGKILL까지 주는 유예. 진짜 터미널이 닫힐 때 셸과 그 잡들이 정리할
/// 시간이고, 협조하지 않는 상대를 기다려 주는 시간이기도 하다.
const GRACE: Duration = Duration::from_millis(300);

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
}

#[derive(Default)]
pub struct PtyPool {
    shells: Mutex<HashMap<u32, Shell>>,
    next_id: AtomicU32,
}

impl PtyPool {
    /// 잠금이 오염됐다는 것은 다른 스레드가 패닉했다는 뜻이다. 여기서 다시 패닉하면 그
    /// 하나가 앱 전체로 번진다 — 안을 꺼내 이어 간다.
    fn lock(&self) -> MutexGuard<'_, HashMap<u32, Shell>> {
        self.shells.lock().unwrap_or_else(|e| e.into_inner())
    }
}

pub fn spawn(
    pool: &Arc<PtyPool>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    on_frame: Channel<InvokeResponseBody>,
) -> Result<PtySpawned, String> {
    let dir = resolve_cwd(cwd)?;
    let builder = shell_builder(&dir)?;
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
    let id = pool.next_id.fetch_add(1, Ordering::Relaxed);

    // **스레드보다 먼저 풀에 앉힌다.** 아래 스레드는 끝나며 자기 자리를 치우는데
    // (`owner.lock().remove`), 그 치움이 등록보다 **먼저** 돌 수 있다 — `$SHELL`이 즉시
    // 끝나면 그렇다. 그러면 등록이 죽은 셸을 되살리고, 그 pid는 이미 회수돼 재사용
    // 가능한 상태다. 다음 `reap_all`이 그 자리에 앉은 남의 프로세스 그룹을 쏜다 —
    // 아래 스레드의 주석이 막으려는 바로 그것이다. 순서를 이렇게 두면 그 창이 닫힌다:
    // 치움은 언제 돌아도 `remove`일 뿐이다.
    pool.lock().insert(id, Shell { pid, master: pair.master, writer });

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
/// **물어봐야** 알고, `tcgetpgrp`는 syscall 하나라 셸 8개(결정 30의 상한)면 초당 8회다.
const POLL: Duration = Duration::from_secs(1);

/// 한 회차에 잰 것 전부 — pty id마다 「지금 도는 것」이다. 잰 값과 **직전에 쏜 값**이 같은
/// 모양이라야 둘을 그대로 뺄 수 있어서 이름을 붙였다. `HashMap`이 아니라 `BTreeMap`인 것은
/// 나가는 순서가 회차마다 흔들리지 않게 하기 위해서다.
type Running = BTreeMap<u32, Option<String>>;

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
/// **잠금 안에서 풀에 남아 있는 셸만 읽는다 — 그것이 `reap`의 순서를 안 건드리는 방법이다.**
/// 포그라운드 그룹은 master fd가 살아 있어야 읽는데, `kill`과 `reap_all`은 풀에서 **먼저
/// 빼고**(잠금 안에서) 그 다음에 거둔다. 그러니 우리가 잠금을 쥐고 있는 동안 그 셸은 아직
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
                running_command(pid, foreground, process_name(foreground))
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

pub fn kill(pool: &PtyPool, id: u32) -> Result<(), String> {
    let shell = pool.lock().remove(&id).ok_or_else(|| gone(id))?;
    reap(vec![shell]);
    Ok(())
}

/// 앱이 닫힐 때(결정 19)와 웹뷰가 다시 뜰 때(결정 18) 전부 거둔다.
pub fn reap_all(pool: &PtyPool) {
    let shells: Vec<Shell> = pool.lock().drain().map(|(_, shell)| shell).collect();
    reap(shells);
}

/// pty 세션들을 거둔다. **순서가 고정이다.**
///
/// 포그라운드 그룹은 `tcgetpgrp(master)`로만 알 수 있는데 master를 떨구면 그 fd가 사라진다.
/// 그러니 (1) 먼저 그룹을 다 읽고 → (2) SIGHUP → (3) 떨구고 → (4) 유예 → (5) 남은 것에
/// SIGKILL 순이어야 한다.
///
/// **(3)에 기대지 않는다.** 리더 스레드가 `try_clone_reader()`로 dup한 master fd를 쥐고
/// 있어서, 여기서 떨구는 것만으로는 커널 hangup이 걸리지 않는다. 걸리더라도 소용없다 —
/// `trap '' HUP TERM`을 건 셸에 대고 재 보니 (2)·(3)이 **전부 통과**했고 (5)만이 끝냈다.
///
/// 유예를 셸마다 따로 주면 여덟 개에 2.4초가 되므로 한 번만 기다린다. 앱 종료 경로는
/// **동기**여야 해서(프로세스가 끝나면 스레드도 함께 사라진다) 이 시간이 그대로 종료 지연이다.
fn reap(shells: Vec<Shell>) {
    if shells.is_empty() {
        return;
    }
    let groups: Vec<i32> = shells.iter().flat_map(groups_of).collect();
    for pgid in &groups {
        signal(*pgid, libc::SIGHUP);
    }
    // writer의 Drop이 개행+^D를 쓰고, master의 Drop이 커널 hangup을 건다.
    drop(shells);
    std::thread::sleep(GRACE);
    // HUP을 무시하는 상대에게는 위 셋이 **전부 통과한다** — `trap '' HUP TERM`을 건 셸에
    // 대고 재 보니 killpg(셸)·killpg(포그라운드)·master 떨구기 셋 다 아무도 못 죽였고
    // SIGKILL만이 끝냈다. 이 단계는 예비가 아니라 실제 방어선이다.
    for pgid in &groups {
        if alive(*pgid) {
            signal(*pgid, libc::SIGKILL);
        }
    }
    // SIGKILL은 잡히지 않으므로 여기까지 살아 있으면 우리가 못 건드리는 것이다(권한·좀비).
    // 조용히 넘기면 고아를 남긴 채 「거뒀다」고 믿게 된다.
    for pgid in &groups {
        if alive(*pgid) {
            eprintln!("atelier: pty process group {pgid} survived SIGKILL");
        }
    }
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

/// `killpg`에 pgid를 그대로 믿고 넘기면 두 가지로 위험하다(둘 다 실측):
/// `0`은 **앱 자신의 프로세스 그룹**을 쏘고, 음수는 macOS에서 `kill(-N)`이 되어 그룹이
/// 아니라 pid `N` 하나를 죽이면서 반환값은 0을 준다.
fn signal(pgid: i32, sig: i32) {
    if pgid <= 1 {
        return;
    }
    unsafe {
        libc::killpg(pgid, sig);
    }
}

fn alive(pgid: i32) -> bool {
    if pgid <= 1 {
        return false;
    }
    if unsafe { libc::killpg(pgid, 0) } == 0 {
        return true;
    }
    // 좀비만 남은 그룹은 ESRCH가 아니라 EPERM을 낸다(실측). 살아있음으로 세는 것이 맞고,
    // 여기서 폴링하지 않으므로 영원히 기다리는 일로는 이어지지 않는다 — 좀비는 리더
    // 스레드의 `child.wait()`가 거둔다.
    std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
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

fn resolve_cwd(cwd: Option<String>) -> Result<PathBuf, String> {
    // 프런트가 `"~/.atelier"`를 박으면 `ATELIER_HOME` 오버라이드가 죽는다. 데이터 루트가
    // 어디인지는 atelier-core만 안다.
    let dir = match cwd {
        None => atelier_core::data_root(),
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

fn shell_builder(dir: &Path) -> Result<CommandBuilder, String> {
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
    use std::time::Duration;

    use portable_pty::{native_pty_system, CommandBuilder, PtySize};

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
        let src = include_str!("pty.rs");
        let body = src
            .split_once("pub fn command_running(")
            .expect("command_running이 있다")
            .1
            .split_once("\nfn ")
            .expect("다음 함수가 있다")
            .0;

        // **잘라 낸 자리가 제 자신을 삼키면 안 된다.** 아래 두 `assert`가 찾는 리터럴은 그
        // `assert`의 문자열로도 이 파일에 있다 — 슬라이스가 테스트 모듈까지 흘러가면 이
        // 검사는 제 문장을 읽고 스스로 통과한다. 위 두 `expect`가 표식이 사라진 경우를
        // 막고, 이 줄이 표식은 있는데 자리가 흘러간 경우를 막는다.
        assert!(
            !body.contains("mod tests"),
            "잘라 낸 자리가 테스트 모듈까지 삼켰다 — 이 검사가 제 문자열을 읽고 통과한다"
        );

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
        let src = include_str!("pty.rs");
        let spawn_fn = src
            .split_once("pub fn spawn(")
            .expect("spawn이 있다")
            .1
            .split_once("\npub fn ")
            .expect("다음 함수가 있다")
            .0;

        let insert = spawn_fn.find("pool.lock().insert(").expect("풀에 앉히는 줄이 있다");
        let thread = spawn_fn.find("std::thread::spawn(").expect("읽기 스레드가 있다");

        assert!(
            insert < thread,
            "등록({insert})이 스레드({thread})보다 뒤에 있다 — 셸이 즉시 끝나면 \
             스레드의 remove가 먼저 돌아 죽은 셸이 되살아나고, 재사용된 pgid를 쏘게 된다"
        );
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
        super::signal(child_pid, libc::SIGKILL);
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
}
