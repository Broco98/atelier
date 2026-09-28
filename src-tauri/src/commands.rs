use std::collections::BTreeMap;
use std::path::PathBuf;

use atelier_core::{
    archive_dir, mode_home, projects_dir, shared_projects_root, works_dir, ArchiveEntry,
    ArchivedDocs, Destination, Mode, ProjectPatch, ProjectView, SearchResults, WorkView,
    WorkWithSpecTree,
};

use std::sync::Arc;

use crate::processes::cleanup_log::CloseReason;
use crate::processes::service::ProcessService;
use crate::pty;

type CmdResult<T> = Result<T, String>;

fn err(e: atelier_core::Error) -> String {
    e.to_string()
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
//
// **빠뜨리면 오류다** (#187, contract). expand 동안에는 이 인자가 선택이었고 「없으면
// Atelier」를 정하는 함수가 한 자리에 있었다 — 프런트가 아직 모드를 안 보내던 때의
// 발판이다. 호출처가 전부 옮겨 온 지금 그 기본값은 그물이 아니라 **구멍**이다: 인자를
// 빠뜨린 새 호출이 오류 없이 저쪽 세계의 데이터로 답하고, 화면에는 「목록이 이상하다」로만
// 보여 어디가 잘못됐는지가 안 남는다. 인자가 필수라 **Tauri의 인자 역직렬화가 거절하고**,
// 그 거절은 부른 자리에서 즉시 보인다.
//
// 그래서 이 파일에는 이제 모드의 기본값이 한 자리도 없다 — 선택 인자로 되돌리든 받은 값을
// 제 손으로 갈아 끼우든, 다리 크레이트의 소스 검사
// (`어느_명령도_모드를_기본값으로_안_정한다`)가 빨개진다. 그 검사가 여기가 아니라 저기
// 사는 것은 **제 자신을 안 읽기 때문이다**(같은 파일의 `APP_SOURCES` 머리말).

// **목록·단건·옮기기 셋은 spec 트리를 싣는다**(spec 레이아웃 구현 스펙 3절). 트리를 덧붙이는
// 규칙은 코어의 `with_spec_trees` 한 자리에 있고 여기는 그것을 부르기만 한다 — L4 다리도 같은
// 입구를 부른다. 레이아웃은 모드의 홈이 아니라 데이터 루트 아래에 산다(`layouts/<id>/`).
//
// 나머지 쓰기(`set_work_*`)의 답은 뷰 그대로다. 화면이 그 답을 캐시에 안 쓰고 목록을 다시
// 읽기 때문이다(`hooks.ts`). 옮기기만 다르다 — 그 답으로 목록 캐시를 갈아 끼우므로, 트리가
// 없으면 끌어 놓은 뒤 그 세계의 work가 전부 기본 문서를 잃는다.

// work 목록은 워크트리마다 `git status` 프로세스를 기다린다(코어가 상한 있는 병렬로 부른다 — 프로세스 스펙 S19).
// 기다리는 일이라 blocking 풀에서 돌려 tokio 워커를 막지 않는다(`pty_kill`과 같다 — 프로세스 스펙 「IPC 규칙」).
// spec이 바뀔 때마다 도는 조회라, 워커에서 돌면 그동안 그 워커가 다른 async 명령을 못 받는다. spec 트리를
// 덧붙이는 것(레이아웃 · spec 폴더 읽기)도 디스크를 기다리는 일이라 같은 blocking 작업 안에서 한다.
#[tauri::command]
pub async fn list_works(mode: Mode) -> CmdResult<Vec<WorkWithSpecTree>> {
    tauri::async_runtime::spawn_blocking(move || {
        let works = atelier_core::list_works(&works_dir(mode)).map_err(err)?;
        atelier_core::with_spec_trees(&atelier_core::data_root(), mode, works).map_err(err)
    })
    .await
    .map_err(|e| format!("목록을 읽지 못했습니다: {e}"))?
}

#[tauri::command]
pub async fn get_work(mode: Mode, slug: String) -> CmdResult<WorkWithSpecTree> {
    let work = atelier_core::get_work(&works_dir(mode), &slug).map_err(err)?;
    // 하나를 넣으면 하나가 나온다. 입구가 목록을 받는 것은 목록의 resolve를 한 번으로 묶는 모양이라서다
    let mut works =
        atelier_core::with_spec_trees(&atelier_core::data_root(), mode, vec![work]).map_err(err)?;
    Ok(works.remove(0))
}

/// 표시 이름만 바꾼다. slug와 워크트리 경로는 그대로다 (update_project와 같은 규칙).
#[tauri::command]
pub async fn set_work_title(mode: Mode, slug: String, title: String) -> CmdResult<WorkView> {
    atelier_core::update_work_title(&works_dir(mode), &slug, &title).map_err(err)
}

#[tauri::command]
pub async fn set_work_status(mode: Mode, slug: String, status: String) -> CmdResult<WorkView> {
    let status = status.parse().map_err(err)?;
    atelier_core::update_work_status(&works_dir(mode), &slug, status).map_err(err)
}

/// 고정을 켜고 끈다. 목록 순서는 커널이 정한다 — 화면은 그 위에 정렬을 얹지 않는다 (결정 100).
#[tauri::command]
pub async fn set_work_pinned(mode: Mode, slug: String, pinned: bool) -> CmdResult<WorkView> {
    atelier_core::update_work_pinned(&works_dir(mode), &slug, pinned).map_err(err)
}

/// 작업 하나를 옮기고 새 목록 전체를 돌려준다 — 인자와 응답의 뜻은 코어 `move_work`에 있다.
#[tauri::command]
pub async fn move_work(
    mode: Mode,
    slug: String,
    pinned: bool,
    before: Option<String>,
) -> CmdResult<Vec<WorkWithSpecTree>> {
    let works =
        atelier_core::move_work(&works_dir(mode), &slug, pinned, before.as_deref()).map_err(err)?;
    atelier_core::with_spec_trees(&atelier_core::data_root(), mode, works).map_err(err)
}

/// 아카이브 보존소로 **옮긴다.** 워크트리는 정리되고 브랜치·spec·기록은 남는다.
/// 되돌리기가 없으므로 force도 없다 — 커밋 안 된 변경이 있으면 어느 파일인지 말하며 거부한다.
#[tauri::command]
pub async fn archive_work(mode: Mode, slug: String) -> CmdResult<()> {
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
pub async fn remove_work(mode: Mode, slug: String) -> CmdResult<()> {
    atelier_core::remove_work(&works_dir(mode), &slug, false).map_err(err)
}

#[tauri::command]
pub async fn read_spec_file(mode: Mode, slug: String, path: String) -> CmdResult<String> {
    atelier_core::read_spec_file(&works_dir(mode), &slug, &path).map_err(err)
}

/// 아카이브 목록. **경량이다** — spec 파일 목록도 워크트리도 담지 않는다.
/// 아카이브는 쌓이기만 하므로 목록 조회가 무거워지면 갈수록 나빠진다.
#[tauri::command]
pub async fn list_archive(mode: Mode) -> CmdResult<Vec<ArchiveEntry>> {
    atelier_core::list_archive(&archive_dir(mode)).map_err(err)
}

/// 아카이브된 work가 가진 문서 경로들과, 그중 `spec/` 아래를 가른 spec 트리. 상세 화면의
/// 머리말(제목·상태·언제 치웠는지)은 목록이 이미 들고 있으므로 단건 조회를 따로 두지 않는다.
///
/// 트리는 work 쪽 셋과 같이 코어의 입구(`with_archived_spec_tree`)가 싣는다 — L4 다리도 같은
/// 입구를 부른다. 목록과 트리가 한 응답이라 화면이 기다릴 쿼리가 늘지 않는다.
#[tauri::command]
pub async fn list_archived_docs(mode: Mode, slug: String) -> CmdResult<ArchivedDocs> {
    let docs = atelier_core::list_archived_docs(&archive_dir(mode), &slug).map_err(err)?;
    atelier_core::with_archived_spec_tree(&atelier_core::data_root(), mode, docs).map_err(err)
}

/// 아카이브된 work의 문서 하나. 경로는 **work 루트 기준**이다 (`record.md`, `spec/overview.md`) —
/// 기록이 spec 밖에 있어서, 화면이 둘을 한 트리로 보여주려면 창구가 하나여야 한다.
#[tauri::command]
pub async fn read_archived_file(mode: Mode, slug: String, path: String) -> CmdResult<String> {
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
    mode: Mode,
    query: String,
    destinations: Vec<Destination>,
) -> CmdResult<SearchResults> {
    // **그 세계의 홈 하나만 넘긴다** — 층별 폴더는 코어가 파생한다(`paths.rs`). 넷을 따로
    // 넘기던 때는 「반드시 코어의 것을 넘겨라」가 여기 주석으로만 서 있었고, 어긋나도
    // 컴파일이 안 잡았다. 여기서 `~/.atelier`를 박으면 `ATELIER_HOME` 오버라이드가 이
    // 자리에서만 죽는 것은 그대로다.
    atelier_core::search(&mode_home(mode), mode, &query, &destinations).map_err(err)
}

/// 그 work 화면이 **떠 있게 됐다**(팔레트 결정 12·14). 이력 맨 앞으로 옮긴다.
///
/// **세는 단위는 work이다** — 문서를 안 열고 터미널만 돌려도 「열었다」이고, 팔레트로 갔든
/// 사이드바로 갔든 주소를 쳤든 같다. 「어느 문으로 들어왔나」로 예외를 만들면 그 예외가 곧
/// 「왜 얘가 위에 없지」가 된다.
///
/// **이력은 세계마다 한 장이다** — 루트를 `mode_home(mode)`로 잡으므로 Maison의 것은
/// `maison/recent.json`에 따로 쌓인다. 한 장으로 합치면 두 세계에 같은 slug가 설 수 있다는
/// 것(결정 10)이 그대로 새어, Maison에서 연 Room이 저쪽 팔레트의 같은 이름을 맨 위로 올린다.
#[tauri::command]
pub async fn touch_recent_work(mode: Mode, slug: String) -> CmdResult<()> {
    atelier_core::touch_recent_work(&mode_home(mode), &slug).map_err(err)
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

// PTY 명령 일곱. 본체는 `pty.rs`에 있고 여기는 위임만 한다 — 이 파일에 `pub async fn`으로
// 있는 것 자체가 배선 테스트의 조건이다.
//
// **모드를 받는 것은 spawn 하나다.** 나머지 여섯은 이미 뜬 셸을 id로 가리키고, 그 셸이 어느
// 세계의 것인지는 뜰 때 정해져 pty에 굳는다 — 여기에 인자를 더하면 「id와 모드가 어긋나면
// 어느 쪽이 이기나」라는, 아무도 답할 수 없는 갈래가 생긴다.

#[tauri::command]
pub async fn pty_spawn(
    pool: tauri::State<'_, Arc<pty::PtyPool>>,
    mode: Mode,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    on_frame: tauri::ipc::Channel<tauri::ipc::InvokeResponseBody>,
) -> CmdResult<pty::PtySpawned> {
    pty::spawn(&pool, mode, cwd, cols, rows, on_frame)
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

// 셸을 닫으면 그 셸에서 나온 것을 모두 끝낸다(프로세스 결정 3). **풀에서 빼고 판정까지 한 뒤 돌아온다** —
// SIGTERM 뒤 최대 2초의 유예와 SIGKILL은 `pty::kill`이 뒤 스레드로 보내고, 그 끝내기는 진행 중인 끝내기 목록에
// 올라 앱 종료가 마감한다(프로세스 스펙 S5). 스냅샷 한 장도 기다리는 일이라 blocking 풀에서 돌려 tokio 워커를
// 막지 않는다. 프런트는 이 명령의 끝을 기다리지 않는다(`terminal-store.ts`의 `ignoreGone`).
//
// **까닭과 셸의 주인을 받는다**(티켓 11) — 끝낸 것이 정리 기록에 그 까닭으로 적힌다. 까닭은 프런트가 고르는 셋뿐이고
// (`CloseReason`), 어느 닫기가 어느 까닭인지는 프런트의 표 한 자리가 정한다. 주인은 기록에 적힐 뿐 셸을 찾는 데 안
// 쓴다 — 셸은 `id` 하나로 가리킨다(한 주인에 셸이 여럿일 수 있어 주인으로는 어느 셸인지 못 고른다). 주인은 없을 수 있다(`null`) — `Processes`의 화면 밖 셸(티켓 32)은 프런트
// 스토어에 칸이 없어 주인을 모른다.
#[tauri::command]
pub async fn pty_kill(
    pool: tauri::State<'_, Arc<pty::PtyPool>>,
    id: u32,
    reason: CloseReason,
    owner: Option<String>,
) -> CmdResult<()> {
    let pool = Arc::clone(&pool);
    tauri::async_runtime::spawn_blocking(move || pty::kill(&pool, id, reason, owner.as_deref()))
        .await
        .map_err(|e| format!("셸을 닫지 못했습니다: {e}"))?
}

// 셸의 **첫 사람 입력**을 한 번 알린다(프로세스 결정 7 · 프로세스 스펙 P1). `at`은 프런트가 잰 에포크 ms다 — 받은
// 순간으로 적지 않는 까닭은 `pty::note_first_input`이 든다. 판정이 셸 도우미를 가르는 기준이다(티켓 08).
#[tauri::command]
pub async fn pty_first_input(
    pool: tauri::State<'_, Arc<pty::PtyPool>>,
    id: u32,
    at: u64,
) -> CmdResult<()> {
    pty::note_first_input(&pool, id, at)
}

// 셸을 닫기 직전에 **한 번** 묻는 값 — 명령이 도는가와 함께 끝날 프로세스 수다(프로세스 결정 3이 ux-papercuts
// 결정 92의 「명령이 도는가」를 넓혔다). 구독도 폴링도 없다 — 매 순간 바뀌는 값이라 상태에 얹으면 폴링이 생기고,
// 필요한 순간은 닫을 때뿐이다. 스냅샷 한 장을 찍는 기다리는 일이라 blocking 풀에서 돌린다(`pty_kill`과 같다).
#[tauri::command]
pub async fn pty_close_check(
    pool: tauri::State<'_, Arc<pty::PtyPool>>,
    id: u32,
) -> CmdResult<pty::CloseCheck> {
    let pool = Arc::clone(&pool);
    tauri::async_runtime::spawn_blocking(move || pty::close_check(&pool, id))
        .await
        .map_err(|e| format!("셸에 무엇이 도는지 읽지 못했습니다: {e}"))?
}

// 셸 여럿의 닫기 전 물음을 **스냅샷 한 장으로** 답한다 — 종료 확인 창과 아카이브 확인 창이 「(띄운 프로세스 M개
// 포함)」을 셀 때 부른다(프로세스 스펙 S18 · 티켓 08). 셸마다 위 명령을 부르면 스냅샷을 셸 수만큼 찍는다.
//
// **답한 셸만 싣는다** — pty id → 답. 못 읽은 셸(이미 끝남, tcgetpgrp 실패)은 빠진다. 셸 하나의 물음은 그 까닭을
// 오류로 돌려주지만, 여기서 하나 때문에 전부를 거절하면 창이 셀 수를 통째로 잃는다.
#[tauri::command]
pub async fn pty_close_checks(
    pool: tauri::State<'_, Arc<pty::PtyPool>>,
    ids: Vec<u32>,
) -> CmdResult<BTreeMap<u32, pty::CloseCheck>> {
    let pool = Arc::clone(&pool);
    tauri::async_runtime::spawn_blocking(move || {
        let checks = pty::close_checks(&pool, &ids);
        ids.into_iter().zip(checks).filter_map(|(id, check)| Some((id, check.ok()?))).collect()
    })
    .await
    .map_err(|e| format!("셸들에 무엇이 도는지 읽지 못했습니다: {e}"))
}

// `Processes` 화면의 스냅샷 — 판정 결과와 풀의 셸 목록이다(프로세스 결정 10 · 티켓 26). **화면이 열려 있는 동안만** 프런트가
// 2초마다 부른다(`src/features/processes/hooks.ts`) — 닫혀 있으면 무거운 수집을 안 한다(스토리 95). 스냅샷 한 장과 판정을
// 기다리는 일이라 blocking 풀에서 돌린다(`pty_close_checks`와 같다). 읽기의 자리는 풀과 따로 앱에 걸린 프로세스 서비스다
// (`processes::service`) — 아래 셋(요약 · 추이 · 정리 기록)도 같다.
//
// 모드를 안 받는다 — 화면이 앱 전체를 보인다(프로세스 결정 9). 두 세계의 주소가 같은 화면을 열고 같은 것을 묻는다.
#[tauri::command]
pub async fn processes_snapshot(
    processes: tauri::State<'_, Arc<ProcessService>>,
) -> CmdResult<crate::processes::screen::ScreenSnapshot> {
    let processes = Arc::clone(&processes);
    tauri::async_runtime::spawn_blocking(move || processes.screen())
        .await
        .map_err(|e| format!("프로세스 스냅샷을 찍지 못했습니다: {e}"))
}

// nav 메타의 요약 — 앱 전체 메모리 합계, 출처 불명의 신원, `●`를 켜는 기록의 머리 id(프로세스 결정 11 · 티켓 29). 두 세계의 모든
// 화면에 선 nav 메타가 10초마다 부른다(`src/features/processes/hooks.ts`). 답은 Rust의 배경 표본이 10초마다 앉힌 마지막 장이다 —
// 부를 때마다 표를 찍지 않는다. 첫 장이 아직 없으면 그 자리에서 모으므로(표 한 장과 판정) blocking 풀에서 돌린다.
//
// 모드를 안 받는다 — nav 메타는 「이 세계의 것만 센다」의 예외다(프로세스 결정 9). 두 세계가 같은 값을 묻는다.
#[tauri::command]
pub async fn processes_summary(
    processes: tauri::State<'_, Arc<ProcessService>>,
) -> CmdResult<crate::processes::summary::Summary> {
    let processes = Arc::clone(&processes);
    tauri::async_runtime::spawn_blocking(move || processes.summary())
        .await
        .map_err(|e| format!("프로세스 요약을 읽지 못했습니다: {e}"))
}

// 요약 카드의 추이 — 배경 표본이 10초마다 든 앱 전체 메모리 합계의 1시간치(360점), 오래된 것부터(프로세스 결정 10 · 티켓 30). 화면이
// 열려 있는 동안 요약이 올 때마다 한 번 부른다(`src/features/processes/hooks.ts`의 `trendQuery`) — 새 박자는 없다. 고리를 복사할
// 뿐이라 표를 찍지 않고 기다리지도 않는다(blocking 풀이 필요 없다). 앱을 다시 켜면 빈다.
//
// 모드를 안 받는다 — 요약과 같은 앱 전체의 값이다(프로세스 결정 9).
#[tauri::command]
pub async fn processes_trend(
    processes: tauri::State<'_, Arc<ProcessService>>,
) -> CmdResult<Vec<crate::processes::summary::Point>> {
    Ok(processes.trend())
}

// 정리 기록 — 앱이 무엇을 언제 왜 끝냈는가, 새것부터 최근 100건(프로세스 결정 6 · 프로세스 스펙 S12 · 티켓 32). `Processes` 화면이
// 스냅샷이 올 때마다 한 번 부른다(`src/features/processes/hooks.ts`의 `cleanupLogQuery`). 기록은 풀의 인스턴스 기록이 연
// 자리에서 읽는다 — 데이터 루트를 여기서 다시 계산하지 않는다. 파일 한 장(100건)을 읽을 뿐이라 표를 찍지 않는다. 적는 것은 끝내기
// 길들이고 여기는 읽기만 한다.
//
// 모드를 안 받는다 — 화면이 앱 전체를 보인다(프로세스 결정 9). 기록도 앱에 한 장이다.
#[tauri::command]
pub async fn processes_cleanup_log(
    processes: tauri::State<'_, Arc<ProcessService>>,
) -> CmdResult<Vec<crate::processes::cleanup_log::Event>> {
    let processes = Arc::clone(&processes);
    tauri::async_runtime::spawn_blocking(move || processes.cleanup_events())
        .await
        .map_err(|e| format!("정리 기록을 읽지 못했습니다: {e}"))
}

// 사람이 고른 프로세스를 끝낸다 — `Processes`의 자손 행 [끝내기]와 고아 묶음의 [정리](프로세스 결정 6 · 티켓 31). 받는 것은
// **화면이 보인 신원(pid, 시작 시각) 목록**이다 — 여기서 다시 판정하지 않는다. 신호까지 보내고 돌아오며(S5) 유예와 SIGKILL은
// 풀의 뒤 스레드가 돈다. 정리 기록에 까닭 「손으로」로 적힌다. 신호 전에 표 한 장을 찍으니 blocking 풀에서 돌린다.
//
// 모드를 안 받는다 — 화면이 앱 전체를 보인다(프로세스 결정 9).
#[tauri::command]
pub async fn processes_end(
    pool: tauri::State<'_, Arc<pty::PtyPool>>,
    targets: Vec<crate::processes::Identity>,
) -> CmdResult<()> {
    let pool = Arc::clone(&pool);
    tauri::async_runtime::spawn_blocking(move || pty::end_by_hand(&pool, &targets))
        .await
        .map_err(|e| format!("프로세스를 끝내지 못했습니다: {e}"))
}

// 사용자 설정 셋 — 읽기 · 쓰기와 예외 목록의 기본값(`default_process_exceptions`, 아래). 본체는 `settings.rs` ·
// `processes::exceptions`에 있고 여기는 위임만 한다 — PTY와 같은 규칙이고,
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

/// 예외 목록의 기본값(프로세스 결정 5 · 프로세스 스펙 S7). 설정의 `terminal.processExceptions`가 `null`일 때 판정이
/// 쓰는 목록이고, 설정 › 터미널이 그 칸에 보여 준다. **값을 정하는 자리는 Rust 상수 하나다** — 판정이 화면 없이
/// 쓰기 때문이다. 화면이 따로 적으면 한쪽이 조용히 낡는다.
///
/// 모드를 안 받는다 — 설정은 어느 세계에도 안 속한다.
#[tauri::command]
pub async fn default_process_exceptions() -> CmdResult<Vec<String>> {
    Ok(crate::processes::exceptions::defaults())
}

// 에이전트 훅 설치 셋 (#207 · 구현 결정 8). 본체는 `hooks.rs`에 있고 여기는 위임만 한다 —
// 설정 셋과 같은 규칙이다.
//
// **홈이 둘이다.** 훅 처리기가 사는 곳은 `atelier_core::data_root()`(테스트가
// `ATELIER_HOME`으로 옮기는 우리 폴더)이고, 고쳐야 할 설정이 사는 곳은 **진짜 홈**이다
// (`hooks::agent_home` — 그 까닭도 거기 있다).

/// 사용자의 설정에 적어 넣을 훅 처리기의 경로 — 새 처리기다(티켓 21). 옛 python 처리기의 줄은 설치가 이것으로 갈아 끼운다.
fn hook_handler() -> PathBuf {
    crate::shells::handler_path(&atelier_core::data_root())
}

/// 얼마나 깔렸나 — **설정 파일을 읽어 답한다.** 앱이 따로 기억하는 상태가 없다. 에이전트마다 없음 · 일부 · 전부다.
#[tauri::command]
pub async fn agent_hooks() -> CmdResult<Vec<crate::hooks::HookStatus>> {
    Ok(crate::hooks::status(&crate::hooks::agent_home(), &hook_handler()))
}

/// 훅 처리기를 세우고 두 설정에 병합한다 — 이미 깐 것은 지금 목록으로 맞춘다(「업데이트 필요」를 고치는 길).
///
/// **처리기를 못 쓰면 거기서 멈춘다.** 설정만 고쳐 두면 사용자의 claude가 매 턴 없는
/// 파일을 부른다 — 병합이 성공한 것이 오히려 나쁜 상태다.
#[tauri::command]
pub async fn install_agent_hooks() -> CmdResult<Vec<crate::hooks::HookStatus>> {
    crate::shells::write_hook_scripts(&atelier_core::data_root())?;
    Ok(crate::hooks::install(&crate::hooks::agent_home(), &hook_handler()))
}

/// 두 설정에서 우리 항목만 걷는다 — 옛 이름의 줄도 새 이름의 줄도. **처리기 파일은 남긴다** — 남아도 무해하고, 지우면
/// 아직 살아 있는 셸의 훅이 그 순간부터 없는 파일을 부른다.
#[tauri::command]
pub async fn uninstall_agent_hooks() -> CmdResult<Vec<crate::hooks::HookStatus>> {
    Ok(crate::hooks::uninstall(&crate::hooks::agent_home(), &hook_handler()))
}

// spec 레이아웃(spec 레이아웃 구현 스펙 3절). 규칙은 전부 코어의 레이아웃 저장소에 있고 여기는 그것을
// 부르기만 한다 — L4 다리도 같은 입구를 부른다. 레이아웃은 모드의 홈이 아니라 데이터 루트 아래에
// 산다(`layouts/<id>/`). 인자가 있으면 이름은 `id`다: 모드 명령이 아니라 레이아웃 id를 받는다.

/// 모드 둘의 레이아웃 상태 — 설정의 「spec 레이아웃」 페이지가 그린다. 아무것도 쓰지 않는다.
#[tauri::command]
pub async fn spec_layout_states() -> CmdResult<Vec<atelier_core::LayoutState>> {
    Ok(atelier_core::layout_states(&atelier_core::data_root()))
}

/// 모드의 레이아웃을 기본값으로 되돌린다 — 그 모드의 레이아웃 폴더를 지운다(spec 레이아웃 결정 7).
/// 깨진 폴더도 지운다. 확인은 화면이 먼저 묻는다. 에이전트에게는 이 길이 없다(spec 레이아웃 결정 21).
/// id는 모드 이름 둘만 받는다.
#[tauri::command]
pub async fn revert_spec_layout(id: String) -> CmdResult<()> {
    atelier_core::revert_layout(&atelier_core::data_root(), &id).map_err(err)
}

/// 편집기가 여는 모드의 레이아웃 — 디스크 형식 그대로의 레이아웃과 템플릿 본문, 경고. 깨졌으면 오류와
/// 원문이다(편집기는 그때 편집 UI를 세우지 않는다). 아무것도 쓰지 않는다. id는 모드 이름 둘만 받는다.
#[tauri::command]
pub async fn read_spec_layout(id: String) -> CmdResult<atelier_core::LayoutRead> {
    atelier_core::read_layout(&atelier_core::data_root(), &id).map_err(err)
}

/// 편집기의 저장. 템플릿은 늘 전부 받는다. **검증이 거절하면 거절이 아니라 답이다** — 위치가 붙은
/// 오류가 성공 응답의 데이터(`{ errors }`)로 가고 아무것도 쓰지 않는다. 명령이 거절하는 것은 쓰다가
/// 실패한 것(IO)과 모드 이름이 아닌 id뿐이다. `layout`은 값으로 받는다 — 구조체로 받으면 모르는 키가
/// 역직렬화에서 떨어진다.
#[tauri::command]
pub async fn write_spec_layout(
    id: String,
    layout: serde_json::Value,
    templates: std::collections::BTreeMap<String, String>,
) -> CmdResult<atelier_core::SaveOutcome> {
    atelier_core::save_layout(&atelier_core::data_root(), &id, layout, &templates).map_err(err)
}

/// 편집기의 미리보기(티켓 14) — 저장하지 않은 초안을 저장하면 에이전트가 받을 안내문과 그 안의 항목의 줄,
/// 검증 오류, 경고. 편집기는 초안이 바뀔 때마다 부른다 — 팝업을 닫은 동안에도 오류가 서고 저장이 잠긴다.
/// 오류의 모양은 저장(`write_spec_layout`)과 같다. **디스크에 쓰지 않는다.** 규칙은 코어의 미리보기 함수에
/// 있다 — 여기에 두면 L4 다리가 같은 규칙을 한 벌 더 가진다. id는 모드 이름 둘만 받는다.
#[tauri::command]
pub async fn render_spec_layout(
    id: String,
    layout: serde_json::Value,
    templates: std::collections::BTreeMap<String, String>,
) -> CmdResult<atelier_core::LayoutPreview> {
    atelier_core::preview_layout(&atelier_core::data_root(), &id, layout, &templates).map_err(err)
}

/// 사람이 종료 확인에서 「종료」를 골랐다(결정 14·15). **「확인됨」을 먼저 세우고** 끈다 — 끄는
/// 사이에 끼어드는 #224의 `terminate:` 훅이 다시 막고 묻지 않게. 셸 정리는 여기서 하지 않는다:
/// `app.exit`가 부르는 `RunEvent::Exit`의 `pty::end_for_exit`가 그대로 돈다(`lib.rs`).
///
/// 모드를 안 받는다 — 앱 하나를 끄는 일이라 세계가 없다.
#[tauri::command]
pub async fn quit_app(app: tauri::AppHandle) -> CmdResult<()> {
    crate::quit::confirm();
    app.exit(0);
    Ok(())
}

/// 앱이 뜰 때 한 일(프로세스 결정 6 · 프로세스 스펙 S11). 프런트가 **부팅 때 한 번** 묻는다(`main.tsx`) —
/// 이벤트로 쏘면 웹뷰가 듣기 전에 지나갈 수 있어서다. 본체는 `startup.rs`에 있고 여기는 위임만 한다.
///
/// **시작 때 할 일이 모두 끝나야 답한다** — 시작 정리가 아직 돌면(최악 2초 남짓, SIGTERM을 무시하는 고아의 유예) 끝날
/// 때까지 기다린다. 기다리는 일이라 blocking 풀에서 돌려 tokio 워커를 막지 않는다(`pty_kill`과 같다) — 부팅 때 나란히
/// 오는 목록 조회 · 설정 읽기가 그 워커에서 돈다.
///
/// 모드를 안 받는다 — 앱 하나가 뜬 일이라 세계가 없다.
#[tauri::command]
pub async fn startup_report(
    holder: tauri::State<'_, Arc<crate::startup::ReportHolder>>,
) -> CmdResult<crate::startup::StartupReport> {
    let holder = Arc::clone(&holder);
    tauri::async_runtime::spawn_blocking(move || holder.answer())
        .await
        .map_err(|e| format!("시작 보고를 읽지 못했습니다: {e}"))
}

#[cfg(test)]
mod tests {
    /// 명령 하나의 몸통 — 서명 뒤에서 열 0의 `}`까지. 잘라 낸 자리가 테스트 모듈을 삼키면 소스 스캔이 제 문자열을
    /// 읽고 통과하므로 그것을 먼저 막는다.
    fn command_body(name: &str) -> &'static str {
        let src = include_str!("commands.rs");
        let body = src
            .split_once(&format!("pub async fn {name}("))
            .expect("명령이 있다")
            .1
            .split_once("\n}\n")
            .expect("명령의 끝이 있다")
            .0;
        assert!(!body.contains("mod tests"), "잘라 낸 자리가 테스트 모듈까지 삼켰다 — 소스 스캔이 제 문자열을 읽고 통과한다");
        body
    }

    /// **기다리는 명령은 blocking 풀에서 기다린다**(프로세스 스펙 「가로지르는 규칙 › IPC」). async 명령 안에서 곧바로 기다리면 그동안
    /// tokio 워커 하나가 멎어 나란히 오는 셸 입력 · 목록 조회 · 설정 읽기가 밀린다. `#[tauri::command]`는 런타임 없이 못 부르니 자리로
    /// 잰다 — 명령마다 기다리는 부름이 `spawn_blocking(` 뒤에 서고, 한 번만 선다(두 번이면 한쪽이 blocking 풀 밖일 수 있다).
    ///
    /// - `startup_report`(티켓 10): 시작 정리가 끝날 때까지(최악 2초 남짓) 답하지 않는다 — 부팅 때 워커 하나가 그만큼 멎는다.
    ///   기다리는 쪽의 동작은 `startup.rs`의 검사가 잰다.
    /// - `list_works`(티켓 15): 코어의 목록 조회가 워크트리마다 `git status` 프로세스를 기다린다. 명령의 모양(공개 async 함수)은
    ///   그대로다 — 등록 이름 검사와 다리가 그 자리를 본다.
    /// - `processes_snapshot`(티켓 26): 화면이 열려 있는 동안 2초마다 오고, 한 번에 이 맥의 프로세스 표 한 장과 판정이 든다(ms).
    /// - `processes_summary`(티켓 29): 답은 대개 배경 표본이 앉힌 장이지만, 첫 장이 아직 없으면(앱이 막 떴다) 그 자리에서 표 한 장과
    ///   판정을 모은다. 부를 때마다 표를 찍지는 않는다(`summarize`가 아니다).
    /// - `processes_end`(티켓 31): 정리 기록에 적을 이름을 떠 두려 신호 전에 표 한 장을 찍는다. 유예와 SIGKILL은 풀의 뒤 스레드가
    ///   돈다(`pty::end_by_hand`).
    #[test]
    fn the_waiting_commands_wait_off_the_async_workers() {
        for (command, call, once) in [
            ("startup_report", "holder.answer()", "answer()"),
            ("list_works", "atelier_core::list_works(", "list_works("),
            ("processes_snapshot", "processes.screen()", ".screen("),
            ("processes_summary", "processes.summary()", ".summary("),
            ("processes_end", "pty::end_by_hand(", "pty::end_by_hand("),
        ] {
            let body = command_body(command);
            let blocking = body
                .find("spawn_blocking(")
                .unwrap_or_else(|| panic!("{command}: blocking 풀로 안 보낸다 — 기다리는 동안 tokio 워커가 멎는다"));
            let waits = body.find(call).unwrap_or_else(|| panic!("{command}: 기다리는 부름(`{call}`)이 없다"));
            assert!(blocking < waits, "{command}: 기다리는 부름({waits})이 blocking 풀({blocking}) 밖에 있다");
            assert_eq!(body.matches(once).count(), 1, "{command}: 두 번 부른다 — 한쪽이 blocking 풀 밖일 수 있다");
        }
        assert!(
            !command_body("processes_summary").contains(".summarize("),
            "요약 IPC가 부를 때마다 표를 찍는다 — 배경 표본의 장을 안 쓴다"
        );
    }

    /// **추이 IPC는 배경 표본의 고리를 돌려줄 뿐이다**(티켓 30). 요약이 올 때마다 부르므로, 여기서 표를 찍거나 요약을 새로 모으면
    /// 화면이 열려 있는 동안 박자마다 표 한 장이 는다.
    #[test]
    fn the_trend_answers_the_ring_without_sampling() {
        let body = command_body("processes_trend");
        assert_eq!(body.matches("processes.trend()").count(), 1, "명령이 배경 표본의 고리를 안 읽는다");
        assert!(!body.contains(".summar") && !body.contains(".screen("), "추이 IPC가 부를 때마다 표를 찍는다");
    }

    // **「받은 모드가 그대로 내려간다」를 재던 단위 테스트 둘은 여기 없다.** 잴 대상이던
    // 「없으면 Atelier」 함수가 #187에서 사라졌고, 이제 명령은 받은 값을 루트 함수에 그대로
    // 건네는 한 줄뿐이라 이 크레이트에서 부를 수 있는 로직이 남지 않았다
    // (`#[tauri::command]`는 런타임 없이 못 부른다).
    //
    // 그 자리를 무엇이 대신하는가: 다리의 계약 테스트(`tests/mode_contract.rs`의
    // `모드를_받는_명령을_전부_maison으로_불러_본다`)가 **명령 하나하나를** 실제로 불러
    // 어느 루트를 읽었는지 재고, 목록은 이 파일에서 파생한다 — 명령이 늘면 저절로 따라온다.

    // **「Maison에는 등록부가 없다」를 재던 단위 테스트도 여기 없다.** 그 갈래가 이 파일을
    // 떠나 코어로 갔기 때문이다(`atelier_core::shared_projects_root`) — 한때 앱·MCP·다리가
    // 같은 `match`를 각자 들고 있었고, 몸통도 이유도 같은 사본 셋이라 하나가 뒤집혀도 나머지
    // 둘의 검사는 그대로 초록이었다. 갈래 자체는 이제 코어의
    // `only_atelier_hands_the_kernel_a_project_registry`가 재고, **이 파일이 그것을 부르는지**는
    // 다리 크레이트의 소스 검사(`명령이_등록부를_제_손으로_고르지_않는다`)가 든다.
}
