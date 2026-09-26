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
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use atelier_core::Mode;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter};

use crate::processes::cleanup_log::{self, Aimed, CloseReason, Reason};
use crate::processes::ending::{Claim, Group, InFlight, Outcome};
use crate::processes::instances::{self, Place, Record};
use crate::processes::metrics::{self, CpuMeter};
use crate::processes::screen::{self, Measured, PoolShell, ScreenSnapshot};
use crate::processes::snapshot::{self, EnvScope};
use crate::processes::summary::{self, Background, Summary};
use crate::processes::verdict::{self, InstanceRecord, Inputs, Occasion, ShellEntry, Verdict};
use crate::processes::{procargs, Identity, Proc, Snapshot, SHELL_KEY_ENV};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtySpawned {
    pub id: u32,
    /// 셸 키 — `<세대>-<PTY 번호>`, 그 셸 env의 `ATELIER_SHELL`과 같은 값이다(프로세스 스펙 S34 · 티켓 23). **세대는 여기에만
    /// 있어서 싣는다** — 프런트가 번호만 알면 옛 실행의 키(알림 클릭)와 이번 실행의 같은 번호 셸을 못 가른다. 프런트는 이
    /// 값으로 셸을 가리킨다(방금 부른 셸로).
    pub shell_key: String,
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
    /// 첫 사람 입력의 시각(에포크 µs). 프런트가 사람 입력을 처음 본 순간 한 번 알린다(`note_first_input`).
    first_input_us: Option<u64>,
    /// 셸이 **마지막으로 무언가를 찍은 때**(에포크 ms). 읽기 스레드가 조각을 받을 때마다 적고, 띄운 순간에 한 번 적는다.
    /// `Processes`의 「조용함」 경과가 이 값에서 잰다(티켓 27) — 사람이 친 글자의 메아리도, 끝난 명령 뒤의 프롬프트도 출력이라
    /// 이 값 뒤로는 셸에 아무 일이 없었다. 읽기 스레드와 나눠 쥐어 `Arc`다. 셸 상태(도는 중 · 확인할 것)와는 상관없다 — 프런트의
    /// 상태 축은 출력이 멎은 시간으로 아무것도 안 만든다(terminal-activity-signal 결정 2). 이것은 화면이 적는 경과의 재료일 뿐이다.
    last_output: Arc<AtomicU64>,
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
    /// 훅 처리기가 순서 가드로 쥐는 이 셸의 잠금 파일(`shells::lock_path`, 프로세스 스펙 S27). 상태 파일과 같은 까닭으로 경로를
    /// 들고 다닌다.
    lock_file: PathBuf,
}

/// **셸이 사라지면 그 셸이 남긴 말도 사라진다.** 안 지우면 닫힌 셸이 사이드바에서 영영
/// 사람을 부르고, 다음 실행이 같은 PTY 번호를 쓸 때 그 값을 새 셸이 뒤집어쓴다.
///
/// **`Drop`인 것이 요점이다.** 셸이 풀에서 빠지는 자리가 셋이다 — 사용자가 `exit`를 쳐서
/// 셸이 스스로 끝날 때(`exited`), `×`로 죽일 때(`kill`), 앱이 닫히거나 웹뷰가 다시 뜰
/// 때(`end_for_exit` · `end_for_reload`). 셋 다 결국 이 값을 떨구므로 여기 한 자리에 두면 빠지는 길이 하나 더
/// 생겨도 따라온다. 세 곳에 손으로 적으면 언젠가 한 곳이 빠지고, 그때 나는 것은 조용히
/// 남는 앰버 점 하나다.
///
/// **잠금 파일도 함께 걷는다**(티켓 19). 셸마다 하나씩 쌓이는 빈 파일이라, 안 걷으면 이 실행 동안 연 셸 수만큼 남는다(다음
/// 실행의 정리가 걷기는 한다). 그 셸의 처리기가 아직 잠금을 쥐고 도는 중이어도 지워진 파일의 잠금을 끝까지 쥘 뿐이다. 늦게 끝난
/// 처리기가 두 파일을 다시 만들 수는 있다 — 옛 처리기의 상태 파일에도 있던 빈틈이고, 셸 번호는 한 실행 안에서 다시 안 쓰이며
/// 다음 실행의 정리가 걷는다.
impl Drop for Shell {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.state_file);
        let _ = std::fs::remove_file(&self.lock_file);
    }
}

#[derive(Default)]
pub struct PtyPool {
    shells: Mutex<HashMap<u32, Shell>>,
    next_id: AtomicU32,
    /// 진행 중인 끝내기 — 이 풀에서 뺀 셸의 끝내기가 뒤 스레드에서 도는 동안 여기 오른다(프로세스 스펙 S5).
    /// 앱 종료가 마감한다. 풀에 두는 것은 셸을 빼는 모든 길이 풀을 쥐고 있어서다.
    endings: Arc<InFlight>,
    /// 이 실행의 인스턴스 기록 — 셸 키 목록(프로세스 결정 6 · 프로세스 스펙 S52). 셸 키를 올리고 내리는 자리가 둘 다 풀을
    /// 쥔다: 셸 띄우기와 뒤로 보낸 끝내기(셸 닫기 · 새로고침 · 셸 스스로 끝남 — 스레드에 넘기려고 `Arc`다). 앱은 setup에서 연다(`open_record`).
    /// 기본값은 안 연 기록이라, 검사가 세우는 풀은 아무 파일도 안 쓴다.
    record: Arc<Record>,
    /// 앱이 사람 손 없이 끝낸 것을 프런트에 알리는 자리 — 셸이 스스로 끝나며 그 셸에서 띄운 것을 끝냈을 때(티켓 13). 앱은
    /// setup에서 이벤트를 쏘는 함수를 건다(`announce_ends`). 기본값은 빈 자리라, 검사가 세우는 풀은 아무 데도 안 쏜다 —
    /// 풀 배선 장면은 제 함수를 걸어 받은 알림을 잰다.
    announcer: OnceLock<Box<dyn Fn(Ended) + Send + Sync>>,
    /// `Processes` 화면 스냅샷의 앞 표본 — CPU%를 두 표본의 차이로 짓는다(프로세스 스펙 S37 · 티켓 28). 화면이 2초마다 부르는
    /// `screen`만 쓴다. 풀에 두는 것은 그 함수가 풀 하나만 받기 때문이고, 박자가 다른 읽기(배경 표본 — 요약 카드의 CPU를 짓게 되면,
    /// 30)는 제 것을 따로 쥔다 — 한 앞 표본을 나눠 쓰면 두 박자가 섞인다. 29의 배경 표본은 CPU를 안 짓는다.
    screen_cpu: Mutex<CpuMeter>,
    /// 배경 표본의 마지막 요약(티켓 29) — nav 메타가 10초마다 묻는다. 앱은 setup에서 표본 스레드를 건다(`sample_in_background`).
    /// 기본값은 빈 자리라, 검사가 세우는 풀에서는 요약을 물으면 그 자리에서 한 장을 모은다(`summary`).
    background: Background,
}

impl PtyPool {
    /// 잠금이 오염됐다는 것은 다른 스레드가 패닉했다는 뜻이다. 여기서 다시 패닉하면 그
    /// 하나가 앱 전체로 번진다 — 안을 꺼내 이어 간다.
    fn lock(&self) -> MutexGuard<'_, HashMap<u32, Shell>> {
        self.shells.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// 화면 스냅샷의 앞 표본. 잠금이 오염됐으면 안을 꺼내 이어 간다(`lock`과 같다) — 잃어도 CPU 칸이 한 박자 「—」일 뿐이다.
    fn screen_cpu(&self) -> MutexGuard<'_, CpuMeter> {
        self.screen_cpu.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// 알리는 함수를 한 번 건다. 두 번째는 버린다 — 앱에서는 setup 한 자리만 부른다.
    fn announce_with(&self, send: impl Fn(Ended) + Send + Sync + 'static) {
        if self.announcer.set(Box::new(send)).is_err() {
            eprintln!("atelier: the ending announcer was already set");
        }
    }

    /// 건 함수가 있으면 알린다. 없으면(검사의 풀, setup 전) 조용히 넘어간다 — 끝내기와 기록은 이미 끝났다.
    fn announce(&self, ended: Ended) {
        if let Some(send) = self.announcer.get() {
            send(ended);
        }
    }
}

/// **앱이 사람 손 없이 끝낸 것의 알림**(프로세스 스펙 S49 · P4 · 티켓 13). 프런트의 `PROCESSES_ENDED_EVENT`와 **문자열로만**
/// 이어진다 — 어긋나면 셸이 스스로 끝나며 dev 서버를 끝내도 화면은 조용하다. 그래서 `src/components/shell/processes-ended.test.ts`가
/// 이 선언을 읽어 견준다(선언 모양을 바꾸면 거기가 던진다).
pub const ENDED_EVENT: &str = "processes:ended";

/// 그 알림이 싣는 것 — 까닭, 셸(pty id), 끝낸 수. **owner는 없다.** Rust 풀은 셸의 주인을 모르고, 프런트도 이 셸 id로
/// 레지스트리를 찾지 않는다(티켓 13 「스펙과 다른 점」) — 종료 프레임을 받은 칸은 그 pty id를 곧바로 지워, 이 알림이 올 때는
/// 늘 못 찾는다. 문구에 owner가 없으니 찾을 까닭도 없다.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct Ended {
    reason: Reason,
    shell_id: u32,
    /// 끝낸 수 — 도우미와 이미 없음 · 못 끝냄은 빠진다(`cleanup_log::ended_count`). 0이면 알리지 않는다.
    count: usize,
}

/// 앱이 사람 손 없이 끝낸 것을 프런트에 알리게 한다 — **setup에서 한 번**(티켓 13). 셸은 프런트가 뜬 뒤에 띄우므로 셸이 스스로
/// 끝나는 것도 그 뒤다 — setup이 먼저 선다. 배선은 `watch_running`과 같은 길이다: 스레드가 emit하고 프런트가 `listen`으로 받는다.
pub fn announce_ends(app: AppHandle, pool: &PtyPool) {
    pool.announce_with(move |ended| {
        let _ = app.emit(ENDED_EVENT, ended);
    });
}

/// 이 실행의 인스턴스 기록을 연다 — **앱이 뜰 때 한 번**, 시작 정리(티켓 10)보다 먼저(프로세스 스펙 S52). 루트는
/// `atelier_core::data_root()`를 부르는 쪽이 준다(`ATELIER_HOME`). 앱의 신원을 못 읽으면 열지 않는다
/// (`Place::this_app` — 리눅스가 늘 그렇다).
pub fn open_record(pool: &PtyPool, root: &Path, version: &str) {
    match Place::this_app(root, instance_prefix(), version) {
        Some(place) => pool.record.open(place),
        None => eprintln!("atelier: could not read this app's identity — the instance record stays unwritten"),
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
    // **셸 키를 기록에 먼저 올린다 — 자식을 띄우기 전이다**(프로세스 스펙 S52). 셸의 rc는 뜨자마자 자손을 띄운다(p10k의
    // `gitstatusd`). 그 순간 키가 기록에 없으면 다른 실행의 정리가 그것을 「살아 있는 실행의, 목록에 없는 셸」의 것으로
    // 읽어 확정 고아로 끝낸다. 띄우기에 실패하면 내린다 — 그 키의 셸은 끝내 없다.
    pool.record.raise(&shell_id);
    let Launched { shell_name, master, mut child, mut reader, writer } =
        match launch(mode, &dir, &shell_id, cols, rows) {
            Ok(launched) => launched,
            Err(e) => {
                pool.record.lower([shell_id.as_str()]);
                return Err(e);
            }
        };
    let pid = child.process_id();
    let process = pid.and_then(snapshot::identity_of);

    // **스레드보다 먼저 풀에 앉힌다.** 아래 스레드는 끝나며 자기 자리를 치우는데
    // (`owner.lock().remove`), 그 치움이 등록보다 **먼저** 돌 수 있다 — `$SHELL`이 즉시
    // 끝나면 그렇다. 그러면 등록이 죽은 셸을 되살리고, 그 pid는 이미 회수돼 재사용
    // 가능한 상태다. 다음 회수가 그 자리에 앉은 남의 프로세스 그룹을 쏜다 —
    // 아래 스레드의 주석이 막으려는 바로 그것이다. 순서를 이렇게 두면 그 창이 닫힌다:
    // 치움은 언제 돌아도 `remove`일 뿐이다.
    // 상태 파일과 잠금 파일의 자리를 여기서 정해 셸과 함께 들려 보낸다 — 거두는 자리(`Drop`)가
    // 루트를 다시 계산하지 않게.
    let root = atelier_core::data_root();
    let state_file = crate::shells::state_path(&root, &shell_id);
    let lock_file = crate::shells::lock_path(&root, &shell_id);
    // 답에 실을 셸 키는 풀에 앉히는 것과 **같은 값**이다 — 따로 다시 지으면 env에 심은 표식과 프런트가 쥔 키가 갈릴 자리가 생긴다.
    let shell_key = shell_id.clone();
    // 마지막 출력 시각의 첫 값은 **띄운 순간**이다 — 앉힌 뒤 첫 조각 전에 화면 스냅샷이 읽어도 1970년부터 조용하다고 안 읽힌다.
    let last_output = Arc::new(AtomicU64::new(now_ms()));
    let stamps = Arc::clone(&last_output);
    pool.lock().insert(
        id,
        Shell { pid, key: shell_id, process, first_input_us: None, last_output, master, writer, state_file, lock_file },
    );

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
                // **보내기 전에 시각을 적는다**(티켓 27) — 채널이 닫혀 끊는 마지막 조각도 셸이 찍은 것이다.
                Ok(n) => {
                    stamps.store(now_ms(), Ordering::Relaxed);
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
        // 셸이 끝났다 — 자리를 치우고, 그 셸에서 띄운 것이 남았으면 끝낸다. 다른 길(×, 새로고침, 앱 종료)이 먼저 거뒀으면
        // 아무것도 안 한다. 끝내기는 새 스레드에서 돌아 이 스레드는 곧바로 끝난다.
        exited(&owner, id);
        // 채널이 여기서 떨어지며 JS 쪽 콜백이 정리된다.
    });

    Ok(PtySpawned { id, shell_key, shell_name })
}

/// 셸 프로세스와 그 입출력 — `spawn`이 실패할 수 있는 몫에서 나온 것.
struct Launched {
    shell_name: String,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
    reader: Box<dyn Read + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
}

/// 셸을 띄우고 입출력을 연다 — `spawn`에서 **실패할 수 있는 몫 전부**다. 한 함수로 모은 것은 `spawn`이 실패 하나로
/// 올린 셸 키를 내리게 하려는 것이다(프로세스 스펙 S52). 몫마다 내리는 줄을 적으면 실패하는 길이 하나 늘 때 빠진다.
fn launch(mode: Mode, dir: &Path, shell_id: &str, cols: u16, rows: u16) -> Result<Launched, String> {
    let builder = shell_builder(mode, dir, shell_id)?;
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
    let reader = match pair.master.try_clone_reader() {
        Ok(reader) => reader,
        Err(e) => return Err(abandon(&mut child, e)),
    };
    let writer = match pair.master.take_writer() {
        Ok(writer) => Arc::new(Mutex::new(writer)),
        Err(e) => return Err(abandon(&mut child, e)),
    };
    Ok(Launched { shell_name, master: pair.master, child, reader, writer })
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

/// 이 셸의 **첫 사람 입력**을 적는다(프로세스 결정 7 · 프로세스 스펙 P1). 이미 있으면 그대로 둔다 — 첫 것만 남는다.
///
/// 셸 도우미(p10k의 `gitstatusd` 등)는 「사람이 처음 입력하기 전에 태어난 자손」이다. 그 기준을 여기 쥐어 두고,
/// 판정은 셸 목록의 칸(`ShellEntry::first_input_us`)으로 읽는다. 무엇이 사람 입력인지는 프런트가 DOM 사건으로 가른다 —
/// 셸로 가는 바이트는 사람이 친 것과 xterm의 응답(커서 위치 등)을 가르지 않아 여기서는 못 본다.
///
/// **시각은 프런트가 잰 값이다(에포크 ms) — 이 명령을 받은 순간이 아니다.** 사람이 붙여넣은 명령줄은 이 알림과
/// 바이트(`pty_write`)가 따로 오는데, 받은 순간으로 적으면 그 명령이 이 알림보다 먼저 떠 도우미로 읽힐 수 있다.
/// 프런트의 시각은 바이트가 나가기 전이라 사람이 띄운 것은 늘 그 뒤에 태어난다. 둘 다 같은 벽시계라 자손의 커널
/// 시작 시각(µs)과 견줄 수 있다.
pub fn note_first_input(pool: &PtyPool, id: u32, at_ms: u64) -> Result<(), String> {
    let mut shells = pool.lock();
    let shell = shells.get_mut(&id).ok_or_else(|| gone(id))?;
    shell.first_input_us.get_or_insert(at_ms.saturating_mul(1000));
    Ok(())
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

/// 셸을 닫기 전에 묻는 답 — **명령이 도는가**와 **함께 끝날 프로세스 수**(프로세스 결정 3 · 프로세스 스펙 S55).
///
/// 확인 창이 이 둘로 묻는다: 명령이 돌면 지금 문구(ux-papercuts 결정 105) 아래에 수를 더하고, 명령 없이 자손만
/// 있으면 그 수로 묻고, 둘 다 없으면 안 묻는다. ux-papercuts 결정 92는 「foreground가 셸이 아닐 때만 묻는다」였고,
/// 프로세스 결정 3이 「foreground가 셸이어도 자손이 있으면 묻는다」로 넓혔다.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CloseCheck {
    /// 명령이 도는가 — 터미널을 쥔 그룹이 셸 자신이 아닌가(`command_runs`).
    pub command: bool,
    /// 확인 창이 말할 「이 셸에서 띄운 프로세스」 수. 셸 도우미 · 예외 · 명령의 foreground 그룹은 빠진다
    /// (`verdict::close_count`).
    pub descendants: usize,
}

/// 물은 셸 하나가 **그 순간** 쥔 것 — 풀 잠금 안에서 읽는다(`asked_of`).
#[derive(Debug, Clone)]
struct Asked {
    entry: ShellEntry,
    /// 셸의 pid — 그대로 셸의 프로세스 그룹이다(`Shell::pid`).
    pid: u32,
    /// 지금 터미널을 쥔 그룹(`tcgetpgrp`).
    foreground: i32,
}

/// 셸 하나의 닫기 전 물음(`pty_command_running`). 셸 탭의 ×, ⌘W, 셸 메뉴의 닫기가 닫기 직전에 한 번 부른다.
///
/// **배치 물음과 같은 길이다** — 셸 하나를 배치로 묻는다. 셸 하나를 닫을 때와 종료 · 아카이브 확인 창이 셀 때가
/// 규칙을 따로 들면, 같은 셸이 닫기 창에서는 조용하고 종료 창에서는 무언가 도는 셸이 된다.
///
/// **`Err`이 실제로 온다**: 이미 끝난 셸, tcgetpgrp 실패, pid를 못 받은 셸. 프런트는 그때 묻지 않고 닫는다 —
/// 모르는 것을 이유로 사람이 고른 닫기를 막지 않는다.
///
/// **이 자리는 여전히 닫기 직전 한 번뿐이다.** 한때 여기 「값이 매 순간 바뀌므로 구독하거나 상태에 얹지
/// 않는다」고 적혀 있었는데, `adr-04`가 그것을 뒤집었다: 아래 `watch_running`이 명령 판정을 1초마다 재서 프런트
/// 상태에 얹는다. 그래도 닫기 판정은 **그 순간의 진실**이어야 하고 구독값은 최대 1초 낡았다. 게다가 이제 스냅샷을
/// 한 장 찍는다 — 1초마다 셸마다 찍을 값이 아니다.
pub fn command_running(pool: &PtyPool, id: u32) -> Result<CloseCheck, String> {
    close_checks(pool, &[id]).pop().unwrap_or_else(|| Err(gone(id)))
}

/// 여러 셸의 닫기 전 물음을 **스냅샷 한 장으로** 답한다(`pty_close_checks`, 티켓 08). 결과는 `ids`의 순서 그대로다.
///
/// 종료 확인 창과 아카이브 확인 창이 셸 여럿의 수를 센다. 셸마다 닫기 전 물음을 부르면 스냅샷을 셸 수만큼 찍는다 —
/// 셸 20개면 20장이다(프로세스 스펙 S2의 목표는 한 장에 20ms 이하). 그래서 한 장을 찍어 한 번 판정하고 셸마다 센다.
///
/// 순서는 셸 닫기(`end`)와 같다: 물은 셸들의 시작 시각으로 env를 읽을 범위를 정하고(S3), 스냅샷을 찍은 **뒤에**
/// 셸 목록을 읽는다(S52). 스냅샷과 판정은 기다리는 일이라 `commands.rs`가 blocking 풀에서 부른다.
pub fn close_checks(pool: &PtyPool, ids: &[u32]) -> Vec<Result<CloseCheck, String>> {
    let born: Vec<Option<Identity>> = {
        let shells = pool.lock();
        ids.iter().filter_map(|id| shells.get(id)).map(|shell| shell.process).collect()
    };
    // 물은 셸이 풀에 하나도 없으면 찍을 까닭이 없다.
    if born.is_empty() {
        return ids.iter().map(|id| Err(gone(*id))).collect();
    }
    let snapshot = snapshot::take(env_scope(born));
    let (live, asked): (Vec<ShellEntry>, Vec<Result<Asked, String>>) = {
        let shells = pool.lock();
        (shells.values().map(Shell::entry).collect(), ids.iter().map(|id| asked_of(&shells, *id)).collect())
    };
    let records = pool.record.records();
    let exceptions = exceptions();
    checks_on(
        &Inputs {
            snapshot: &snapshot,
            generation: instance_prefix(),
            shells: &live,
            ending: &[],
            instances: &records,
            exceptions: &exceptions,
            app_pid: std::process::id(),
            inherited_key: crate::processes::inherited_key(),
            occasion: Occasion::Normal,
        },
        asked,
    )
}

/// 판정 한 번으로 물은 셸마다 답한다 — 위 함수에서 스냅샷을 찍고 셸을 읽는 일만 뺀 나머지다. 값만 받으므로 셸
/// 셋을 한 번에 물은 것과 하나씩 물은 것을 표로 견준다. 못 읽은 셸의 오류는 그 자리에 그대로 둔다.
fn checks_on(input: &Inputs, asked: Vec<Result<Asked, String>>) -> Vec<Result<CloseCheck, String>> {
    let verdict = verdict::judge(input);
    asked.into_iter().map(|one| one.map(|asked| close_check(&verdict, &asked))).collect()
}

/// **셸 하나의 답 — 두 물음이 모두 이 하나를 지난다.** 명령이 도는가는 결정 92의 판정 그대로이고, 수에서 셋을
/// 빼는 것은 `verdict::close_count`가 혼자 한다. foreground 그룹은 명령이 돌 때만 넘긴다 — 프롬프트면 그 그룹은
/// 셸 자신이고, 잡 제어 밖에서 뜬 자손이 거기 산다. 늘 넘기면 그것이 수에서 빠져 확인 창 없이 함께 끝난다
/// (`one_snapshot_answers_every_shell_as_if_asked_alone`의 셸 A와 풀 배선 장면 `Ask`가 잰다).
fn close_check(verdict: &Verdict, asked: &Asked) -> CloseCheck {
    let command = command_runs(asked.pid, asked.foreground);
    let command_group = if command { u32::try_from(asked.foreground).ok() } else { None };
    CloseCheck { command, descendants: verdict::close_count(verdict, &asked.entry.key, command_group) }
}

/// 풀에서 물은 셸이 그 순간 쥔 것을 읽는다. 못 읽으면 그 까닭이다.
fn asked_of(shells: &HashMap<u32, Shell>, id: u32) -> Result<Asked, String> {
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
    Ok(Asked { entry: shell.entry(), pid, foreground })
}

/// 포그라운드 그룹이 셸 자신이 아니면 명령이 돈다(ux-papercuts 결정 92의 판정 — 「명령」의 뜻은 그대로다. 프로세스
/// 결정 3이 넓힌 것은 확인 창이 묻는 때이고, 그 몫은 `CloseCheck::descendants`가 든다).
///
/// **한 줄인데 따로 있는 이유는 재기 위해서다.** 위 함수는 살아 있는 pty가 있어야 돌지만
/// 이 판정은 값 둘이면 된다. 뒤집히면 확인 창이 정확히 반대로 산다 — 빈 프롬프트를 닫을
/// 때마다 묻고, `claude`가 도는 칸은 조용히 죽는다.
fn command_runs(shell_pid: u32, foreground: i32) -> bool {
    foreground != shell_pid as i32
}

/// `Processes` 화면의 스냅샷(`processes_snapshot`, 프로세스 결정 10 · 티켓 26). 화면이 열려 있는 동안 프런트가 2초마다 묻는다 —
/// 닫혀 있으면 아무도 안 부른다(스토리 95). 판정 결과에 풀의 셸 목록을 곁들인다(`processes::screen`).
///
/// 순서는 닫기 전 물음과 같다: 스냅샷을 먼저 찍고, 셸 목록과 인스턴스 기록은 그 **뒤에** 읽는다(S52). 다른 점은 둘이다.
/// - env를 **전부** 읽는다. 셸 닫기는 그 셸이 뜬 뒤에 태어난 것만 읽지만(S3), 화면은 고아를 가려야 하고 고아는 지금 풀의
///   어느 셸보다 먼저 태어났을 수 있다.
/// - 판정에 넘기는 셸 목록과 화면에 싣는 풀의 셸 목록을 **한 잠금 안에서** 읽는다. 다른 순간의 것이면 그 사이에 뜨거나 닫힌
///   셸이 한쪽에만 선다.
///
/// **지표(메모리 · CPU · 포트)는 판정 뒤에 읽는다**(티켓 28). 무엇이 우리 트리인지는 판정이 정하므로(프로세스 스펙 S38 — 우리 트리만)
/// 판정이 묶음에 넣은 행과 풀의 셸 프로세스만 읽는다(`screen::targets`). 풀 잠금 밖이다 — 프로세스마다 fd를 훑는 동안 셸 입력 ·
/// 닫기가 기다리지 않게. CPU%는 풀이 쥔 앞 표본과 견준다(`CpuMeter`).
///
/// 끝낼 셸은 없다 — 아무것도 안 끝낸다. 스냅샷과 판정은 기다리는 일이라 `commands.rs`가 blocking 풀에서 부른다.
pub fn screen(pool: &PtyPool) -> ScreenSnapshot {
    let snapshot = snapshot::take(EnvScope::All);
    let (live, listed): (Vec<ShellEntry>, Vec<PoolShell>) = {
        let shells = pool.lock();
        (
            shells.values().map(Shell::entry).collect(),
            pool_shells(shells.iter().map(|(id, shell)| {
                (*id, shell.key.as_str(), shell.last_output.load(Ordering::Relaxed), shell.process)
            })),
        )
    };
    let records = pool.record.records();
    let exceptions = exceptions();
    let verdict = verdict::judge(&Inputs {
        snapshot: &snapshot,
        generation: instance_prefix(),
        shells: &live,
        ending: &[],
        instances: &records,
        exceptions: &exceptions,
        app_pid: std::process::id(),
        inherited_key: crate::processes::inherited_key(),
        occasion: Occasion::Normal,
    });
    let readings = metrics::read(screen::targets(&verdict, &listed));
    let cpu = pool.screen_cpu().sample(Instant::now(), readings.cpu_ns());
    let measured = Measured { readings: readings.by_id, cpu };
    ScreenSnapshot::of(&verdict, listed, &measured)
}

/// **요약 한 장을 모은다** — nav 메타의 합계와 `●`의 재료(프로세스 결정 10 · 11 · 티켓 29). 배경 표본이 10초마다 부른다
/// (`sample_in_background`) — 화면이 닫혀 있어도 돈다.
///
/// 순서는 화면 스냅샷(`screen`)과 같다: 스냅샷을 먼저 찍고, 판정에 넘길 셸 목록과 셸 프로세스의 신원을 **한 잠금 안에서** 읽고,
/// 인스턴스 기록은 그 **뒤에** 읽는다(S52). env는 전부 읽는다 — 출처 불명은 지금 풀의 어느 셸보다 먼저 태어났을 수 있다. 지표는
/// 판정 뒤, 풀 잠금 밖에서 합계에 드는 것만 읽는다(`summary::targets` — 앱 본체 + 이 실행의 셸과 자손). CPU%는 안 짓는다: 요약
/// 카드의 CPU는 30이 제 앞 표본으로 짓는다(화면의 앞 표본을 나눠 쓰면 두 박자가 섞인다 — `PtyPool::screen_cpu`).
///
/// `●`를 켜는 기록의 머리는 정리 기록 파일에서 고른다(`cleanup_log::look_head`). 아무것도 안 끝낸다.
pub fn summarize(pool: &PtyPool) -> Summary {
    let snapshot = snapshot::take(EnvScope::All);
    let (live, shells): (Vec<ShellEntry>, Vec<Identity>) = {
        let shells = pool.lock();
        (shells.values().map(Shell::entry).collect(), shells.values().filter_map(|shell| shell.process).collect())
    };
    let records = pool.record.records();
    let exceptions = exceptions();
    let verdict = verdict::judge(&Inputs {
        snapshot: &snapshot,
        generation: instance_prefix(),
        shells: &live,
        ending: &[],
        instances: &records,
        exceptions: &exceptions,
        app_pid: std::process::id(),
        inherited_key: crate::processes::inherited_key(),
        occasion: Occasion::Normal,
    });
    let app = snapshot::identity_of(std::process::id());
    let readings = metrics::read(summary::targets(&verdict, &shells, app));
    let head = cleanup_log::look_head(&pool.record.events());
    Summary::of(&verdict, &shells, app, &readings.by_id, head)
}

/// 요약 IPC의 답(`processes_summary`) — **배경 표본의 마지막 한 장**이다(티켓 29). 아직 한 장도 없으면(앱이 막 떠 첫 표본이 도는
/// 중, 표본 스레드를 안 건 검사의 풀) 그 자리에서 모아 앉힌다 — 프런트는 뜨자마자 묻는다.
pub fn summary(pool: &PtyPool) -> Summary {
    pool.background.latest().unwrap_or_else(|| {
        let fresh = summarize(pool);
        pool.background.keep(fresh.clone());
        fresh
    })
}

/// **배경 표본을 건다** — setup에서 한 번, 인스턴스 기록을 연 **뒤에**(티켓 29 · 프로세스 스펙 「수집 › 배경 표본」). 곧바로 한 장을
/// 모으고 10초마다 다시 모은다. 화면이 닫혀 있어도, 창이 가려져 있어도 돈다 — nav 메타는 늘 서 있고, 1시간 추이(30)는 그 사이를
/// 비우면 안 된다.
///
/// 기록을 열기 전에 모으면 판정이 이 실행 밖의 모든 세대를 기록 없는 세대로 본다 — 함께 뜬 다른 빌드의 셸 자손이 모두 출처
/// 불명으로 서서 뜨자마자 `●`가 선다. 그래서 setup의 자리가 `open_record` 뒤다(`lib.rs`의 핀).
pub fn sample_in_background(pool: Arc<PtyPool>) {
    let spawned = std::thread::Builder::new().name("atelier-summary".into()).spawn(move || loop {
        let fresh = summarize(&pool);
        pool.background.keep(fresh);
        std::thread::sleep(summary::EVERY);
    });
    // 스레드를 못 띄우면 요약은 첫 물음이 그 자리에서 모은 한 장에서 멎는다(`summary`) — nav 메타의 합계가 안 바뀐다. 조용히
    // 넘기지 않고 한 줄 남긴다.
    if let Err(e) = spawned {
        eprintln!("atelier: could not start the summary sampler: {e}");
    }
}

/// 풀의 셸 목록 — pty id · 셸 키 · 마지막 출력 시각 · 셸 프로세스의 신원을 **pty id 순**으로. 풀이 해시 맵이라 그대로 두면 부를
/// 때마다 순서가 흔들린다. 지표는 비워 둔다 — 판정 뒤에 읽어 `ScreenSnapshot::of`가 채운다.
fn pool_shells<'a>(shells: impl Iterator<Item = (u32, &'a str, u64, Option<Identity>)>) -> Vec<PoolShell> {
    let mut listed: Vec<PoolShell> = shells
        .map(|(pty_id, key, last_output_ms, process)| PoolShell {
            pty_id,
            shell_key: key.to_string(),
            last_output_ms,
            process,
            metrics: Default::default(),
        })
        .collect();
    listed.sort_by_key(|shell| shell.pty_id);
    listed
}

/// 지금(에포크 ms). 셸의 마지막 출력 시각이 쓴다. 시계가 에포크 앞이면 0으로 눕는다(`prefix_at`과 같다).
fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
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
/// **이 방침에는 예외가 하나 있다**(프로세스 스펙 S38 · 티켓 28): `Processes`의 포트를 읽는 소켓 fd 정보
/// (`processes/metrics.rs`의 `SocketFdInfo`). libc에 그 구조체가 없고 크레이트를 들이는 것보다 작아서, 쓰는 칸
/// 셋만 손으로 적고 크기와 자리를 검사로 못박았다 — 커널과 어긋나면 그 검사가 빨갛다.
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
/// `end_for_exit` · 셸 스스로 끝남의 `exited`)은 풀에서 **먼저 빼고**(잠금 안에서) 그 다음에 거둔다. 그러니 우리가 잠금을 쥐고 있는 동안 그 셸은 아직
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
///
/// 까닭과 셸의 주인은 부른 쪽(프런트)이 준다 — 끝낸 것이 정리 기록에 그 까닭으로 적힌다(티켓 11). 어느 닫기가 어느 까닭인지는
/// 프런트의 표 한 자리가 고른다(`shell-registry.ts`의 `CLOSE_REASONS`).
pub fn kill(pool: &PtyPool, id: u32, reason: CloseReason, owner: &str) -> Result<(), String> {
    // **빼기 전에 센다.** 뺀 뒤 목록에 오르기 전에 종료가 오면, 종료는 그 셸을 풀에서도 목록에서도 못 본다.
    // 셈이 먼저 서 있으면 종료가 판정이 끝나기를 기다린다. 뺄 셸이 없으면 셈은 떨어지며 물러난다.
    let claim = pool.endings.claim();
    let shell = pool.lock().remove(&id).ok_or_else(|| gone(id))?;
    end(pool, vec![shell], claim, Cause { reason: reason.into(), owner: Some(owner.to_string()) });
    Ok(())
}

/// **셸이 스스로 끝났다** — 리더 스레드가 셸 프로세스를 거둔 뒤 부른다(프로세스 결정 3 · 6 · 프로세스 스펙 S49 · 티켓 13).
///
/// **자기 자리를 치운다.** 사용자가 `exit`를 치면 셸은 여기서 끝나는데, 치우지 않으면 죽은 셸이 풀에 남아 fd 둘을 붙잡고
/// 있고 — 더 나쁘게 — 그 pid가 이미 회수돼 **재사용 가능한 상태**로 남는다. 다음 회수가 그 자리에 앉은 남의 프로세스 그룹을
/// 쏘게 된다.
///
/// **빼기가 셸을 돌려줄 때만** 그 셸에서 띄운 것을 끝낸다. 다른 길(×, 새로고침, 앱 종료)이 먼저 뺐으면 그 길이 이미 끝내고
/// 있다 — 여기서 또 하면 같은 셸을 두 번 끝내고 정리 기록도 두 줄이 된다. 빼기 전에 세는 것(판정 중 셈)은 셸 닫기와 같다:
/// 판정하는 사이 앱이 닫혀도 종료가 이 끝내기가 목록에 오르기를 기다려 마감한다.
///
/// **남겨 두어도 그것들은 확정 고아다**(프로세스 결정 6) — 이 실행은 살아 있고 그 셸은 목록에 없다. 다음 시작 정리가 어차피
/// 끝낸다. 결정 6의 이유(「고아는 이어 쓸 길이 없다」)가 「지금」을 고른다. 결정 3은 「남기기」를 두지 않는다.
///
/// 판정 · 끝내기 · 기록 · 알림은 **새 스레드**에서 한다(`atelier-shell-exit`) — 유예가 2초까지 돈다. 판정은 셸 닫기와 같은
/// 길(`begin`)이지만 셸 pid는 이미 거둬져 PID 트리가 끊겼다: 판정은 셸 프로세스를 못 찾고 **그 셸 키를 문 생존자와 그 트리**만
/// 고른다. 표식이 안 읽히는 자손(시스템 바이너리)은 못 찾는다 — 스펙 Further Notes 「표식이 안 읽히는 고아」와 같은 한계다.
/// 셸 그룹에는 신호가 안 간다 — 리더(셸)가 이미 없어 신원을 아는 그룹은 빠지고, 신원을 모르는 그룹은 번호가 남의 것일 수 있어
/// 쏘지 않는다(`groups_signalled`).
///
/// 끝낸 것은 정리 기록에 「셸 스스로 끝남」으로 적고(owner 없음 — 티켓 11), 셸 키는 **끝내기가 끝난 뒤에** 내린다(S52). 사람이
/// 끝내기를 고르지 않은 길이라 도우미가 아닌 것을 끝냈으면 알린다(P4 — `cleanup_log::ended_count`). p10k 셸의 `exit`는
/// `gitstatusd`(도우미)만 끝나 조용하다.
fn exited(pool: &Arc<PtyPool>, id: u32) {
    let claim = pool.endings.claim();
    let left = pool.lock().remove(&id);
    // 이미 다른 길이 가져갔다 — 셈은 떨어지며 물러난다.
    let Some(shell) = left else {
        return;
    };
    let owner = Arc::clone(pool);
    let behind = std::thread::Builder::new().name("atelier-shell-exit".into()).spawn(move || {
        let cause = Cause { reason: Reason::ShellExit, owner: None };
        let (aimed, outcomes) = begin(&owner, vec![shell], claim, cause).finish();
        let members: Vec<Aimed> = aimed.into_iter().flat_map(|(_, members)| members).collect();
        if let Some(count) = cleanup_log::ended_count(&members, &outcomes) {
            owner.announce(Ended { reason: Reason::ShellExit, shell_id: id, count });
        }
    });
    // 스레드를 못 띄우면 셸과 셈이 함께 떨어진다 — 셈은 물러나고 셸의 자손은 안 끝난다. 키는 기록에 남아 그 자손이 고아로 안
    // 읽히고, 앱 종료가 이 세대의 표식째 끝낸다(`end`의 같은 자리와 같다).
    if let Err(e) = behind {
        eprintln!("atelier: could not start the shell-exit thread for pty {id}: {e}");
    }
}

/// 셸을 거두는 까닭과 그 셸의 주인 — 정리 기록의 사건이 든다(티켓 11). 주인은 닫기 IPC로 온 것에만 있다: Rust 풀은 셸의
/// 주인을 모른다(새로고침 · 셸 스스로 끝남은 비운다).
struct Cause {
    reason: Reason,
    owner: Option<String>,
}

/// 웹뷰가 다시 뜰 때 옛 페이지의 셸을 모두 닫는다.
///
/// 정리 시점은 in-app-terminal 결정 18이 앱 종료 · 새로고침 둘로 정했고, 프로세스 결정 3이 셸 닫기를,
/// 프로세스 결정 6이 앱 시작을 더했다(`clean_up_at_startup`). 옛 페이지가 쥐던 채널은 죽었으니 그 셸을 이어 쓸 길이 없다.
///
/// **풀은 그 자리에서 비우고, 끝내기는 셸 닫기와 같은 길로 뒤로 보낸다** — 새로고침은 유예를 기다리지 않는다.
/// 판정은 뺀 셸들을 끝낼 셸로 받으므로, 새 웹뷰가 곧바로 띄운 셸은 거기 들지 않는다.
pub fn end_for_reload(pool: &PtyPool) {
    let claim = pool.endings.claim();
    let shells: Vec<Shell> = pool.lock().drain().map(|(_, shell)| shell).collect();
    // 첫 로드에도 온다 — 그때 풀은 비어 있고, 셈은 떨어지며 물러난다.
    if !shells.is_empty() {
        end(pool, shells, claim, Cause { reason: Reason::Reload, owner: None });
    }
}

/// 앱이 닫힐 때 — 이 실행이 띄운 것을 모두 끝내고 **나서** 돌아온다(프로세스 결정 3 · 프로세스 스펙 S5).
///
/// 끝낼 것 = 이 세대의 표식을 문 전부 ∪ 풀 셸들의 PID 트리 ∪ 진행 중인 끝내기. 예외 목록에 걸린 것과 그 밑은
/// 빠진다(프로세스 결정 5). 한 번에 판정하고 **동기로** 끝낸다 — 스레드에 넘기면 프로세스가 끝나며 그 스레드도
/// 함께 사라져 아무도 SIGKILL을 못 보낸다. 진행 중인 끝내기는 남은 유예만 기다린다. 다 끝나면 곧바로 나오고,
/// 가장 늦어도 2초 남짓이다.
///
/// 끝내고 나면 인스턴스 기록을 닫는다 — 「못 끝냄」이 없으면 지우고, 있으면 남긴다(티켓 09). 마감한 결과를 그대로 넘기는
/// 이 배선은 실행으로 못 재 자리로 잰다(`the_exit_closes_the_record_with_what_its_ending_returned`). 결과(못 끝냄 포함)를
/// 돌려준다.
///
/// 끝낸 것은 정리 기록에 「앱 종료」로 적는다(티켓 11) — **종료가 새로 맡은 것만.** 진행 중인 끝내기의 것은 그것을 시작한
/// 길(셸 닫기 · 새로고침 · 시작 정리)의 뒤 스레드가 제 까닭으로 적는다. 앱이 그 스레드보다 먼저 끝나면 그 사건은 빠진다.
pub fn end_for_exit(pool: &PtyPool) -> Vec<(Identity, Outcome)> {
    let shells: Vec<Shell> = pool.lock().drain().map(|(_, shell)| shell).collect();
    let pgids: Vec<i32> = shells.iter().flat_map(groups_of).collect();
    let ending: Vec<ShellEntry> = shells.iter().map(Shell::entry).collect();
    // 이 세대의 표식은 언제 태어난 누가 물었는지 모르니 env를 다 읽는다.
    let snapshot = snapshot::take(EnvScope::All);
    let records = pool.record.records();
    let exit = verdict::at_exit(&Inputs {
        snapshot: &snapshot,
        generation: instance_prefix(),
        shells: &[],
        ending: &ending,
        instances: &records,
        exceptions: &exceptions(),
        app_pid: std::process::id(),
        inherited_key: crate::processes::inherited_key(),
        occasion: Occasion::Normal,
    });
    let groups = groups_led(&shells, &pgids, &snapshot);

    let closing = pool.endings.close(&exit.targets, &groups);
    // 정리 기록에 적을 것 — 종료가 새로 맡은 대상의 행. 스냅샷의 행을 지금 떠 둔다.
    let aimed: Vec<Aimed> = closing
        .fresh()
        .iter()
        .filter_map(|id| snapshot.procs.iter().find(|row| row.id == *id))
        .map(|row| Aimed::of(row, exit.helpers.contains(&row.id)))
        .collect();
    // writer의 Drop이 개행+^D를 쓰고, master의 Drop이 커널 hangup을 건다. 상태 파일도 여기서 사라진다.
    drop(shells);
    let outcomes = closing.finish();
    // 못 끝낸 것이 없으면 인스턴스 기록을 지우고, 있으면 남긴다 — 다음 실행의 시작 정리가 이 실행을 「죽은 인스턴스」로
    // 읽어 한 번 더 해 본다. 어느 쪽이든 기록을 닫아, 아직 도는 뒤 스레드의 늦은 쓰기가 파일을 되살리지 않는다.
    pool.record.close(&outcomes);
    // 기록을 닫아도 정리 기록은 적힌다(`Record::log`). 셸과 도우미만 끝났으면 안 적는다.
    if let Some(event) = cleanup_log::event(cleanup_log::now_ms(), Reason::AppExit, None, None, &aimed, &outcomes) {
        pool.record.log(event);
    }
    outcomes
}

/// 시작 정리가 끝내려 한 것 하나 — 신원, 커널 이름, 결과. 시작 보고가 끝낸 것(끝남 · 강제)을 골라 알린다
/// (`startup::cleaned`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Cleared {
    pub id: Identity,
    pub name: String,
    pub outcome: Outcome,
}

/// **시작 정리**(프로세스 결정 6 · 티켓 10) — 지난 실행이 남긴 확정 고아를 끝내고, 죽은 실행의 기록을 지운다. 앱이 뜰 때
/// 인스턴스 기록을 연 **뒤에** 뒤 스레드에서 한 번 돈다(`startup::clean_up`). 끝내기가 끝나야 돌아온다(최악 2초 남짓).
///
/// 판정(`plan_startup`)과 끝내기(`carry_out`)를 가른 것은 실물 검사가 그 사이에서 끝낼 신원을 자기 자식으로 거르기
/// 위해서다 — 이 함수는 둘을 그대로 잇는다.
pub fn clean_up_at_startup(pool: &PtyPool) -> Vec<Cleared> {
    carry_out(pool, plan_startup(pool, &exceptions()))
}

/// 시작 정리가 고른 것 — 끝낼 확정 고아(스냅샷의 행)와 지울 죽은 실행의 기록. 판정 중인 셈을 쥐고 있다.
struct StartupPlan {
    claim: Claim,
    targets: Vec<Proc>,
    dead: Vec<InstanceRecord>,
}

/// 시작 정리의 판정 — 신호도 파일 쓰기도 없다.
///
/// 1. **판정 중으로 먼저 센다**(프로세스 스펙 S5). 판정하는 사이 앱이 닫히면 종료가 이 끝내기가 목록에 오르기를 기다려
///    마감한다 — 셸 닫기가 빼기 전에 세는 것과 같다.
/// 2. 스냅샷을 찍고, **그 뒤에** 셸 목록과 기록을 읽는다(프로세스 스펙 S52). 첫 셸이 이 사이에 떠도 그 키는 이 실행의
///    것이라 시작 정리가 안 본다.
/// 3. 시작 정리 모드로 판정해 **확정 고아만** 고른다(`verdict::at_startup`) — 출처 불명, 다른 인스턴스, 예외는 안 고른다.
///    지울 기록은 앱이 스냅샷에 없는 실행의 것이다(`verdict::dead_instances`).
fn plan_startup(pool: &PtyPool, exceptions: &[String]) -> StartupPlan {
    let claim = pool.endings.claim();
    let snapshot = snapshot::take(EnvScope::All);
    let live: Vec<ShellEntry> = pool.lock().values().map(Shell::entry).collect();
    let records = pool.record.records();
    let input = Inputs {
        snapshot: &snapshot,
        generation: instance_prefix(),
        shells: &live,
        ending: &[],
        instances: &records,
        exceptions,
        app_pid: std::process::id(),
        inherited_key: crate::processes::inherited_key(),
        occasion: Occasion::StartupCleanup,
    };
    let targets = verdict::at_startup(&input).into_iter().cloned().collect();
    let dead = verdict::dead_instances(&input).into_iter().cloned().collect();
    StartupPlan { claim, targets, dead }
}

/// 고른 것을 끝내고 죽은 실행의 기록을 지운다.
///
/// 끝내기는 진행 중인 끝내기 목록에 올라 돈다 — 유예 중에 앱이 닫히면 종료가 마감한다. 고아에게는 셸 그룹이 없다(그 셸은
/// 지난 실행과 함께 사라졌다).
///
/// **죽은 실행의 기록은 그 고아를 끝낸 뒤에 지운다**(프로세스 스펙 「인스턴스 기록 › 지우는 때」). 그래도 남은 것(못 끝냄)은
/// 다음부터 출처 불명이 되어 자동으로는 안 건드린다. 지우기 직전에 그 앱이 **지금도** 없는지 본다 — 판정의 스냅샷 뒤에
/// 막 뜬 실행은 앱이 스냅샷에 없어 죽은 것으로 읽혔을 뿐이다. 그 실행의 고아로 끝낸 것은 없다(그 자손은 스냅샷 뒤에
/// 태어났다). 끝내기 전에 앱이 끝나면 기록은 남아, 다음 실행의 시작 정리가 한 번 더 해 본다.
///
/// 끝낸 것은 정리 기록에 「시작 정리」로 적는다(티켓 11). 고아에는 셸도 도우미도 없다 — 끝낸 것이 하나라도 있으면 적는다.
fn carry_out(pool: &PtyPool, plan: StartupPlan) -> Vec<Cleared> {
    let StartupPlan { claim, targets, dead } = plan;
    let ids: Vec<Identity> = targets.iter().map(|proc| proc.id).collect();
    let outcomes = claim.start(&ids, &[]).finish();
    let aimed: Vec<Aimed> = targets.iter().map(|proc| Aimed::of(proc, false)).collect();
    if let Some(event) = cleanup_log::event(cleanup_log::now_ms(), Reason::StartupCleanup, None, None, &aimed, &outcomes) {
        pool.record.log(event);
    }
    pool.record.forget(
        dead.iter().filter(|record| !instances::alive(record.app)).map(|record| record.generation.as_str()),
    );
    // 끝내기는 받은 순서 그대로 결과를 준다.
    outcomes.into_iter().zip(targets).map(|((id, outcome), proc)| Cleared { id, name: proc.name, outcome }).collect()
}

/// 풀에서 뺀 셸들과 그 셸들에서 나온 것을 끝낸다 — 셸 닫기와 새로고침의 길. 판정까지 하고(`begin`) 돌아온다. 셸을 떨구고
/// 유예와 SIGKILL을 도는 것은 뒤 스레드(`Behind::finish`)다.
fn end(pool: &PtyPool, shells: Vec<Shell>, claim: Claim, cause: Cause) {
    let behind = begin(pool, shells, claim, cause);
    // **셸을 떨구는 것도 뒤 스레드에서 한다.** writer의 Drop은 pty에 개행 + ^D를 쓰는데, 셸이 입력을 안 읽는
    // 채 pty 버퍼가 차 있으면 거기서 막힌다 — 새로고침은 메인 스레드에서 돈다.
    let spawned = std::thread::Builder::new().name("atelier-ending".into()).spawn(move || {
        behind.finish();
    });
    // 스레드를 못 띄우면 끝내기는 마감되지 않은 채 목록에 남는다 — 앱 종료가 마감한다. 키도 기록에 남는다: 그 셸의
    // 자손은 판정에서 「키만 있는 셸」의 자손이 되어 고아로 안 읽히고, 앱 종료가 이 세대의 표식째 끝낸다.
    if let Err(e) = spawned {
        eprintln!("atelier: could not start the ending thread: {e}");
    }
}

/// 판정하고 끝내기를 시작한다 — 셸 닫기 · 새로고침 · 셸 스스로 끝남의 앞 절반. **순서가 고정이다.**
///
/// 1. 셸마다 그룹을 읽는다. foreground 그룹은 `tcgetpgrp(master)`로만 알 수 있어 master를 떨구기 전이다.
/// 2. 스냅샷을 찍고, **그 뒤에** 풀에 남은 셸 목록을 읽는다(프로세스 스펙 S52). 그 사이에 뜬 셸은 목록에
///    이미 있어, 그 셸의 자손이 누구의 것도 아닌 표식으로 읽히는 창이 없다.
/// 3. 판정 — 뺀 셸들을 「끝낼 셸」로 넘긴다. 끝낼 대상은 그 셸의 PID 트리 ∪ 그 키를 문 것 ∪ 그 트리들이다.
///    부모가 먼저 끝나 launchd 밑으로 넘어간 dev 서버는 트리가 끊겨 표식으로만 잡힌다. 스스로 끝난 셸은 PID 트리가
///    없다 — 표식으로만 잡힌다(`exited`).
/// 4. 끝내기를 시작해(대상 SIGTERM, 셸 그룹 SIGHUP) 진행 중인 끝내기 목록에 올리고 돌아온다. 뒤 절반(`Behind`)을 돌려준다.
///
/// **셸 그룹과 그 순간의 foreground 그룹에 가는 신호는 지금 방어선 그대로 남는다.** 셸 그룹 밖으로 떨어진
/// 자손이 대상 목록으로 더해질 뿐이다. 다른 OS는 스냅샷이 비고 셸의 신원도 몰라, 지금처럼 그룹 신호만 간다.
/// 셸 스스로 끝남만 다르다 — 셸이 이미 거둬져 리더의 신원을 아는 그룹만 쏜다(`groups_signalled`). 다른 OS에서 그 길은
/// 쏠 것이 없다.
fn begin(pool: &PtyPool, shells: Vec<Shell>, claim: Claim, cause: Cause) -> Behind {
    let pgids: Vec<i32> = shells.iter().flat_map(groups_of).collect();
    let ending: Vec<ShellEntry> = shells.iter().map(Shell::entry).collect();
    let snapshot = snapshot::take(env_scope(ending.iter().map(|shell| shell.process)));
    let live: Vec<ShellEntry> = pool.lock().values().map(Shell::entry).collect();
    let records = pool.record.records();
    let exceptions = exceptions();
    let verdict = verdict::judge(&Inputs {
        snapshot: &snapshot,
        generation: instance_prefix(),
        shells: &live,
        ending: &ending,
        instances: &records,
        exceptions: &exceptions,
        app_pid: std::process::id(),
        inherited_key: crate::processes::inherited_key(),
        occasion: Occasion::Normal,
    });
    // 셸마다 끝낼 자손 — 정리 기록에 적을 것(행의 이름 · 명령줄 · 도우미 표시)을 지금 떠 둔다. 뒤 스레드는 스냅샷을 못 빌린다.
    let aimed: Vec<(String, Vec<Aimed>)> = ending
        .iter()
        .map(|shell| {
            let members = verdict.descendants.get(shell.key.as_str()).into_iter().flatten();
            let members = members.map(|proc| Aimed::of(proc, verdict.helpers.contains(&proc.id))).collect();
            (shell.key.clone(), members)
        })
        .collect();
    let targets: Vec<Identity> = aimed.iter().flat_map(|(_, members)| members.iter().map(|one| one.id)).collect();
    let groups = groups_signalled(groups_led(&shells, &pgids, &snapshot), cause.reason);

    let running = claim.start(&targets, &groups);
    Behind { shells, running, aimed, cause, record: Arc::clone(&pool.record) }
}

/// 시작한 끝내기의 뒤 절반 — 기다리는 일이라 뒤 스레드가 쥔다. 마감하지 않고 떨어지면 끝내기는 진행 중인 끝내기 목록에
/// 남아 앱 종료가 마감하고, 셸 키도 기록에 남는다.
struct Behind {
    shells: Vec<Shell>,
    /// 진행 중인 끝내기 목록에 오른 끝내기(`processes::ending::Running`) — 이 파일의 `Running`(도는 명령의 표)과 다른 것이다.
    running: crate::processes::ending::Running,
    /// 셸 키마다 끝낼 자손 — 정리 기록에 적을 것(행의 이름 · 명령줄 · 도우미 표시)을 판정 때 떠 둔 것.
    aimed: Vec<(String, Vec<Aimed>)>,
    cause: Cause,
    record: Arc<Record>,
}

impl Behind {
    /// 셸을 떨구고, 유예와 SIGKILL을 마감하고, 정리 기록에 적고, 셸 키를 내린다. 셸마다 떠 둔 자손과 끝내기의 결과를
    /// 돌려준다 — 셸 스스로 끝남이 그것으로 알릴 수를 센다.
    fn finish(self) -> (Vec<(String, Vec<Aimed>)>, Vec<(Identity, Outcome)>) {
        let Behind { shells, running, aimed, cause, record } = self;
        // writer의 Drop이 개행+^D를 쓰고, master의 Drop이 커널 hangup을 건다. 상태 파일도 여기서 사라진다.
        drop(shells);
        let outcomes = running.finish();
        // 끝낸 것을 셸마다 한 줄씩 정리 기록에 적는다(티켓 11) — 셸과 도우미만 끝난 셸은 안 적는다(프로세스 스펙 P1).
        let at = cleanup_log::now_ms();
        for (key, members) in &aimed {
            if let Some(event) = cleanup_log::event(at, cause.reason, Some(key), cause.owner.as_deref(), members, &outcomes) {
                record.log(event);
            }
        }
        // **셸 키는 끝내기가 끝난 뒤에 내린다**(프로세스 스펙 S52). 유예 2초 동안 SIGTERM을 무시하며 사는 자손은 아직 이
        // 셸의 표식을 문다 — 그동안 키가 기록에 없으면 다른 실행의 정리가 그것을 확정 고아로 본다.
        record.lower(aimed.iter().map(|(key, _)| key.as_str()));
        (aimed, outcomes)
    }
}

/// 스냅샷이 env를 읽을 범위 — 셸들 중 가장 이른 것보다 늦게 태어난 것만 읽는다(프로세스 스펙 S3). 그 셸의 표식을
/// 문 것은 그 셸보다 먼저 태어날 수 없다. 셸 하나라도 신원을 모르면(리눅스, 못 읽음) 다 읽는다.
fn env_scope(shells: impl IntoIterator<Item = Option<Identity>>) -> EnvScope {
    shells
        .into_iter()
        .map(|process| process.map(|id| id.started_us))
        .collect::<Option<Vec<u64>>>()
        .and_then(|born| born.into_iter().min())
        .map_or(EnvScope::All, EnvScope::BornSince)
}

/// 예외 목록 — **끝낼 때마다 설정을 새로 읽는다**(프로세스 결정 5 · 프로세스 스펙 S7). 사람이 설정 › 터미널에서
/// 목록을 고치면 다음에 닫는 셸부터 먹는다. 파일이 없거나 깨졌으면 기본 목록이다.
///
/// 부르는 자리가 셋이다 — 닫기 · 새로고침의 `end`, 앱 종료의 `end_for_exit`, 닫기 전 물음의 `close_checks`(확인
/// 창의 수에서 예외를 빼려면 판정이 목록을 알아야 한다). 판정 표는 목록을 직접 받으니 이 배선은 못 잰다. 풀 배선
/// 장면 `CloseKeeping`(닫기)과 `ExitKeeping`(종료), `Ask`(닫기 전 물음)가 하나씩 잰다.
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

/// 끝내기가 쏠 그룹 — **셸 스스로 끝남은 리더의 신원을 아는 그룹만 쏜다**(티켓 13).
///
/// 그 길의 셸은 리더 스레드가 이미 거뒀다. 신원을 모르는 그룹(다른 OS의 셸 그룹, 스냅샷에 리더 행이 없는 foreground 그룹)은
/// 끝내기가 「그 번호의 그룹이 아직 있는가」만 보고 쏘는데, 거둬진 셸의 번호는 비었다가 남의 그룹 리더에게 다시 갈 수 있다.
/// 신원을 아는 그룹은 신호마다 그 신원이 그대로인지 보므로(`processes::ending`) 거둬진 셸의 그룹은 저절로 빠지고, 아직 도는
/// foreground 잡만 남는다. 스스로 끝남이 끝낼 것은 그 셸 키를 문 생존자다 — 그것은 대상 목록으로 신원째 간다.
///
/// 다른 까닭은 셸이 살아 있을 때라 그 번호가 그 셸의 것이다. 옛 방어선(그룹이 있는 동안) 그대로 둔다.
fn groups_signalled(groups: Vec<Group>, reason: Reason) -> Vec<Group> {
    match reason {
        Reason::ShellExit => groups.into_iter().filter(|group| group.leader.is_some()).collect(),
        _ => groups,
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

impl Shell {
    /// 판정이 읽는 셸의 모양. 첫 사람 입력 시각까지 싣는다 — 그 전에 태어난 자손을 셸 도우미로 가르는 것은 판정의
    /// 몫이다(`Verdict::helpers`).
    fn entry(&self) -> ShellEntry {
        ShellEntry { key: self.key.clone(), process: self.process, first_input_us: self.first_input_us }
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
/// 지금 그 첫 호출자는 `lib.rs`의 `setup`에서 도는 `shells::sweep(&root, &pty::live_generations(&root))`
/// (그 안의 `live_generations`)라, 값은 사실상 **앱이 뜬 시각**이다. 이 함수가 기대는 성질은 그것이 아니라 「실행끼리
/// 안 겹친다」 하나이므로 첫 호출자가 누구든 다 서지만, 남은 파일을 눈으로 볼 때 시각이
/// 앱을 켠 때와 맞는 것은 그 배선 덕이다.
///
/// **정리(`shells::sweep`)가 남길 이 실행의 세대는 반드시 이 함수에서 온다**(`live_generations`) — 앱 시작 시각을
/// 따로 재면 두 값이 갈라져 살아 있는 셸의 상태 파일을 지운다. 그 둘이 갈리는 순간은
/// `shells.rs`의 `a_sweep_keeps_the_file_a_live_shell_is_named_with`가 값으로 잡는다.
///
/// **인스턴스 기록의 세대(파일 이름)도 이 값이다**(`open_record`). 판정은 셸 키의 머리로 그 키를 낸 기록을 찾으니,
/// 기록 이름을 따로 지으면 이 실행의 셸 자손이 제 기록을 못 찾아 「출처 불명」이 된다.
pub(crate) fn instance_prefix() -> &'static str {
    static PREFIX: OnceLock<String> = OnceLock::new();
    PREFIX.get_or_init(|| prefix_at(SystemTime::now()))
}

/// **훅 상태 파일 정리가 남길 세대** — 이 실행의 세대와, 살아 있는 다른 실행들의 세대(티켓 11 · 프로세스 스펙 S10).
///
/// 예전 정리는 이 실행의 것 말고 전부 지웠다. dev 빌드와 설치본을 함께 띄우면 한쪽이 뜰 때 다른 쪽 셸의 상태 파일을 지워
/// 그 셸의 띠 상태가 사라졌다. 이제 인스턴스 기록(티켓 09)으로 살아 있는 실행을 가려 그 세대의 파일은 남긴다. 기록이 없는
/// 실행(이 기능 전의 설치본, 리눅스)은 가릴 길이 없어 예전처럼 지운다.
///
/// 이 실행의 기록은 아직 안 열렸을 수 있어(정리는 기록을 열기 전에 돈다) 세대를 따로 싣는다.
///
/// 기록 폴더의 살아 있는 세대를 더하는 줄은 `shells.rs`의 `a_sweep_keeps_the_files_of_a_run_whose_instance_record_is_alive`가
/// 앱이 쓰는 길로 잰다(macOS) — 이 줄이 빠지면 정리가 다시 이 실행의 세대만 남긴다.
pub fn live_generations(root: &Path) -> Vec<String> {
    let mut generations = vec![instance_prefix().to_string()];
    generations.extend(instances::live_generations(&instances::dir(root)));
    generations
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

    /// **닫힌 셸은 자기 상태 파일과 잠금 파일을 데리고 나간다.** 상태 파일이 남으면 사이드바에서 죽은 셸이
    /// 영영 사람을 부르고, 다음 실행이 같은 PTY 번호를 쓸 때 그 값을 새 셸이 뒤집어쓴다. 잠금 파일(티켓 19)이 남으면
    /// 셸마다 빈 파일이 쌓인다.
    ///
    /// 두 경로는 앱이 셸을 띄울 때 짓는 그 함수(`shells::state_path` · `shells::lock_path`)로 짓는다 — 처리기가 실제로 쓰는
    /// 이름과 같은지는 `shells.rs`의 처리기 검사가 파일로 본다. 앵커: 같은 폴더의 남의 셸 파일은 남는다.
    ///
    /// 살아 있는 pty가 필요하지만 셸을 띄우지는 않는다 — `openpty` 하나면 `Shell`이 선다.
    #[test]
    fn a_closed_shell_takes_its_state_and_lock_files_with_it() {
        let root = std::env::temp_dir().join(format!("atelier-pty-drop-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(crate::shells::shells_dir(&root)).unwrap();
        let state = crate::shells::state_path(&root, "1700-9");
        let lock = crate::shells::lock_path(&root, "1700-9");
        let neighbour = crate::shells::lock_path(&root, "1700-10");
        for file in [&state, &lock, &neighbour] {
            std::fs::write(file, r#"{"agent":"claude"}"#).unwrap();
        }

        let size = PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 };
        let pair = native_pty_system().openpty(size).expect("pty가 열린다");
        let writer = pair.master.take_writer().expect("writer가 나온다");
        let shell = super::Shell {
            pid: None,
            key: "1700-9".to_string(),
            process: None,
            first_input_us: None,
            last_output: std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0)),
            master: pair.master,
            writer: std::sync::Arc::new(std::sync::Mutex::new(writer)),
            state_file: state.clone(),
            lock_file: lock.clone(),
        };

        drop(shell);

        assert!(!state.exists(), "셸이 닫혔는데 상태 파일이 남았다");
        assert!(!lock.exists(), "셸이 닫혔는데 잠금 파일이 남았다");
        assert!(neighbour.exists(), "남의 셸 잠금 파일까지 지웠다");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 셸을 띄우지 않고 `openpty` 하나로 선 풀의 칸. 상태 파일은 없는 자리를 가리킨다 — 떨굴 때 지울 것이 없다.
    fn idle_shell(key: &str) -> super::Shell {
        let size = PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 };
        let pair = native_pty_system().openpty(size).expect("pty가 열린다");
        let writer = pair.master.take_writer().expect("writer가 나온다");
        super::Shell {
            pid: None,
            key: key.to_string(),
            process: None,
            first_input_us: None,
            last_output: std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0)),
            master: pair.master,
            writer: std::sync::Arc::new(std::sync::Mutex::new(writer)),
            state_file: std::env::temp_dir()
                .join(format!("atelier-pty-idle-{}-{key}.json", std::process::id())),
            lock_file: std::env::temp_dir()
                .join(format!(".atelier-pty-idle-{}-{key}.lock", std::process::id())),
        }
    }

    /// 첫 사람 입력은 **한 번만** 풀의 그 셸에 앉고, 판정이 읽는 셸의 모양까지 간다(프로세스 결정 7 · 프로세스 스펙 P1).
    ///
    /// 셸 도우미를 가르는 기준이 「사람이 처음 입력하기 전에 태어났나」라, 뒤의 알림이 덮으면 그사이 사람이 띄운 것이
    /// 도우미로 읽힌다. 프런트가 잰 ms를 µs로 옮긴다 — 자손의 커널 시작 시각과 같은 단위다(`Identity::started_us`).
    #[test]
    fn the_first_human_input_lands_once_on_its_shell() {
        let pool = super::PtyPool::default();
        pool.lock().insert(7, idle_shell("1700-7"));
        pool.lock().insert(8, idle_shell("1700-8"));
        let first_input = |id: u32| pool.lock().get(&id).map(|shell| shell.entry().first_input_us);

        assert_eq!(first_input(7), Some(None), "막 뜬 셸에 사람 입력이 있다");
        super::note_first_input(&pool, 7, 1_790_000_000_123).expect("있는 셸이다");
        assert_eq!(first_input(7), Some(Some(1_790_000_000_123_000)), "첫 입력 시각이 µs로 안 앉았다");

        super::note_first_input(&pool, 7, 1_790_000_009_999).expect("있는 셸이다");
        assert_eq!(first_input(7), Some(Some(1_790_000_000_123_000)), "뒤의 알림이 첫 입력을 덮었다");
        assert_eq!(first_input(8), Some(None), "다른 셸에 앉았다");

        assert!(super::note_first_input(&pool, 9, 1).is_err(), "없는 셸을 조용히 넘겼다");
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
    /// **몸통이 넓어졌다**(티켓 08). 셸 하나의 물음이 배치 물음(`close_checks`)을 지나고, 값 둘을 읽는 자리
    /// (`asked_of`)와 판정에 넘기는 자리(`close_check`)가 갈렸다. 그래서 핀이 넷이다: 셸 하나가 배치를 지나는가,
    /// 값 둘을 읽는가, 그 둘을 판정에 그대로 넘기고 수는 `verdict::close_count` 하나로 세는가, 배치가 스냅샷을
    /// **한 장** 찍고 셸 목록은 그 **뒤에** 읽는가(프로세스 스펙 S52).
    ///
    /// **무엇을 못 보는지 적어 둔다.** 이것은 리터럴이 **있는가**만 보므로, 부르기는 하되
    /// 값을 갈아 끼우는 변형은 그대로 통과한다 — `.process_group_leader().or(Some(1))`로
    /// 뒤집어도 초록인 것을 실측했다(그러면 죽은 셸이 늘 「명령이 돈다」가 된다). 그 자리는
    /// **살아 있는 pty 없이는 못 잰다** — 풀 배선 장면 `Ask`가 진짜 셸로 잰다. 수를 세는 규칙은
    /// `processes::verdict`의 표가, 배치와 셸 하나가 같은 답을 내는지와 foreground 그룹을 명령이 돌 때만 빼는지는
    /// 아래 표가 잰다 — `close_check`가 그룹을 늘 넘기도록 바꿔도 이 핀과 판정 표는 초록이었다(실측).
    #[test]
    fn command_running_hands_both_values_to_the_verdict() {
        assert!(
            body_of("pub fn command_running(", "\n}\n").contains("close_checks(pool, &[id])"),
            "셸 하나의 물음이 배치 물음을 안 지난다 — 닫기 창과 종료 창이 규칙을 따로 든다"
        );
        assert!(
            body_of("fn asked_of(", "\n}\n").contains("process_group_leader()"),
            "터미널을 쥔 그룹을 안 읽는다 — 판정의 한쪽 값이 없다"
        );
        let check = body_of("fn close_check(", "\n}\n");
        assert!(
            check.contains("command_runs(asked.pid, asked.foreground)"),
            "값 둘을 그대로 판정에 넘기지 않는다 — 여기서 답을 새로 지으면 위 전수가 헛돈다"
        );
        assert!(
            check.contains("verdict::close_count(verdict, &asked.entry.key, command_group)"),
            "확인 창의 수를 판정의 한 함수로 안 센다 — 빼는 셋(도우미 · 예외 · foreground)이 두 벌이 된다"
        );

        let batch = body_of("pub fn close_checks(", "\n}\n");
        assert_eq!(batch.matches("snapshot::take(").count(), 1, "배치가 스냅샷을 한 장이 아니게 찍는다");
        let taken = batch.find("snapshot::take(").expect("스냅샷을 찍는다");
        let listed = batch.find("shells.values().map(Shell::entry)").expect("셸 목록을 읽는다");
        assert!(
            taken < listed,
            "셸 목록({listed})을 스냅샷({taken})보다 먼저 읽는다 — 그 사이에 뜬 셸의 자손이 누구의 것도 아니게 된다"
        );
        assert!(batch.contains("checks_on("), "배치가 셸마다 답하는 자리를 안 지난다");
    }

    /// **셸 셋을 한 번에 물으면 스냅샷 한 장으로 셸마다 {명령, 자손 수}가 나오고, 그 값은 셸마다 따로 물은 것과
    /// 같다**(티켓 08). 종료 · 아카이브 확인 창이 셸 여럿을 한 번에 묻고, 셸 하나를 닫을 때는 하나만 묻는다 — 두
    /// 답이 어긋나면 같은 셸이 닫기 창에서는 조용하고 종료 창에서는 무언가 도는 셸이 된다.
    ///
    /// 셸 A(100)는 사람이 친 뒤 dev 서버 하나를 띄웠고, 잡 제어를 끈 채 뒤로 띄운 것(103)이 **셸 자신의 그룹(100)에**
    /// 산다. 셸 B(200)는 입력이 없다 — 자손은 모두 셸 도우미다. 셸 C(300)에서는 claude가 돌고(그 그룹 330과 MCP
    /// 서버), Bash 도구가 dev 서버(340, 제 세션)를 띄웠다. 못 읽은 셸의 오류는 제 자리에 남는다.
    ///
    /// **foreground 그룹은 명령이 돌 때만 뺀다**(`close_check`) — 그 갈래를 재는 것도 이 표다. A는 프롬프트에 서
    /// 있어 터미널을 쥔 그룹이 셸 자신(100)이다. 그 그룹을 늘 빼면 103이 수에서 빠져 A가 조용한 셸이 되고, 확인 창
    /// 없이 닫히며 103이 함께 끝난다. C의 331(그룹 330)은 명령의 그룹이라 빠진다 — 두 갈래가 한 표에 선다.
    /// 판정 표(`verdict`)는 `close_count`에 그룹을 곧바로 주므로 이 갈래를 못 잰다.
    #[test]
    fn one_snapshot_answers_every_shell_as_if_asked_alone() {
        use crate::processes::verdict::{Inputs, Occasion, ShellEntry};
        use crate::processes::{Identity, Proc, Snapshot};

        let row = |pid: u32, ppid: u32, pgid: u32, born: u64, key: Option<&str>| Proc {
            id: Identity { pid, started_us: born },
            ppid,
            pgid,
            uid: 501,
            name: format!("p{pid}"),
            argv0: None,
            command: None,
            shell_key: key.map(str::to_string),
        };
        let procs = vec![
            row(50, 1, 50, 1_000, None),
            row(100, 50, 100, 1_100, None),
            row(101, 100, 101, 2_000, None),
            row(102, 1, 102, 6_000, Some("G-1")),
            row(103, 100, 100, 6_500, None),
            row(200, 50, 200, 1_200, None),
            row(201, 200, 201, 2_000, None),
            row(202, 1, 202, 3_000, Some("G-2")),
            row(300, 50, 300, 1_300, None),
            row(330, 300, 330, 6_000, None),
            row(331, 330, 330, 6_100, None),
            row(340, 1, 340, 6_500, Some("G-3")),
        ];
        let snapshot = Snapshot { uid: 501, procs, skipped: 0 };
        let entry = |key: &str, pid: u32, born: u64, first_input_us: Option<u64>| ShellEntry {
            key: key.to_string(),
            process: Some(Identity { pid, started_us: born }),
            first_input_us,
        };
        let a = entry("G-1", 100, 1_100, Some(5_000));
        let b = entry("G-2", 200, 1_200, None);
        let c = entry("G-3", 300, 1_300, Some(5_000));
        let live = [a.clone(), b.clone(), c.clone()];
        let input = Inputs {
            snapshot: &snapshot,
            generation: "G",
            shells: &live,
            ending: &[],
            instances: &[],
            exceptions: &[],
            app_pid: 50,
            inherited_key: None,
            occasion: Occasion::Normal,
        };
        let asked = |entry: &ShellEntry, foreground: i32| {
            let pid = entry.process.expect("신원이 있다").pid;
            Ok(super::Asked { entry: entry.clone(), pid, foreground })
        };
        let gone: Result<super::Asked, String> = Err(super::gone(9));
        let questions = vec![asked(&a, 100), asked(&b, 200), asked(&c, 330), gone.clone()];

        let together = super::checks_on(&input, questions.clone());
        let alone: Vec<_> =
            questions.into_iter().flat_map(|one| super::checks_on(&input, vec![one])).collect();

        let quiet = |descendants| Ok(super::CloseCheck { command: false, descendants });
        assert_eq!(
            together,
            vec![quiet(2), quiet(0), Ok(super::CloseCheck { command: true, descendants: 1 }), Err(super::gone(9))],
            "셸마다 명령과 수가 어긋났다 — A가 1이면 프롬프트인데 셸 자신의 그룹(100)을 명령의 그룹으로 뺐다"
        );
        assert_eq!(together, alone, "셸 셋을 한 번에 물은 답이 하나씩 물은 답과 다르다");
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

    /// **셸 키는 자식을 띄우기 전에 기록에 오른다**(프로세스 스펙 S52 · 티켓 09). 기록에 없는 키의 프로세스가 한순간이라도
    /// 살아 있으면 다른 실행의 정리가 그것을 확정 고아로 본다 — 막 뜬 셸의 rc가 띄운 `gitstatusd`가 그 창에 선다.
    /// 띄우기에 실패하면 내린다.
    ///
    /// 실행으로는 순서를 못 잰다 — 자식이 뜨는 순간은 밖에서 안 보인다. 그래서 자리로 잰다. 실패하면 내리는 것은 풀 배선
    /// 장면 `RecordFailed`가 진짜 셸로도 잰다(macOS).
    #[test]
    fn the_shell_key_is_raised_before_the_shell_is_launched() {
        let spawn_fn = spawn_source();
        let mint = spawn_fn.find("mint_shell_id(pool)").expect("id를 발급하는 줄이 있다");
        let raise = spawn_fn.find("pool.record.raise(&shell_id)").expect("셸 키를 기록에 올리는 줄이 있다");
        let launch = spawn_fn.find("launch(mode, &dir, &shell_id").expect("셸을 띄우는 줄이 있다");
        assert!(
            mint < raise && raise < launch,
            "셸 키를 올리는 줄({raise})이 발급({mint})과 띄우기({launch}) 사이에 없다 — 키가 기록에 오르기 전에 셸이 뜬다"
        );
        let failed = &spawn_fn[launch..];
        let lower = failed.find("pool.record.lower(").expect("띄우기에 실패하면 키를 내리는 줄이 있다");
        let give_up = failed.find("return Err(").expect("띄우기에 실패하면 돌아간다");
        assert!(lower < give_up, "띄우기에 실패하고 키를 안 내린 채 돌아간다 — 없는 셸의 키가 기록에 남는다");
    }

    /// 판정은 **스냅샷을 먼저 찍고 인스턴스 기록을 그 뒤에 읽는다**(프로세스 스펙 S52). 셸 키는 자식을 띄우기 전에 기록에
    /// 오르므로, 스냅샷에 선 프로세스의 키는 그 뒤에 읽은 기록에 이미 있다. 뒤집히면 그 사이 뜬 셸의 자손이 「목록에 없는
    /// 이 세대 키」로 읽힌다. 판정을 부르는 여섯 자리를 모두 본다 — 다섯째가 `Processes` 화면의 스냅샷(티켓 26), 여섯째가 nav
    /// 메타의 배경 표본이다(티켓 29).
    #[test]
    fn the_records_are_read_after_the_snapshot() {
        for (path, body) in [
            ("close_checks", body_of("pub fn close_checks(", "\n}\n")),
            ("begin", body_of("fn begin(", "\n}\n")),
            ("end_for_exit", body_of("pub fn end_for_exit(", "\n}\n")),
            ("plan_startup", body_of("fn plan_startup(", "\n}\n")),
            ("screen", body_of("pub fn screen(", "\n}\n")),
            ("summarize", body_of("pub fn summarize(", "\n}\n")),
        ] {
            let taken = body.find("snapshot::take(").unwrap_or_else(|| panic!("{path}가 스냅샷을 안 찍는다"));
            let read = body.find("pool.record.records()").unwrap_or_else(|| panic!("{path}가 기록을 안 읽는다"));
            assert!(taken < read, "{path}: 기록({read})을 스냅샷({taken})보다 먼저 읽는다");
            assert!(body.contains("instances: &records"), "{path}: 읽은 기록을 판정에 안 넘긴다");
        }
    }

    /// `Processes` 화면의 스냅샷은 **풀의 셸 목록을 판정에 넘긴 셸 목록과 한 잠금 안에서** 읽는다(티켓 26). 두 목록이 다른
    /// 순간의 것이면 그 사이에 뜨거나 닫힌 셸이 한쪽에만 선다 — 화면이 판정의 셸을 풀에서 못 찾거나, 판정에 없는 셸을 풀
    /// 목록에서 본다(32의 화면 밖 셸이 그 차이를 셸로 센다). env는 **전부** 읽는다: 고아는 지금 풀의 어느 셸보다 먼저 태어났을
    /// 수 있어 셸 닫기의 가지치기(`env_scope`, S3)를 쓰면 표식이 안 읽혀 묶음에서 빠진다.
    ///
    /// 실행으로는 못 잰다 — 진짜 스냅샷은 이 맥의 표 전체라 기대값을 못 세운다. 자리로 잰다. 판정 결과가 와이어에 실리는
    /// 모양은 `processes::screen`의 검사가 잰다.
    #[test]
    fn the_screen_reads_the_pool_with_the_shells_it_judges() {
        let body = body_of("pub fn screen(", "\n}\n");
        assert_eq!(body.matches("snapshot::take(").count(), 1, "화면 스냅샷이 표를 한 장이 아니게 찍는다");
        assert!(body.contains("snapshot::take(EnvScope::All)"), "화면 스냅샷이 env를 가지치기한다 — 오래된 고아의 표식이 안 읽힌다");
        let taken = body.find("snapshot::take(").expect("스냅샷을 찍는다");
        assert_eq!(body.matches("pool.lock()").count(), 1, "풀을 두 번 잠근다 — 두 목록이 다른 순간의 것이 된다");
        let locked = body.find("pool.lock()").expect("풀을 잠근다");
        let judged = body.find("shells.values().map(Shell::entry)").expect("판정에 넘길 셸 목록을 읽는다");
        let listed = body.find("pool_shells(").expect("풀의 셸 목록을 읽는다");
        let records = body.find("pool.record.records()").expect("기록을 읽는다");
        assert!(taken < locked, "풀({locked})을 스냅샷({taken})보다 먼저 읽는다");
        assert!(
            locked < judged && locked < listed && judged < records && listed < records,
            "두 목록이 한 잠금 안에 없다 — 잠금 {locked} · 판정의 셸 {judged} · 풀의 셸 {listed} · 기록 {records}"
        );
        assert!(
            body.contains("ScreenSnapshot::of(&verdict, listed, &measured)"),
            "판정 결과와 풀의 셸 목록과 지표를 그대로 싣지 않는다"
        );
    }

    /// **지표는 판정 뒤에, 판정이 고른 것만, 풀 잠금 밖에서 읽는다**(티켓 28 · 프로세스 스펙 S38). 무엇이 우리 트리인지는 판정이
    /// 정하므로 판정보다 앞설 수 없고, 읽을 신원은 판정의 결과와 풀의 셸에서만 고른다(`screen::targets` — 이 맥의 다른 프로세스의 fd를
    /// 훑지 않는다). 프로세스마다 fd를 훑는 일이라 풀을 쥔 채 하면 그동안 셸 입력 · 크기 바꾸기 · 닫기가 기다린다.
    ///
    /// CPU%는 풀이 쥔 앞 표본과 견준다(`CpuMeter`) — 부를 때마다 새로 세우면 늘 첫 표본이라 CPU 칸이 영영 「—」다. 실행으로는 장면
    /// `Ask`가 잰다(macOS — 두 번 찍으면 둘째에 셸의 CPU%가 선다).
    #[test]
    fn the_screen_measures_what_the_verdict_picked_outside_the_pool_lock() {
        let body = body_of("pub fn screen(", "\n}\n");
        let judged = body.find("verdict::judge(").expect("판정한다");
        let read = body.find("metrics::read(screen::targets(&verdict, &listed))").expect("판정이 고른 것만 지표를 읽는다");
        let lock_ends = body.find("pool.record.records()").expect("잠금을 푼 뒤 기록을 읽는다");
        assert!(lock_ends < read && judged < read, "지표를 판정({judged})이나 풀 잠금이 풀리기({lock_ends}) 전에 읽는다 — {read}");
        assert_eq!(body.matches("metrics::read(").count(), 1, "지표를 두 번 읽는다");
        let sampled = body.find("pool.screen_cpu()").expect("풀이 쥔 앞 표본과 견준다");
        assert!(read < sampled, "읽기({read}) 전에 CPU% 표본을 넣는다({sampled})");
        assert!(!body.contains("CpuMeter::default()"), "부를 때마다 앞 표본을 새로 세운다 — CPU%가 늘 첫 표본이다");
    }

    /// **배경 표본은 화면 스냅샷과 같은 순서로 모은다**(티켓 29 · 프로세스 스펙 S52 · S38). 표를 한 장 찍고(env 전부 — 출처 불명은
    /// 지금 풀의 어느 셸보다 먼저 태어났을 수 있다), 판정의 셸 목록과 셸 프로세스의 신원을 한 잠금 안에서 읽는다. 지표는 판정 뒤,
    /// 잠금 밖에서 **합계에 드는 것만** 읽는다(`summary::targets` — 앱 본체와 이 실행의 셸 · 자손). `●`의 머리는 이 풀의 인스턴스
    /// 기록이 연 정리 기록에서 고른다 — 데이터 루트를 다시 계산하면 검사의 풀이 진짜 기록을 읽는다.
    ///
    /// 실행으로는 못 잰다 — 진짜 스냅샷은 이 맥의 표 전체라 기대값을 못 세운다. 값의 모양은 `processes::summary`의 검사가 잰다.
    #[test]
    fn the_background_sample_reads_like_the_screen_and_measures_only_the_total() {
        let body = body_of("pub fn summarize(", "\n}\n");
        assert!(body.contains("snapshot::take(EnvScope::All)"), "배경 표본이 env를 가지치기한다 — 오래된 출처 불명의 표식이 안 읽힌다");
        assert_eq!(body.matches("pool.lock()").count(), 1, "풀을 두 번 잠근다 — 판정의 셸과 셸 프로세스가 다른 순간의 것이 된다");
        let judged = body.find("verdict::judge(").expect("판정한다");
        let read = body.find("metrics::read(summary::targets(&verdict, &shells, app))").expect("합계에 드는 것만 지표를 읽는다");
        let records = body.find("pool.record.records()").expect("기록을 읽는다");
        assert!(records < read && judged < read, "지표를 판정({judged})이나 풀 잠금이 풀리기({records}) 전에 읽는다 — {read}");
        assert_eq!(body.matches("metrics::read(").count(), 1, "지표를 두 번 읽는다");
        assert!(body.contains("cleanup_log::look_head(&pool.record.events())"), "`●`의 머리를 이 풀의 정리 기록에서 안 고른다");
        assert!(!body.contains("screen_cpu"), "배경 표본이 화면의 앞 표본을 나눠 쓴다 — 두 박자가 섞인다");
    }

    /// **요약 IPC는 배경 표본의 마지막 장을 돌려준다**(티켓 29) — 부를 때마다 표를 찍지 않는다. 아직 한 장도 없으면 그 자리에서
    /// 모아 앉힌다(앱이 막 떠 첫 표본이 도는 중에 프런트가 묻는다). 연 적 없는 기록의 풀은 정리 기록을 안 읽는다 — 머리가 없다.
    ///
    /// 둘째 갈래는 이 맥의 표를 한 장 찍는다(읽기만 한다 — 아무것도 안 끝낸다).
    #[test]
    fn the_summary_answers_the_last_background_sample() {
        let pool = super::PtyPool::default();
        let kept = super::Summary { total: Some(1), webview_excluded: true, unknown: vec![], record_head: Some(9) };
        pool.background.keep(kept.clone());
        assert_eq!(super::summary(&pool), kept, "배경 표본이 앉힌 장을 안 돌려준다");

        let fresh = super::PtyPool::default();
        let first = super::summary(&fresh);
        assert_eq!(fresh.background.latest(), Some(first.clone()), "그 자리에서 모은 장을 안 앉혔다");
        assert_eq!(first.record_head, None, "연 적 없는 기록에서 머리를 골랐다 — 검사의 풀이 진짜 정리 기록을 읽는다");
    }

    /// 풀의 셸 목록은 **pty id 순**이다 — 풀이 해시 맵이라 그대로 두면 부를 때마다 순서가 흔들린다. 셸마다 pty id와 셸 키가 짝으로
    /// 서고(티켓 26), 그 셸이 마지막으로 무언가를 찍은 때(티켓 27 — 「조용함」의 경과)와 셸 프로세스의 신원(티켓 28 — 셸 자신의 지표를
    /// 찾는 열쇠)이 함께 간다. 넷이 한 셸의 것으로 붙어 다닌다. 지표는 아직 비었다 — 판정 뒤에 읽어 채운다.
    #[test]
    fn the_pool_list_is_in_pty_order_with_each_shells_key() {
        let zsh = |pid: u32| Some(crate::processes::Identity { pid, started_us: u64::from(pid) * 10 });
        let shell = |pty_id: u32, key: &str, last_output_ms: u64, process: Option<crate::processes::Identity>| super::PoolShell {
            pty_id,
            shell_key: key.into(),
            last_output_ms,
            process,
            metrics: Default::default(),
        };
        assert_eq!(
            super::pool_shells([(3, "G-3", 30, zsh(33)), (1, "G-1", 10, zsh(11)), (2, "G-2", 20, None)].into_iter()),
            vec![shell(1, "G-1", 10, zsh(11)), shell(2, "G-2", 20, None), shell(3, "G-3", 30, zsh(33))]
        );
    }

    /// **셸이 무언가를 찍을 때마다 그 시각을 적는다**(티켓 27). `Processes`의 「조용함」 경과가 이 값에서 잰다 — 사람이 친 글자의
    /// 메아리도, 끝난 명령 뒤의 프롬프트도 출력이라, 이 값 뒤로는 셸에 아무 일이 없었다. 적는 자리는 읽기 스레드가 조각을 **보내기
    /// 전**이다: 보낸 뒤에 적으면 채널이 닫혀 끊는 마지막 조각이 안 적힌다. 띄운 순간에도 한 번 적는다 — 아직 아무것도 안 찍은 셸이
    /// 에포크(1970)부터 조용하다고 읽히지 않게.
    ///
    /// 실행으로는 장면 `Ask`가 잰다(macOS — 셸에 친 줄의 메아리가 값을 올린다). 여기서는 두 자리를 글자로 붙든다.
    #[test]
    fn the_reader_stamps_each_output_before_sending_it() {
        let spawn_fn = spawn_source();
        let born = spawn_fn.find("AtomicU64::new(now_ms())").expect("띄울 때 한 번 적는다");
        let insert = spawn_fn.find("pool.lock().insert(").expect("풀에 앉히는 줄이 있다");
        assert!(born < insert, "풀에 앉힌 뒤에 첫 시각을 적는다 — 그 사이의 화면 스냅샷이 빈 값을 읽는다");
        let read = &spawn_fn[spawn_fn.find("Ok(n) => {").expect("읽은 조각을 다루는 갈래가 있다")..];
        let stamp = read.find("stamps.store(now_ms()").expect("읽은 조각마다 시각을 적는다");
        let send = read.find("on_frame.send(").expect("읽은 조각을 보낸다");
        assert!(stamp < send, "조각을 보낸 뒤에 적는다 — 채널이 닫혀 끊는 마지막 조각이 안 적힌다");
    }

    /// 앱 종료는 **끝내기를 마감한 뒤, 그 결과로** 인스턴스 기록을 닫는다(프로세스 스펙 「인스턴스 기록 › 지우는 때」 · 티켓
    /// 09). 「못 끝냄」이 있으면 남기는 것은 `Record::close`가 하고 `instances`의 검사가 잰다. 여기서 재는 것은 그 앞의
    /// 배선이다 — 종료가 마감해 받은 결과를 그대로 넘기는가. 빈 목록으로 닫거나 마감 전에 닫으면 SIGKILL에도 산 것이 있어도
    /// ⌘Q가 기록을 지운다. 다음 실행의 시작 정리는 그 세대를 「기록 없음 → 출처 불명」으로 보고 한 번 더 해 보지 않는다.
    ///
    /// 실행으로는 못 잰다 — SIGKILL에도 사는 프로세스를 검사가 세울 수 없고(좀비는 신원이 없다), 실물 장면 `Record`의 종료는
    /// 끝낼 것이 없어 결과가 `[]`다. `close(&[])`로 바꾼 변형이 이 크레이트의 L1 전부를 통과했다(실측). 그래서 자리로 잰다.
    #[test]
    fn the_exit_closes_the_record_with_what_its_ending_returned() {
        const FINISH: &str = "let outcomes = closing.finish();";
        let body = body_of("pub fn end_for_exit(", "\n}\n");
        // 마감 줄이 **끝난** 자리 — 아래 「사이」가 마감 줄 자신의 `let`을 세지 않게.
        let finish = body.find(FINISH).expect("종료가 끝내기를 마감해 결과를 받는다") + FINISH.len();
        let close = body
            .find("pool.record.close(&outcomes);")
            .expect("종료가 마감한 결과로 기록을 닫지 않는다 — 「못 끝냄」이 있어도 기록이 지워진다");
        assert!(
            finish < close,
            "기록을 닫는 줄({close})이 마감({finish})보다 앞에 있다 — 결과가 서기 전에 닫는다"
        );
        assert!(
            !body[finish..close].contains("let "),
            "마감과 닫기 사이에서 결과를 다시 묶는다 — 닫기가 마감한 결과를 못 받는다"
        );
        assert_eq!(body.matches("record.close(").count(), 1, "종료가 기록을 두 번 닫는다 — 먼저 닫은 쪽이 이긴다");
        assert_eq!(body.matches(".finish()").count(), 1, "종료가 끝내기를 두 번 마감한다");
    }

    /// 정리 기록에 적을 행을 뜨는 두 자리(셸 닫기 · 앱 종료)는 판정의 도우미 표시를 넘기고, 종료는 **새로 맡은 것만** 뜬다
    /// (티켓 11 · 프로세스 스펙 P1).
    ///
    /// 실행으로는 비싸다 — 도우미는 사람의 zsh 설정(gitstatusd)이 있어야 서고, 종료가 진행 중인 끝내기의 대상까지 뜨면 닫은
    /// 셸의 유예 중에 앱이 닫힐 때만 한 대상이 「셸 닫기」와 「앱 종료」 두 줄로 적힌다. 표시를 버리면 사람이 띄운 적 없는
    /// 이름이 셸마다 「앱이 끝낸 것」으로 적힌다. 그래서 자리로 잰다 — 도우미를 빼는 규칙은 `cleanup_log`의 검사가 잰다.
    #[test]
    fn the_log_rows_carry_the_helper_mark_and_the_exit_takes_only_the_fresh() {
        let begin = body_of("fn begin(", "\n}\n");
        assert!(begin.contains("verdict.helpers.contains(&proc.id)"), "셸 닫기가 정리 기록의 행에 도우미 표시를 안 넘긴다");
        let exit = body_of("pub fn end_for_exit(", "\n}\n");
        assert!(exit.contains("exit.helpers.contains(&row.id)"), "앱 종료가 정리 기록의 행에 도우미 표시를 안 넘긴다");
        assert!(
            exit.contains("closing\n        .fresh()"),
            "앱 종료가 진행 중인 끝내기의 대상까지 「앱 종료」로 뜬다 — 그 끝내기를 시작한 뒤 스레드가 제 까닭으로 또 적는다"
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
            // 셸이 스스로 끝날 때(티켓 13) — 리더 스레드가 풀에서 빼는 자리도 같다.
            ("exited", body_of("fn exited(", "\n}\n"), ".remove(&id)"),
        ] {
            let count = body.find("pool.endings.claim()").unwrap_or_else(|| panic!("{path}가 셈을 안 한다"));
            let left = body.find(leave).unwrap_or_else(|| panic!("{path}가 셸을 안 뺀다"));
            assert!(
                count < left,
                "{path}: 셈({count})이 빼기({left})보다 뒤에 있다 — 그 사이에 앱 종료가 오면 뺀 셸의 자손이 남는다"
            );
        }
    }

    /// **셸 스스로 끝남의 알림이 싣는 모양**(티켓 13). 프런트(`processes-ended.ts`의 `ProcessesEnded`)가 칸 이름으로 읽는다 —
    /// 글자로 못박는다. 까닭은 정리 기록의 낱말 그대로다.
    #[test]
    fn the_ended_event_crosses_the_wire_in_the_shape_the_frontend_reads() {
        let ended = super::Ended { reason: super::Reason::ShellExit, shell_id: 3, count: 2 };
        assert_eq!(
            serde_json::to_value(ended).unwrap(),
            serde_json::json!({ "reason": "shellExit", "shellId": 3, "count": 2 })
        );
    }

    /// 셸 스스로 끝남은 **리더의 신원을 아는 그룹만** 쏜다(티켓 13). 그 셸은 이미 거둬졌다 — 신원을 모르는 그룹은 「그 번호의
    /// 그룹이 아직 있는가」만 보고 쏘는데, 거둬진 셸의 번호는 비었다가 남의 그룹 리더에게 다시 갈 수 있다. 다른 까닭은 셸이
    /// 살아 있을 때라 그 번호가 그 셸의 것이고, 옛 방어선(그룹이 있는 동안) 그대로 쏜다.
    ///
    /// 실물 장면으로는 못 밟는다 — macOS는 셸 그룹의 신원을 늘 쥐어(`identity_of`) 신원을 모르는 셸 그룹이 없다. 다른 OS의
    /// 모양이라 표로 재고, `begin`이 이것을 거치는지는 자리로 잰다.
    #[test]
    fn a_shell_that_exited_signals_only_the_groups_it_can_name() {
        use crate::processes::ending::Group;
        let named = Group { pgid: 110, leader: Some(crate::processes::Identity { pid: 110, started_us: 1_000 }) };
        let nameless = Group { pgid: 120, leader: None };
        let both = vec![named, nameless];
        assert_eq!(
            super::groups_signalled(both.clone(), super::Reason::ShellExit),
            vec![named],
            "셸 스스로 끝남이 신원 모르는 그룹을 쏜다 — 거둬진 셸의 번호에 앉은 남의 그룹이 SIGHUP을 받을 수 있다"
        );
        for reason in [super::Reason::ShellClose, super::Reason::Reload, super::Reason::Archive, super::Reason::McpArchive] {
            assert_eq!(
                super::groups_signalled(both.clone(), reason),
                both,
                "{reason:?}: 살아 있는 셸의 그룹은 신원을 몰라도 옛 방어선대로 쏜다"
            );
        }
        assert!(
            body_of("fn begin(", "\n}\n").contains("groups_signalled(groups_led(&shells, &pgids, &snapshot), cause.reason)"),
            "끝내기의 앞 절반이 쏠 그룹을 까닭으로 거르지 않는다"
        );
    }

    /// **시작 정리의 순서**(프로세스 스펙 「시작 시 확정 고아 자동 정리」 · S5 · 티켓 10). 실행으로는 못 잡는 자리들이다 —
    /// 실물 장면 `Startup`은 판정과 끝내기 사이에서 끝낼 것을 제 자식으로 거르므로 이 함수들을 따로 부른다.
    ///
    /// - 앱의 정리가 판정과 끝내기를 **그대로 잇는다** — 사이에서 거르거나 바꾸면 실물 장면이 잰 것과 앱이 하는 것이 갈린다.
    /// - 판정 전에 **판정 중으로 센다.** 판정하는 사이 앱이 닫히면 종료가 이 끝내기를 기다려 마감한다. 뒤집혀도 터지는 것은
    ///   그 ms 창에 ⌘Q가 올 때뿐이다(셸 닫기의 같은 자리는 `a_close_is_counted_before_its_shell_leaves_the_pool`).
    /// - 판정은 **시작 정리의 판정**(`verdict::at_startup` — 확정 고아만, 이 실행 것은 안 봄)이다.
    /// - 죽은 실행의 기록은 끝내기를 **마감한 뒤에** 지운다. 먼저 지우면 끝내기가 도는 사이 앱이 닫혔을 때 남은 고아가 다음부터
    ///   출처 불명이 되어 영영 안 치워진다.
    /// - 판정에 **앱의 pid와 앱이 물려받은 셸 키**를 넘긴다(프로세스 스펙 S6). 설치본 셸에서 띄운 dev 앱이 제 vite와 제
    ///   조상을 지난 실행의 확정 고아로 읽지 않게 하는 배선이다. 물려받은 키는 실물 장면 `Startup`도 재지만 macOS에서만
    ///   돈다. 앱 pid는 실물 장면이 못 잰다 — 안쪽 검사 프로세스(앱)는 물려받은 키로도 막히고, 그 조상은 검사를 띄운
    ///   사용자의 셸 쪽이라 죽은 실행의 키를 물릴 수 없다. `inherited_key: None`으로 바꾼 변형이 이 크레이트의 L1 전부를
    ///   통과했다(실측) — 이 핀과 실물 장면의 「물려받은 키」 줄이 그 뒤에 섰다.
    #[test]
    fn the_startup_cleanup_counts_itself_judges_ends_then_forgets() {
        assert!(
            body_of("pub fn clean_up_at_startup(", "\n}\n").contains("carry_out(pool, plan_startup(pool, &exceptions()))"),
            "앱의 시작 정리가 판정과 끝내기를 그대로 잇지 않는다 — 실물 장면이 잰 것과 앱이 하는 것이 갈린다"
        );
        let plan = body_of("fn plan_startup(", "\n}\n");
        let counted = plan.find("pool.endings.claim()").expect("시작 정리가 판정 중으로 안 센다");
        let taken = plan.find("snapshot::take(").expect("시작 정리가 스냅샷을 안 찍는다");
        assert!(counted < taken, "셈({counted})이 판정({taken})보다 뒤에 있다 — 그 사이에 앱이 닫히면 이 끝내기가 마감되지 않는다");
        assert!(plan.contains("verdict::at_startup(&input)"), "시작 정리가 확정 고아만 고르는 판정을 안 지난다");
        assert!(plan.contains("verdict::dead_instances(&input)"), "시작 정리가 지울 기록을 판정과 같은 입력으로 안 고른다");
        assert!(
            plan.contains("app_pid: std::process::id(),"),
            "시작 정리가 판정에 이 앱의 pid를 안 넘긴다 — 앱과 그 조상이 막히지 않는다"
        );
        assert!(
            plan.contains("inherited_key: crate::processes::inherited_key(),"),
            "시작 정리가 판정에 앱이 물려받은 셸 키를 안 넘긴다 — 설치본 셸에서 띄운 dev 앱이 제 vite를 확정 고아로 끝낸다"
        );

        let carry = body_of("fn carry_out(", "\n}\n");
        let ended = carry.find(".finish()").expect("시작 정리가 끝내기를 마감하지 않는다");
        let forgot = carry.find("pool.record.forget(").expect("시작 정리가 죽은 실행의 기록을 안 지운다");
        assert!(ended < forgot, "기록을 지우는 줄({forgot})이 끝내기 마감({ended})보다 앞에 있다 — 고아가 남은 채 기록이 사라진다");
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

        // 빌더는 띄우는 몫(`launch`) 안에 있다 — 발급이 그것을 부르기 전이고, 발급된 ID가 빌더까지 간다.
        let mint = spawn_fn.find("mint_shell_id(pool)").expect("id를 발급하는 줄이 있다");
        let build = spawn_fn.find("launch(mode, &dir, &shell_id").expect("발급된 ID로 셸을 띄우는 줄이 있다");

        assert!(
            mint < build,
            "발급({mint})이 빌더({build})보다 뒤에 있다 — 빌더에 넘길 셸 ID가 아직 없다"
        );
        assert!(
            body_of("fn launch(", "\n}\n").contains("shell_builder(mode, dir, shell_id)"),
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

    /// **셸 띄우기 답이 셸 키를 싣는다**(프로세스 스펙 S34 · 티켓 23) — 와이어 모양을 글자로 못박는다. 프런트는 이 칸
    /// (`shellKey`)으로 셸을 가리킨다: 방금 부른 셸로 가는 길이 키로 셸을 찾는다. 칸 이름이 어긋나면 프런트는 `undefined`를
    /// 받아 모든 셸이 키 없는 셸이 되고, 그 길은 조용히 아무 데도 안 간다. 실린 값이 셸 env의 표식과 같은지는 셸을 실제로
    /// 띄우는 `tests/top_terminal.rs`가 잰다.
    #[test]
    fn the_spawn_answer_crosses_the_wire_with_the_shell_key() {
        let spawned = super::PtySpawned { id: 3, shell_key: "G-3".to_string(), shell_name: "zsh".to_string() };
        assert_eq!(
            serde_json::to_value(&spawned).expect("직렬화된다"),
            serde_json::json!({ "id": 3, "shellKey": "G-3", "shellName": "zsh" })
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

    /// `spawn`의 본문. 셋 중 둘이 이것을 보므로 표식을 한 자리에만 적는다. 띄우는 몫(`launch`)은 따로 잘라 본다.
    fn spawn_source() -> &'static str {
        body_of("pub fn spawn(", "\n}\n")
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
        /// `CloseKeeping`과 같은 자식 둘과 목록으로, 셸을 닫지 않고 앱 종료 길을 부른다. 종료는 닫기(`end`)와 따로
        /// 판정을 부르므로(`verdict::at_exit`) 목록을 넘기는 줄도 따로다 — 그 줄을 재는 장면이다. 인스턴스 기록을 연 풀로 돌아
        /// 종료가 끝낸 것을 정리 기록에 적는지도 본다(티켓 11).
        ExitKeeping,
        /// 닫지 않고 **묻기만 한다**(티켓 08). 셸 도우미 · 사람이 띄운 것 · 예외 이름 · 명령을 차례로 세우며 닫기 전
        /// 물음의 답을 본다. 판정을 끝내기에 넘기지 않는다 — 거둘 때는 이 장면이 띄운 자식과 이 셸 그룹에만 보낸다.
        Ask,
        /// 인스턴스 기록을 연 풀로(티켓 09) 셸을 띄우고 ×로 닫는다. 자식은 SIGTERM을 무시한다 — 끝내기가 2초 도는 동안
        /// 셸 키가 기록에 남는지 본다. 그 셸의 리더 스레드는 닫기 뒤에 끝나지만 다시 끝내지 않는다(티켓 13). 이어서 둘째 셸이
        /// `exit`로 스스로 끝나고, 앱 종료 길이 기록을 지운다.
        Record,
        /// 인스턴스 기록을 연 풀로 셸 띄우기가 실패한다 — 빌더에서(없는 `$SHELL`), 자식을 띄우다가(실행할 수 없는
        /// `$SHELL`). 올린 키가 내려가는지 본다. 셸이 안 떠 신호를 보낼 것이 없다.
        RecordFailed,
        /// 인스턴스 기록을 연 풀로 시작 정리를 돈다(티켓 10). 셸은 안 띄운다 — 죽은 실행의 기록과 그 셸 키를 문 자식, 기록이
        /// 없는 세대의 키를 문 자식을 세우고, 시작 정리가 무엇을 고르고 끝내고 지우는지 본다.
        Startup,
        /// 인스턴스 기록을 연 풀로 셸을 띄우고, 사람이 친 셸에서 표식 자식을 띄운 뒤 셸에 `exit`를 친다(티켓 13). 셸이 스스로
        /// 끝나면 리더 스레드가 그 셸 키를 문 생존자를 끝낸다. 자식은 SIGTERM을 무시한다 — 끝내기가 2초 도는 동안 키가 기록에
        /// 남는지 본다. 끝낸 것이 정리 기록과 알림에 서는지도 본다.
        Exit,
    }

    #[cfg(target_os = "macos")]
    impl Scene {
        const ALL: [Scene; 11] = [
            Scene::Close,
            Scene::CloseIgnoring,
            Scene::CloseThenExit,
            Scene::Reload,
            Scene::CloseKeeping,
            Scene::ExitKeeping,
            Scene::Ask,
            Scene::Record,
            Scene::RecordFailed,
            Scene::Startup,
            Scene::Exit,
        ];

        fn name(self) -> &'static str {
            match self {
                Scene::Close => "close",
                Scene::CloseIgnoring => "close-ignoring",
                Scene::CloseThenExit => "close-then-exit",
                Scene::Reload => "reload",
                Scene::CloseKeeping => "close-keeping",
                Scene::ExitKeeping => "exit-keeping",
                Scene::Ask => "ask",
                Scene::Record => "record",
                Scene::RecordFailed => "record-failed",
                Scene::Startup => "startup",
                Scene::Exit => "exit",
            }
        }

        /// 셸에서 띄울 자식의 역할(`processes::testkit`).
        fn role(self) -> &'static str {
            match self {
                Scene::Close | Scene::CloseKeeping | Scene::ExitKeeping | Scene::Ask => "sleep",
                _ => "ignore-term",
            }
        }

        /// 예외 이름으로 부른 자식을 하나 더 띄우고, 그 이름을 설정의 예외 목록에 적는 장면인가.
        fn keeps(self) -> bool {
            matches!(self, Scene::CloseKeeping | Scene::ExitKeeping)
        }

        /// 인스턴스 기록을 연 풀로 도는 장면인가. 나머지 장면의 풀은 기록을 안 연다 — 아무 파일도 안 쓴다. 정리 기록(티켓 11)도
        /// 연 기록만 쓴다.
        fn records(self) -> bool {
            matches!(self, Scene::Record | Scene::RecordFailed | Scene::Startup | Scene::ExitKeeping | Scene::Exit)
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

    /// **앱을 꺼도 예외 목록에 걸린 이름의 자식은 산다**(프로세스 결정 5 · 티켓 06). 앱 종료는 셸 닫기 · 새로고침과
    /// 달리 `end`를 안 지나고 `end_for_exit`에서 판정(`verdict::at_exit`)을 따로 부른다 — 설정을 읽어 판정에 넘기는
    /// 줄이 거기 따로 있고, 위 닫기 장면은 그 줄을 안 지난다. 종료는 이 세대의 표식을 문 것을 모두 끝내니, 그 줄이
    /// 빠지면 아틀리에 셸에서 띄운 tmux 서버와 그 창의 셸 · 명령이 ⌘Q마다 끝난다.
    ///
    /// 앵커: 다른 하나(예외가 아닌 표식 자식)는 종료 길이 돌아올 때 이미 끝나 있다 — 종료가 아무것도 안 끝내도
    /// 「남았다」는 참이 된다.
    #[cfg(target_os = "macos")]
    #[test]
    fn the_exit_leaves_the_child_named_on_the_exception_list() {
        on_the_pool_side("the_exit_leaves_the_child_named_on_the_exception_list", Scene::ExitKeeping);
    }

    /// **풀 배선 — 닫기 전 물음**(티켓 08 · 프로세스 스펙 P1 · S55). 진짜 zsh로 `command_running`이 확인 창에 줄 답을
    /// 본다: 사람이 입력하기 전에 뜬 것(셸 도우미)은 수에 안 들고, 입력 뒤에 제 세션으로 떨어진 dev 서버와 잡 제어
    /// 밖에서 셸 자신의 그룹에 뜬 것은 들고, 예외 목록의 이름과 명령 자신(foreground 그룹)은 안 든다. 배치 물음도
    /// 같은 답을 낸다.
    ///
    /// p10k 셸을 입력 없이 닫으면 창이 안 뜨는 것과, claude Bash 도구가 dev 서버를 띄운 셸이 그 수를 말하는 것의
    /// 백엔드 절반이다. 창의 절반은 L3(`e2e/close-confirm-count.spec.ts`)가 잰다.
    #[cfg(target_os = "macos")]
    #[test]
    fn asking_before_a_close_counts_what_a_person_spawned() {
        on_the_pool_side("asking_before_a_close_counts_what_a_person_spawned", Scene::Ask);
    }

    /// **풀 배선 — 인스턴스 기록의 셸 키**(티켓 09 · 프로세스 스펙 S52). 헤드리스로 셸을 띄우면 그 키가 기록에 오르고, ×로
    /// 닫으면 **끝내기가 끝난 뒤에** 내려간다 — SIGTERM을 무시하는 자식이 유예 2초를 사는 동안 키는 기록에 남는다. 그
    /// 사이에 다른 실행이 정리를 돌리면 그 자식은 「목록에 있는 셸의 자손」이라 확정 고아가 아니다. 셸이 `exit`로 스스로
    /// 끝나면 그 셸의 끝내기(끝낼 것이 없다) 뒤에 내려간다. 앱 종료 길은 못 끝낸 것이 없으면 기록을 지운다.
    ///
    /// **×로 먼저 닫은 셸은 두 번 끝나지 않는다**(프로세스 스펙 S49 · 티켓 13). 닫기가 셸을 끝내면 그 셸의 리더 스레드도 곧
    /// 끝나는데, 풀에서 빼기가 셸을 돌려주지 않으니 아무것도 안 한다 — 두 번째 끝내기 · 「셸 스스로 끝남」 기록 · 알림이 없고,
    /// 유예 중에 키를 먼저 내리지도 않는다. 두 번째 끝내기가 돌면 그 자식은 닫기의 유예 안에 SIGTERM을 받고 사라지므로
    /// 「끝남」으로 적히고 알려진다 — 여기서 보인다.
    ///
    /// 앵커: 닫기가 돌아온 순간 키는 아직 기록에 있고 자식은 살아 있다.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_shell_key_stays_on_the_record_until_its_ending_is_done() {
        on_the_pool_side("a_shell_key_stays_on_the_record_until_its_ending_is_done", Scene::Record);
    }

    /// **셸이 스스로 끝나도 그 셸에서 띄운 것이 남지 않는다**(프로세스 결정 3 · 6 · 프로세스 스펙 S49 · P4 · 티켓 13). 사람이
    /// 친 셸에서 표식 자식을 띄우고(트리가 끊겨 부모가 launchd다 — claude Bash 도구가 띄운 dev 서버의 모양) 셸에 `exit`를 친다.
    /// 셸 pid는 이미 거둬져 PID 트리가 없다 — 판정은 그 셸 키를 문 생존자로 자식을 찾아 끝낸다.
    ///
    /// - 인스턴스 기록의 키는 **끝내기가 끝난 뒤에** 내려간다(프로세스 스펙 S52). 자식이 SIGTERM을 무시해 유예 2초를 사는 동안
    ///   키는 남는다 — 그사이 다른 실행의 정리가 그 자식을 확정 고아로 보지 않게.
    /// - 끝낸 것은 정리 기록에 「셸 스스로 끝남」 한 줄로 남고(owner 없음), 끝낸 수가 알림으로 나간다.
    ///
    /// 앵커: 셸이 풀에서 빠진 순간 키는 아직 기록에 있고 자식은 살아 있다.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_shell_that_exits_on_its_own_ends_the_child_it_marked_and_says_so() {
        on_the_pool_side("a_shell_that_exits_on_its_own_ends_the_child_it_marked_and_says_so", Scene::Exit);
    }

    /// **셸 띄우기가 실패하면 올린 키를 내린다**(티켓 09). 키는 자식을 띄우기 전에 오른다 — 빌더가 `$SHELL`을 거절하거나
    /// 자식을 띄우다 실패하면 그 키의 셸은 끝내 없다. 남겨 두면 기록이 없는 셸을 쥐고 있다고 말한다.
    ///
    /// 앵커: 실패마다 기록의 갱신 시각이 움직인다 — 키를 올렸다 내리는 쓰기가 실제로 있었다.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_shell_that_fails_to_spawn_takes_its_key_off_the_record() {
        on_the_pool_side("a_shell_that_fails_to_spawn_takes_its_key_off_the_record", Scene::RecordFailed);
    }

    /// **시작 정리는 죽은 실행이 남긴 표식 자식을 끝내고 그 실행의 기록을 지운다**(프로세스 결정 6 · 티켓 10). 기록이 없는
    /// 세대의 키를 문 자식은 출처 불명이라 고르지 않는다 — 누구의 것인지 모른다. 앱이 크래시한 뒤 다시 켜면 지난 실행의
    /// dev 서버가 끝나는 것의 백엔드 절반이다(토스트의 절반은 L3 `e2e/startup-report.spec.ts`).
    ///
    /// 안쪽 검사 프로세스가 임시 데이터 루트에 제 기록을 열고, 죽은 실행의 기록(앱 신원 = 이 프로세스의 pid에 다른 시작
    /// 시각 — 그 pid를 남이 받은 모양, 프로세스 스펙 S9)을 곁에 쓴다. 판정은 이 기계의 표 전체를 읽지만 **끝내기에는 이
    /// 검사가 띄운 자식만 넘긴다.**
    ///
    /// 지우기 직전에 앱이 **지금도** 없는지 다시 보는 것도 잰다: 판정이 죽은 것으로 읽었지만 지금 사는 실행(스냅샷 뒤에 막
    /// 뜬 실행의 모양)의 기록은 남는다.
    ///
    /// **앱이 물려받은 셸 키를 문 것은 안 고른다**(프로세스 스펙 S6). 설치본 셸에서 `pnpm tauri dev`로 띄운 dev 앱과 그
    /// vite는 설치본 셸의 키를 함께 문다. 설치본이 죽어 그 기록이 남으면 vite는 죽은 실행의 키를 문 확정 고아 (가)의 모양이다
    /// — 다시 뜬 dev 앱이 제 프런트 서버를 끝낸다. 셸 닫기와 종료는 이 세대의 자손만 끝내 이 키를 만날 일이 없어, 이 배선이
    /// 실제로 지키는 자리는 시작 정리뿐이다. 그래서 안쪽 검사 프로세스가 죽은 실행의 키를 물려받고 뜬다(`on_the_pool_side`).
    ///
    /// 앵커: 고른 것이 끝난다 — 아무것도 안 고르면 「기록이 없는 세대의 자식은 안 골랐다」와 「물려받은 키를 문 자식은 안
    /// 골랐다」가 저절로 참이 된다.
    #[cfg(target_os = "macos")]
    #[test]
    fn the_startup_cleanup_ends_what_a_dead_run_left_and_forgets_its_record() {
        on_the_pool_side("the_startup_cleanup_ends_what_a_dead_run_left_and_forgets_its_record", Scene::Startup);
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
    /// 입력(물려받은 키 없음)이 되게 지운다. 시작 정리 장면만 **이 검사가 지은 키**를 대신 물려준다 — 설치본 셸에서 띄운
    /// dev 앱의 모양이다. 값은 이 검사 프로세스의 pid로 지어 이 기계의 어떤 실제 세대와도 안 겹치고, 어디서 돌리든 같다.
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
        let mut command = Command::new(crate::processes::testkit::exe());
        command
            .args(["--exact", &name, "--nocapture", "--test-threads", "1"])
            .env(POOL_SIDE, scene.name())
            .env("HOME", &home)
            .env("ATELIER_HOME", home.join(".atelier"))
            .env("SHELL", "/bin/zsh")
            .env_remove("ZDOTDIR")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        match scene {
            Scene::Startup => {
                command.env(crate::processes::SHELL_KEY_ENV, format!("test-{}-inherited-1", std::process::id()))
            }
            _ => command.env_remove(crate::processes::SHELL_KEY_ENV),
        };
        let mut inner = command.spawn().expect("검사 프로세스를 하나 더 띄운다");

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
        // 기록은 안쪽의 데이터 루트(임시 `ATELIER_HOME`)에만 쓴다.
        if scene.records() {
            super::open_record(&pool, &atelier_core::data_root(), env!("CARGO_PKG_VERSION"));
        }
        // 앱이 setup에서 거는 알림 자리(`announce_ends`) 대신 받은 것을 모은다 — 앱은 여기서 이벤트를 쏜다(티켓 13).
        let announced = std::sync::Arc::new(std::sync::Mutex::new(Vec::<super::Ended>::new()));
        let heard_end = std::sync::Arc::clone(&announced);
        pool.announce_with(move |ended| heard_end.lock().unwrap_or_else(|e| e.into_inner()).push(ended));
        if scene == Scene::RecordFailed {
            return record_failed_side(&pool, &home);
        }
        if scene == Scene::Startup {
            return startup_side(&pool);
        }
        let spoke = std::sync::Arc::new(AtomicBool::new(false));
        let heard = std::sync::Arc::clone(&spoke);
        let frames = Channel::new(move |_| {
            heard.store(true, std::sync::atomic::Ordering::Relaxed);
            Ok(())
        });
        let spawned = super::spawn(&pool, Mode::Atelier, Some(home.display().to_string()), 80, 24, frames)
            .expect("셸을 띄운다");
        let key = super::shell_id(spawned.id);
        let raised_on_spawn = listed(&key);

        // 셸이 무언가(프롬프트)를 내보낸 뒤에 친다 — 읽기 전에 쓴 줄을 셸이 버릴 수 있다.
        wait_until(|| spoke.load(std::sync::atomic::Ordering::Relaxed));
        let shell_pid = pool.lock().get(&spawned.id).and_then(|shell| shell.pid);
        if scene == Scene::Ask {
            return ask_side(&pool, spawned.id, &key, shell_pid);
        }
        let args = child_args().join(" ");
        // 예외 장면의 자식이 부를 이름. 이 검사 프로세스의 pid를 붙여 이 기계의 어떤 실제 이름과도 안 겹치게 한다 —
        // 예외 목록은 안쪽의 데이터 루트(임시 `ATELIER_HOME`)의 설정 파일에만 적는다.
        let keep_name = format!("atelier-keep-{}", std::process::id());
        if scene.keeps() {
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
            Scene::CloseKeeping | Scene::ExitKeeping => {
                let child = |argv0: &str| {
                    format!(
                        "( {CHILD_ROLE}={} {argv0}'{}' {args} </dev/null >/dev/null 2>&1 & )",
                        scene.role(),
                        exe().display()
                    )
                };
                format!("{}; {}\n", child(""), child(&format!("ARGV0={keep_name} ")))
            }
            // 기록 장면의 자식도 `ARGV0`로 부른다 — 짧은 이름으로. 정리 기록의 명령줄은 앞 200자라, 테스트 바이너리의 전체
            // 경로를 argv[0]으로 두면 뒤의 인자가 잘리는 자리가 코드가 아니라 체크아웃 · target 경로의 길이에 달린다(경로가
            // 143자를 넘으면 자식 테스트 이름이 잘렸다 — 재 봤다). 커널 이름은 여전히 exec 경로에서 온다.
            Scene::Record => format!(
                "( {CHILD_ROLE}={} ARGV0={RECORD_ARGV0} '{}' {args} </dev/null >/dev/null 2>&1 & )\n",
                scene.role(),
                exe().display()
            ),
            _ => format!(
                "( {CHILD_ROLE}={} '{}' {args} </dev/null >/dev/null 2>&1 & )\n",
                scene.role(),
                exe().display()
            ),
        };
        // 기록 장면은 사람이 친 것으로 알린다 — 입력이 없는 셸의 자손은 모두 셸 도우미라(프로세스 스펙 P1) 정리 기록이 그
        // 닫기를 안 적는다(티켓 11). 알린 시각 뒤에 뜬 자식은 사람이 띄운 것이다.
        if matches!(scene, Scene::Record | Scene::ExitKeeping | Scene::Exit) {
            super::note_first_input(&pool, spawned.id, crate::processes::cleanup_log::now_ms()).expect("첫 입력을 알린다");
        }
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
            child.is_some() && (!scene.keeps() || kept.is_some())
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
            Scene::Close | Scene::CloseIgnoring | Scene::CloseThenExit | Scene::CloseKeeping | Scene::Record => {
                super::kill(&pool, spawned.id, crate::processes::cleanup_log::CloseReason::ShellClose, SCENE_OWNER).expect("셸을 닫는다");
            }
            Scene::Reload => super::end_for_reload(&pool),
            // 셸을 풀에 둔 채 부른다 — 앱이 셸을 연 채 닫히는 보통의 ⌘Q다.
            Scene::ExitKeeping => {
                let _ = super::end_for_exit(&pool);
            }
            // 사람이 `exit`를 친다 — 거두는 것은 리더 스레드다. 셸이 풀에서 빠지기를 기다린다.
            Scene::Exit => {
                super::write(&pool, spawned.id, "exit\n").expect("셸에 exit를 친다");
                wait_until(|| !pool.lock().contains_key(&spawned.id));
            }
            // 위에서 제 안쪽(`ask_side` · `record_failed_side`)으로 갈라져 여기 안 온다.
            Scene::Ask | Scene::RecordFailed | Scene::Startup => {
                unreachable!("묻는 장면 · 띄우기가 실패하는 장면 · 시작 정리 장면은 거두는 길을 안 탄다")
            }
        }
        let closed = began.elapsed();
        let emptied = pool.lock().is_empty();
        if scene == Scene::CloseThenExit {
            let _ = super::end_for_exit(&pool);
        }
        let returned = began.elapsed();
        let alive_on_return = alive();
        // 끝내기가 도는 동안 키가 기록에 남는지 본다 — 기록을 먼저 읽고 자식을 그 뒤에 본다. 키가 내려간 것을 본 순간 자식이
        // 아직 살아 있으면 끝내기가 끝나기 전에 내린 것이다.
        let listed_on_return = listed(&key);
        let mut lowered_while_alive = false;
        let lowered = matches!(scene, Scene::Record | Scene::Exit)
            && wait_until(|| {
                let still = listed(&key);
                lowered_while_alive |= !still && alive();
                !still
            });
        let ended = wait_until(|| !alive());
        let ended_after = began.elapsed();
        // 예외 자식에 신호가 갔다면 앵커와 같은 순간(SIGTERM)이다 — 앵커가 끝난 뒤로도 한동안 살아 있는지 본다.
        let survived = scene.keeps() && holds_for(Duration::from_millis(500), kept_alive);

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
        if scene == Scene::Record {
            return record_side(
                &pool,
                &home,
                raised_on_spawn,
                (listed_on_return, alive_on_return),
                lowered,
                lowered_while_alive,
                (&key, child),
                &announced,
            );
        }
        if scene == Scene::Exit {
            return exit_side(
                &announced,
                (listed_on_return, alive_on_return),
                (lowered, lowered_while_alive),
                ended_after,
                (&key, spawned.id, child),
            );
        }
        if scene.keeps() {
            assert!(kept.is_some(), "예외 이름({keep_name})으로 부른 자식이 5초 안에 서지 않았다");
            if scene == Scene::ExitKeeping {
                // 종료는 대상이 끝나기를 기다리고 돌아온다 — 앵커가 그때 살아 있으면 판정이 그것을 안 골랐다.
                assert!(!alive_on_return, "종료 길이 돌아왔는데 예외가 아닌 표식 자식이 살아 있다 ({returned:?})");
                assert!(survived, "앱 종료 길이 예외 목록에 적은 이름({keep_name})의 자식까지 끝냈다");
                // 정리 기록(티켓 11) — 「앱 종료」 한 줄, 셸 없이. 끝낸 앵커만 든다 — 예외 자식은 끝내기에 안 넘어갔다.
                let log = crate::processes::cleanup_log::read(&crate::processes::cleanup_log::path(&atelier_core::data_root()));
                let child = child.expect("앵커를 봤다");
                assert_eq!(
                    log.iter()
                        .map(|event| {
                            let targets: Vec<_> = event.targets.iter().map(|target| (target.pid, target.outcome)).collect();
                            (event.reason, event.shell_key.clone(), event.owner.clone(), targets)
                        })
                        .collect::<Vec<_>>(),
                    [(
                        crate::processes::cleanup_log::Reason::AppExit,
                        None,
                        None,
                        vec![(child.pid, crate::processes::ending::Outcome::Ended)]
                    )],
                    "앱 종료가 끝낸 것을 정리 기록에 「앱 종료」 한 줄로 안 적었다"
                );
            } else {
                assert!(survived, "셸을 닫았더니 예외 목록에 적은 이름({keep_name})의 자식까지 끝났다");
            }
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
    /// 이 실행(안쪽 검사 프로세스)의 인스턴스 기록에 그 셸 키가 있나. 안쪽의 데이터 루트는 임시다.
    #[cfg(target_os = "macos")]
    fn listed(key: &str) -> bool {
        on_the_record().is_some_and(|file| file.shell_keys.iter().any(|listed| listed == key))
    }

    #[cfg(target_os = "macos")]
    fn on_the_record() -> Option<crate::processes::instances::InstanceFile> {
        use crate::processes::instances;
        instances::read(&instances::dir(&atelier_core::data_root()), super::instance_prefix())
    }

    /// 풀 배선 장면이 닫는 셸의 주인 — 정리 기록에 그대로 적힌다(티켓 11).
    #[cfg(target_os = "macos")]
    const SCENE_OWNER: &str = "atelier:pty-scene";

    /// 풀 배선 장면 `Record`의 자식이 불리는 이름(argv[0]) — 정리 기록의 명령줄 머리에 그대로 적힌다. 짧게 둬 argv 전체가
    /// 늘 200자 안에 든다. 예외 목록은 이 장면에서 안 쓰니 이름이 무엇과 겹쳐도 판정은 안 흔들린다.
    #[cfg(target_os = "macos")]
    const RECORD_ARGV0: &str = "atelier-record-child";

    /// 풀 배선 장면 `Record`의 끝 절반 — 첫 셸은 이미 닫혔고 그 자식도 끝났다. 둘째 셸을 띄워 `exit`로 스스로 끝나게 하고,
    /// 앱 종료 길을 부른다. 단언은 모두 끝에 둔다 — 둘째 셸이 남지 않게 거두는 것이 먼저다.
    ///
    /// **정리 기록**(티켓 11)도 여기서 본다. 첫 셸의 닫기는 「셸 닫기」 한 줄로 적힌다 — 그 셸 키와 주인, 사람이 띄운 자식이
    /// 결과(SIGTERM을 무시해 강제)와 명령줄(자식을 부른 인자)을 달고. 스스로 끝난 둘째 셸과, 끝낼 것이 없던 앱 종료는 안 적힌다.
    #[cfg(target_os = "macos")]
    #[allow(clippy::too_many_arguments)]
    fn record_side(
        pool: &std::sync::Arc<super::PtyPool>,
        home: &Path,
        raised_on_spawn: bool,
        (listed_on_return, alive_on_return): (bool, bool),
        lowered: bool,
        lowered_while_alive: bool,
        (closed_key, closed_child): (&str, Option<crate::processes::Identity>),
        announced: &std::sync::Mutex<Vec<super::Ended>>,
    ) {
        use std::sync::atomic::{AtomicBool, Ordering};

        use tauri::ipc::Channel;

        use crate::processes::testkit::wait_until;

        let spoke = std::sync::Arc::new(AtomicBool::new(false));
        let heard = std::sync::Arc::clone(&spoke);
        let frames = Channel::new(move |_| {
            heard.store(true, Ordering::Relaxed);
            Ok(())
        });
        let second = super::spawn(pool, Mode::Atelier, Some(home.display().to_string()), 80, 24, frames)
            .expect("둘째 셸을 띄운다");
        let second_key = super::shell_id(second.id);
        let second_raised = listed(&second_key);
        wait_until(|| spoke.load(Ordering::Relaxed));
        super::write(pool, second.id, "exit\n").expect("둘째 셸에 exit를 친다");
        let second_left = wait_until(|| !pool.lock().contains_key(&second.id));
        let second_lowered = wait_until(|| !listed(&second_key));
        // 남았으면 거둔다 — 단언보다 먼저.
        let _ = super::kill(pool, second.id, crate::processes::cleanup_log::CloseReason::ShellClose, SCENE_OWNER);

        let before_exit = on_the_record().is_some();
        let outcomes = super::end_for_exit(pool);
        let after_exit = on_the_record();
        let log = crate::processes::cleanup_log::read(&crate::processes::cleanup_log::path(&atelier_core::data_root()));

        assert!(raised_on_spawn, "셸을 띄웠는데 그 키가 인스턴스 기록에 없다");
        assert!(
            listed_on_return && alive_on_return,
            "닫기가 돌아온 순간 키가 기록에 없거나({listed_on_return}) 자식이 이미 없다({alive_on_return}) — 끝내기가 도는 창을 못 봤다"
        );
        assert!(!lowered_while_alive, "그 셸의 자식이 아직 사는데 키를 기록에서 내렸다 — 다른 실행이 그 자식을 확정 고아로 본다");
        assert!(lowered, "끝내기가 끝났는데 키가 5초가 지나도 기록에 남았다");
        assert!(second_raised, "둘째 셸의 키가 기록에 없다");
        assert!(second_left, "`exit`를 쳤는데 둘째 셸이 풀에서 안 빠졌다");
        assert!(second_lowered, "셸이 스스로 끝났는데 그 키가 기록에 남았다");
        // ×로 닫은 첫 셸의 리더 스레드도, 끝낼 것 없이 스스로 끝난 둘째 셸도 알리지 않는다(티켓 13).
        let announced = announced.lock().unwrap_or_else(|e| e.into_inner()).clone();
        assert!(
            announced.is_empty(),
            "알릴 것이 없는데 알렸다 — ×로 먼저 닫은 셸을 리더 스레드가 한 번 더 끝냈거나, 끝낸 것 없는 `exit`를 알렸다: {announced:?}"
        );
        assert!(before_exit, "앱 종료 전에 기록이 없다 — 지웠는지 잴 수 없다");
        assert!(
            after_exit.is_none(),
            "못 끝낸 것이 없는데({outcomes:?}) 앱 종료 뒤에도 기록이 남았다 — 다음 실행이 죽은 실행의 기록으로 헛일을 한다"
        );
        assert_closed_shell_logged(&log, closed_key, closed_child);
    }

    /// 정리 기록에 셸 닫기 한 줄 — 그 셸 키와 주인, 자식 하나(강제, 명령줄은 자식을 부른 argv 전체)뿐이다. 자식은 짧은 이름으로
    /// 불려 argv가 200자 안에 다 든다.
    #[cfg(target_os = "macos")]
    fn assert_closed_shell_logged(
        log: &[crate::processes::cleanup_log::Event],
        closed_key: &str,
        closed_child: Option<crate::processes::Identity>,
    ) {
        use crate::processes::cleanup_log::{Reason, COMMAND_CHARS};
        use crate::processes::ending::Outcome;
        use crate::processes::testkit::{child_args, exe};

        let child = closed_child.expect("닫은 셸의 자식을 봤다");
        assert_eq!(
            log.iter().map(|event| (event.reason, event.shell_key.as_deref())).collect::<Vec<_>>(),
            [(Reason::ShellClose, Some(closed_key))],
            "정리 기록이 셸 닫기 한 줄이 아니다 — 닫기를 안 적었거나, 스스로 끝난 셸 · 끝낼 것이 없던 종료까지 적었다: {log:?}"
        );
        let event = &log[0];
        assert_eq!(event.owner.as_deref(), Some(SCENE_OWNER), "닫기 IPC가 준 주인이 기록에 없다");
        assert_eq!(event.targets.len(), 1, "대상이 자식 하나가 아니다: {:?}", event.targets);
        let target = &event.targets[0];
        assert_eq!(target.pid, child.pid, "기록의 대상이 닫은 셸의 자식이 아니다");
        assert_eq!(target.outcome, Outcome::Forced, "SIGTERM을 무시한 자식의 결과가 강제가 아니다");
        let exe_name = exe().file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
        assert!(
            !target.name.is_empty() && exe_name.starts_with(&target.name),
            "대상의 이름이 커널 이름(테스트 바이너리)이 아니다: {}",
            target.name
        );
        // 자식은 짧은 이름(`RECORD_ARGV0`)으로 불렸다 — argv 전체가 200자 안에 들어 잘리지 않는다. 그래서 이 단언은 체크아웃
        // 경로와 상관없이 선다. 200자에서 자르는 것은 `cleanup_log`의 검사가 잰다. 부른 이름이 exec 경로(테스트 바이너리)와
        // 달라, 명령줄을 exec 경로가 아니라 argv에서 읽는 것도 여기서 갈린다.
        let mut argv = vec![RECORD_ARGV0.to_string()];
        argv.extend(child_args());
        let whole = argv.join(" ");
        assert!(whole.chars().count() <= COMMAND_CHARS, "장면 자식의 argv가 200자를 넘어 뒤의 인자가 잘린다: {whole}");
        let command = target.command.as_deref().expect("기록에 명령줄이 없다");
        assert_eq!(command, whole, "기록의 명령줄이 자식을 부른 argv(부른 이름과 인자) 전체가 아니다");
        assert!(command.contains(&child_args()[1]), "기록의 명령줄에 자식을 부른 인자가 없다: {command}");
    }

    /// 풀 배선 장면 `Exit`의 끝 절반 — 셸은 `exit`로 스스로 끝나 풀에서 빠졌고, 자식은 이미 거뒀다(끝났거나 검사가 SIGKILL).
    /// 단언만 남았다.
    #[cfg(target_os = "macos")]
    fn exit_side(
        announced: &std::sync::Mutex<Vec<super::Ended>>,
        (listed_on_leave, alive_on_leave): (bool, bool),
        (lowered, lowered_while_alive): (bool, bool),
        ended_after: Duration,
        (key, shell_id, child): (&str, u32, Option<crate::processes::Identity>),
    ) {
        use crate::processes::cleanup_log::{self, Reason};
        use crate::processes::ending::{Outcome, GRACE};
        use crate::processes::testkit::wait_until;

        let child = child.expect("셸에서 띄운 자식을 봤다");
        assert!(
            listed_on_leave && alive_on_leave,
            "셸이 풀에서 빠진 순간 키가 기록에 없거나({listed_on_leave}) 자식이 이미 없다({alive_on_leave}) — 끝내기가 도는 창을 못 봤다"
        );
        assert!(
            !lowered_while_alive,
            "스스로 끝난 셸의 자식이 아직 사는데 키를 기록에서 내렸다 — 다른 실행이 그 자식을 확정 고아로 본다"
        );
        assert!(lowered, "끝내기가 끝났는데 스스로 끝난 셸의 키가 5초가 지나도 기록에 남았다");
        assert!(ended_after >= GRACE, "SIGTERM을 무시하는 자식이 유예 전에 끝났다 ({ended_after:?})");

        let log = cleanup_log::read(&cleanup_log::path(&atelier_core::data_root()));
        assert_eq!(
            log.iter()
                .map(|event| {
                    let targets: Vec<_> = event.targets.iter().map(|target| (target.pid, target.outcome)).collect();
                    (event.reason, event.shell_key.clone(), event.owner.clone(), targets)
                })
                .collect::<Vec<_>>(),
            [(Reason::ShellExit, Some(key.to_string()), None, vec![(child.pid, Outcome::Forced)])],
            "셸이 스스로 끝나며 끝낸 것을 정리 기록에 「셸 스스로 끝남」 한 줄(owner 없음)로 안 적었다"
        );

        // 알림은 기록과 키 내리기 뒤에 나간다 — 잠깐 기다린다.
        wait_until(|| !announced.lock().unwrap_or_else(|e| e.into_inner()).is_empty());
        let announced = announced.lock().unwrap_or_else(|e| e.into_inner()).clone();
        assert_eq!(
            announced,
            [super::Ended { reason: Reason::ShellExit, shell_id, count: 1 }],
            "셸이 스스로 끝나며 끝낸 것을 한 번 알리지 않았다"
        );
    }

    /// 풀 배선 장면 `RecordFailed`의 안쪽. 셸이 안 뜨니 거둘 것이 없다. `$SHELL`을 바꾸는 것은 이 안쪽 프로세스 하나다 —
    /// 이 검사 하나만 돈다(`--exact`, 한 스레드).
    ///
    /// **실패는 빌더(없는 `$SHELL`) 하나로 낸다.** `launch` 안의 실패는 전부 한 갈래(`Err` → 내린다)로 모이니 하나면
    /// 그 갈래를 잰다. exec 실패로는 못 낸다: portable-pty가 `pre_exec`에서 fd를 모두 닫아 std가 exec 오류를 받는
    /// 파이프까지 닫히므로, 실행할 수 없는 `$SHELL`(폴더)도 띄우기는 `Ok`로 온다(재 봤다). 그 셸은 곧 끝나 읽기 스레드가
    /// 풀에서 빼며 키를 내린다 — 둘째 셸의 `exit` 갈래와 같은 길이다.
    #[cfg(target_os = "macos")]
    fn record_failed_side(pool: &std::sync::Arc<super::PtyPool>, home: &Path) {
        use tauri::ipc::Channel;

        std::env::set_var("SHELL", home.join("no-such-shell"));
        let before = on_the_record().map(|file| file.updated_us);
        let refused = super::spawn(pool, Mode::Atelier, Some(home.display().to_string()), 80, 24, Channel::new(|_| Ok(())));
        let after = on_the_record();

        assert!(refused.is_err(), "없는 `$SHELL`인데 셸 띄우기가 성공했다 ({:?})", refused.map(|spawned| spawned.id));
        let after_us = after.as_ref().map(|file| file.updated_us);
        assert!(
            before.is_some() && after_us > before,
            "셸 띄우기가 실패했는데 기록의 갱신 시각이 그대로다({before:?} → {after_us:?}) — 키를 올린 적이 없다"
        );
        assert_eq!(
            after.map(|file| file.shell_keys),
            Some(Vec::new()),
            "셸 띄우기가 실패했는데 올린 키가 기록에 남았다 — 다른 실행이 이 키를 「살아 있는 셸」로 읽는다"
        );
    }

    /// 풀 배선 장면 `Startup`의 안쪽 — 셸은 안 띄운다. 기록은 안쪽의 임시 데이터 루트에만 있다: 이 실행의 것(풀이 열었다)과
    /// 이 장면이 쓰는 죽은 실행의 것. 자식들의 표식은 이 검사 프로세스의 pid로(물려받은 키는 바깥 검사 프로세스의 pid로)
    /// 지어 이 기계의 어떤 실제 세대와도 안 겹친다.
    #[cfg(target_os = "macos")]
    fn startup_side(pool: &std::sync::Arc<super::PtyPool>) {
        use crate::processes::instances::{self, Build, Place, Record};
        use crate::processes::snapshot::identity_of;
        use crate::processes::testkit::{holds_for, wait_until, Kid};
        use crate::processes::Identity;

        let me = std::process::id();
        let dir = instances::dir(&atelier_core::data_root());
        let dead_generation = format!("test-{me}-dead");
        let dead_key = format!("{dead_generation}-1");
        let unrecorded_key = format!("test-{me}-unrecorded-1");
        let dead = Record::default();
        dead.open(Place {
            dir: dir.clone(),
            generation: dead_generation.clone(),
            app: Identity { pid: me, started_us: 1 },
            build: Build::Release,
            version: "0.0.0".to_string(),
            log: crate::processes::cleanup_log::path(&atelier_core::data_root()),
        });
        dead.raise(&dead_key);
        let dead_file = dir.join(format!("{dead_generation}.json"));
        let recorded = dead_file.exists();
        // 판정의 스냅샷 뒤에 막 뜬 실행의 모양 — 앱은 **지금** 살아 있는데(이 프로세스의 진짜 신원) 판정이 죽은 것으로 읽었다.
        // 판정으로는 이 모양을 못 세우니(앱이 스냅샷에 있다) 아래에서 지울 목록에 손으로 얹는다.
        let late_generation = format!("test-{me}-late");
        let late_app = identity_of(me).expect("이 검사 프로세스의 신원을 읽는다");
        let late = Record::default();
        late.open(Place {
            dir: dir.clone(),
            generation: late_generation.clone(),
            app: late_app,
            build: Build::Release,
            version: "0.0.0".to_string(),
            log: crate::processes::cleanup_log::path(&atelier_core::data_root()),
        });
        let late_file = dir.join(format!("{late_generation}.json"));
        // 이 프로세스가 물려받은 셸 키 — 바깥이 지어 물려줬다(`on_the_pool_side`). 그 셸을 띄운 실행(설치본의 모양)은 죽었고
        // 기록이 남았다. 그 키를 문 자식은 이 앱과 함께 뜬 vite의 모양이다.
        let inherited_key = crate::processes::inherited_key().expect("바깥이 시작 정리 장면에 물려받은 키를 준다").to_string();
        let (installed_generation, _) = inherited_key.rsplit_once('-').expect("셸 키는 <세대>-<번호>다");
        let installed = Record::default();
        installed.open(Place {
            dir: dir.clone(),
            generation: installed_generation.to_string(),
            app: Identity { pid: me, started_us: 1 },
            build: Build::Release,
            version: "0.0.0".to_string(),
            log: crate::processes::cleanup_log::path(&atelier_core::data_root()),
        });
        installed.raise(&inherited_key);

        let left = Kid::spawn("sleep", &dead_key);
        let unrecorded = Kid::spawn("sleep", &unrecorded_key);
        let vite = Kid::spawn("sleep", &inherited_key);
        let (left_id, unrecorded_id, vite_id) = (left.settle(), unrecorded.settle(), vite.settle());

        let mut plan = super::plan_startup(pool, &super::exceptions());
        let picked: Vec<Identity> = plan.targets.iter().map(|proc| proc.id).collect();
        let forgets = plan.dead.iter().any(|record| record.generation == dead_generation);
        // 물려받은 키의 실행을 판정이 죽은 것으로 읽었다 — 그 키를 문 자식은 막히지 않으면 확정 고아 (가)다.
        let installed_dead = plan.dead.iter().any(|record| record.generation == installed_generation);
        // **끝내기에는 이 검사가 띄운 자식만 넘긴다.** 판정은 이 기계의 표 전체를 읽는다. 기록이 임시 데이터 루트의 것뿐이라
        // 고르는 것도 이 자식뿐이어야 하지만, 그 믿음으로 남에게 신호를 보내지 않는다.
        plan.targets.retain(|proc| Some(proc.id) == left_id);
        plan.dead.push(crate::processes::verdict::InstanceRecord {
            generation: late_generation.clone(),
            app: late_app,
            shell_keys: Vec::new(),
            updated_us: 0,
        });
        let late_recorded = late_file.exists();
        let cleared = super::carry_out(pool, plan);
        let left_alive = || left_id.is_some_and(|id| identity_of(id.pid) == Some(id));
        let ended = wait_until(|| !left_alive());
        let unrecorded_lives =
            holds_for(Duration::from_millis(300), || unrecorded_id.is_some_and(|id| identity_of(id.pid) == Some(id)));
        let forgotten = !dead_file.exists();
        let late_kept = late_file.exists();
        let own_kept = on_the_record().is_some();
        let reported = crate::startup::cleaned(&cleared);
        let log = crate::processes::cleanup_log::read(&crate::processes::cleanup_log::path(&atelier_core::data_root()));

        // **거두는 것이 단언보다 먼저다.** 이 검사가 띄운 자식이다(`Kid`의 Drop).
        drop(left);
        drop(unrecorded);
        drop(vite);

        let left_id = left_id.expect("죽은 실행의 키를 문 자식이 5초 안에 제 세션을 열지 못했다");
        let unrecorded_id = unrecorded_id.expect("기록이 없는 세대의 키를 문 자식이 5초 안에 제 세션을 열지 못했다");
        let vite_id = vite_id.expect("물려받은 키를 문 자식이 5초 안에 제 세션을 열지 못했다");
        assert!(recorded, "죽은 실행의 기록을 못 썼다 — 이 장면이 아무것도 못 잰다");
        assert!(picked.contains(&left_id), "죽은 실행의 키를 문 자식을 시작 정리가 안 골랐다 — 고른 것: {picked:?}");
        assert!(
            !picked.contains(&unrecorded_id),
            "기록이 없는 세대의 키를 문 자식(출처 불명)을 시작 정리가 골랐다 — 누구의 것인지 모르는데 끝낸다"
        );
        assert!(
            installed_dead,
            "물려받은 키의 실행을 죽은 것으로 안 읽었다 — 아래 「안 골랐다」가 아무것도 못 잰다"
        );
        assert!(
            !picked.contains(&vite_id),
            "앱이 물려받은 키를 문 자식(앱과 함께 뜬 vite)을 시작 정리가 골랐다 — 설치본 셸에서 띄운 dev 앱이 제 프런트 서버를 끝낸다"
        );
        assert!(forgets, "죽은 실행의 기록을 지울 것으로 안 골랐다");
        assert_eq!(
            cleared.iter().map(|one| (one.id, one.outcome)).collect::<Vec<_>>(),
            vec![(left_id, crate::processes::ending::Outcome::Ended)],
            "고른 자식을 SIGTERM으로 끝낸 결과가 아니다"
        );
        assert!(ended, "시작 정리가 돌아왔는데 죽은 실행의 키를 문 자식이 5초가 지나도 살아 있다");
        assert_eq!(
            reported.iter().map(|one| one.pid).collect::<Vec<_>>(),
            vec![left_id.pid],
            "시작 보고에 끝낸 자식이 안 실렸다 — 토스트가 수를 못 말한다"
        );
        assert!(unrecorded_lives, "기록이 없는 세대의 키를 문 자식이 시작 정리 뒤에 끝났다");
        assert!(forgotten, "죽은 실행의 고아를 처리했는데 그 실행의 기록이 남았다 — 다음 실행이 헛일을 한다");
        assert!(late_recorded, "막 뜬 실행의 기록을 못 썼다 — 아래 「남았다」가 아무것도 못 잰다");
        assert!(
            late_kept,
            "판정이 죽은 것으로 읽었을 뿐 지금 사는 실행의 기록을 지웠다 — 그 실행의 셸 자손이 남에게 출처 불명이 된다"
        );
        assert!(own_kept, "시작 정리가 이 실행의 기록까지 지웠다 — 이 실행의 셸 자손이 남에게 출처 불명이 된다");
        // 정리 기록(티켓 11) — 「시작 정리」 한 줄, 셸 없이, 끝낸 자식과 그 결과.
        assert_eq!(
            log.iter()
                .map(|event| {
                    let targets: Vec<_> = event.targets.iter().map(|target| (target.pid, target.outcome)).collect();
                    (event.reason, event.shell_key.clone(), event.owner.clone(), targets)
                })
                .collect::<Vec<_>>(),
            [(
                crate::processes::cleanup_log::Reason::StartupCleanup,
                None,
                None,
                vec![(left_id.pid, crate::processes::ending::Outcome::Ended)]
            )],
            "시작 정리가 끝낸 것을 정리 기록에 「시작 정리」 한 줄로 안 적었다"
        );
    }

    /// 풀 배선 장면 `Ask`의 안쪽. 신호를 보내는 것은 끝의 거두기뿐이고, 그것은 이 장면이 띄운 자식의 신원(방금 다시
    /// 봤다)과 이 셸 그룹(리더가 그대로일 때만)에만 간다 — 판정을 이 기계의 표에 「끝내기」로 돌리지 않는다.
    #[cfg(target_os = "macos")]
    fn ask_side(pool: &std::sync::Arc<super::PtyPool>, id: u32, key: &str, shell_pid: Option<u32>) {
        use std::time::{SystemTime, UNIX_EPOCH};

        use crate::processes::ending::{self, Group};
        use crate::processes::snapshot::{identity_of, take, EnvScope};
        use crate::processes::testkit::{child_args, exe, wait_until, CHILD_ROLE};
        use crate::processes::Proc;

        use super::CloseCheck;

        // 예외 목록은 안쪽의 데이터 루트(임시 `ATELIER_HOME`)의 설정에만 적는다. 이름에 이 검사 프로세스의 pid를 붙여
        // 이 기계의 어떤 실제 이름과도 안 겹치게 한다.
        let keep_name = format!("atelier-keep-{}", std::process::id());
        let mut settings = crate::settings::Settings::default();
        settings.terminal.process_exceptions = Some(vec![keep_name.clone()]);
        crate::settings::write(&atelier_core::data_root(), &settings).expect("임시 데이터 루트에 설정을 쓴다");

        let args = child_args().join(" ");
        let child = |argv0: &str| {
            format!("( {CHILD_ROLE}=sleep {argv0}'{}' {args} </dev/null >/dev/null 2>&1 & )", exe().display())
        };
        // 이 셸의 표식을 물고 트리가 끊긴(부모 1) 제 세션의 자식들 — claude Bash 도구가 띄운 dev 서버의 모양이다.
        let marked = || -> Vec<Proc> {
            take(EnvScope::All)
                .procs
                .into_iter()
                .filter(|p| p.shell_key.as_deref() == Some(key) && p.ppid == 1 && p.pgid == p.id.pid)
                .collect()
        };
        let invoked_keep =
            |p: &Proc| p.argv0.as_deref().is_some_and(|argv0| argv0.rsplit('/').next() == Some(keep_name.as_str()));

        // 셸이 마지막으로 무언가를 찍은 때(티켓 27 — `Processes`의 「조용함」 경과). 아래 (1)의 줄을 치면 셸이 그 글자를 메아리로
        // 찍으므로 값이 오른다. 시각은 ms라 치기 전에 한 박자 쉰다.
        let stamped = || pool.lock().get(&id).map(|shell| shell.last_output.load(std::sync::atomic::Ordering::Relaxed));
        let quiet_since = stamped();
        std::thread::sleep(Duration::from_millis(5));

        // (1) 사람이 아직 안 쳤다 — 셸이 뜰 때 함께 뜨는 도우미(p10k의 `gitstatusd`)의 모양. 백엔드는 쓰기를 입력으로
        // 안 센다: 사람 입력은 프런트가 DOM 사건으로 가려 `note_first_input`으로만 알린다.
        super::write(pool, id, &format!("{}\n", child(""))).expect("셸에 한 줄을 친다");
        let mut helper = None;
        wait_until(|| {
            helper = marked().first().map(|p| p.id);
            helper.is_some()
        });
        let before = super::command_running(pool, id);
        let echoed = stamped();
        // 화면 스냅샷이 그 값을 풀의 셸에 싣는다. 읽기만 한다 — 판정을 이 기계의 표에 「끝내기」로 돌리지 않는다. 두 번 찍는다: 셸
        // 프로세스 자신과 자손의 지표가 서고, CPU%는 둘째 표본부터 선다(티켓 28).
        let first = super::screen(pool);
        let second = super::screen(pool);
        let shell_of = |snapshot: &super::ScreenSnapshot| snapshot.pool.iter().find(|shell| shell.pty_id == id).cloned();
        let (first_shell, second_shell) = (shell_of(&first), shell_of(&second));
        let on_screen = first_shell.as_ref().map(|shell| shell.last_output_ms);
        let helper_memory = first
            .verdict
            .descendants
            .get(key)
            .and_then(|rows| rows.iter().find(|row| Some(row.id) == helper))
            .and_then(|row| row.metrics.memory);

        // 셸의 자식인 `sleep` 중 셸 자신의 그룹에 사는 것(잡 제어 밖의 백그라운드 잡)과 제 그룹을 연 것(명령).
        // 시스템 바이너리라 표식은 안 읽히고 셸의 트리로 잡힌다.
        let sleep_of_shell = |in_shell_group: bool| {
            take(EnvScope::BornSince(u64::MAX))
                .procs
                .into_iter()
                .find(|p| {
                    shell_pid == Some(p.ppid) && p.name == "sleep" && (Some(p.pgid) == shell_pid) == in_shell_group
                })
                .map(|p| p.id)
        };

        // (2) 사람이 처음 입력했다. 그 뒤에 dev 서버 모양 하나와, 예외 목록의 이름으로 부른 것 하나와, 잡 제어를
        // 끈 채 뒤로 띄운 것 하나를 띄운다. 마지막 것은 셸 자신의 그룹에 산다 — 프롬프트에서 터미널을 쥔 그룹도
        // 셸 자신이라, 명령이 없는데 그 그룹을 빼면 이것이 수에서 빠진다(`close_check`가 그룹을 명령이 돌 때만 넘기는
        // 까닭). 잡 제어는 같은 줄에서 다시 켠다 — (3)의 명령이 제 그룹을 열어야 한다.
        let now_ms = SystemTime::now().duration_since(UNIX_EPOCH).expect("시계가 에포크 뒤다").as_millis() as u64;
        super::note_first_input(pool, id, now_ms).expect("있는 셸이다");
        std::thread::sleep(Duration::from_millis(5));
        let line = format!(
            "{}; {}; set +m; /bin/sleep 31 </dev/null >/dev/null 2>&1 & set -m\n",
            child(""),
            child(&format!("ARGV0={keep_name} "))
        );
        super::write(pool, id, &line).expect("셸에 한 줄을 친다");
        let (mut spawned, mut kept, mut background) = (None, None, None);
        wait_until(|| {
            let procs = marked();
            spawned = procs.iter().find(|p| Some(p.id) != helper && !invoked_keep(p)).map(|p| p.id);
            kept = procs.iter().find(|p| invoked_keep(p)).map(|p| p.id);
            background = sleep_of_shell(true);
            spawned.is_some() && kept.is_some() && background.is_some()
        });
        let after = super::command_running(pool, id);

        // (3) 명령이 돈다 — 셸이 터미널을 잡에 넘겼다.
        super::write(pool, id, "/bin/sleep 30\n").expect("셸에 한 줄을 친다");
        let mut during = None;
        wait_until(|| {
            during = super::command_running(pool, id).ok().filter(|check| check.command);
            during.is_some()
        });
        let batch = super::close_checks(pool, &[id, u32::MAX]);
        let command = sleep_of_shell(false);

        // **거두는 것이 단언보다 먼저다.** 이 장면이 띄운 자식이고, 신원을 방금 다시 본다.
        for child in [helper, spawned, kept, background, command].into_iter().flatten() {
            if identity_of(child.pid) == Some(child) {
                unsafe { libc::kill(child.pid as i32, libc::SIGKILL) };
            }
        }
        let shells: Vec<super::Shell> = pool.lock().drain().map(|(_, shell)| shell).collect();
        let groups: Vec<Group> =
            shells.iter().filter_map(|shell| Some(Group { pgid: shell.pid?, leader: shell.process })).collect();
        let started = ending::start(&[], &groups);
        drop(shells);
        let _ = started.finish();

        assert!(helper.is_some(), "입력 전에 띄운 자식이 5초 안에 서지 않았다");
        assert!(
            matches!((quiet_since, echoed), (Some(quiet), Some(echo)) if quiet > 0 && echo > quiet),
            "셸에 친 줄의 메아리가 마지막 출력 시각을 안 올렸다 ({quiet_since:?} → {echoed:?})"
        );
        assert!(
            on_screen >= echoed,
            "화면 스냅샷이 풀의 셸에 마지막 출력 시각을 안 싣는다 ({on_screen:?} < {echoed:?})"
        );
        let (first_shell, second_shell) = (first_shell.expect("풀의 셸이 화면에 있다"), second_shell.expect("풀의 셸이 화면에 있다"));
        assert!(
            first_shell.metrics.memory.is_some_and(|memory| memory > 0),
            "화면 스냅샷이 셸 프로세스 자신의 메모리를 안 싣는다: {:?}",
            first_shell.metrics
        );
        assert_eq!(first_shell.metrics.cpu, None, "첫 표본에 셸의 CPU%가 섰다");
        assert!(second_shell.metrics.cpu.is_some(), "둘째 표본에 셸의 CPU%가 안 섰다 — 풀이 앞 표본을 안 쥔다");
        assert!(helper_memory.is_some_and(|memory| memory > 0), "화면 스냅샷이 셸 자손의 메모리를 안 싣는다");
        assert_eq!(
            before,
            Ok(CloseCheck { command: false, descendants: 0 }),
            "사람이 입력하기 전에 뜬 것(셸 도우미)까지 셌다 — p10k 셸은 빈 프롬프트를 닫을 때마다 묻는다"
        );
        assert!(
            spawned.is_some() && kept.is_some() && background.is_some(),
            "입력 뒤에 띄운 자식 셋이 5초 안에 서지 않았다 (dev 서버 {spawned:?} · 예외 {kept:?} · 셸 그룹 {background:?})"
        );
        assert_eq!(
            after,
            Ok(CloseCheck { command: false, descendants: 2 }),
            "사람이 띄운 둘(dev 서버 · 셸 그룹의 백그라운드 잡)만 세야 한다 — 도우미나 예외 목록의 이름({keep_name})까지 \
             셌거나, 프롬프트인데 셸 자신의 그룹을 명령의 그룹으로 뺐거나, dev 서버를 놓쳤다"
        );
        assert_eq!(
            during,
            Some(CloseCheck { command: true, descendants: 2 }),
            "명령이 도는 셸 — 명령 자신(foreground 그룹)은 빼고 dev 서버와 셸 그룹의 백그라운드 잡은 센다"
        );
        assert_eq!(
            batch,
            vec![Ok(during.expect("위에서 봤다")), Err(super::gone(u32::MAX))],
            "배치 물음이 셸 하나의 물음과 다른 답을 냈다"
        );
    }
}
