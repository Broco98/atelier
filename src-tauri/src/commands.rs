use std::path::PathBuf;

use atelier_core::{
    archive_dir, projects_dir, works_dir, ArchiveEntry, Destination, Mode, ProjectPatch,
    ProjectView, SearchResults, WorkView,
};

use std::sync::Arc;

use crate::pty;

type CmdResult<T> = Result<T, String>;

fn err(e: atelier_core::Error) -> String {
    e.to_string()
}

/// 명령이 받은 모드. **없으면 Atelier인 것은 이 티켓에서만이다**(#181, expand).
///
/// 프런트는 아직 모드를 안 보낸다 — 주소가 `/maison/...`으로 갈리는 것은 #182다. 그래서
/// 새 형태(인자)를 옛 형태(인자 없음) **옆에** 세워 지금 도는 화면이 한 글자도 안 바뀌게
/// 한다. 빠진 인자를 오류로 되돌려 주는 것은 마지막 contract 티켓(#187)이고, 그때
/// `Option`과 이 함수가 함께 사라진다.
///
/// **기본값을 정하는 자리는 여기 하나다.** 명령마다 `unwrap_or`를 적으면 하나가 다른 값으로
/// 눕는 날 그 명령만 저쪽 세계를 읽고, 화면과 데이터가 어긋난 채로 조용히 돈다.
fn or_atelier(mode: Option<Mode>) -> Mode {
    mode.unwrap_or(Mode::Atelier)
}

/// **모드를 함께 받는 커널 함수**에 건네는 프로젝트 등록부. Maison에서는 「없음」이다
/// (결정 17) — MCP 서버의 `shared_projects_root`와 같은 갈래이고 이유도 같다.
///
/// 없음인 것은 규약이 아니라 인자다. 건네면 Maison에서도 커널이 프로젝트 층을 걷는다 —
/// ⇧⇧ 결과에 Atelier 프로젝트가 서고(US 49), 아카이브 기록이 Room에 없는 구획을 렌더한다.
fn shared_projects_root(mode: Mode) -> Option<PathBuf> {
    match mode {
        Mode::Atelier => Some(projects_dir()),
        Mode::Maison => None,
    }
}

#[tauri::command]
pub async fn list_projects() -> CmdResult<Vec<ProjectView>> {
    atelier_core::list_projects(&projects_dir()).map_err(err)
}

#[tauri::command]
pub async fn get_project(slug: String) -> CmdResult<ProjectView> {
    atelier_core::get_project(&projects_dir(), &slug).map_err(err)
}

#[tauri::command]
pub async fn create_project(folder: String) -> CmdResult<ProjectView> {
    atelier_core::create_project(&projects_dir(), &PathBuf::from(folder)).map_err(err)
}

#[tauri::command]
pub async fn update_project(
    slug: String,
    name: Option<String>,
    description: Option<String>,
    base_branch: Option<String>,
) -> CmdResult<ProjectView> {
    atelier_core::update_project(
        &projects_dir(),
        &slug,
        ProjectPatch { name, description, base_branch },
    )
    .map_err(err)
}

#[tauri::command]
pub async fn delete_project(slug: String) -> CmdResult<()> {
    atelier_core::delete_project(&projects_dir(), &slug).map_err(err)
}

// 아래 명령들이 받는 `mode`가 **어느 세계의 목록인가**를 정한다. 이름은 안 바뀐다 —
// Maison은 같은 명령이 다른 루트를 읽는 것이지 다른 명령이 아니다 (결정 1).

#[tauri::command]
pub async fn list_works(mode: Option<Mode>) -> CmdResult<Vec<WorkView>> {
    let mode = or_atelier(mode);
    atelier_core::list_works(&works_dir(mode)).map_err(err)
}

#[tauri::command]
pub async fn get_work(mode: Option<Mode>, slug: String) -> CmdResult<WorkView> {
    let mode = or_atelier(mode);
    atelier_core::get_work(&works_dir(mode), &slug).map_err(err)
}

/// 표시 이름만 바꾼다. slug와 워크트리 경로는 그대로다 (update_project와 같은 규칙).
#[tauri::command]
pub async fn set_work_title(
    mode: Option<Mode>,
    slug: String,
    title: String,
) -> CmdResult<WorkView> {
    let mode = or_atelier(mode);
    atelier_core::update_work_title(&works_dir(mode), &slug, &title).map_err(err)
}

#[tauri::command]
pub async fn set_work_status(
    mode: Option<Mode>,
    slug: String,
    status: String,
) -> CmdResult<WorkView> {
    let mode = or_atelier(mode);
    let status = status.parse().map_err(err)?;
    atelier_core::update_work_status(&works_dir(mode), &slug, status).map_err(err)
}

/// 고정을 켜고 끈다. 목록 순서는 커널이 정한다 — 화면은 그 위에 정렬을 얹지 않는다 (결정 100).
#[tauri::command]
pub async fn set_work_pinned(
    mode: Option<Mode>,
    slug: String,
    pinned: bool,
) -> CmdResult<WorkView> {
    let mode = or_atelier(mode);
    atelier_core::update_work_pinned(&works_dir(mode), &slug, pinned).map_err(err)
}

/// 아카이브 보존소로 **옮긴다.** 워크트리는 정리되고 브랜치·spec·기록은 남는다.
/// 되돌리기가 없으므로 force도 없다 — 커밋 안 된 변경이 있으면 어느 파일인지 말하며 거부한다.
#[tauri::command]
pub async fn archive_work(mode: Option<Mode>, slug: String) -> CmdResult<()> {
    let mode = or_atelier(mode);
    atelier_core::archive_work(
        &works_dir(mode),
        &archive_dir(mode),
        shared_projects_root(mode).as_deref(),
        &slug,
    )
    .map(|_| ())
    .map_err(err)
}

/// 통째로 지운다. MCP 도구와 같이 force를 노출하지 않는다 (atelier_remove_work와 같은 계약).
#[tauri::command]
pub async fn remove_work(mode: Option<Mode>, slug: String) -> CmdResult<()> {
    let mode = or_atelier(mode);
    atelier_core::remove_work(&works_dir(mode), &slug, false).map_err(err)
}

#[tauri::command]
pub async fn read_spec_file(mode: Option<Mode>, slug: String, path: String) -> CmdResult<String> {
    let mode = or_atelier(mode);
    atelier_core::read_spec_file(&works_dir(mode), &slug, &path).map_err(err)
}

/// 아카이브 목록. **경량이다** — spec 파일 목록도 워크트리도 담지 않는다.
/// 아카이브는 쌓이기만 하므로 목록 조회가 무거워지면 갈수록 나빠진다.
#[tauri::command]
pub async fn list_archive(mode: Option<Mode>) -> CmdResult<Vec<ArchiveEntry>> {
    let mode = or_atelier(mode);
    atelier_core::list_archive(&archive_dir(mode)).map_err(err)
}

/// 아카이브된 work가 가진 문서 경로들. 상세 화면의 머리말(제목·상태·언제 치웠는지)은
/// 목록이 이미 들고 있으므로 단건 조회를 따로 두지 않는다.
#[tauri::command]
pub async fn list_archived_docs(mode: Option<Mode>, slug: String) -> CmdResult<Vec<String>> {
    let mode = or_atelier(mode);
    atelier_core::list_archived_docs(&archive_dir(mode), &slug).map_err(err)
}

/// 아카이브된 work의 문서 하나. 경로는 **work 루트 기준**이다 (`record.md`, `spec/overview.md`) —
/// 기록이 spec 밖에 있어서, 화면이 둘을 한 트리로 보여주려면 창구가 하나여야 한다.
#[tauri::command]
pub async fn read_archived_file(
    mode: Option<Mode>,
    slug: String,
    path: String,
) -> CmdResult<String> {
    let mode = or_atelier(mode);
    atelier_core::read_work_file(&archive_dir(mode), &slug, &path).map_err(err)
}

/// 팔레트가 보여 주는 줄들. **규칙은 전부 코어에 있다** — 맞추는 규칙도 순위도 층 규칙도
/// 프런트와 갈리면 어긋나도 화면에 티가 안 난다. 여기는 루트 셋과 질의, 그리고 프런트가
/// 들고 온 목적지 목록을 건네는 위임뿐이다.
///
/// **목적지는 인자로 받는다**(결정 21). main nav의 라우트 문자열은 프런트 것이라 코어가
/// 알면 목적지가 늘 때마다 Rust를 고쳐야 하고, 그렇다고 프런트가 그 층만 직접 맞추면
/// AND·대소문자 규칙과 층 순서가 두 곳으로 갈린다.
///
/// **디바운스도 캐시도 여기 없다**(결정 29). 치는 동안 매번 부르고, 늦게 온 응답을 버리는
/// 것은 부르는 쪽이 한다 — 막아야 할 것은 비용이 아니라 순서 뒤바뀜이다.
///
/// **모드가 검색 루트를 통째로 갈아 끼운다**(US 49·50). Maison에서는 프로젝트 등록부를
/// 안 건네므로 프로젝트 층이 빈다 — 공부하다 ⇧⇧를 눌러 `feat/spec-search`를 보는 일이
/// 없다.
#[tauri::command]
pub async fn search(
    mode: Option<Mode>,
    query: String,
    destinations: Vec<Destination>,
) -> CmdResult<SearchResults> {
    let mode = or_atelier(mode);
    atelier_core::search(
        &works_dir(mode),
        &archive_dir(mode),
        shared_projects_root(mode).as_deref(),
        &query,
        &destinations,
    )
    .map_err(err)
}

#[tauri::command]
pub async fn open_project_folder(app: tauri::AppHandle, slug: String) -> CmdResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let view = atelier_core::get_project(&projects_dir(), &slug).map_err(err)?;
    if view.missing {
        return Err("폴더가 존재하지 않습니다".to_string());
    }
    let abs = atelier_core::expand_home(&view.project.path);
    app.opener()
        .open_path(abs.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

// PTY 명령 다섯. 본체는 `pty.rs`에 있고 여기는 위임만 한다 — 이 파일에 `pub async fn`으로
// 있는 것 자체가 배선 테스트의 조건이다.
//
// **모드를 받는 것은 spawn 하나다.** 나머지 넷은 이미 뜬 셸을 id로 가리키고, 그 셸이 어느
// 세계의 것인지는 뜰 때 정해져 pty에 굳는다 — 여기에 인자를 더하면 「id와 모드가 어긋나면
// 어느 쪽이 이기나」라는, 아무도 답할 수 없는 갈래가 생긴다.

#[tauri::command]
pub async fn pty_spawn(
    pool: tauri::State<'_, Arc<pty::PtyPool>>,
    mode: Option<Mode>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    on_frame: tauri::ipc::Channel<tauri::ipc::InvokeResponseBody>,
) -> CmdResult<pty::PtySpawned> {
    pty::spawn(&pool, or_atelier(mode), cwd, cols, rows, on_frame)
}

#[tauri::command]
pub async fn pty_write(
    pool: tauri::State<'_, Arc<pty::PtyPool>>,
    id: u32,
    data: String,
) -> CmdResult<()> {
    pty::write(&pool, id, &data)
}

#[tauri::command]
pub async fn pty_resize(
    pool: tauri::State<'_, Arc<pty::PtyPool>>,
    id: u32,
    cols: u16,
    rows: u16,
) -> CmdResult<()> {
    pty::resize(&pool, id, cols, rows)
}

#[tauri::command]
pub async fn pty_kill(pool: tauri::State<'_, Arc<pty::PtyPool>>, id: u32) -> CmdResult<()> {
    pty::kill(&pool, id)
}

// 닫기 직전에 **한 번** 묻는 값이다(결정 92). 구독도 폴링도 없다 — 매 순간 바뀌는 값이라
// 상태에 얹으면 폴링이 생기고, 필요한 순간은 닫을 때뿐이다.
#[tauri::command]
pub async fn pty_command_running(
    pool: tauri::State<'_, Arc<pty::PtyPool>>,
    id: u32,
) -> CmdResult<bool> {
    pty::command_running(&pool, id)
}

// 사용자 설정 둘. 본체는 `settings.rs`에 있고 여기는 위임만 한다 — PTY와 같은 규칙이고,
// **이 파일에 `pub async fn`으로 있는 것 자체가 배선 테스트의 조건이다**
// (`src/tauri-commands.test.ts`는 `commands::`로 등록된 이름만 센다).
//
// 루트는 `atelier_core::data_root()`가 정한다 — 여기서 `~/.atelier`를 다시 계산하면
// `ATELIER_HOME` 오버라이드가 이 자리에서만 죽는다.

#[tauri::command]
pub async fn read_settings() -> CmdResult<crate::settings::Settings> {
    crate::settings::read(&atelier_core::data_root())
}

/// **읽은 것을 통째로 되돌려 받는다.** 그래야 우리가 모르는 키가 파일에 남는다 —
/// `update_work_title`이 work를 읽어 한 필드만 바꿔 되쓰는 것과 같은 왕복이고, 여기서는
/// 그 왕복이 IPC 경계를 건넌다.
#[tauri::command]
pub async fn write_settings(settings: crate::settings::Settings) -> CmdResult<()> {
    crate::settings::write(&atelier_core::data_root(), &settings)
}
