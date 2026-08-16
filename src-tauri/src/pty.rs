//! 앱 안 터미널의 PTY 층. 셸을 띄우고, 바이트를 나르고, pty 세션째 거둔다.
//!
//! `watcher.rs`와 같은 자리에 사는 이유도 같다 — 스레드를 들고 사는 데스크톱 전용 배선이고,
//! `atelier-core`는 CLI·MCP와 공유하는 도메인만 담는다. PTY는 MCP가 쓸 일이 없다.
//!
//! 이 파일에는 `#[tauri::command]`가 하나도 없다. 명령은 `commands.rs`에 얇은 위임으로 산다 —
//! `src/tauri-commands.test.ts`가 등록 이름을 `lib.rs`의 `generate_handler!`에서 모으고 그
//! 이름이 `commands.rs`에 `pub async fn`으로 있는지를 문자열로 보기 때문이다. 여기 두면
//! 그 그물이 조용히 꺼진다.

use std::collections::HashMap;
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

    pool.lock().insert(id, Shell { pid, master: pair.master, writer });
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
    Ok(cmd)
}

fn executable(path: &Path) -> bool {
    let Ok(c) = CString::new(path.as_os_str().as_bytes()) else {
        return false;
    };
    unsafe { libc::access(c.as_ptr(), libc::X_OK) == 0 }
}
