//! 셸이 스스로 말한 것 — 훅 처리기가 쓰는 상태 파일 한 장과 그것을 보는 감시.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::time::Duration;

use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::processes::shell_key;

/// 옛 훅 스크립트의 이름 — **옛 python 처리기**다. 이 판 전의 설치 버튼이 사용자의 설정에 걸던 것이다. 이제 설치와 앱이 뜰
/// 때의 맞춤(티켓 21)은 새 처리기(`HANDLER_NAME`)를 걸고, 이 이름의 줄은 우리 것으로 알아봐 새 줄로 갈아 끼운다(`hooks::is_ours`).
/// 파일은 계속 세운다 — 옛 빌드가 깐 채 아직 안 맞춘 설정과, 옛 설치본이 그 줄을 다시 부른다.
pub const SCRIPT_NAME: &str = "atelier-hook.py";

/// 훅 스크립트의 본문. **소스 트리의 진짜 파일을 그대로 굽는다** — 문자열 리터럴로 Rust
/// 안에 적으면 그 언어의 문법 검사도, 편집기의 손도 닿지 않는 코드가 된다.
pub const HOOK_SCRIPT: &str = include_str!("../hooks/atelier-hook.py");

/// 새 훅 처리기의 이름(프로세스 스펙 S28 · 티켓 19). **옛 이름과 다른 파일이다** — 두 빌드는 같은 데이터 루트를 쓰는데,
/// 옛 이름에 두면 이 기능 전의 설치본이 뜰 때마다 옛 계약의 python 스크립트로 덮는다. 옛 파일은 지우지 않는다: 아직 그것을
/// 부르는 설정과 셸이 있다.
pub const HANDLER_NAME: &str = "atelier-hook.zsh";

/// 새 처리기의 본문 — `/bin/zsh -f`와 내장 모듈만으로 도는 스크립트다. 왜 zsh인지(재서 고른 값)는 그 파일의 머리말에 있다.
pub const HANDLER: &str = include_str!("../hooks/atelier-hook.zsh");

/// 셸이 말한 것이 실려 나가는 이벤트. **양쪽이 이 문자열로만 이어져 있다** — 한쪽을 고치면
/// 컴파일도 타입 검사도 통과하고 화면만 영영 조용하다. 이름을 아는 자리가 여기와 `api.ts`
/// 둘뿐이라, 그 둘이 같은지는 `shell-registry.test.ts`가 두 파일을 함께 읽어 못박는다.
const ATTENTION_EVENT: &str = "shell:attention";

/// 폴더가 흔들린 뒤 얼마나 기다렸다 읽는가.
///
/// **기존 감시 둘(300·500ms)보다 짧다.** 그쪽이 보는 것은 사람이 편집기에서 저장하는
/// 문서라 몰아서 받는 것이 이득이지만, 이 파일은 훅이 한 번에 한 장을 원자적으로 쓰는
/// 것이고 값이 「지금 나를 기다린다」다 — 늦으면 그만큼 사람이 모르는 시간이 된다.
const DEBOUNCE: Duration = Duration::from_millis(100);

/// 셸들이 자기 상태를 적어 두는 곳.
pub fn shells_dir(root: &Path) -> PathBuf {
    root.join("shells")
}

/// 이 셸이 자기 상태를 적는 파일. **이름이 곧 셸 ID다** — 훅은 env로 받은 ID 말고는
/// 아무것도 모르고, 감시는 이름에서 그것을 되뽑는다.
pub fn state_path(root: &Path, shell_id: &str) -> PathBuf {
    shells_dir(root).join(format!("{shell_id}.json"))
}

/// 셸 하나의 잠금 파일 — 처리기의 순서 가드가 쥐는 자리(프로세스 스펙 S27).
///
/// **상태 파일 자체는 잠금 자리가 못 된다.** 처리기는 상태 파일을 임시 파일에서 rename으로 갈아 끼우므로 쓸 때마다 inode가
/// 바뀐다 — 기다리던 처리기는 옛 inode의 잠금을 얻고 새 파일과 겨룬다. 그래서 따로 선 파일이다. 점으로 시작하는 것은 감시가
/// 이 파일을 셸로 읽지 않게 하려는 것이다(`scan`의 점 파일 규칙). 앱 시작 때의 정리는 점을 떼고 세대로 읽어 살아 있는 실행의
/// 것을 남긴다(`sweep`). 이름을 짓는 자리가 여기와 처리기 둘이다 — 처리기 쪽은 `.$shell.lock`이고, 검사
/// `the_handler_leaves_one_state_file_in_the_new_contract_and_no_tmp`가 둘이 같은 이름인지 파일로 본다.
pub fn lock_path(root: &Path, shell_id: &str) -> PathBuf {
    shells_dir(root).join(format!(".{shell_id}.lock"))
}

/// 훅 스크립트가 사는 곳.
pub fn hooks_dir(root: &Path) -> PathBuf {
    root.join("hooks")
}

/// 옛 python 처리기의 자리. 이 판 전의 설치 버튼이 사용자의 설정에 적어 넣던 경로다.
pub fn script_path(root: &Path) -> PathBuf {
    hooks_dir(root).join(SCRIPT_NAME)
}

/// 새 처리기의 자리. 설치와 앱이 뜰 때의 맞춤(티켓 21)이 사용자의 설정에 적어 넣는 경로가 이것이다.
pub fn handler_path(root: &Path) -> PathBuf {
    hooks_dir(root).join(HANDLER_NAME)
}

/// 훅 스크립트 둘을 디스크에 세운다 — 설치와 맞춤(티켓 21)이 거는 새 처리기와, 아직 맞추지 않은 설정이 부르는 옛 python 처리기.
///
/// **맞춤보다 먼저 세운다**(`lib.rs`의 셋업). 설정만 새 경로를 가리키면 사용자의 claude가 매 턴 없는 파일을 부른다. 옛 파일도 계속
/// 세운다 — 옛 빌드가 깐 채 아직 안 맞춘 설정이 그것을 부른다. 아무 설정에도 안 걸린 파일은 안 불리니 세워 두는 것은 무해하다.
pub fn write_hook_script(root: &Path) -> Result<(), String> {
    let dir = hooks_dir(root);
    std::fs::create_dir_all(&dir).map_err(|e| format!("훅 폴더를 만들지 못했습니다: {e}"))?;
    write_executable(&script_path(root), HOOK_SCRIPT)?;
    write_executable(&handler_path(root), HANDLER)
}

/// 실행 파일 한 장을 **바꿔 넣는다** — 같은 폴더의 임시 파일에 다 쓰고 rename한다. 그 자리의 파일은 지금 도는 에이전트가
/// 언제든 부를 수 있어서, 제자리에 덮어쓰면 반쯤 쓰인 스크립트가 불리는 순간이 생긴다.
///
/// **같은 내용이 이미 실행 권한으로 서 있으면 다시 쓰지 않는다.** macOS는 새로 쓰인 실행 파일의 첫 실행을 한 번 검사한다 —
/// 이 기계에서 새 파일의 첫 호출은 125~150ms, 둘째부터 3~5ms였다(구현 기록 19절). 앱이 뜰 때마다 같은 처리기를 새 파일로
/// 갈아 끼우면, 켤 때마다 첫 훅이 그 값을 문다.
fn write_executable(path: &Path, body: &str) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let standing = std::fs::metadata(path).is_ok_and(|meta| meta.permissions().mode() & 0o777 == 0o755);
    if standing && std::fs::read(path).is_ok_and(|bytes| bytes == body.as_bytes()) {
        return Ok(());
    }

    let name = path.file_name().map(|name| name.to_string_lossy()).unwrap_or_default();
    let tmp = path.with_file_name(format!(".{name}.tmp"));
    std::fs::write(&tmp, body).map_err(|e| format!("훅 스크립트를 쓰지 못했습니다: {e}"))?;
    std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755))
        .map_err(|e| format!("훅 스크립트에 실행 권한을 주지 못했습니다: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("훅 스크립트를 바꿔 넣지 못했습니다: {e}"))
}

/// 상태 파일 한 장의 **디스크 모양** — 처리기가 적는 그대로다(프로세스 스펙 S26).
///
/// `subagents`는 도는 서브에이전트의 id 집합이고 `stopped`는 「턴이 멈췄다」다. 둘 다 처리기가 사건마다 접는다(S50 · S51) —
/// 파일은 마지막 사건 하나만 담고 감시는 100ms로 디바운스하므로, 화면이 사건을 하나씩 세면 수가 샌다.
///
/// **두 칸이 없으면 빈 목록과 거짓으로 읽는다.** 옛 python 처리기(`SCRIPT_NAME`)는 이 칸을 모른다. 두 빌드가 같은 루트를 쓰고
/// 훅 갱신 전까지 옛 처리기가 불리므로, 그 파일과 섞여도 셸이 조용해지면 안 된다. 거꾸로 옛 빌드는 모르는 칸을 무시한다
/// (`deny_unknown_fields`가 없다).
#[derive(Debug, Deserialize)]
struct StateFile {
    agent: String,
    event: String,
    at: u64,
    /// 훅이 못 읽었으면 `null`이다 — 그때도 「이 셸에서 그 이벤트가 났다」는 참이다.
    #[serde(default)]
    payload: serde_json::Value,
    #[serde(default)]
    subagents: Vec<String>,
    #[serde(default)]
    stopped: bool,
}

/// 상태 파일 한 장의 **선 위 모양** — 감시가 프런트로 싣는다.
///
/// **이름이 `types.ts`의 것과 같다.** 이 저장소의 전송 타입은 양쪽 이름이 늘 같고
/// (`PtySpawned`·`PtyExit`·`PtyRunning`), 그래야 한쪽만 고친 것이 눈에 띈다. 여기서 굳이
/// `ShellState`가 아닌 것은 프런트에 셸 레지스트리의 `ShellsState`가 이미 있어 한 글자
/// 차이로 서기 때문이다 — 갈리는 쪽이 아니라 **둘 다** 이 이름으로 맞췄다.
///
/// **`message`가 없다.** 스펙의 전이 표가 말하는 message는 이벤트마다 다른 자리에서
/// 나오고(`tool_input` 요약 · `last_assistant_message`의 첫 줄) 그 접기는 에이전트별
/// 어댑터의 일이라 프런트에 산다. 여기서 한 줄로 접으면 그 규칙이 사용자 홈에 설치된
/// 스크립트와 Rust에 반씩 갈려, 화면이 바뀔 때 두 곳을 고쳐야 한다. 대신 페이로드를
/// **통째로** 싣는다 — 접는 데 필요한 것이 다 그 안에 있다.
///
/// **디스크 모양(`StateFile`)과 한 칸이 다르다** — `subagents`가 여기서는 **수**다. 화면은 도는 서브에이전트가 몇인지만 보고
/// (셸 상태의 일곱째 칸, S51) id는 처리기가 집합을 접는 데만 쓴다. 수로 실으면 id만 바뀌고 수가 같은 파일은 감시가 안 내보낸다.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellHookState {
    agent: String,
    event: String,
    at: u64,
    payload: serde_json::Value,
    /// 도는 서브에이전트 수.
    subagents: usize,
    /// 턴이 멈췄나 — Stop · StopFailure에서 참, 새 턴 · 중단에서 거짓(S50). 세션 끝은 그대로 둔다(처리기 머리말 — 티켓 20 리뷰 반영).
    stopped: bool,
}

impl From<StateFile> for ShellHookState {
    fn from(file: StateFile) -> Self {
        ShellHookState {
            agent: file.agent,
            event: file.event,
            at: file.at,
            payload: file.payload,
            // 집합으로 센다. 처리기가 이미 집합으로 적지만, 손으로 고친 파일 한 장이 수를 부풀리지 않게.
            subagents: file.subagents.iter().collect::<BTreeSet<_>>().len(),
            stopped: file.stopped,
        }
    }
}

/// 한 번에 읽은 상태 전부 — 셸 ID마다 한 장이다. `BTreeMap`인 것은 나가는 순서가
/// 회차마다 흔들리지 않게 하기 위해서다(`pty.rs`의 `Running`과 같은 이유).
type Attention = BTreeMap<String, ShellHookState>;

/// 상태 폴더를 통째로 한 번 읽는다 — **이번 실행의 것만.**
///
/// **깨진 파일은 없는 것으로 친다.** 훅이 원자적으로 쓰니 반쯤인 파일은 안 생기지만, 사람이
/// 손으로 들여다보다 저장할 수도 있고 디스크가 찰 수도 있다. 그때 감시가 죽으면 **그 뒤로
/// 어느 셸도 말을 못 한다** — 한 장 때문에 통로 전체를 잃는 것이라 조용히 건너뛴다.
///
/// **접두사를 여기서 못박는다**(fail-closed). 접두사는 「실행끼리 안 겹치게」 하는 값인데,
/// 그것을 견주는 자리가 `sweep` 하나뿐이면 그 보장은 앱이 뜰 때 한 번 도는 **파괴적
/// 청소**에만 걸려 있는 것이지 읽는 길에는 아무 데도 없다. `~/.atelier`는 빌드마다 안
/// 갈리고(`data_root()`) single-instance도 안 걸려 있어 설치본과 `pnpm tauri dev`가 같은
/// 폴더를 나눠 쓰는데, 그때 남의 인스턴스가 놓고 간 `<남의 접두사>-0.json`이 그대로 실려
/// 나가고 프런트는 마지막 `-` 뒤 번호만 읽으므로(`ptyIdOf`) **전혀 다른 셸에 남의 claude
/// 상태와 남의 마지막 말**이 앉는다. 오류 한 줄 없이 조용한 종류라 읽는 쪽에서 닫는다.
///
/// 이번 실행의 것인지는 `sweep`과 **같은 규칙**으로 가른다(`shell_key::of_generation` — 「세대-숫자」). 구분자까지 견주지
/// 않으면 `1700`에 `17000-1`이 이번 실행의 것으로 읽히고, 번호까지 견주지 않으면 앱이 짓지 않는 `1700-x`가 셸로 실린다 —
/// 쓸기는 그것을 남의 것으로 걷는데 읽기만 이 실행의 셸로 읽는다.
fn scan(dir: &Path, prefix: &str) -> Attention {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Attention::new();
    };
    entries
        .filter_map(|entry| {
            let path = entry.ok()?.path();
            // 이름이 곧 셸 ID다. dotfile(훅이 쓰는 중인 임시 파일)은 여기서 걸린다 —
            // `.abc.json.9.tmp`의 stem은 `.abc.json.9`라 점으로 시작한다.
            let id = path.file_stem()?.to_str()?.to_string();
            if id.starts_with('.') || path.extension()? != "json" || !shell_key::of_generation(&id, prefix) {
                return None;
            }
            let content = std::fs::read_to_string(&path).ok()?;
            let file: StateFile = serde_json::from_str(&content).ok()?;
            Some((id, file.into()))
        })
        .collect()
}

/// 나가는 것 한 줄 — 어느 셸이 무엇을 말했나. `state`가 `null`이면 그 셸의 상태가
/// 사라졌다는 뜻이다(파일이 지워졌다 = 셸이 닫혔다).
///
/// 이름은 `types.ts`의 `ShellAttention`과 같다(위 `ShellHookState` 독 참조).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShellAttention {
    shell_id: String,
    state: Option<ShellHookState>,
}

/// **재는 것과 쏘는 것을 가르는 자리** — 직전에 쏜 것과 다른 셸만 나온다.
///
/// 감시는 폴더가 흔들릴 때마다 통째로 다시 읽으므로(그래야 지워진 파일도 눈에 띈다) 여기서
/// 안 가르면 셸 하나가 말할 때마다 전부가 다시 나가고, 상태 축이 붙는 화면 넷이 함께 다시
/// 그려진다. 구조는 `pty.rs`의 `changes`와 같다 — 그쪽이 이 판의 본이다.
fn changes(sent: &Attention, now: &Attention) -> Vec<ShellAttention> {
    let mut out = Vec::new();
    for (id, state) in now {
        if sent.get(id) != Some(state) {
            out.push(ShellAttention { shell_id: id.clone(), state: Some(state.clone()) });
        }
    }
    // 사라진 셸은 **한 번 더** 쏘아 지운다. 안 그러면 마지막 값이 화면에 굳어 닫힌 칸이
    // 영영 사람을 부른다. 다음 회차에는 `sent`에도 없으므로 두 번 나가지 않는다.
    for id in sent.keys() {
        if !now.contains_key(id) {
            out.push(ShellAttention { shell_id: id.clone(), state: None });
        }
    }
    out
}

/// 앱이 뜰 때 **죽은 실행이 남긴 것을 걷는다** — 살아 있는 실행의 세대는 남긴다(프로세스 스펙 S10 · 티켓 11).
///
/// 셸 ID의 꼬리는 PTY 번호이고 그 번호는 실행마다 0부터 다시 난다 — 접두사가 갈라 주지
/// 않으면 지난 실행의 `…-0.json`이 이번 실행의 첫 셸에 그대로 붙어 **뜨자마자 사람을 부르는
/// 셸**이 생긴다. 앱이 정상 종료하면 셸마다 자기 파일을 걷고 나가지만(`Shell`의 `Drop`),
/// 강제 종료·패닉·전원이 나간 경우가 남는다.
///
/// **남길 세대는 `instances::live_generations`가 준다** — 이 실행의 세대(`shell_key::generation`)와, 인스턴스 기록으로 가린
/// 살아 있는 다른 실행들의 세대다. 예전에는 이 실행의 것 말고 전부 걷어, dev 빌드와 설치본을 함께 띄우면 한쪽이 뜰 때
/// 다른 쪽 셸의 상태 파일을 지웠다 — 그 셸의 띠 상태가 사라졌다. 이 실행의 세대를 여기서 시각으로 따로 재면 두 값이
/// 갈려 살아 있는 셸의 상태 파일을 지운다.
///
/// **이름 앞의 점을 뗀 뒤 세대를 읽는다.** 쓰는 중인 임시 파일(`.<셸 키>.json.<pid>.tmp`)과 판 03의 잠금 파일
/// (`.<셸 키>.lock`)은 점으로 시작한다 — 점 파일을 세대 밖으로 보면 살아 있는 실행의 잠금을 지워 배타가 깨지고, 쓰는
/// 중인 파일을 지워 그 사건을 잃는다.
///
/// 우리 모양이 아닌 것도 함께 걷는다 — 이 폴더는 앱이 만들고 앱만 쓰는 자리다.
pub fn sweep(root: &Path, keep: &[String]) {
    let dir = shells_dir(root);
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        // 셸 키는 첫 `.` 앞까지다(`<세대>-<번호>` — 세대도 번호도 점이 없다).
        let key = name.trim_start_matches('.').split('.').next().unwrap_or_default();
        // 구분자와 번호까지 견준다(`shell_key::of_generation`). `1700`만 보면 `17000-1.json`이 이번 실행의 것으로 읽혀
        // 살아남고, 다음에 그 번호의 셸이 열리면 남의 상태를 뒤집어쓴다.
        if !keep.iter().any(|generation| shell_key::of_generation(key, generation)) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// `~/.atelier/shells/`를 보는 **세 번째 감시**.
///
/// **기존 감시(`watcher.rs`)를 못 쓴다.** 그쪽은 「무언가 바뀌었다」는 종만 치고 페이로드를
/// 안 싣는다 — 프런트가 그 종을 듣고 다시 물어보는 구조다. 여기서 그렇게 하면 셸이 말할
/// 때마다 프런트가 폴더를 통째로 되읽는 왕복이 하나 생기고, 「바뀐 셸만」이라는 값도 잃는다.
/// 그래서 바뀐 파일에서 셸 ID를 뽑고 내용을 읽어 **바뀐 셸만** 실어 보낸다.
///
/// **한 번 흔들릴 때마다 폴더를 통째로 다시 읽는다.** 이벤트가 든 경로만 읽으면 지워진
/// 파일을 못 보고(그 셸이 화면에서 영영 안 지워진다) 감시가 놓친 회차도 못 따라잡는다.
/// 파일 수는 셸 수(화면마다 8)라 통째로 읽어도 싸다.
///
/// **접두사를 받는다.** 이번 실행의 셸만 읽는 자리가 `scan`이고, 그 값이 여기까지 실려
/// 와야 판정이 `sweep`(파괴적 일회성 청소)에 매이지 않는다.
pub fn watch(app: AppHandle, dir: PathBuf, prefix: &'static str) {
    std::thread::spawn(move || {
        watch_into(&dir, prefix, |changed| {
            let _ = app.emit(ATTENTION_EVENT, changed);
        });
    });
}

/// 감시의 **몸통**. 나가는 자리를 인자로 받는 것은 검사를 위해서다 — `AppHandle`은 창과
/// 웹뷰가 있어야 서고, 그러면 「파일이 바뀌면 바뀐 셸만 나간다」를 실행으로 잴 자리가
/// 어디에도 안 남는다(그 값이 이 감시의 전부다). 돌아오지 않는 함수다.
///
/// **디바운서를 세우는 앞 절반은 `watcher.rs`의 `spawn_watch`와 짝이다** — `create_dir_all`
/// → 채널 → `new_debouncer` → `watch` → 회차 루프가 줄 단위로 같고 오류 문구까지 겹친다.
/// 새로 판 근거는 **나가는 것**이었지(그쪽은 페이로드 없는 종, 이쪽은 바뀐 셸) 배선이
/// 아니므로, notify의 API가 바뀌거나 오류 처리를 고칠 때는 **두 자리를 함께** 고쳐야 한다.
/// 뽑아낼 자리는 「폴더 하나를 디바운스로 보며 회차마다 콜백을 부른다」인데, 이 판에서는
/// 안 뽑는다 — 감시 셋이 다 서고 나서 볼 일이다.
fn watch_into(dir: &Path, prefix: &str, mut emit: impl FnMut(Vec<ShellAttention>)) {
    let _ = std::fs::create_dir_all(dir);
    let (tx, rx) = std::sync::mpsc::channel();
    let mut debouncer = match new_debouncer(DEBOUNCE, tx) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("atelier: shells watcher init failed for {}: {e}", dir.display());
            return;
        }
    };
    if let Err(e) = debouncer.watcher().watch(dir, RecursiveMode::NonRecursive) {
        eprintln!("atelier: failed to watch {}: {e}", dir.display());
        return;
    }
    // **프런트가 지금 믿고 있는 값**이다. 안 쏜 회차에는 잰 값과 같으므로 그대로 덮어써도
    // 어긋나지 않는다 — `pty.rs`의 폴링 스레드와 같은 한 줄이다.
    let mut sent = Attention::new();
    for result in rx {
        let Ok(_events) = result else { continue };
        let now = scan(dir, prefix);
        let changed = changes(&sent, &now);
        if !changed.is_empty() {
            emit(changed);
        }
        sent = now;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::processes::clock::now_ms;

    fn temp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("atelier-shells-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// **아틀리에 밖 터미널에서 무해해야 한다.** 사용자가 훅을 깔면 그 훅은 앱 밖에서 띄운
    /// claude·codex에서도 돈다 — 거기엔 셸 ID가 없다. 그때 무엇이든 남기면 남의 홈에
    /// 쓰레기를 쌓는 것이고, 0이 아닌 코드로 끝나면 Claude·Codex 둘 다 그것을 훅 실패로
    /// 읽어 사람에게 오류를 보인다.
    ///
    /// **문자열로 재지 않고 실제로 돌린다.** 「스크립트에 그 줄이 쓰여 있다」는 「그 줄이
    /// 돈다」가 아니다.
    ///
    /// **페이로드를 파이프 버퍼보다 크게 먹인다.** 「무해하다」는 종료 코드만의 이야기가
    /// 아니다 — 훅이 stdin을 한 글자도 안 읽고 나가면 페이로드를 쓰던 에이전트가 `EPIPE`를
    /// 받는다. 짧은 이벤트는 페이로드가 파이프 버퍼(macOS·리눅스 모두 64KB) 안에 다 들어가
    /// 커널이 대신 받아 주므로 안 터지고, 긴 프롬프트가 실린 `UserPromptSubmit`이나 긴
    /// `last_assistant_message`만 그 선을 넘는다 — 그래서 작은 페이로드로 재면 이 자리가
    /// 영영 안 보인다. 여기서 재는 것은 **쓰는 쪽이 끝까지 쓸 수 있는가**다.
    #[test]
    fn without_a_shell_id_the_hook_eats_the_payload_and_exits_zero() {
        let root = temp_root("no-env");
        write_hook_script(&root).expect("스크립트를 세운다");

        // 파이프 버퍼(64KB)를 훌쩍 넘긴다. 커널이 대신 받아 줄 수 없는 크기라야 「스크립트가
        // 읽는가」가 쓰는 쪽에 보인다.
        let big = format!(r#"{{"prompt":"{}"}}"#, "x".repeat(1_000_000));
        let (wrote, out) = run_hook(&root, None, &["claude", "UserPromptSubmit"], &big);

        wrote.expect("에이전트가 페이로드를 끝까지 쓸 수 있다 — 훅이 stdin을 안 읽고 나갔다");
        assert!(out.status.success(), "종료 코드가 0이 아니다: {:?}", out.status);
        assert!(
            !shells_dir(&root).exists(),
            "셸 ID가 없는데 상태 폴더를 만들었다 — 아틀리에 밖에서 자국을 남긴다"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// **셸 ID는 그대로 파일 이름이 된다.** `/`나 `..`가 섞인 값이 통과하면 상태 폴더 **밖**에
    /// 쓰게 된다 — 값이 사용자 홈으로 새는 방향이라 스크립트가 막는다(`shell.isalnum()` 한 줄).
    ///
    /// 그 한 줄이 **주석만의 보장**이 되지 않도록 실행으로 잰다. 앱이 심는 값은 늘 우리
    /// 모양이므로 이것은 적대자가 아니라 나중의 우리를 막는 검사다 — env 이름 하나를 남이
    /// 쓰거나, 셸 ID의 모양을 넓히다 이 줄을 함께 지우는 길이 있다.
    #[test]
    fn a_shell_id_that_could_escape_the_folder_writes_nothing() {
        let root = temp_root("evil-id");
        write_hook_script(&root).expect("스크립트를 세운다");

        for evil in ["../evil", "a/b", "..", "."] {
            let (wrote, out) = run_hook(&root, Some(evil), &["claude", "Stop"], "{}");
            wrote.expect("페이로드를 끝까지 쓸 수 있다");
            assert!(out.status.success(), "`{evil}`에 0이 아닌 코드로 끝났다: {:?}", out.status);

            let outside: Vec<String> =
                files_in(&root).into_iter().filter(|n| n != "hooks" && n != "shells").collect();
            assert!(outside.is_empty(), "`{evil}`이 상태 폴더 **밖**에 썼다: {outside:?}");
            if shells_dir(&root).exists() {
                assert_eq!(files_in(&shells_dir(&root)), Vec::<String>::new(), "`{evil}`이 파일을 남겼다");
            }
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 셸 ID가 있으면 **그 ID의 파일 한 장**이 생긴다. 그 한 장이 이 판의 신호 길에서
    /// 훅이 남기는 전부다.
    ///
    /// **임시 파일이 안 남는 것을 함께 잰다.** 쓰기는 원자적이어야 하는데(감시가 반쯤
    /// 쓰인 파일을 읽으면 그 셸이 조용히 사라진다) 원자성의 값은 「중간 단계가 안 보인다」
    /// 이고, 중간 단계가 그 자리에 **남아 있으면** 그 값은 이미 깨진 것이다.
    #[test]
    fn with_a_shell_id_the_hook_leaves_one_file_and_no_tmp() {
        let root = temp_root("with-env");
        write_hook_script(&root).expect("스크립트를 세운다");

        let (wrote, out) = run_hook(
            &root,
            Some("1700000000000-3"),
            &["claude", "Stop"],
            r#"{"last_assistant_message":"테스트 셋 통과"}"#,
        );
        wrote.expect("페이로드를 끝까지 쓸 수 있다");
        assert!(out.status.success(), "종료 코드가 0이 아니다: {out:?}");

        let written = std::fs::read_to_string(shells_dir(&root).join("1700000000000-3.json"))
            .expect("그 셸 ID의 상태 파일이 있다");
        let state: serde_json::Value = serde_json::from_str(&written).expect("JSON이다");
        assert_eq!(state["agent"], "claude");
        assert_eq!(state["event"], "Stop");
        assert_eq!(
            state["payload"]["last_assistant_message"], "테스트 셋 통과",
            "페이로드가 그대로 안 실렸다 — 둘째 줄에 적을 말이 여기서만 온다"
        );
        assert!(state["at"].as_u64().unwrap_or(0) > 1_700_000_000_000, "적힌 시각이 없다");

        let names = files_in(&shells_dir(&root));
        assert_eq!(names, vec!["1700000000000-3.json"], "임시 파일이 남았거나 딴것이 생겼다");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// **훅은 남을 부르지 않는다.** 훅이 도는 시간은 그대로 사람이 기다리는 시간이라
    /// (에이전트의 턴 안에서 돈다) 프로세스를 하나 더 띄우는 것은 신호의 값을 속도로
    /// 물어내는 것이다.
    ///
    /// **금지어 목록이 아니라 허용 목록으로 잰다.** 「`subprocess`가 없다」는 다음에 누가
    /// `multiprocessing`이나 `ctypes`를 들이면 조용히 통과한다 — 파이썬에서 프로세스를
    /// 띄우는 길이 열 가지가 넘는다. 들여오는 모듈 넷과 쓰는 `os` 함수 여섯을 **못으로
    /// 박아** 그 밖의 무엇이든 빨간불이 되게 한다. 허용 목록을 우회하는 길(동적 import·
    /// eval·`getattr`로 이름을 조립하는 것)은 그 이름을 따로 막는다 — 그 다섯이 닫히면 이
    /// 목록 밖으로 나가는 문이 없다.
    ///
    /// **공백을 지운 소스로 잰다.** 파이썬은 `os . system(...)`도 `getattr (os, …)`도 받는데,
    /// 리터럴 `"os."`·`"getattr("`를 찾는 스캔은 그 공백 하나에 통째로 눈이 먼다 — 이
    /// 저장소는 파서가 새면 조용히 통과하는 검사를 fail-open이라 부르고, 여기가 정확히 그
    /// 모양이 될 자리였다. 공백을 지우면 `os.\n.system`처럼 줄을 넘긴 것도 함께 걸린다.
    ///
    /// 재는 대상은 **앱이 실제로 굽는 문자열**(`HOOK_SCRIPT`)이라, 소스 트리의 다른 파일이
    /// 바뀌어도 이 검사가 헛도는 자리가 없다.
    #[test]
    fn the_hook_never_reaches_for_another_process() {
        let imports: Vec<&str> = HOOK_SCRIPT
            .lines()
            .map(str::trim)
            .filter(|line| line.starts_with("import ") || line.starts_with("from "))
            .collect();
        assert_eq!(
            imports,
            vec!["import json", "import os", "import sys", "import time"],
            "훅이 들여오는 모듈이 늘었다 — 프로세스를 띄우는 길이 열렸는지 눈으로 보라"
        );

        let squeezed: String = HOOK_SCRIPT.chars().filter(|c| !c.is_whitespace()).collect();

        for name in os_attributes(&squeezed) {
            assert!(
                ["environ", "path", "makedirs", "replace", "remove", "getpid"].contains(&name.as_str()),
                "훅이 `os.{name}`을 쓴다 — 이 목록은 시스템 호출로만 채워져 있어야 한다"
            );
        }

        // `getattr`는 이름을 **조각으로 지어** 부를 수 있어(`getattr(os, "sys" + "tem")`) 위
        // 스캔에도 아래 셋에도 안 걸린다. 훅이 쓸 일이 없는 이름이라 통째로 막는다.
        for door in ["__import__", "eval(", "exec(", "compile(", "getattr("] {
            assert!(
                !squeezed.contains(door),
                "훅에 `{door}`가 있다 — 위 허용 목록을 우회해 무엇이든 들여올 수 있다"
            );
        }
    }

    /// `os.` 뒤에 오는 이름들. 앞 글자가 이름의 일부인 경우(`macos.`)는 건너뛴다.
    /// 공백이 지워진 소스를 받는다(부르는 쪽의 독 참조).
    ///
    /// **앞 글자는 ASCII로만 견준다.** 공백을 지우면 한글 주석이 `os.`에 그대로 붙는데,
    /// 유니코드 전체를 「이름의 일부」로 보면 그런 자리가 통째로 스캔에서 빠진다 — 새는
    /// 방향이 조용한 통과라 좁게 잡는다. 자리를 바이트가 아니라 글자로 되짚는 것도 같은
    /// 이유다(한글 한 글자는 세 바이트라 바이트 하나만 보면 엉뚱한 조각을 읽는다).
    fn os_attributes(src: &str) -> Vec<String> {
        src.match_indices("os.")
            .filter(|(at, _)| {
                !src[..*at].chars().next_back().is_some_and(|c| c.is_ascii_alphanumeric() || c == '_')
            })
            .map(|(at, _)| {
                src[at + 3..].chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect()
            })
            .collect()
    }

    /// 깨진 파일 한 장이 나머지를 끌고 가지 않는다. 이 감시가 죽으면 화면이 조용해지는
    /// 것이 아니라 **모든 셸이 영영 말을 못 하게** 된다.
    #[test]
    fn a_broken_state_file_is_skipped_and_the_rest_still_come() {
        let root = temp_root("broken");
        let dir = shells_dir(&root);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("prefix-1.json"), r#"{"agent":"claude","event":"Stop","at":7,"payload":null}"#).unwrap();
        std::fs::write(dir.join("prefix-2.json"), "{ 여기서 잘렸").unwrap();
        std::fs::write(dir.join(".prefix-3.json.9.tmp"), "{}").unwrap();

        let seen = scan(&dir, "prefix");

        assert_eq!(seen.keys().collect::<Vec<_>>(), vec!["prefix-1"], "실린 셸이 다르다");
        assert_eq!(seen["prefix-1"].event, "Stop");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// **읽는 쪽이 접두사를 본다.** 접두사는 「실행끼리 안 겹치게」 하는 값인데, 그것을
    /// 견주는 자리가 `sweep` 하나뿐이면 그 보장은 **파괴적 일회성 청소**에만 걸려 있다 —
    /// 필터가 아니다. `~/.atelier`는 빌드마다 안 갈리고 single-instance도 안 걸려 있어
    /// 설치본과 `pnpm tauri dev`가 같은 폴더를 나눠 쓰는데, 그때 남의 인스턴스가 놓고 간
    /// 파일이 그대로 실려 나가고 프런트는 마지막 `-` 뒤 번호만 읽어 **전혀 다른 셸에 남의
    /// claude 상태와 남의 마지막 말**을 앉힌다. 오류 한 줄 없이 조용하다.
    ///
    /// 그래서 fail-closed다 — 이번 실행의 접두사가 아니면 안 싣는다. `17000-1`은
    /// 구분자까지 견주는 자리라 함께 잰다(`1700`으로 시작하지만 남의 것이다).
    #[test]
    fn another_instances_files_are_not_read() {
        let root = temp_root("scan-prefix");
        let dir = shells_dir(&root);
        std::fs::create_dir_all(&dir).unwrap();
        for name in ["1700-1.json", "1699-1.json", "17000-1.json"] {
            std::fs::write(
                dir.join(name),
                r#"{"agent":"claude","event":"Stop","at":7,"payload":null}"#,
            )
            .unwrap();
        }

        let seen = scan(&dir, "1700");

        assert_eq!(
            seen.keys().collect::<Vec<_>>(),
            vec!["1700-1"],
            "남의 인스턴스가 놓고 간 파일이 실렸다 — 그 값이 이번 실행의 엉뚱한 셸에 앉는다"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// **읽기와 쓸기가 같은 셸 키 규칙을 쓴다** — 「세대-숫자」(`shell_key::of_generation`). 읽기가 머리(`1700-`)만 보면 이 세대의
    /// 머리를 달았지만 꼬리가 PTY 번호가 아닌 파일(`1700-x` · `1700-` · `1700-1a`)이 셸로 실려 나간다. 앱은 그런 이름을 짓지
    /// 않고 쓸기는 그것을 남의 것으로 걷으니, 두 자리가 같은 파일을 다르게 읽는다.
    ///
    /// 앵커: 이 세대의 온전한 셸 키(`1700-1` · `1700-12`)는 실린다 — 아무것도 안 싣게 무너지면 「안 실렸다」가 저절로 참이 된다.
    #[test]
    fn a_file_whose_tail_is_not_a_pty_number_is_not_read() {
        let root = temp_root("scan-tail");
        let dir = shells_dir(&root);
        std::fs::create_dir_all(&dir).unwrap();
        for name in ["1700-1.json", "1700-12.json", "1700-x.json", "1700-.json", "1700-1a.json", "1700-1-2.json"] {
            std::fs::write(
                dir.join(name),
                r#"{"agent":"claude","event":"Stop","at":7,"payload":null}"#,
            )
            .unwrap();
        }

        let seen = scan(&dir, "1700");

        assert_eq!(
            seen.keys().collect::<Vec<_>>(),
            vec!["1700-1", "1700-12"],
            "꼬리가 PTY 번호가 아닌 파일이 셸로 실렸다 — 쓸기가 남의 것으로 걷는 이름을 읽기는 이 실행의 셸로 읽는다"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// **바뀐 셸만** 나간다. 안 바뀐 셸이 함께 실리면 상태 축이 붙은 화면 넷이 파일 하나가
    /// 흔들릴 때마다 통째로 다시 그려진다.
    #[test]
    fn only_the_shells_that_changed_go_out() {
        let 조용한 = state("claude", "Stop", 1);
        let 말한 = state("claude", "PermissionRequest", 2);
        let sent = Attention::from([("가-1".into(), 조용한.clone()), ("가-2".into(), 말한.clone())]);
        let now = Attention::from([
            ("가-1".into(), 조용한.clone()),
            ("가-2".into(), state("claude", "Stop", 3)),
            ("가-3".into(), 말한.clone()),
        ]);

        let out = changes(&sent, &now);

        assert_eq!(
            out.iter().map(|c| c.shell_id.as_str()).collect::<Vec<_>>(),
            vec!["가-2", "가-3"],
            "안 바뀐 셸이 실렸거나 바뀐 셸이 빠졌다"
        );
        assert_eq!(out[0].state.as_ref().map(|s| s.at), Some(3));
    }

    /// 파일이 사라지면 **한 번** 지우러 나간다. 안 그러면 마지막 값이 화면에 굳어 닫힌
    /// 셸이 영영 사람을 부른다. 두 번 나가면 알림 엣지가 두 번 발화한다.
    #[test]
    fn a_vanished_state_goes_out_once_as_nothing() {
        let sent = Attention::from([("가-1".into(), state("claude", "Stop", 1))]);
        let 빈 = Attention::new();

        let 지움 = changes(&sent, &빈);
        assert_eq!(지움.len(), 1, "사라진 셸이 안 나갔다");
        assert_eq!(지움[0].shell_id, "가-1");
        assert_eq!(지움[0].state, None, "사라진 셸에 값이 실렸다");

        // 감시는 쏜 뒤 `sent`를 방금 잰 것으로 덮는다 — 그다음 회차가 이것이다.
        assert!(changes(&빈, &빈).is_empty(), "사라진 셸을 다시 지우러 나갔다");
    }

    /// 지난 실행의 파일은 가고 이번 실행의 것은 남는다.
    #[test]
    fn a_sweep_keeps_only_this_runs_files() {
        let root = temp_root("sweep");
        let dir = shells_dir(&root);
        std::fs::create_dir_all(&dir).unwrap();
        for name in ["1699-0.json", "1700-0.json", "1700-12.json", ".1699-4.json.9.tmp"] {
            std::fs::write(dir.join(name), "{}").unwrap();
        }

        sweep(&root, &["1700".to_string()]);

        assert_eq!(
            files_in(&dir),
            vec!["1700-0.json", "1700-12.json"],
            "지난 실행의 파일이 남았거나 이번 실행의 것이 지워졌다"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// **살아 있는 실행의 세대는 남는다 — 상태 · 잠금 · 쓰는 중 임시 파일 모두**(프로세스 스펙 S10 · 티켓 11). dev 빌드와
    /// 설치본을 함께 띄우면 한쪽이 뜰 때 다른 쪽 셸의 띠 상태를 지우던 자리다. 죽은 세대의 것은 모두 간다.
    ///
    /// **점으로 시작하는 파일도 세대로 읽는다.** 잠금(`.<키>.lock`)과 쓰는 중인 파일(`.<키>.json.<pid>.tmp`)의 세대를 점째
    /// 견주면 어느 세대와도 안 맞아, 살아 있는 실행의 잠금을 지워 배타가 깨진다.
    ///
    /// 앵커: 죽은 세대와 경계만 겹치는 세대, 우리 모양이 아닌 것은 실제로 지워진다 — 아무것도 안 지우게 무너지면 「남았다」가
    /// 저절로 참이 된다.
    #[test]
    fn a_sweep_keeps_every_file_of_a_live_run_and_reads_dot_files_by_their_generation() {
        let root = temp_root("sweep-live-runs");
        let dir = shells_dir(&root);
        std::fs::create_dir_all(&dir).unwrap();
        let this_run = ["1700-0.json", ".1700-0.lock", ".1700-0.json.77.tmp"];
        let other_live_run = ["1800-3.json", ".1800-3.lock", ".1800-3.json.9.tmp"];
        let dead_run = ["1699-1.json", ".1699-1.lock", ".1699-1.json.5.tmp"];
        let look_alikes = ["17000-1.json", ".17000-1.lock", ".1800-.lock", "notes.txt", ".DS_Store"];
        for name in this_run.iter().chain(&other_live_run).chain(&dead_run).chain(&look_alikes) {
            std::fs::write(dir.join(name), "{}").unwrap();
        }

        sweep(&root, &["1700".to_string(), "1800".to_string()]);

        let mut kept: Vec<&str> = this_run.iter().chain(&other_live_run).copied().collect();
        kept.sort_unstable();
        assert_eq!(
            files_in(&dir),
            kept,
            "살아 있는 실행의 파일(점 파일 포함)이 지워졌거나, 죽은 실행 · 경계만 겹치는 것 · 모양이 아닌 것이 남았다"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// **쓸기가 살아 있는 셸의 파일을 지우지 않는다.**
    ///
    /// 위 둘은 접두사를 **손으로 지어** 넣어 쓸기의 규칙만 잰다 — 그래서 앱이 실제로 쓰는 두
    /// 값(`shell_key::mint`가 파일 이름에 넣는 세대 · 쓸기가 견주는 세대)이 갈리는 순간을
    /// 하나도 못 본다. 그 둘이 갈리면 앱이 뜨자마자 방금 연 셸의 상태 파일을 지워 셸이 말해도
    /// 그 값이 곧 사라진다. 여기서 **값으로** 잰다: 진짜 셸 ID로 이름 지은 파일을 놓고 진짜
    /// 접두사로 쓸어, 그 파일이 **남아 있는지** 본다.
    #[test]
    fn a_sweep_keeps_the_file_a_live_shell_is_named_with() {
        let root = temp_root("sweep-live");
        let dir = shells_dir(&root);
        std::fs::create_dir_all(&dir).unwrap();
        let name = format!("{}.json", shell_key::mint(0));
        std::fs::write(dir.join(&name), "{}").unwrap();

        sweep(&root, &crate::processes::instances::live_generations(&root));

        assert_eq!(
            files_in(&dir),
            vec![name],
            "이번 실행의 셸 파일이 지워졌다 — 이름 짓는 접두사와 쓸기의 접두사가 갈렸다"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// **살아 있는 다른 실행은 인스턴스 기록에서 온다**(티켓 11 · 프로세스 스펙 S10) — 앱이 setup에서 부르는 그대로
    /// (`sweep(&root, &instances::live_generations(&root))`) 쓸어, 앱이 지금 떠 있는 기록의 세대 파일(상태 · 잠금 · 임시)은 남고
    /// 앱이 죽은 기록의 세대 파일은 가는지 본다.
    ///
    /// 위의 살아 있는 실행 검사는 남길 세대를 **손으로** 넘기고, 바로 위 검사의 루트에는 기록 폴더가 없다 — 그래서
    /// `instances::live_generations`가 기록 폴더의 살아 있는 세대를 더하는 한 줄을 지우거나 폴더를 잘못 줘도 아무 검사가 안
    /// 울었다. 그러면 dev 빌드가 뜰 때 설치본 셸의 상태 파일을 지워 그 셸의 띠 상태가 사라진다(이 장이 고친 결함 그대로).
    ///
    /// 기록은 앱이 쓰는 길(`Place::this_app` · `Record::open`)로 임시 루트에 쓴다. 살아 있는 실행의 앱은 이 검사 프로세스다.
    /// 죽은 실행은 같은 pid에 다른 시작 시각이다(pid가 재사용된 흉내, S9). 신원을 읽는 것은 macOS뿐이다 — 다른 OS에서는
    /// `alive`가 늘 거짓이라 잴 갈래가 없다.
    ///
    /// 앵커: 죽은 실행의 세대 파일은 기록이 있어도 실제로 지워진다 — 아무것도 안 지우게 무너지면 「남았다」가 저절로 참이 된다.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_sweep_keeps_the_files_of_a_run_whose_instance_record_is_alive() {
        use crate::processes::instances::{Place, Record};
        use crate::processes::Identity;

        let root = temp_root("sweep-live-record");
        let dir = shells_dir(&root);
        std::fs::create_dir_all(&dir).unwrap();
        let live = Place::this_app(&root, "1800", "0.0.0").expect("이 검사 프로세스의 신원을 읽는다");
        let dead_app = Identity { pid: live.app.pid, started_us: live.app.started_us + 1 };
        Record::default().open(Place { generation: "1699".to_string(), app: dead_app, ..live.clone() });
        Record::default().open(live);
        let this_run = format!("{}.json", shell_key::mint(0));
        let live_run = ["1800-3.json", ".1800-3.lock", ".1800-3.json.9.tmp"];
        let dead_run = ["1699-1.json", ".1699-1.lock", ".1699-1.json.5.tmp"];
        for name in live_run.iter().chain(&dead_run).copied().chain([this_run.as_str()]) {
            std::fs::write(dir.join(name), "{}").unwrap();
        }

        sweep(&root, &crate::processes::instances::live_generations(&root));

        let mut kept: Vec<String> = live_run.iter().map(|name| name.to_string()).chain([this_run]).collect();
        kept.sort_unstable();
        assert_eq!(
            files_in(&dir),
            kept,
            "앱이 떠 있는 실행(인스턴스 기록)의 파일이 지워졌거나, 앱이 죽은 실행의 파일이 남았다"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 접두사가 **온전히** 맞아야 한다. `1700`으로 쓸어 낼 때 `17000-…`을 남기면 다음
    /// 실행이 그것을 자기 셸로 읽는다 — 이 검사가 없으면 `starts_with(prefix)` 한 줄이
    /// 조용히 통과한다.
    #[test]
    fn a_prefix_only_matches_up_to_the_separator() {
        let root = temp_root("sweep-boundary");
        let dir = shells_dir(&root);
        std::fs::create_dir_all(&dir).unwrap();
        for name in ["1700-1.json", "17000-1.json"] {
            std::fs::write(dir.join(name), "{}").unwrap();
        }

        sweep(&root, &["1700".to_string()]);

        assert_eq!(files_in(&dir), vec!["1700-1.json"], "다른 실행의 파일을 이번 것으로 읽었다");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// **디바운스의 상한은 스펙이 정한 수다** — 100ms 이하(구현 스펙 결정 2). 기존 감시
    /// 둘(300·500ms)은 문서 편집을 몰아 받는 값이고 이쪽은 「지금 나를 기다린다」라, 늦은
    /// 만큼이 그대로 사람이 모르는 시간이 된다.
    ///
    /// **실측 지연으로는 못 잰다** — macOS의 FSEvents가 몇백 밀리초씩 뭉쳐 오므로 「나가기까지
    /// 걸린 시간」을 재면 러너와 파일시스템에 매인 검사가 된다. 그래서 상수를 값으로 못박는다.
    /// 이 한 줄이 없으면 `DEBOUNCE`를 `from_secs(5)`로 갈아도 어느 검사도 안 울린다.
    #[test]
    fn the_debounce_stays_under_the_ceiling_the_spec_set() {
        assert!(
            DEBOUNCE <= Duration::from_millis(100),
            "디바운스가 스펙의 상한(100ms)을 넘었다: {DEBOUNCE:?}"
        );
    }

    /// **파일이 바뀌면 그 셸이 나간다 — 그리고 그 셸만 나간다.** 위 `changes`가 값으로
    /// 전수되지만 그것만으로는 「감시가 이 폴더에 실제로 걸렸는가」를 모른다 — 배선이 통째로
    /// 빠져도 `changes`의 검사들은 초록이다. 여기가 그 자리를 잰다.
    ///
    /// **「얼마 만에 나가는가」는 여기서 안 잰다**(위 `the_debounce_stays_under_the_ceiling_the_spec_set`
    /// 참조). 아래 `recv_timeout`은 상한이지 지연의 단언이 아니다.
    ///
    /// 나가는 자리를 채널로 받아 헤드리스로 돈다. 기다리는 시간을 넉넉히 두는 것은
    /// macOS의 FSEvents가 몇백 밀리초씩 뭉쳐 오기 때문이다 — 짧게 잡으면 러너 속도에 매인
    /// 검사가 된다.
    #[test]
    fn a_changed_file_goes_out_and_the_quiet_ones_do_not() {
        let root = temp_root("watch");
        let dir = shells_dir(&root);
        std::fs::create_dir_all(&dir).unwrap();

        let (tx, rx) = std::sync::mpsc::channel();
        let watched = dir.clone();
        std::thread::spawn(move || {
            watch_into(&watched, "1700", |changed| {
                let _ = tx.send(changed);
            });
        });
        // **감시가 걸릴 때까지 같은 파일을 다시 쓴다.** 감시가 걸리기 전에 쓴 파일은 아무 이벤트도 안 낸다. 한때 300ms
        // 쉬고 한 번만 썼는데, 붐비는 기계(다른 검사가 함께 도는 `cargo test --workspace`, 옆 세션의 L3)에서는 감시
        // 스레드가 그 안에 FSEvents 흐름을 못 열어 첫 쓰기가 통째로 빠지고 10초 기다림이 터졌다(쉼을 3초로 늘리면 같은
        // 부하에서 다섯 번 모두 초록이었다). 같은 내용을 다시 쓰는 것은 무해하다 — 감시는 바뀐 셸만 내보내므로, 먼저
        // 나온 한 번 뒤에 늦게 온 이벤트는 아무것도 안 싣는다. 모두 합쳐 10초가 상한인 것은 그대로다.
        let first = (0..40)
            .find_map(|_| {
                write_state(&dir, "1700-1", 1);
                rx.recv_timeout(std::time::Duration::from_millis(250)).ok()
            })
            .expect("바뀐 셸이 나온다");
        assert_eq!(first.len(), 1, "한 셸만 바뀌었는데 여럿이 나갔다: {first:?}");
        assert_eq!(first[0].shell_id, "1700-1");
        // 감시가 쏘는 사건에 서브에이전트 수와 멈춤이 실린다(티켓 19) — 파일의 id 둘이 수 2로.
        let sent = first[0].state.as_ref().expect("값이 실렸다");
        assert_eq!((sent.subagents, sent.stopped), (2, true), "감시의 사건에 서브에이전트 수나 멈춤이 안 실렸다");

        write_state(&dir, "1700-2", 2);
        let second = rx.recv_timeout(std::time::Duration::from_secs(10)).expect("둘째 셸이 나온다");
        assert_eq!(
            second.iter().map(|c| c.shell_id.as_str()).collect::<Vec<_>>(),
            vec!["1700-2"],
            "안 바뀐 셸이 함께 실려 나갔다 — 화면 넷이 파일 하나에 통째로 다시 그려진다"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    // ── 상태 파일의 새 칸 읽기(티켓 19 · 프로세스 스펙 S26) ──

    /// **옛 처리기의 파일은 서브에이전트 없음 · 안 멈춤으로 읽힌다.** 훅 갱신(티켓 21) 전까지 설정이 부르는 것은 옛 python
    /// 처리기이고, 두 빌드가 같은 루트를 쓴다 — 새 칸이 없는 파일을 깨진 것으로 보면 그 셸이 통째로 조용해진다.
    ///
    /// 파일은 옛 처리기가 쓰는 글자 그대로다(`json.dumps`의 기본 구분자 — 쉼표와 쌍점 뒤에 빈칸).
    #[test]
    fn an_old_handlers_file_reads_as_no_subagents_and_not_stopped() {
        let root = temp_root("old-file");
        let dir = shells_dir(&root);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("1700-1.json"),
            r#"{"agent": "claude", "event": "Stop", "at": 1790000000123, "payload": {"last_assistant_message": "끝"}}"#,
        )
        .unwrap();

        let seen = scan(&dir, "1700");

        let old = seen.get("1700-1").expect("옛 처리기의 파일이 안 읽혔다 — 그 셸이 조용해진다");
        assert_eq!((old.subagents, old.stopped), (0, false), "새 칸이 없는 파일을 빈 목록과 거짓으로 안 읽었다");
        assert_eq!((old.event.as_str(), old.at), ("Stop", 1_790_000_000_123), "옛 칸이 그대로 안 읽혔다");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// **감시의 사건이 서브에이전트 수와 멈춤을 싣는다 — 선 위의 글자로.** 화면(티켓 20)은 이 두 이름으로 읽는다. 파일의 id는
    /// 집합으로 세므로, 손으로 고친 파일의 겹친 id가 수를 부풀리지 않는다.
    #[test]
    fn the_attention_event_carries_the_subagent_count_and_stopped_on_the_wire() {
        let root = temp_root("wire");
        let dir = shells_dir(&root);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("1700-4.json"),
            r#"{"agent":"claude","event":"SubagentStop","at":7,"subagents":["a1","b2","a1"],"stopped":true,"payload":null}"#,
        )
        .unwrap();

        let out = changes(&Attention::new(), &scan(&dir, "1700"));

        assert_eq!(
            serde_json::to_string(&out).unwrap(),
            r#"[{"shellId":"1700-4","state":{"agent":"claude","event":"SubagentStop","at":7,"payload":null,"subagents":2,"stopped":true}}]"#,
            "선 위의 모양이 다르다 — 화면이 서브에이전트 수나 멈춤을 못 읽는다"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// **사건 이름과 시각이 같아도 수나 멈춤이 바뀐 셸은 나간다.** 순서 가드에 막힌 늦은 사건은 파일의 사건 이름과 `at`을 두고
    /// 수와 멈춤만 고친다(S27) — 그 변화를 감시가 버리면 서브에이전트가 다 끝나도 셸이 「도는 중」에 남는다(S50).
    #[test]
    fn a_file_whose_only_change_is_the_count_or_the_stop_goes_out() {
        let before = state("claude", "Stop", 5);
        let sent = Attention::from([("가-1".into(), ShellHookState { subagents: 2, stopped: true, ..before.clone() })]);

        let fewer = Attention::from([("가-1".into(), ShellHookState { subagents: 1, stopped: true, ..before.clone() })]);
        assert_eq!(changes(&sent, &fewer).len(), 1, "수만 바뀐 셸이 안 나갔다");

        let resumed = Attention::from([("가-1".into(), ShellHookState { subagents: 2, stopped: false, ..before.clone() })]);
        assert_eq!(changes(&sent, &resumed).len(), 1, "멈춤만 바뀐 셸이 안 나갔다");

        // 앵커: 정말 같은 파일은 안 나간다 — 늘 나가게 무너지면 위 둘이 저절로 참이 된다.
        assert!(changes(&sent, &sent.clone()).is_empty(), "안 바뀐 셸이 나갔다");
    }

    // ── 새 처리기(티켓 19 · 프로세스 스펙 S26 · S27 · S28) — 실물로 띄운다 ──
    //
    // 처리기를 임시 루트에 세우고(`write_hook_script`, 앱과 같은 길) 에이전트가 부르는 모양 — 셸 없이 곧바로(`args` 꼴), argv
    // 둘(에이전트 · 사건), stdin의 페이로드 — 으로 띄운다. 페이로드는 지어내지 않고 출처를 단다.

    /// claude 2.1.283의 SubagentStart 페이로드. **실측**: 판 03 선행 시험 r2(`research/판03-선행-시험.md`) — 진짜 claude를 `-p`로
    /// 돌려 command 훅의 stdin에서 받은 것이다. 경로와 세션 칸은 줄였고, 키와 그 순서는 그대로다. id만 갈아 끼운다.
    fn claude_subagent_start(id: &str) -> String {
        format!(
            r#"{{"session_id":"d76da175-9131-40aa-a893-69a3cfb0abc6","transcript_path":"/tmp/p18/d76da175.jsonl","cwd":"/tmp/p18/cwd","prompt_id":"36e4193c-881e-4d4b-88b8-4bb80c643446","agent_id":"{id}","agent_type":"general-purpose","hook_event_name":"SubagentStart"}}"#
        )
    }

    /// claude 2.1.283의 SubagentStop 페이로드. **실측**: 같은 시험 r2. `background_tasks`에 그 서브에이전트 자신이 `id` 칸으로 또
    /// 선다 — 처리기가 id를 그 자리에서 읽으면 안 된다.
    fn claude_subagent_stop(id: &str) -> String {
        format!(
            r#"{{"session_id":"d76da175-9131-40aa-a893-69a3cfb0abc6","transcript_path":"/tmp/p18/d76da175.jsonl","cwd":"/tmp/p18/cwd","prompt_id":"36e4193c-881e-4d4b-88b8-4bb80c643446","permission_mode":"default","agent_id":"{id}","agent_type":"general-purpose","hook_event_name":"SubagentStop","stop_hook_active":false,"agent_transcript_path":"/tmp/p18/d76da175/subagents/agent-{id}.jsonl","last_assistant_message":"PONG","background_tasks":[{{"id":"{id}","type":"subagent","status":"running","description":"Test agent ping","agent_type":"general-purpose"}}],"session_crons":[]}}"#
        )
    }

    /// codex 0.155.1의 SubagentStart 페이로드. **스키마**(실측이 아니다): codex 바이너리가 싣는 `subagent-start.command.input`
    /// JSON 스키마의 필수 칸 그대로다 — id 칸 이름이 claude와 같은 `agent_id`다. 값과 키 순서는 지은 것이다. 진짜 codex로 뜬
    /// 페이로드는 구현 기록 19절의 「사람이 볼 것」이다.
    fn codex_subagent_start(id: &str) -> String {
        format!(
            r#"{{"session_id":"019a2c3e-0000-7000-8000-000000000001","turn_id":"019a2c3e-0000-7000-8000-000000000002","transcript_path":null,"cwd":"/tmp/codex","hook_event_name":"SubagentStart","model":"gpt-5.5","permission_mode":"default","agent_id":"{id}","agent_type":"default"}}"#
        )
    }

    /// claude의 PostToolUseFailure 페이로드. **스키마**(실측이 아니다): claude 2.1.283 바이너리의 입력 스키마 칸(`tool_name` ·
    /// `tool_input` · `tool_use_id` · `error` · `is_interrupt?`). 판 03 선행 시험은 이 사건을 못 띄웠다(중단은 대개 이 사건 없이
    /// 끝난다 — 문서).
    fn claude_tool_failure(interrupted: bool) -> String {
        format!(
            r#"{{"session_id":"d76da175-9131-40aa-a893-69a3cfb0abc6","transcript_path":"/tmp/p18/d76da175.jsonl","cwd":"/tmp/p18/cwd","permission_mode":"default","hook_event_name":"PostToolUseFailure","tool_name":"Bash","tool_input":{{"command":"sleep 30","description":"wait"}},"tool_use_id":"toolu_01","error":"Interrupted by user","is_interrupt":{interrupted}}}"#
        )
    }

    /// 그 밖의 사건 — 이 장의 접기가 안 읽는 칸뿐이다. **실측**: 같은 시험 r1의 Stop 꼬리.
    const CLAUDE_STOP: &str = r#"{"session_id":"d76da175-9131-40aa-a893-69a3cfb0abc6","hook_event_name":"Stop","stop_hook_active":false,"last_assistant_message":"OK","background_tasks":[],"session_crons":[]}"#;

    /// 처리기를 세우고 **한 번 헛불러 둔다**(셸 ID 없이 — 아무것도 안 쓴다). macOS는 새로 쓰인 실행 파일의 첫 실행을 한 번
    /// 검사해 그 호출이 100ms를 넘고, 여러 검사가 함께 돌면 몇백 ms가 된다(`write_executable` 머리말). 시각과 순서를 재는
    /// 검사는 그 값을 처리기가 늦게 뜬 것으로 읽는다 — 앱에서는 처리기 파일이 켤 때마다 새로 안 쓰이므로 이 값은 앱을 올린 뒤
    /// 첫 호출 한 번뿐이다.
    fn ready_handler(root: &Path) {
        write_hook_script(root).expect("스크립트를 세운다");
        warm_up(&handler_path(root), root);
    }

    fn warm_up(handler: &Path, root: &Path) {
        let (wrote, out) = feed(handler_command(handler, root, None, &["claude", "Stop"]).into_spawned(), "{}");
        wrote.expect("페이로드를 끝까지 쓸 수 있다");
        assert!(out.status.success(), "헛부름이 0이 아닌 코드로 끝났다: {out:?}");
    }

    /// 처리기의 잠금 줄 — `-i`(다시 쥐어 보는 틈)가 든 5.9의 꼴이다.
    const LOCK_WITH_INTERVAL: &str = "zsystem flock -t 1 -i 0.001 -f lockfd $lock";

    /// **zsh 5.8을 흉내 낸 처리기 사본**을 세우고 한 번 헛불러 둔다. macOS 11 Big Sur의 `/bin/zsh`는 5.8, 12 Monterey · 13
    /// Ventura는 5.8.1이고 5.9는 14 Sonoma부터다. 앱은 최소 macOS를 안 걸어 그 기계에도 깔린다. `zsystem flock`의 `-i`와 소수
    /// 초는 5.9에서 들어왔다(zsh NEWS 「Changes from 5.8.1 to 5.9」). 그 전의 zsh는 모르는 옵션을 만나면 파일을 열기 전에
    /// 「flock: unknown option」을 말하고 1로 끝난다.
    ///
    /// 이 기계와 CI(ubuntu)의 zsh는 5.9라 그 갈래가 저절로는 안 돈다. 그래서 잠금 줄의 `-i` 한 글자를 5.9도 모르는 옵션으로
    /// 바꿔 같은 1을 낸다. `body`는 처리기 본문이다(fork 없음 검사는 침묵 줄을 뺀 사본을 준다).
    fn old_zsh_handler(root: &Path, body: &str) -> PathBuf {
        assert_eq!(body.matches(LOCK_WITH_INTERVAL).count(), 1, "처리기에 잠금 줄 `{LOCK_WITH_INTERVAL}`이 하나가 아니다 — 흉내가 빗나간다");
        let path = hooks_dir(root).join("zsh-5.8.zsh");
        write_executable(&path, &body.replacen(LOCK_WITH_INTERVAL, &LOCK_WITH_INTERVAL.replace(" -i ", " -Z "), 1)).unwrap();
        warm_up(&path, root);
        path
    }

    /// 한 셸의 잠금 파일을 **이 검사 프로세스가** 쥔다 — 처리기와 같은 fcntl 쓰기 잠금이다. 돌려준 파일을 닫으면(drop) 풀린다.
    fn hold_lock(root: &Path, shell: &str) -> std::fs::File {
        use std::os::fd::AsRawFd;

        std::fs::create_dir_all(shells_dir(root)).unwrap();
        let file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(lock_path(root, shell))
            .unwrap();
        // SAFETY: 모두 0인 `flock`은 올바른 값이고, 살아 있는 fd에 그 잠금 한 칸을 건다.
        let held = unsafe {
            let mut lock: libc::flock = std::mem::zeroed();
            lock.l_type = libc::F_WRLCK as _;
            lock.l_whence = libc::SEEK_SET as _;
            libc::fcntl(file.as_raw_fd(), libc::F_SETLK, &lock)
        };
        assert_eq!(held, 0, "검사가 잠금을 못 쥐었다: {}", std::io::Error::last_os_error());
        file
    }

    /// 처리기 한 벌을 띄운다 — stdin은 아직 안 준다(`feed`가 준다). 처리기의 시각이 stdin을 받기 **전에** 서는지 재려면 둘을
    /// 갈라야 한다.
    fn spawn_handler(root: &Path, shell: &str, agent: &str, event: &str) -> std::process::Child {
        handler_command(&handler_path(root), root, Some(shell), &[agent, event]).into_spawned()
    }

    /// 처리기를 한 번 불러 끝까지 — 순서대로 부르는 장면의 한 걸음. 부른 뒤의 상태 파일을 돌려준다.
    ///
    /// 걸음마다 계약의 바뀌지 않는 셋을 본다: 페이로드를 끝까지 받고, 0으로 끝나고, 아무 말도 없다(claude는 UserPromptSubmit의
    /// stdout을 대화에 싣는다).
    fn call(root: &Path, shell: &str, agent: &str, event: &str, payload: &str) -> serde_json::Value {
        let (wrote, out) = feed(spawn_handler(root, shell, agent, event), payload);
        wrote.expect("페이로드를 끝까지 쓸 수 있다 — 처리기가 stdin을 다 안 읽었다");
        assert!(out.status.success(), "{agent} {event}: 0이 아닌 코드로 끝났다: {out:?}");
        assert!(out.stdout.is_empty() && out.stderr.is_empty(), "{agent} {event}: 처리기가 말을 했다: {out:?}");
        state_in(root, shell)
    }

    fn state_in(root: &Path, shell: &str) -> serde_json::Value {
        let written = std::fs::read_to_string(state_path(root, shell)).expect("그 셸의 상태 파일이 있다");
        serde_json::from_str(&written).unwrap_or_else(|e| panic!("상태 파일이 JSON이 아니다({e}): {written}"))
    }

    /// 상태 파일의 서브에이전트 id — 집합이라 정렬해 견준다.
    fn subagent_ids(state: &serde_json::Value) -> Vec<String> {
        let mut ids: Vec<String> = state["subagents"]
            .as_array()
            .unwrap_or_else(|| panic!("`subagents`가 목록이 아니다: {state}"))
            .iter()
            .map(|id| id.as_str().expect("id는 글자다").to_string())
            .collect();
        ids.sort();
        ids
    }

    /// 새 처리기도 **아틀리에 밖 터미널에서 무해하다** — 셸 ID가 없으면 파이프 버퍼(64KB)를 훌쩍 넘는 페이로드를 끝까지 먹고,
    /// 아무것도 안 남기고, 아무 말 없이 0으로 끝난다. 옛 처리기 검사(`without_a_shell_id_the_hook_eats_the_payload_and_exits_zero`)와
    /// 같은 까닭이다.
    #[test]
    fn without_a_shell_id_the_handler_eats_the_payload_and_exits_zero() {
        let root = temp_root("handler-no-env");
        write_hook_script(&root).expect("스크립트를 세운다");

        let big = format!(r#"{{"prompt":"{}"}}"#, "x".repeat(1_000_000));
        let command = handler_command(&handler_path(&root), &root, None, &["claude", "UserPromptSubmit"]);
        let (wrote, out) = feed(command.into_spawned(), &big);

        wrote.expect("에이전트가 페이로드를 끝까지 쓸 수 있다 — 처리기가 stdin을 안 읽고 나갔다");
        assert!(out.status.success(), "종료 코드가 0이 아니다: {:?}", out.status);
        assert!(out.stdout.is_empty() && out.stderr.is_empty(), "처리기가 말을 했다: {out:?}");
        assert!(!shells_dir(&root).exists(), "셸 ID가 없는데 상태 폴더를 만들었다 — 아틀리에 밖에서 자국을 남긴다");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// **셸 ID와 argv는 파일 이름과 JSON 글자가 된다.** `/`나 `..`가 섞인 셸 ID는 상태 폴더 밖에 쓰고, 따옴표가 섞인 에이전트
    /// · 사건 이름은 상태 파일을 깨뜨린다(깨진 파일은 감시가 버린다 — 그 셸이 조용해진다). 처리기는 앱이 짓는 모양만 받는다.
    #[test]
    fn a_shell_id_or_an_argument_that_could_escape_makes_the_handler_write_nothing() {
        let root = temp_root("handler-evil");
        write_hook_script(&root).expect("스크립트를 세운다");

        let cases: [(&str, [&str; 2]); 6] = [
            ("../evil", ["claude", "Stop"]),
            ("a/b", ["claude", "Stop"]),
            ("..", ["claude", "Stop"]),
            (".", ["claude", "Stop"]),
            ("1700-1", [r#"claude","event":"x"#, "Stop"]),
            ("1700-1", ["claude", "Stop\"}"]),
        ];
        for (shell, args) in cases {
            let (wrote, out) = feed(handler_command(&handler_path(&root), &root, Some(shell), &args).into_spawned(), "{}");
            wrote.expect("페이로드를 끝까지 쓸 수 있다");
            assert!(out.status.success(), "`{shell}` {args:?}에 0이 아닌 코드로 끝났다: {:?}", out.status);
            let outside: Vec<String> =
                files_in(&root).into_iter().filter(|n| n != "hooks" && n != "shells").collect();
            assert!(outside.is_empty(), "`{shell}`이 상태 폴더 **밖**에 썼다: {outside:?}");
            if shells_dir(&root).exists() {
                assert_eq!(files_in(&shells_dir(&root)), Vec::<String>::new(), "`{shell}` {args:?}이 파일을 남겼다");
            }
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 셸 ID가 있으면 **그 셸의 상태 파일 한 장이 새 계약으로** 선다 — `{agent, event, at, payload, subagents, stopped}`(S26).
    /// 페이로드는 그대로 실리고, 쓰는 중 파일은 안 남는다. 잠금 파일(`lock_path`)은 남는다 — 셸이 끝날 때 셸이 걷는다.
    #[test]
    fn the_handler_leaves_one_state_file_in_the_new_contract_and_no_tmp() {
        let root = temp_root("handler-one");
        write_hook_script(&root).expect("스크립트를 세운다");

        let before = now_ms();
        let state = call(&root, "1700-3", "claude", "Stop", r#"{"last_assistant_message":"테스트 셋 통과"}"#);
        let after = now_ms();

        assert_eq!((state["agent"].as_str(), state["event"].as_str()), (Some("claude"), Some("Stop")));
        assert_eq!(
            state["payload"]["last_assistant_message"], "테스트 셋 통과",
            "페이로드가 그대로 안 실렸다 — 둘째 줄에 적을 말이 여기서만 온다"
        );
        let at = state["at"].as_u64().expect("`at`은 ms 수다");
        assert!((before..=after).contains(&at), "`at`({at})이 부른 때({before}..={after}) 밖이다");
        assert_eq!(subagent_ids(&state), Vec::<String>::new(), "서브에이전트가 없는데 목록이 비지 않았다");
        assert_eq!(state["stopped"], true, "Stop인데 멈추지 않았다");

        let lock = lock_path(&root, "1700-3").file_name().unwrap().to_string_lossy().to_string();
        assert_eq!(
            files_in(&shells_dir(&root)),
            vec![lock, "1700-3.json".to_string()],
            "쓰는 중 파일이 남았거나, 잠금 파일이 앱이 걷는 이름(`lock_path`)과 다르거나, 딴것이 생겼다"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// `ATELIER_HOME`이 없으면 데이터 루트는 `~/.atelier`다 — 앱(`atelier_core::data_root`)과 같은 자리. 검사의 `HOME`은 임시
    /// 루트다(`hook_command`).
    #[test]
    fn without_atelier_home_the_handler_writes_under_the_home() {
        let root = temp_root("handler-home");
        write_hook_script(&root).expect("스크립트를 세운다");

        let mut command = handler_command(&handler_path(&root), &root, Some("1700-2"), &["codex", "Stop"]);
        command.env_remove("ATELIER_HOME");
        let (wrote, out) = feed(command.into_spawned(), "{}");
        wrote.expect("페이로드를 끝까지 쓸 수 있다");
        assert!(out.status.success(), "종료 코드가 0이 아니다: {out:?}");

        assert!(
            state_path(&root.join(".atelier"), "1700-2").exists(),
            "`ATELIER_HOME` 없이 `HOME/.atelier/shells`에 안 썼다 — 앱이 보는 자리와 갈린다"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// **`at`은 처리기가 시작한 시각이다 — stdin을 다 읽은 때가 아니다**(S26). 옛 처리기는 다 읽고 푼 뒤에 쟀다. 순서 가드는
    /// 「누가 먼저 불렸나」를 이 값으로 가르므로, 긴 페이로드를 늦게 받은 처리기가 늦게 불린 것으로 읽히면 안 된다.
    #[test]
    fn the_handler_takes_its_time_when_it_starts_not_when_the_payload_is_in() {
        let root = temp_root("handler-at");
        ready_handler(&root);

        let child = spawn_handler(&root, "1700-5", "claude", "UserPromptSubmit");
        std::thread::sleep(std::time::Duration::from_millis(400));
        let fed = now_ms();
        let (wrote, out) = feed(child, r#"{"prompt":"hi"}"#);
        wrote.expect("페이로드를 끝까지 쓸 수 있다");
        assert!(out.status.success(), "종료 코드가 0이 아니다: {out:?}");

        let at = state_in(&root, "1700-5")["at"].as_u64().expect("`at`은 ms 수다");
        assert!(at + 200 < fed, "`at`({at})이 페이로드를 준 때({fed})에 붙어 있다 — 시작이 아니라 다 읽은 뒤에 쟀다");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// **늦게 시작한 처리기가 먼저 끝나면 그 사건이 남는다 — 이른 것은 수와 멈춤만 접는다**(S27).
    ///
    /// 이른 처리기를 띄우고 stdin을 쥐고 있으면, 그 처리기는 제 `at`을 잰 채 페이로드를 기다린다. 그사이 늦은 처리기를 끝까지
    /// 돌린 뒤 이른 것을 놓는다 — 부하에서 async 도구 사건의 처리기가 늦게 끝나는 모양 그대로다. 두 판이다:
    /// - 이른 Stop · 늦은 SubagentStart: 파일은 SubagentStart 그대로이고(사건 이름 · `at` · 페이로드), 이른 Stop이 멈춤만 켠다.
    /// - 이른 SubagentStop · 늦은 PostToolUse: 파일은 PostToolUse 그대로이고, 이른 SubagentStop이 집합에서 id를 뺀다.
    ///
    /// 둘째 판이 앵커다 — 막힌 사건이 아예 안 돌았으면(시작하자마자 끝남) id가 그대로 남는다.
    #[test]
    fn a_later_handler_that_ends_first_keeps_its_event_and_the_earlier_one_only_folds() {
        let root = temp_root("handler-order");
        ready_handler(&root);
        let shell = "1700-6";
        // 이른 것이 제 시각을 재고도 남을 틈. zsh가 뜨는 데 몇 ms면 된다.
        let head_start = std::time::Duration::from_millis(300);

        let early_stop = spawn_handler(&root, shell, "claude", "Stop");
        std::thread::sleep(head_start);
        let late = call(&root, shell, "claude", "SubagentStart", &claude_subagent_start("ace905bb8e05c8931"));
        let (wrote, out) = feed(early_stop, CLAUDE_STOP);
        wrote.expect("페이로드를 끝까지 쓸 수 있다");
        assert!(out.status.success() && out.stdout.is_empty() && out.stderr.is_empty(), "이른 Stop: {out:?}");
        let after = state_in(&root, shell);
        for field in ["agent", "event", "at", "payload"] {
            assert_eq!(after[field], late[field], "이른 Stop이 늦은 사건의 `{field}`를 덮었다 — 늦게 끝난 옛 사건이 이겼다");
        }
        assert_eq!(subagent_ids(&after), vec!["ace905bb8e05c8931"]);
        assert_eq!(after["stopped"], true, "순서 가드에 막힌 Stop이 멈춤을 안 접었다");

        let early_stop_of_subagent = spawn_handler(&root, shell, "claude", "SubagentStop");
        std::thread::sleep(head_start);
        let late = call(&root, shell, "claude", "PostToolUse", r#"{"tool_name":"Bash","tool_response":{"stdout":"ok"}}"#);
        let (wrote, out) = feed(early_stop_of_subagent, &claude_subagent_stop("ace905bb8e05c8931"));
        wrote.expect("페이로드를 끝까지 쓸 수 있다");
        assert!(out.status.success() && out.stdout.is_empty() && out.stderr.is_empty(), "이른 SubagentStop: {out:?}");
        let after = state_in(&root, shell);
        for field in ["agent", "event", "at", "payload"] {
            assert_eq!(after[field], late[field], "이른 SubagentStop이 늦은 사건의 `{field}`를 덮었다");
        }
        assert_eq!(subagent_ids(&after), Vec::<String>::new(), "순서 가드에 막힌 SubagentStop이 집합을 안 접었다");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// **`at`이 같으면 뒤에 온 것이 이긴다**(S27). 같은 ms의 두 사건(빠른 PostToolUse → Stop)에서 「더 새로울 때만」이면 뒤의 것을
    /// 버린다.
    ///
    /// 처리기의 `at`은 진짜 시계라 손으로 못 맞춘다. 그래서 **처리기가 뜰 ms를 짐작해** 그 `at`으로 앞 사건을 미리 적어 두고
    /// 처리기를 띄운다. 세 갈래가 난다:
    /// - 처리기 `at` > 적은 `at` — 짐작이 일렀다. 처리기가 이긴다(순서대로). 다시 한다.
    /// - 처리기 `at` < 적은 `at` — 짐작이 늦었다. 처리기가 막힌다. 다시 한다.
    /// - 같다 — 뒤에 온 처리기가 이겨 사건 이름이 처리기의 것이고 `at`은 적은 값 그대로다. **이것을 한 번 보면 끝이다.**
    ///
    /// 「같으면 막힘」으로 무너지면 셋째 갈래가 영영 안 나서 빨갛다(적은 사건이 남은 판은 둘째 갈래와 못 가르므로 실패로 치지
    /// 않는다). 짐작은 직전 판에서 잰 뜨는 데 걸린 ms로 고친다 — 같은 ms에 떨어지는 판이 흔해 대개 몇 판 안에 끝난다.
    #[test]
    fn when_two_events_share_a_millisecond_the_one_that_comes_later_wins() {
        let root = temp_root("handler-tie");
        ready_handler(&root);
        let shell = "1700-7";
        std::fs::create_dir_all(shells_dir(&root)).unwrap();

        let mut guess = 3u64;
        for _ in 0..400 {
            let spawned = now_ms();
            let planted = spawned + guess;
            std::fs::write(
                state_path(&root, shell),
                format!(r#"{{"agent":"claude","event":"PermissionRequest","at":{planted},"subagents":["k1"],"stopped":false,"payload":{{"tool_name":"Bash"}}}}"#),
            )
            .unwrap();
            let state = call(&root, shell, "claude", "Stop", CLAUDE_STOP);
            let at = state["at"].as_u64().expect("`at`은 ms 수다");
            // 막힌 판이든 이긴 판이든 접기는 늘 선다 — Stop은 집합을 안 건드리고 멈춤을 켠다.
            assert_eq!(subagent_ids(&state), vec!["k1"], "Stop이 집합을 건드렸다");
            assert_eq!(state["stopped"], true, "Stop이 멈춤을 안 켰다");
            match (state["event"].as_str(), at.cmp(&planted)) {
                (Some("Stop"), std::cmp::Ordering::Equal) => {
                    let _ = std::fs::remove_dir_all(&root);
                    return;
                }
                (Some("Stop"), std::cmp::Ordering::Greater) => guess = at - spawned,
                (Some("PermissionRequest"), std::cmp::Ordering::Equal) => guess = guess.saturating_sub(1),
                other => panic!("처리기가 이기지도 막히지도 않았다: {other:?} {state}"),
            }
        }
        panic!("같은 ms의 두 사건에서 뒤에 온 것이 이긴 판이 400판에 한 번도 없다 — 같으면 막는다");
    }

    /// **서브에이전트는 id 집합으로 접힌다 — 늦게 온 SubagentStop, 빠진 SubagentStart에도 수가 맞다**(S51).
    ///
    /// +1/−1로 세면 짝이 안 맞는 사건 하나가 수를 영영 비틀어 셸이 「도는 중」에 박힌다. 실측으로 본 모양: claude 자신의 에이전트
    /// (프롬프트 제안 등)는 SubagentStart 없이 SubagentStop만 낸다(판 03 선행 시험 r5 · r6). 새 턴(UserPromptSubmit)과 세션
    /// 끝(SessionEnd)은 비운다. codex도 같은 칸(`agent_id`)이다.
    ///
    /// 따옴표가 풀린 id 흉내(문자열 칸 안의 `\"agent_id\":\"…\"`)는 id가 아니다 — 에이전트의 마지막 말은 무엇이든 담을 수 있다.
    #[test]
    fn the_subagent_set_stays_right_through_a_late_stop_and_a_missing_start() {
        let root = temp_root("handler-subagents");
        write_hook_script(&root).expect("스크립트를 세운다");
        let shell = "1700-8";
        let ids = |state: serde_json::Value| subagent_ids(&state);

        assert_eq!(ids(call(&root, shell, "claude", "SubagentStart", &claude_subagent_start("aaa1"))), ["aaa1"]);
        assert_eq!(ids(call(&root, shell, "claude", "SubagentStart", &claude_subagent_start("bbb2"))), ["aaa1", "bbb2"]);
        assert_eq!(
            ids(call(&root, shell, "claude", "SubagentStart", &claude_subagent_start("aaa1"))),
            ["aaa1", "bbb2"],
            "같은 서브에이전트의 두 번째 Start가 수를 늘렸다"
        );
        assert_eq!(
            ids(call(&root, shell, "claude", "SubagentStop", &claude_subagent_stop("a8341c66cb460a30a"))),
            ["aaa1", "bbb2"],
            "Start 없이 온 Stop(claude 자신의 에이전트)이 도는 것을 뺐다"
        );
        assert_eq!(ids(call(&root, shell, "claude", "SubagentStop", &claude_subagent_stop("aaa1"))), ["bbb2"]);
        assert_eq!(
            ids(call(&root, shell, "claude", "SubagentStop", &claude_subagent_stop("aaa1"))),
            ["bbb2"],
            "늦게 한 번 더 온 Stop이 다른 것을 뺐다"
        );
        let decoy = r#"{"cwd":"/tmp/a,\"agent_id\":\"decoy\"","agent_id":"ccc3","agent_type":"general-purpose"}"#;
        assert_eq!(
            ids(call(&root, shell, "claude", "SubagentStart", decoy)),
            ["bbb2", "ccc3"],
            "문자열 칸 안의 흉내를 id로 읽었다"
        );
        assert_eq!(
            ids(call(&root, shell, "claude", "UserPromptSubmit", r#"{"prompt":"다음"}"#)),
            Vec::<String>::new(),
            "새 턴이 집합을 안 비웠다"
        );

        assert_eq!(
            ids(call(&root, shell, "codex", "SubagentStart", &codex_subagent_start("019a2c3e-0000-7000-8000-00000000000a"))),
            ["019a2c3e-0000-7000-8000-00000000000a"],
            "codex의 서브에이전트 id를 못 읽었다"
        );
        assert_eq!(
            ids(call(&root, shell, "codex", "SessionEnd", r#"{"reason":"other"}"#)),
            Vec::<String>::new(),
            "세션 끝이 집합을 안 비웠다"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// **한 셸의 처리기가 한꺼번에 돌아도 사건을 잃지 않는다 — 잠금**(S27). 처리기는 파일을 읽고 접어 다시 쓴다. 잠금 없이
    /// 그러면 둘이 같은 옛 파일을 읽고 각자 쓴 뒤 나중 것이 앞의 것을 지운다 — 서브에이전트 여럿이 한꺼번에 뜨는 턴(병렬
    /// Agent 호출)에서 수가 모자라게 선다.
    ///
    /// 열여섯 벌을 띄워 stdin을 쥐고 있다가 한꺼번에 놓는다. 모두 SubagentStart라 순서와 무관하게 집합은 열여섯이어야 한다.
    #[test]
    fn handlers_racing_on_one_shell_lose_no_subagent() {
        let root = temp_root("handler-race");
        ready_handler(&root);
        let shell = "1700-13";

        let ids: Vec<String> = (0..16).map(|n| format!("race{n:02}")).collect();
        let waiting: Vec<std::process::Child> =
            ids.iter().map(|_| spawn_handler(&root, shell, "claude", "SubagentStart")).collect();
        std::thread::sleep(std::time::Duration::from_millis(200));
        let running: Vec<std::thread::JoinHandle<_>> = waiting
            .into_iter()
            .zip(ids.clone())
            .map(|(child, id)| std::thread::spawn(move || feed(child, &claude_subagent_start(&id))))
            .collect();
        for run in running {
            let (wrote, out) = run.join().unwrap();
            wrote.expect("페이로드를 끝까지 쓸 수 있다");
            assert!(out.status.success() && out.stdout.is_empty() && out.stderr.is_empty(), "{out:?}");
        }

        assert_eq!(subagent_ids(&state_in(&root, shell)), ids, "한꺼번에 돈 처리기가 서로의 접기를 지웠다 — 잠금이 안 선다");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// **잠금이 쥐여 있으면 기다렸다가 쓰고, 끝내 안 풀리면 1초 남짓에 손을 뗀다** — 5.9의 `-i` 꼴도, 그것을 모르는 zsh 5.8의
    /// 갈래(`old_zsh_handler`)도 같다. 기다림에 끝이 없으면 멈춘 처리기 하나가 에이전트의 턴을 붙잡는다. 기다리지 않으면 경합에서
    /// 사건을 잃는다. 5.8에서 잠금 줄이 1로 끝났다고 그냥 나가면, 그 기계에서는 사건이 하나도 안 남는다.
    ///
    /// 잠금은 이 검사 프로세스가 쥔다(`hold_lock`). 처음엔 300ms 뒤에 놓고, 다음엔 놓지 않는다.
    #[test]
    fn a_handler_waits_for_a_held_lock_and_gives_up_after_about_a_second_on_zsh_5_9_and_5_8() {
        let root = temp_root("handler-held-lock");
        ready_handler(&root);
        let handlers = [("zsh 5.9", handler_path(&root)), ("zsh 5.8 흉내", old_zsh_handler(&root, HANDLER))];
        let quiet_success =
            |out: &std::process::Output| out.status.success() && out.stdout.is_empty() && out.stderr.is_empty();

        for (n, (zsh, handler)) in handlers.iter().enumerate() {
            let shell = format!("1700-2{n}");

            let held = hold_lock(&root, &shell);
            let started = std::time::Instant::now();
            let child = handler_command(handler, &root, Some(&shell), &["claude", "Stop"]).into_spawned();
            let release = std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(300));
                drop(held);
            });
            let (wrote, out) = feed(child, CLAUDE_STOP);
            release.join().unwrap();
            wrote.expect("페이로드를 끝까지 쓸 수 있다");
            assert!(quiet_success(&out), "{zsh}: {out:?}");
            assert!(
                shells_dir(&root).join(format!("{shell}.json")).exists(),
                "{zsh}: 잠금이 300ms 만에 풀렸는데 안 썼다 — 기다리지 않고 나갔다"
            );
            assert!(started.elapsed() >= std::time::Duration::from_millis(300), "{zsh}: 잠금이 풀리기 전에 썼다");
            assert_eq!(state_in(&root, &shell)["event"], "Stop");

            // 끝이 없는 처리기가 검사를 영영 붙잡지 않게, 5초가 지나면 놓는다 — 그러면 처리기가 쓰고 아래 단언이 빨갛다.
            let held = hold_lock(&root, &shell);
            let (done, watchdog) = std::sync::mpsc::channel::<()>();
            let release = std::thread::spawn(move || {
                let _ = watchdog.recv_timeout(std::time::Duration::from_secs(5));
                drop(held);
            });
            let started = std::time::Instant::now();
            let command = handler_command(handler, &root, Some(&shell), &["claude", "UserPromptSubmit"]);
            let (wrote, out) = feed(command.into_spawned(), r#"{"prompt":"다음"}"#);
            let took = started.elapsed();
            let _ = done.send(());
            release.join().unwrap();
            wrote.expect("페이로드를 끝까지 쓸 수 있다");
            assert!(quiet_success(&out), "{zsh}: {out:?}");
            assert!(took < std::time::Duration::from_secs(5), "{zsh}: 안 풀리는 잠금을 {took:?} 기다렸다 — 기다림에 끝이 없다");
            assert!(took >= std::time::Duration::from_millis(900), "{zsh}: 1초를 채우지 않고 {took:?}에 손을 뗐다");
            assert_eq!(state_in(&root, &shell)["event"], "Stop", "{zsh}: 잠금을 못 쥐고도 썼다");
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    /// **`-i`를 모르는 zsh 5.8에서도 한꺼번에 돈 처리기가 서로의 접기를 안 지운다.** 5.8의 갈래는 한 번씩 쥐어 보고 쉬었다가
    /// 다시 쥔다 — 그 틈에 둘이 함께 들어가면 잠금이 없는 것과 같다. 경합 검사(`handlers_racing_on_one_shell_lose_no_subagent`)를
    /// 그 갈래로 다시 돈다.
    #[test]
    fn on_zsh_5_8_handlers_racing_on_one_shell_still_lose_no_subagent() {
        let root = temp_root("handler-race-zsh58");
        ready_handler(&root);
        let handler = old_zsh_handler(&root, HANDLER);
        let shell = "1700-14";

        let ids: Vec<String> = (0..16).map(|n| format!("old{n:02}")).collect();
        let waiting: Vec<std::process::Child> = ids
            .iter()
            .map(|_| handler_command(&handler, &root, Some(shell), &["claude", "SubagentStart"]).into_spawned())
            .collect();
        std::thread::sleep(std::time::Duration::from_millis(200));
        let running: Vec<std::thread::JoinHandle<_>> = waiting
            .into_iter()
            .zip(ids.clone())
            .map(|(child, id)| std::thread::spawn(move || feed(child, &claude_subagent_start(&id))))
            .collect();
        for run in running {
            let (wrote, out) = run.join().unwrap();
            wrote.expect("페이로드를 끝까지 쓸 수 있다");
            assert!(out.status.success() && out.stdout.is_empty() && out.stderr.is_empty(), "{out:?}");
        }

        assert_eq!(subagent_ids(&state_in(&root, shell)), ids, "zsh 5.8의 갈래에서 처리기가 서로의 접기를 지웠다");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// **멈춤은 Stop · StopFailure가 켜고, 새 턴 · 중단이 끈다**(S50). 그 밖의 사건은 그대로 둔다 — 그래서 Stop 뒤에 온
    /// SubagentStop에도 참이고, 화면(티켓 20)은 서브에이전트가 다 끝나는 순간을 「확인할 것」으로 읽을 수 있다.
    ///
    /// **세션 끝(SessionEnd)은 멈춤을 안 건드린다**(티켓 20 리뷰 반영 — 스펙 S50은 끈다고 적었다). `claude -p`는 Stop 뒤
    /// 17ms 만에 SessionEnd를 내고(판 03 선행 시험 r1), 감시는 100ms로 디바운스해 그 순간의 파일 한 장만 싣는다. 끄면 화면은
    /// 「멈춘 턴 뒤의 끝」과 「도는 턴이 끊긴 끝」을 못 갈라 `claude -p`의 확인할 것이 한 번도 안 선다. 도는 턴의 끝은 새 턴이
    /// 이미 멈춤을 껐으므로 거짓이다(아래 UserPromptSubmit → SessionEnd).
    ///
    /// 중단은 둘이다: claude PostToolUseFailure의 `is_interrupt: true`, codex의 Interrupt. 중단 아닌 도구 실패는 멈춤을 안 건드린다.
    #[test]
    fn stopped_is_set_by_a_stop_cleared_by_a_new_turn_or_an_interrupt_and_kept_by_an_end() {
        let root = temp_root("handler-stopped");
        write_hook_script(&root).expect("스크립트를 세운다");
        let shell = "1700-9";
        let stopped = |state: serde_json::Value| (state["event"].as_str().unwrap_or_default().to_string(), state["stopped"].clone());

        let steps: [(&str, &str, String, bool); 15] = [
            ("claude", "SubagentStart", claude_subagent_start("aaa1"), false),
            ("claude", "Stop", CLAUDE_STOP.to_string(), true),
            ("claude", "SubagentStop", claude_subagent_stop("aaa1"), true),
            ("claude", "UserPromptSubmit", r#"{"prompt":"다음"}"#.to_string(), false),
            ("claude", "PreToolUse", r#"{"tool_name":"Bash"}"#.to_string(), false),
            ("claude", "StopFailure", r#"{"error":"rate_limit"}"#.to_string(), true),
            ("claude", "PostToolUseFailure", claude_tool_failure(false), true),
            ("claude", "PostToolUseFailure", claude_tool_failure(true), false),
            ("claude", "Stop", CLAUDE_STOP.to_string(), true),
            // `claude -p`의 끝 — 멈춘 턴 뒤의 끝이라 참 그대로다.
            ("claude", "SessionEnd", r#"{"reason":"other"}"#.to_string(), true),
            ("claude", "UserPromptSubmit", r#"{"prompt":"다음"}"#.to_string(), false),
            // 도는 턴이 끊긴 끝 — 새 턴이 끈 멈춤 그대로 거짓이다.
            ("claude", "SessionEnd", r#"{"reason":"prompt_input_exit"}"#.to_string(), false),
            ("codex", "Stop", r#"{"turn_id":"t1"}"#.to_string(), true),
            ("codex", "SessionEnd", "{}".to_string(), true),
            ("codex", "Interrupt", r#"{"turn_id":"t1"}"#.to_string(), false),
        ];
        for (agent, event, payload, expected) in steps {
            assert_eq!(
                stopped(call(&root, shell, agent, event, &payload)),
                (event.to_string(), serde_json::Value::Bool(expected)),
                "{agent} {event} 뒤의 멈춤이 틀렸다"
            );
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    /// **파이프 버퍼를 넘는 페이로드도 통째로 받아 통째로 싣는다 — 빨리.** 긴 프롬프트의 UserPromptSubmit이 그 모양이다.
    /// 한 글자씩 읽거나 페이로드 위에서 되짚는 패턴을 쓰면 여기서 초 단위가 된다(단언은 느슨하다 — 부하를 탄다).
    #[test]
    fn a_payload_past_the_pipe_buffer_is_taken_and_written_whole() {
        let root = temp_root("handler-big");
        write_hook_script(&root).expect("스크립트를 세운다");
        let big = format!(r#"{{"prompt":"{}"}}"#, "가".repeat(400_000));

        let started = std::time::Instant::now();
        call(&root, "1700-10", "claude", "Stop", CLAUDE_STOP);
        let state = call(&root, "1700-10", "claude", "UserPromptSubmit", &big);
        let took = started.elapsed();

        assert_eq!(state["payload"]["prompt"].as_str().map(|p| p.chars().count()), Some(400_000), "페이로드가 잘렸다");
        assert_eq!(state["stopped"], false);
        assert!(took < std::time::Duration::from_secs(3), "1.2MB 페이로드 두 번에 {took:?}가 걸렸다");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// **처리기는 다른 프로세스를 띄우지 않는다** — 옛 처리기의 같은 검사(`the_hook_never_reaches_for_another_process`, python의
    /// 허용 목록)를 새 처리기의 언어로 다시 썼다. 훅은 에이전트의 턴 안에서 돌아, 프로세스 하나는 그대로 사람이 기다리는 ms다.
    ///
    /// **목록이 아니라 커널로 잰다.** zsh에서 프로세스가 생기는 길(바깥 명령, `$(…)`, 파이프, 서브셸, `&`)은 글자로 다 못 막는다.
    /// 그래서 처리기를 **프로세스를 못 만드는 몸**으로 띄운다: 자식에서 `RLIMIT_NPROC`를 1로 낮춘 뒤 exec한다 — 그 사용자에게는
    /// 이미 프로세스가 여럿이라 그 뒤의 fork는 모두 실패한다. 그 몸으로 모든 갈래(새 파일, 옛 파일 읽기, id 읽기, 중단 읽기, 막힘,
    /// zsh 5.8의 잠금 — 쥐여 있는 잠금을 쉬었다 다시 쥐는 길까지)를 밟아도 파일이 맞게 서야 한다.
    ///
    /// **침묵 줄을 뺀 사본을 띄운다.** 처리기는 fail-open이라 맨 앞에서 stderr를 닫는다(`exec 2>/dev/null`). 그대로면 쓸모없는
    /// fork의 실패(「fork failed」)가 안 보인다 — 그 한 줄만 뺀 사본으로 stderr가 비었는지 본다. 그 줄이 정확히 하나이고 다른 줄이
    /// stderr를 돌리지 않는지를 먼저 글자로 본다(그래야 뺀 사본이 전부를 말한다).
    ///
    /// 앵커: 같은 한도로 띄운 zsh의 `$(…)`는 실제로 실패한다 — 한도가 안 먹는 몸(root)이면 이 검사는 아무것도 못 잰다.
    #[test]
    fn the_handler_never_reaches_for_another_process() {
        use std::os::unix::process::CommandExt;

        const SILENCE: &str = "exec 2>/dev/null";
        let code: Vec<&str> = HANDLER.lines().map(str::trim).filter(|line| !line.starts_with('#')).collect();
        assert_eq!(code.iter().filter(|line| **line == SILENCE).count(), 1, "침묵 줄 `{SILENCE}`이 정확히 하나가 아니다");
        for door in ["2>", "&>", ">&", "|&"] {
            let others: Vec<&&str> = code.iter().filter(|line| **line != SILENCE && line.contains(door)).collect();
            assert!(others.is_empty(), "침묵 줄 말고도 stderr를 돌리는 줄이 있다(`{door}`): {others:?}");
        }

        if unsafe { libc::geteuid() } == 0 {
            eprintln!("root로는 RLIMIT_NPROC가 안 먹어 이 검사를 건너뛴다");
            return;
        }
        fn without_fork(mut command: std::process::Command) -> std::process::Command {
            // SAFETY: fork 뒤 exec 전의 자식에서 async-signal-safe한 setrlimit 하나만 부른다.
            unsafe {
                command.pre_exec(|| {
                    let limit = libc::rlimit { rlim_cur: 1, rlim_max: 1 };
                    if libc::setrlimit(libc::RLIMIT_NPROC, &limit) != 0 {
                        return Err(std::io::Error::last_os_error());
                    }
                    Ok(())
                });
            }
            command
        }

        let anchor = without_fork({
            let mut zsh = std::process::Command::new("/bin/zsh");
            zsh.args(["-f", "-c", "print -r -- $(print forked)"]);
            zsh
        })
        .output()
        .expect("zsh가 뜬다");
        assert!(
            !String::from_utf8_lossy(&anchor.stdout).contains("forked") && !anchor.stderr.is_empty(),
            "RLIMIT_NPROC 1로도 zsh가 fork했다 — 이 몸으로는 아무것도 못 잰다: {anchor:?}"
        );

        let root = temp_root("handler-no-fork");
        write_hook_script(&root).expect("스크립트를 세운다");
        let loud = hooks_dir(&root).join("loud.zsh");
        let body: String = HANDLER.lines().filter(|line| line.trim() != SILENCE).map(|line| format!("{line}\n")).collect();
        write_executable(&loud, &body).unwrap();

        let shell = "1700-11";
        let step = |agent: &str, event: &str, payload: &str| {
            let command = without_fork(handler_command(&loud, &root, Some(shell), &[agent, event]));
            let (wrote, out) = feed(command.into_spawned(), payload);
            wrote.expect("페이로드를 끝까지 쓸 수 있다");
            assert!(out.status.success(), "{event}: 0이 아닌 코드로 끝났다: {out:?}");
            assert!(
                out.stdout.is_empty() && out.stderr.is_empty(),
                "{event}: 프로세스를 못 만드는 몸에서 처리기가 말을 했다 — 어딘가 fork한다: {}",
                String::from_utf8_lossy(&out.stderr)
            );
            state_in(&root, shell)
        };

        let first = step("claude", "SubagentStart", &claude_subagent_start("aaa1"));
        assert_eq!((first["event"].as_str(), subagent_ids(&first)), (Some("SubagentStart"), vec!["aaa1".to_string()]));
        let second = step("claude", "Stop", CLAUDE_STOP);
        assert_eq!((second["event"].as_str(), second["stopped"].as_bool()), (Some("Stop"), Some(true)));
        let third = step("claude", "PostToolUseFailure", &claude_tool_failure(true));
        assert_eq!((third["stopped"].as_bool(), subagent_ids(&third)), (Some(false), vec!["aaa1".to_string()]));
        // 막힌 사건 — 앞에 먼 미래의 `at`을 적어 두면 어느 사건이든 옛 것이다.
        std::fs::write(
            state_path(&root, shell),
            r#"{"agent":"claude","event":"PermissionRequest","at":99999999999999,"subagents":["aaa1"],"stopped":false,"payload":{}}"#,
        )
        .unwrap();
        let blocked = step("claude", "SubagentStop", &claude_subagent_stop("aaa1"));
        assert_eq!(
            (blocked["event"].as_str(), blocked["at"].as_u64(), subagent_ids(&blocked)),
            (Some("PermissionRequest"), Some(99_999_999_999_999), Vec::<String>::new())
        );

        // zsh 5.8의 갈래(`old_zsh_handler`) — 잠금이 쥐여 있어 쉬었다가 다시 쥐는 길까지 밟는다. 이 사본은 침묵 줄이 없어 zsh의
        // 잠금 경고(흉내 낸 「unknown option」, 못 쥔 시도마다의 「failed to lock file」)를 말한다. 그 둘을 걷고 남은 것이 없어야 한다.
        let old = old_zsh_handler(&root, &body);
        let shell = "1700-15";
        let held = hold_lock(&root, shell);
        let child = without_fork(handler_command(&old, &root, Some(shell), &["claude", "SubagentStart"])).into_spawned();
        let release = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(100));
            drop(held);
        });
        let (wrote, out) = feed(child, &claude_subagent_start("bbb2"));
        release.join().unwrap();
        wrote.expect("페이로드를 끝까지 쓸 수 있다");
        assert!(out.status.success() && out.stdout.is_empty(), "zsh 5.8 갈래: {out:?}");
        let stderr = String::from_utf8_lossy(&out.stderr);
        let expected = |line: &str| line.contains("flock: unknown option") || line.contains("failed to lock file");
        let others: Vec<&str> = stderr.lines().filter(|line| !expected(line)).collect();
        assert!(others.is_empty(), "zsh 5.8 갈래: 프로세스를 못 만드는 몸에서 처리기가 말을 했다 — 어딘가 fork한다: {others:?}");
        // 앵커: 흉내가 먹었고(5.8의 갈래로 갔고), 잠금이 쥐여 있던 동안 쉬었다 다시 쥐는 길을 밟았다.
        assert!(stderr.contains("flock: unknown option"), "zsh 5.8 흉내가 안 먹었다: {stderr}");
        assert!(stderr.contains("failed to lock file"), "잠금이 쥐여 있던 동안 다시 쥐는 길을 안 밟았다: {stderr}");
        assert_eq!(subagent_ids(&state_in(&root, shell)), vec!["bbb2"]);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// **호출 시간 — 에이전트가 부르는 모양으로 잰다**(S28). 판정은 구현 기록의 계측이 하고, 여기서는 로그를 남기고 크게 무너진
    /// 것만 잡는다(`cargo test -p atelier-app --lib shells::tests::the_handler -- --nocapture`로 본다).
    ///
    /// - `args` 꼴: 셸 없이 곧바로 — claude가 `args`가 있는 command 훅을 띄우는 길(exec form). 21이 claude에 거는 모양이다.
    /// - 셸 꼴: `/bin/sh -c '<경로> claude Stop'` — `args`가 없을 때 claude가 띄우는 길(Bun의 `shell: true`). 견줌으로 남긴다.
    /// - codex 꼴: `/bin/zsh -c '<경로> codex Stop'` — codex에는 `args`가 없고, 훅 명령줄을 `/bin/sh`가 아니라 **제 환경의 셸**로
    ///   부른다(codex 소스 `hooks/src/engine/command_runner.rs` · `core/src/session/mod.rs`: 그 셸의 `-c`, 환경이 없을 때만
    ///   `$SHELL -lc`). macOS의 기본 사용자 셸이 zsh라 그 모양을 잰다. `HOME`이 임시 루트라 사용자의 `~/.zshenv`는 안 든다 —
    ///   그 값은 사용자 몫이다.
    #[test]
    fn the_handler_answers_in_a_few_milliseconds_in_the_shapes_an_agent_calls_it() {
        let root = temp_root("handler-time");
        ready_handler(&root);
        let handler = handler_path(&root);
        let shell_line = format!("'{}' claude Stop", handler.display());
        let codex_line = format!("'{}' codex Stop", handler.display());
        let payload = claude_subagent_stop("ace905bb8e05c8931");

        let time = |command: std::process::Command| {
            let started = std::time::Instant::now();
            let (wrote, out) = feed(command.into_spawned(), &payload);
            let took = started.elapsed();
            wrote.expect("페이로드를 끝까지 쓸 수 있다");
            assert!(out.status.success(), "0이 아닌 코드로 끝났다: {out:?}");
            took
        };
        let (mut exec_form, mut shell_form, mut codex_form) = (Vec::new(), Vec::new(), Vec::new());
        for _ in 0..40 {
            exec_form.push(time(handler_command(&handler, &root, Some("1700-12"), &["claude", "Stop"])));
            let mut sh = handler_command(Path::new("/bin/sh"), &root, Some("1700-12"), &["-c"]);
            sh.arg(&shell_line);
            shell_form.push(time(sh));
            let mut zsh = handler_command(Path::new("/bin/zsh"), &root, Some("1700-12"), &["-c"]);
            zsh.arg(&codex_line);
            codex_form.push(time(zsh));
        }
        let p50 = |mut runs: Vec<std::time::Duration>| {
            runs.sort();
            runs[runs.len() / 2]
        };
        let (exec_p50, shell_p50, codex_p50) = (p50(exec_form), p50(shell_form), p50(codex_form));
        eprintln!("계측(처리기 호출 p50, 40번): args 꼴 {exec_p50:?} · 셸 꼴 {shell_p50:?} · codex 꼴 {codex_p50:?}");
        assert!(exec_p50 < std::time::Duration::from_millis(100), "args 꼴 p50이 {exec_p50:?}다");
        assert!(shell_p50 < std::time::Duration::from_millis(150), "셸 꼴 p50이 {shell_p50:?}다");
        assert!(codex_p50 < std::time::Duration::from_millis(150), "codex 꼴 p50이 {codex_p50:?}다");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 앱이 뜰 때(`lib.rs` setup) · 설치 버튼이 부르는 **한 함수가 두 처리기를 함께 세운다** — 설정이 부르는 옛 처리기는 그대로,
    /// 새 처리기는 옆에 새 이름으로. 새 것은 exec 꼴(`args`)로 곧바로 불리므로 실행 권한이 있어야 한다.
    #[test]
    fn writing_the_hook_scripts_puts_the_new_handler_beside_the_old_one() {
        use std::os::unix::fs::PermissionsExt;

        let root = temp_root("write-both");
        write_hook_script(&root).expect("스크립트를 세운다");

        assert_eq!(std::fs::read_to_string(script_path(&root)).unwrap(), HOOK_SCRIPT, "옛 처리기가 안 섰다");
        assert_eq!(std::fs::read_to_string(handler_path(&root)).unwrap(), HANDLER, "새 처리기가 안 섰다");
        let mode = std::fs::metadata(handler_path(&root)).unwrap().permissions().mode();
        assert_eq!(mode & 0o111, 0o111, "새 처리기에 실행 권한이 없다: {mode:o}");
        assert_ne!(SCRIPT_NAME, HANDLER_NAME, "새 처리기가 옛 이름을 쓴다 — 옛 설치본이 뜰 때마다 덮는다");
        assert_eq!(files_in(&hooks_dir(&root)), vec![SCRIPT_NAME, HANDLER_NAME], "쓰는 중 파일이 남았다");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// **같은 처리기는 다시 안 쓴다 — 다르면 쓴다.** macOS는 새로 쓰인 실행 파일의 첫 실행을 한 번 검사해 첫 호출이 100ms를
    /// 넘는다(`write_executable` 머리말). 앱이 뜰 때마다 새 파일로 갈아 끼우면 켤 때마다 첫 훅이 그 값을 문다. 그래서 두 번째
    /// 세우기는 같은 파일(inode)을 그대로 둔다.
    ///
    /// 앵커: 내용이 다르거나(옛 빌드가 같은 이름에 다른 본문을 둔 흉내) 실행 권한이 빠졌으면 새로 쓴다 — 아무것도 안 쓰게
    /// 무너지면 「그대로 둔다」가 저절로 참이 된다.
    #[test]
    fn the_same_handler_is_not_written_twice_but_a_different_one_is() {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};

        let root = temp_root("write-once");
        let inode = || std::fs::metadata(handler_path(&root)).unwrap().ino();
        write_hook_script(&root).expect("스크립트를 세운다");
        let first = inode();

        write_hook_script(&root).expect("스크립트를 세운다");
        assert_eq!(inode(), first, "같은 처리기를 새 파일로 다시 썼다 — 켤 때마다 첫 훅이 느려진다");

        std::fs::write(handler_path(&root), "#!/bin/zsh -f\nexit 0\n").unwrap();
        write_hook_script(&root).expect("스크립트를 세운다");
        assert_eq!(std::fs::read_to_string(handler_path(&root)).unwrap(), HANDLER, "다른 본문을 그대로 뒀다");

        std::fs::set_permissions(handler_path(&root), std::fs::Permissions::from_mode(0o644)).unwrap();
        write_hook_script(&root).expect("스크립트를 세운다");
        let mode = std::fs::metadata(handler_path(&root)).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o755, "실행 권한이 빠진 처리기를 그대로 뒀다");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 새 처리기가 적는 모양 그대로 한 장을 쓴다 — 서브에이전트 둘이 돌고 턴이 멈춘 셸.
    fn write_state(dir: &Path, shell: &str, at: u64) {
        let json = format!(
            r#"{{"agent":"claude","event":"Stop","at":{at},"subagents":["a1","b2"],"stopped":true,"payload":null}}"#
        );
        // 훅과 같은 길로 쓴다 — 감시가 중간 단계를 보지 않게.
        let tmp = dir.join(format!(".{shell}.json.tmp"));
        std::fs::write(&tmp, json).unwrap();
        std::fs::rename(&tmp, dir.join(format!("{shell}.json"))).unwrap();
    }

    fn state(agent: &str, event: &str, at: u64) -> ShellHookState {
        ShellHookState {
            agent: agent.to_string(),
            event: event.to_string(),
            at,
            payload: serde_json::Value::Null,
            subagents: 0,
            stopped: false,
        }
    }

    /// 훅을 **에이전트가 부르는 그대로** 돌린다 — argv 둘과 파이프로 온 페이로드.
    ///
    /// **쓰기의 실패를 삼키지 않고 돌려준다.** 스크립트가 stdin을 안 읽고 나가면 그 실패는
    /// 훅이 아니라 **쓰는 쪽**(에이전트)에서 `EPIPE`로 나므로, 여기서 `unwrap`으로 삼키면
    /// 그 자리를 잴 검사가 어디에도 안 남는다.
    fn run_hook(
        root: &Path,
        shell: Option<&str>,
        args: &[&str],
        stdin: &str,
    ) -> (std::io::Result<()>, std::process::Output) {
        feed(hook_command(&script_path(root), root, shell, args).spawn().expect("스크립트가 돈다"), stdin)
    }

    /// 훅 한 장을 띄울 명령 — stdin · stdout · stderr는 파이프다. 부르는 쪽이 띄우고 `feed`로 페이로드를 준다.
    ///
    /// `ATELIER_SHELL`은 늘 명시한다: 검사 프로세스는 이 앱의 셸에서 떠 진짜 셸 키를 물려받았다.
    fn hook_command(program: &Path, root: &Path, shell: Option<&str>, args: &[&str]) -> std::process::Command {
        let mut command = std::process::Command::new(program);
        command
            .args(args)
            .env("ATELIER_HOME", root)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        match shell {
            Some(id) => command.env("ATELIER_SHELL", id),
            None => command.env_remove("ATELIER_SHELL"),
        };
        command
    }

    /// 새 처리기를 띄울 명령 — `hook_command`에 **`HOME`까지 임시 루트로 옮긴다.** 새 처리기는 `ATELIER_HOME`이 없으면
    /// `HOME` 아래로 간다 — 검사가 그 갈래를 밟을 때 진짜 홈에 쓰면 안 된다. (옛 python 검사는 `HOME`을 안 옮긴다 — macOS의
    /// python은 `HOME/Library`에 캐시를 적어 「상태 폴더 밖에 안 쓴다」 검사가 그것을 제 자국으로 본다.)
    fn handler_command(program: &Path, root: &Path, shell: Option<&str>, args: &[&str]) -> std::process::Command {
        let mut command = hook_command(program, root, shell, args);
        command.env("HOME", root);
        command
    }

    /// 명령을 띄운다 — 못 뜨면 거기서 검사를 멈춘다(처리기 파일이 없거나 실행 권한이 없다).
    trait Launch {
        fn into_spawned(self) -> std::process::Child;
    }

    impl Launch for std::process::Command {
        fn into_spawned(mut self) -> std::process::Child {
            self.spawn().unwrap_or_else(|e| panic!("훅이 안 뜬다({e}): {self:?}"))
        }
    }

    /// 뜬 훅에 페이로드를 다 쓰고 파이프를 닫은 뒤 끝을 기다린다.
    fn feed(mut child: std::process::Child, stdin: &str) -> (std::io::Result<()>, std::process::Output) {
        use std::io::Write;

        let mut pipe = child.stdin.take().expect("stdin이 열려 있다");
        let wrote = pipe.write_all(stdin.as_bytes()).and_then(|()| pipe.flush());
        // 파이프를 닫아야 스크립트의 `read()`가 EOF를 본다 — 안 닫으면 둘이 서로를 기다린다.
        drop(pipe);
        (wrote, child.wait_with_output().expect("끝난다"))
    }

    fn files_in(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .expect("폴더가 있다")
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        names.sort();
        names
    }
}
