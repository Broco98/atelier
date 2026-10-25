use std::collections::BTreeMap;
use std::path::PathBuf;

use atelier_core::{
    archive_dir, data_root, projects_dir, works_dir, AddProject, ArchiveEntry, ArchivedDocs, Destination,
    FolderLook, NewProjectPlace, ProjectPatch, ProjectRemoval, ProjectUsage, ProjectView, SearchResults, Space, SpaceDetail,
    SpaceDraft, SpacePatch, WorkView, WorkWithSpecTree, WorktreeTree,
};

use std::convert::Infallible;
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

// Project 추가 창(03 구현 스펙 §15 · §16) — 살피기 · 추가 · 새로 만들 자리 · 새로 만들기. 모두 core 하나를 부른다(L4 다리도 같은
// 입구다). 경로는 `~`로 시작해도 된다 — 창은 살피기가 돌려준 꼴(`~/…`)을 그대로 되돌려 넘긴다.

/// 폴더 살피기 — 추가 창이 폴더를 고르는 순간 부른다. 실패하지 않는다(읽지 못한 폴더는 「폴더가 없음」 갈래다).
#[tauri::command]
pub async fn inspect_project_folder(folder: String) -> CmdResult<FolderLook> {
    Ok(atelier_core::inspect_folder(&projects_dir(), &PathBuf::from(folder)))
}

/// 추가 — 이름 칸(비면 폴더 이름)과 「git init 하고 추가」를 함께 받는다. git이 아닌 폴더는 `init_git`일 때만 받는다.
#[tauri::command]
pub async fn create_project(folder: String, name: Option<String>, init_git: bool) -> CmdResult<ProjectView> {
    atelier_core::add_project(&projects_dir(), &PathBuf::from(folder), AddProject { name, init_git }).map_err(err)
}

/// 새로 만들 자리 — 「새로 만들기」가 이름을 칠 때마다 부른다(그 자리에 무엇이 있으면 「이미 있어요」).
#[tauri::command]
pub async fn new_project_place(parent: String, name: String) -> CmdResult<NewProjectPlace> {
    Ok(atelier_core::new_project_place(&PathBuf::from(parent), &name))
}

/// 새로 만들기 — 폴더 · `git init -b main` · 빈 첫 커밋 · 등록. git이 실패하면 만든 폴더를 걷고 git의 글로 실패한다.
#[tauri::command]
pub async fn new_project(parent: String, name: String) -> CmdResult<ProjectView> {
    atelier_core::new_project(&projects_dir(), &PathBuf::from(parent), &name).map_err(err)
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

/// 재설정 — 폴더를 찾을 수 없는 Project가 새 자리를 고른다(03 구현 스펙 §15 · §16). git 저장소의 뿌리만 받고 경로만 바꾼다.
#[tauri::command]
pub async fn relocate_project(slug: String, folder: String) -> CmdResult<ProjectView> {
    atelier_core::relocate_project(&projects_dir(), &slug, &PathBuf::from(folder)).map_err(err)
}

// Project 제거(03 구현 스펙 §15 · §16) — 확인 창이 읽는 것 · 제거 · 되돌리기. 셋 다 core를 부르기만 한다(L4 다리도 같은 입구다). Space
// 파일 · Work 파일을 함께 읽고 고쳐 데이터 루트를 넘긴다.

/// 제거 확인 창이 읽는 것 — 이 Project를 적은 Space들, 이 Project를 고치는 진행 중인 Work들. 창의 세 갈래가 이것으로 갈린다.
#[tauri::command]
pub async fn project_usage(slug: String) -> CmdResult<ProjectUsage> {
    atelier_core::project_usage(&data_root(), &slug).map_err(err)
}

/// 제거 — 진행 중인 Work가 고치면 제거하지 않고 그 Work들을 돌려준다(창이 막힌 갈래로 바뀐다). 폴더 · 파일 · git 기록은 그대로다.
#[tauri::command]
pub async fn remove_project(slug: String) -> CmdResult<ProjectRemoval> {
    atelier_core::remove_project(&data_root(), &slug).map_err(err)
}

/// 되돌리기 — 제거한 뒤의 토스트 「되돌리기」만 부른다(S10). 그사이 같은 slug · 같은 폴더가 다시 등록됐으면 실패한다.
#[tauri::command]
pub async fn restore_project(slug: String) -> CmdResult<ProjectView> {
    atelier_core::restore_project(&data_root(), &slug).map_err(err)
}

// **Space는 파일이다**(03 구현 스펙 §8 · §17) — 셋 다 core를 부르기만 한다. 검사 · 글 단위 고치기는 core 하나이고(S7), 기록 줄을 남기지
// 않으니 엔진을 지나지 않는다(`thread_` 접두가 아니라 L4 다리로도 탄다). 문제 있는 파일도 목록에 선다.
#[tauri::command]
pub async fn list_spaces() -> CmdResult<Vec<Space>> {
    atelier_core::list_spaces(&data_root()).map_err(err)
}

/// Space 하나와 함께 쓰는 Space — 상세 화면이 한 번에 읽는다.
#[tauri::command]
pub async fn get_space(slug: String) -> CmdResult<SpaceDetail> {
    atelier_core::space_detail(&data_root(), &slug).map_err(err)
}

/// 상세의 설명 · 넣기 · 빼기(되돌리기는 `before`로 제자리에 넣는다). 고친 칸만 바꾸고, 새 문제를 만들면 쓰지 않고 그 문제를 말한다.
#[tauri::command]
pub async fn update_space(
    slug: String,
    name: Option<String>,
    description: Option<String>,
    add: Option<Vec<String>>,
    before: Option<String>,
    remove: Option<Vec<String>>,
) -> CmdResult<Space> {
    let patch =
        SpacePatch { name, description, add: add.unwrap_or_default(), before, remove: remove.unwrap_or_default() };
    atelier_core::update_space(&data_root(), &slug, patch).map_err(err)
}

// **Space 파일 고치기 화면**(03 구현 스펙 §13 · 관계 편집 · 직접 만들기) — 파일 글 그대로 읽기 · 고칠 때마다 검사 · 글로 저장. `slug`가 없으면
// 새 Space다. 검사는 core 하나이고 화면은 따로 검사하지 않는다(S7) — 저장도 같은 검사로 거절한다.
#[tauri::command]
pub async fn read_space_text(slug: String) -> CmdResult<String> {
    atelier_core::read_space_text(&data_root(), &slug).map_err(err)
}

/// 고치는 글 하나의 검사(문제 · 조각 자리)와 미리보기 · 안내 줄 · 새 Space의 파일 이름.
#[tauri::command]
pub async fn check_space(slug: Option<String>, text: String) -> CmdResult<SpaceDraft> {
    atelier_core::draft_space(&data_root(), slug.as_deref(), &text).map_err(err)
}

/// 사람이 쓴 글을 그대로 쓴다 — 문제가 있으면 쓰지 않는다. 새 Space면 글의 이름에서 slug를 짓는다.
#[tauri::command]
pub async fn save_space_text(slug: Option<String>, text: String) -> CmdResult<Space> {
    atelier_core::save_space_text(&data_root(), slug.as_deref(), &text).map_err(err)
}

/// 읽는 범위(03 구현 스펙 §7) — Space(slug · 이름 · 문제 있음) · 읽는 Project(slug · 이름 · 왜) · 갈래(전부 · Space · 빈 Space · 등록
/// 없음). `thread`가 있으면 그 Thread의 범위, 없으면 보내기 전의 새 Thread — 입력창이 고른 Work · Space로 센다. 요약 카드 「소스」와
/// Space 메뉴가 이것을 그린다. 읽기만 하고 core를 부르기만 한다(L4 다리로도 탄다).
#[tauri::command]
pub async fn reading_scope(
    thread: Option<String>,
    work: Option<String>,
    space: Option<String>,
) -> CmdResult<atelier_core::ReadingScope> {
    atelier_core::reading_scope_of(&data_root(), thread.as_deref(), work.as_deref(), space.as_deref()).map_err(err)
}

// **목록·단건·옮기기 셋은 spec 트리를 싣는다**(spec 레이아웃 구현 스펙 3절). 트리를 덧붙이는
// 규칙은 코어의 `with_spec_trees` 한 자리에 있고 여기는 그것을 부르기만 한다 — L4 다리도 같은
// 입구를 부른다. 레이아웃은 데이터 루트 아래에 산다(`layouts/atelier/`).
//
// 나머지 쓰기(`set_work_*`)의 답은 뷰 그대로다. 화면이 그 답을 캐시에 안 쓰고 목록을 다시
// 읽기 때문이다(`hooks.ts`). 옮기기만 다르다 — 그 답으로 목록 캐시를 갈아 끼우므로, 트리가
// 없으면 끌어 놓은 뒤 모든 work가 기본 문서를 잃는다.

// work 목록은 워크트리마다 `git status` 프로세스를 기다린다(코어가 상한 있는 병렬로 부른다 — 프로세스 스펙 S19).
// 기다리는 일이라 blocking 풀에서 돌려 tokio 워커를 막지 않는다(`pty_kill`과 같다 — 프로세스 스펙 「IPC 규칙」).
// spec이 바뀔 때마다 도는 조회라, 워커에서 돌면 그동안 그 워커가 다른 async 명령을 못 받는다. spec 트리를
// 덧붙이는 것(레이아웃 · spec 폴더 읽기)도 디스크를 기다리는 일이라 같은 blocking 작업 안에서 한다.
#[tauri::command]
pub async fn list_works() -> CmdResult<Vec<WorkWithSpecTree>> {
    tauri::async_runtime::spawn_blocking(move || {
        let works = atelier_core::list_works(&works_dir()).map_err(err)?;
        Ok(atelier_core::with_spec_trees(&data_root(), works))
    })
    .await
    .map_err(|e| format!("목록을 읽지 못했습니다: {e}"))?
}

#[tauri::command]
pub async fn get_work(slug: String) -> CmdResult<WorkWithSpecTree> {
    let work = atelier_core::get_work(&works_dir(), &slug).map_err(err)?;
    // 하나를 넣으면 하나가 나온다. 입구가 목록을 받는 것은 목록의 resolve를 한 번으로 묶는 모양이라서다
    let mut works = atelier_core::with_spec_trees(&data_root(), vec![work]);
    Ok(works.remove(0))
}

/// 표시 이름만 바꾼다. slug와 워크트리 경로는 그대로다 (update_project와 같은 규칙).
#[tauri::command]
pub async fn set_work_title(slug: String, title: String) -> CmdResult<WorkView> {
    atelier_core::update_work_title(&works_dir(), &slug, &title).map_err(err)
}

#[tauri::command]
pub async fn set_work_status(slug: String, status: String) -> CmdResult<WorkView> {
    let status = status.parse().map_err(err)?;
    atelier_core::update_work_status(&works_dir(), &slug, status).map_err(err)
}

/// 고정을 켜고 끈다. 목록 순서는 커널이 정한다 — 화면은 그 위에 정렬을 얹지 않는다 (결정 100).
#[tauri::command]
pub async fn set_work_pinned(slug: String, pinned: bool) -> CmdResult<WorkView> {
    atelier_core::update_work_pinned(&works_dir(), &slug, pinned).map_err(err)
}

/// 작업 하나를 옮기고 새 목록 전체를 돌려준다 — 인자와 응답의 뜻은 코어 `move_work`에 있다.
#[tauri::command]
pub async fn move_work(
    slug: String,
    pinned: bool,
    before: Option<String>,
) -> CmdResult<Vec<WorkWithSpecTree>> {
    let works =
        atelier_core::move_work(&works_dir(), &slug, pinned, before.as_deref()).map_err(err)?;
    Ok(atelier_core::with_spec_trees(&data_root(), works))
}

/// 아카이브 보존소로 **옮긴다.** 워크트리는 정리되고 브랜치·spec·기록은 남는다.
/// 되돌리기가 없으므로 force도 없다 — 커밋 안 된 변경이 있으면 어느 파일인지 말하며 거부한다.
#[tauri::command]
pub async fn archive_work(slug: String) -> CmdResult<()> {
    atelier_core::archive_work(&works_dir(), &archive_dir(), &projects_dir(), &slug)
    .map(|_| ())
    .map_err(err)
}

/// 통째로 지운다. MCP 도구와 같이 force를 노출하지 않는다 (atelier_remove_work와 같은 계약).
#[tauri::command]
pub async fn remove_work(slug: String) -> CmdResult<()> {
    atelier_core::remove_work(&works_dir(), &slug, false).map_err(err)
}

#[tauri::command]
pub async fn read_spec_file(slug: String, path: String) -> CmdResult<String> {
    atelier_core::read_spec_file(&works_dir(), &slug, &path).map_err(err)
}

/// 워크트리 하나의 트리(git-integration 판 01 — files 칸). 워크트리가 없거나 git이 실패한 것은 답의 갈래다(코어 머리말).
/// git을 두세 번 기다리므로(`ls-files` 둘, 걸린 폴더가 있으면 빠른 길을 배우는 `check-ignore` 하나 더) work 목록처럼 blocking
/// 풀에서 돈다 — 칸이 보일 때만 오지만, 큰 워크트리에서는 그 기다림이 수십 ms다.
#[tauri::command]
pub async fn list_worktree_tree(slug: String, project: String) -> CmdResult<WorktreeTree> {
    tauri::async_runtime::spawn_blocking(move || {
        atelier_core::list_worktree_tree(&works_dir(), &slug, &project).map_err(err)
    })
    .await
    .map_err(|e| format!("워크트리 트리를 읽지 못했습니다: {e}"))?
}

/// gitignore에 걸린 폴더 하나의 바로 아래(git-integration 판 01 — files 칸에서 그 폴더를 펼칠 때). 답은 트리 목록과 같은
/// 갈래다(코어 머리말). `..` · 절대 경로는 명령 실패다. 디스크를 한 겹 읽으므로 트리 목록처럼 blocking 풀에서 돈다 —
/// `node_modules/` 바로 아래는 수백 개다.
#[tauri::command]
pub async fn list_worktree_folder(slug: String, project: String, path: String) -> CmdResult<WorktreeTree> {
    tauri::async_runtime::spawn_blocking(move || {
        atelier_core::list_worktree_folder(&works_dir(), &slug, &project, &path).map_err(err)
    })
    .await
    .map_err(|e| format!("워크트리 폴더를 읽지 못했습니다: {e}"))?
}

/// 아카이브 목록. **경량이다** — spec 파일 목록도 워크트리도 담지 않는다.
/// 아카이브는 쌓이기만 하므로 목록 조회가 무거워지면 갈수록 나빠진다.
#[tauri::command]
pub async fn list_archive() -> CmdResult<Vec<ArchiveEntry>> {
    atelier_core::list_archive(&archive_dir()).map_err(err)
}

/// 아카이브된 work가 가진 문서 경로들과, 그중 `spec/` 아래를 가른 spec 트리. 상세 화면의
/// 머리말(제목·상태·언제 치웠는지)은 목록이 이미 들고 있으므로 단건 조회를 따로 두지 않는다.
///
/// 트리는 work 쪽 셋과 같이 코어의 입구(`with_archived_spec_tree`)가 싣는다 — L4 다리도 같은
/// 입구를 부른다. 목록과 트리가 한 응답이라 화면이 기다릴 쿼리가 늘지 않는다.
#[tauri::command]
pub async fn list_archived_docs(slug: String) -> CmdResult<ArchivedDocs> {
    let docs = atelier_core::list_archived_docs(&archive_dir(), &slug).map_err(err)?;
    Ok(atelier_core::with_archived_spec_tree(&data_root(), docs))
}

/// 아카이브된 work의 문서 하나. 경로는 **work 루트 기준**이다 (`record.md`, `spec/overview.md`) —
/// 기록이 spec 밖에 있어서, 화면이 둘을 한 트리로 보여주려면 창구가 하나여야 한다.
#[tauri::command]
pub async fn read_archived_file(slug: String, path: String) -> CmdResult<String> {
    atelier_core::read_work_file(&archive_dir(), &slug, &path).map_err(err)
}

/// 워크트리 파일 하나(git-integration 판 01 — 파일 탭의 본문). 없음 · 워크트리 없음 · 바깥 링크 · 읽지 못함은 답의 갈래다(코어 머리말).
/// 디스크를 읽고 실제 경로를 푸므로 work 목록처럼 blocking 풀에서 돈다.
#[tauri::command]
pub async fn read_worktree_file(
    slug: String,
    project: String,
    path: String,
) -> CmdResult<atelier_core::WorktreeFile> {
    tauri::async_runtime::spawn_blocking(move || {
        atelier_core::read_worktree_file(&works_dir(), &slug, &project, &path).map_err(err)
    })
    .await
    .map_err(|e| format!("워크트리 파일을 읽지 못했습니다: {e}"))?
}

// Work 카드의 자료(v1 구현 스펙 §12 · 티켓 33) — 변경 · 한 파일 diff · PR. 본체는 코어에 있고 여기는 위임만 한다. 모두 git이나
// `gh`를 기다리므로 blocking 풀에서 돈다. worktree가 없거나 · base를 모르거나 · `gh`가 없는 것은 답의 갈래다(코어 머리말).

/// Work의 변경(S23) — Project마다 base 대비 바뀐 파일과 +/−, 커밋한 것과 작업 중인 것을 합친다. Work 카드가 열릴 때와
/// `worktree:changed`마다 다시 읽는다.
#[tauri::command]
pub async fn list_work_changes(slug: String) -> CmdResult<Vec<atelier_core::ProjectChanges>> {
    tauri::async_runtime::spawn_blocking(move || {
        atelier_core::list_work_changes(&works_dir(), &projects_dir(), &slug).map_err(err)
    })
    .await
    .map_err(|e| format!("Work의 변경을 읽지 못했습니다: {e}"))?
}

/// 변경 하나의 diff(S23) — 넓힌 카드의 diff 보기가 받는 unified patch다. `..` · 절대 경로는 명령 실패다.
#[tauri::command]
pub async fn read_work_diff(slug: String, project: String, path: String) -> CmdResult<atelier_core::FileDiff> {
    tauri::async_runtime::spawn_blocking(move || {
        atelier_core::read_work_diff(&works_dir(), &projects_dir(), &slug, &project, &path).map_err(err)
    })
    .await
    .map_err(|e| format!("diff를 읽지 못했습니다: {e}"))?
}

/// Work의 PR(S24) — Project마다 Work 브랜치의 PR을 `gh`로 읽는다. Work 카드가 열릴 때와 열린 동안 60초마다 부른다. **Thread 엔진이
/// 읽는다**(v1 티켓 36) — 처음 보인 PR과 상태 변화를 그 Work의 Thread에 `pr` 줄로 남기는 것이 엔진이라, 카드의 읽기도 그 셈에 든다.
/// `gh`는 엔진이 쥔 로그인 셸의 PATH로 찾는다 — Finder에서 띄운 앱의 PATH로는 Homebrew의 `gh`가 안 보인다. 엔진으로 가는 명령이라
/// 이름이 `thread_`로 시작하고 다리는 거절한다(코드-지도 §2, 코드 리뷰 1차 B10).
#[tauri::command]
pub async fn thread_work_prs(
    engine: tauri::State<'_, Arc<atelier_acp::ConversationHost>>,
    slug: String,
) -> CmdResult<Vec<atelier_core::ProjectPr>> {
    to_host(&engine, "PR을 읽지 못했습니다", move |host| host.read_work_prs(&slug)).await
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
#[tauri::command]
pub async fn search(query: String, destinations: Vec<Destination>) -> CmdResult<SearchResults> {
    // **데이터 루트 하나만 넘긴다** — 층별 폴더는 코어가 파생한다(`paths.rs`). 넷을 따로
    // 넘기던 때는 「반드시 코어의 것을 넘겨라」가 여기 주석으로만 서 있었고, 어긋나도
    // 컴파일이 안 잡았다. 여기서 `~/.atelier`를 박으면 `ATELIER_HOME` 오버라이드가 이
    // 자리에서만 죽는 것은 그대로다.
    atelier_core::search(&data_root(), &query, &destinations).map_err(err)
}

/// 그 work 화면이 **떠 있게 됐다**(팔레트 결정 12·14). 이력 맨 앞으로 옮긴다.
///
/// **세는 단위는 work이다** — 문서를 안 열고 터미널만 돌려도 「열었다」이고, 팔레트로 갔든
/// 사이드바로 갔든 주소를 쳤든 같다. 「어느 문으로 들어왔나」로 예외를 만들면 그 예외가 곧
/// 「왜 얘가 위에 없지」가 된다.
#[tauri::command]
pub async fn touch_recent_work(slug: String) -> CmdResult<()> {
    atelier_core::touch_recent_work(&data_root(), &slug).map_err(err)
}

// Agent 정의(v1 구현 스펙 §6 · §18) — @ 메뉴와 Library 화면이 읽는다. 범위 · 고르기 규칙은 전부 코어에 있고 여기는 넘기기만 한다
// (L4 다리도 같은 입구를 부른다). `work`가 없으면 Library만, 있으면 그 Work의 Project들까지가 범위다.

/// 범위 안의 Agent — 부를 수 있는 것과 깨진 것(까닭과 함께). Library와 Project마다 폴더를 읽고 파일을 하나씩 읽으므로 work
/// 목록처럼 blocking 풀에서 돈다.
#[tauri::command]
pub async fn list_agents(work: Option<String>) -> CmdResult<atelier_core::AgentRoster> {
    tauri::async_runtime::spawn_blocking(move || atelier_core::find_agents(&data_root(), work.as_deref()).map_err(err))
        .await
        .map_err(|e| format!("Agent 목록을 읽지 못했습니다: {e}"))?
}

/// 범위 안 Agent 파일 하나의 원문 — 부르는 이름(`reviewer` · `api-server/reviewer`)으로 고른다. 깨진 파일도 준다(무엇이
/// 틀렸는지 보게). 범위를 다시 찾아 고르므로 목록처럼 blocking 풀에서 돈다.
#[tauri::command]
pub async fn read_agent_file(work: Option<String>, call: String) -> CmdResult<String> {
    tauri::async_runtime::spawn_blocking(move || {
        atelier_core::read_agent_file(&data_root(), work.as_deref(), &call).map_err(err)
    })
    .await
    .map_err(|e| format!("Agent 파일을 읽지 못했습니다: {e}"))?
}

/// Library 화면의 「Finder에서 열기」(v1 티켓 19 · 구현 스펙 §16) — 그 Agent 파일을 Finder에서 골라 보인다. 고치는 길의 하나가 외부
/// 편집기라서 폴더가 아니라 파일 자리다. 경로를 받지 않고 부르는 이름으로 범위 안에서 푼다(`read_agent_file`과 같은 까닭). 푸는 일은
/// 범위를 다시 찾으므로 blocking 풀에서 돈다.
#[tauri::command]
pub async fn reveal_agent_file(app: tauri::AppHandle, work: Option<String>, call: String) -> CmdResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let path = tauri::async_runtime::spawn_blocking(move || {
        atelier_core::agent_file_path(&data_root(), work.as_deref(), &call).map_err(err)
    })
    .await
    .map_err(|e| format!("Agent 파일을 찾지 못했습니다: {e}"))??;
    app.opener().reveal_item_in_dir(path).map_err(|e| e.to_string())
}

/// 입력창의 첨부 칩(v1 티켓 06 · 구현 스펙 S30) — `+`로 고르거나 끌어다 놓은 경로를 첨부로 잰다(크기 · 폴더인가). 내용은 읽지
/// 않는다. 보낼 때 엔진이 같은 입구로 다시 재서 `sent` 줄에 남긴다. 디스크를 보므로 blocking 풀에서 돈다.
#[tauri::command]
pub async fn describe_attachments(paths: Vec<String>) -> CmdResult<Vec<atelier_core::Attachment>> {
    tauri::async_runtime::spawn_blocking(move || atelier_core::describe_attachments(&paths).map_err(err))
        .await
        .map_err(|e| format!("첨부를 읽지 못했습니다: {e}"))?
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

/// Finder 열기 둘(아래 `open_work_folder` · `open_archived_spec_folder`)의 거절 문장. **사라진 폴더는 화면 말로 어느 폴더인지
/// 말한다**(codex-ds 스펙 §6 「지금처럼 오류 문장」 · §11 「화면 말: 해요체」) — 화면이 이 문장을 「Finder에서 열지 못했어요: 」
/// 뒤에 그대로 붙여 토스트로 세운다. 손으로 지운 worktree가 이 길이다. 코어의 문장(`folder does not exist: …`)은 CLI · MCP도
/// 쓰는 영어라 여기서 갈아 끼운다(`open_project_folder`가 제 문장을 여기서 짓는 것과 같은 자리). 그 밖의 거절(모르는 work ·
/// work에 없는 프로젝트)은 메뉴가 내지 않는 길이라 코어의 문장 그대로다.
fn folder_err(e: atelier_core::Error) -> String {
    match e {
        atelier_core::Error::FolderMissing(folder) => format!("{folder} 폴더가 없어요"),
        other => err(other),
    }
}

/// work 메뉴의 「Finder에서 열기」(codex-ds 스펙 S6) — `project`가 없으면 spec 폴더, 있으면 그 프로젝트의 worktree다.
/// `open_project_folder`와 같은 모양이다: 화면은 slug(와 프로젝트)만 넘기고 경로는 코어가 푼다(`work_folder`). 폴더가
/// 없으면 어느 폴더인지 말하는 문장으로 거절한다(`folder_err`).
#[tauri::command]
pub async fn open_work_folder(
    app: tauri::AppHandle,
    slug: String,
    project: Option<String>,
) -> CmdResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let folder = atelier_core::work_folder(&works_dir(), &slug, project.as_deref()).map_err(folder_err)?;
    app.opener()
        .open_path(folder.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// 아카이브된 work의 spec 폴더를 연다 — `open_work_folder`와 한 가족이고 뿌리만 보존소다(`archived_spec_folder`).
#[tauri::command]
pub async fn open_archived_spec_folder(app: tauri::AppHandle, slug: String) -> CmdResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let folder = atelier_core::archived_spec_folder(&archive_dir(), &slug).map_err(folder_err)?;
    app.opener()
        .open_path(folder.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

// PTY 명령 일곱. 본체는 `pty.rs`에 있고 여기는 위임만 한다 — 이 파일에 `pub async fn`으로
// 있는 것 자체가 배선 테스트의 조건이다.

#[tauri::command]
pub async fn pty_spawn(
    pool: tauri::State<'_, Arc<pty::PtyPool>>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    on_frame: tauri::ipc::Channel<tauri::ipc::InvokeResponseBody>,
) -> CmdResult<pty::PtySpawned> {
    pty::spawn(&pool, cwd, cols, rows, on_frame)
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
#[tauri::command]
pub async fn processes_snapshot(
    processes: tauri::State<'_, Arc<ProcessService>>,
) -> CmdResult<crate::processes::screen::ScreenSnapshot> {
    let processes = Arc::clone(&processes);
    tauri::async_runtime::spawn_blocking(move || processes.screen())
        .await
        .map_err(|e| format!("프로세스 스냅샷을 찍지 못했습니다: {e}"))
}

// nav 메타의 요약 — 앱 전체 메모리 합계, 출처 불명의 신원, `●`를 켜는 기록의 머리 id(프로세스 결정 11 · 티켓 29). 모든
// 화면에 선 nav 메타가 10초마다 부른다(`src/features/processes/hooks.ts`). 답은 Rust의 배경 표본이 10초마다 앉힌 마지막 장이다 —
// 부를 때마다 표를 찍지 않는다. 첫 장이 아직 없으면 그 자리에서 모으므로(표 한 장과 판정) blocking 풀에서 돌린다.
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
// 루트는 `data_root()`가 정한다 — 여기서 `~/.atelier`를 다시 계산하면
// `ATELIER_HOME` 오버라이드가 이 자리에서만 죽는다.

#[tauri::command]
pub async fn read_settings() -> CmdResult<crate::settings::Settings> {
    crate::settings::read(&data_root())
}

/// **읽은 것을 통째로 되돌려 받는다.** 그래야 우리가 모르는 키가 파일에 남는다 —
/// `update_work_title`이 work를 읽어 한 필드만 바꿔 되쓰는 것과 같은 왕복이고, 여기서는
/// 그 왕복이 IPC 경계를 건넌다.
#[tauri::command]
pub async fn write_settings(settings: crate::settings::Settings) -> CmdResult<()> {
    crate::settings::write(&data_root(), &settings)
}

/// 사람 메뉴에 서는 이름(v1 구현 스펙 S27 · 티켓 07) — 이 컴퓨터 계정의 전체 이름(macOS 「사용자 및 그룹」의 이름 — passwd의 GECOS
/// 첫 칸)이고, 비었으면 로그인 이름이다. 둘 다 없으면 `None`이고 화면이 「나」로 선다. 앱이 이름을 따로 묻거나 적어 두지 않는다 —
/// 이 컴퓨터를 쓰는 사람이 곧 그 계정이다.
#[tauri::command]
pub async fn person_name() -> CmdResult<Option<String>> {
    Ok(display_name(account_full_name().as_deref(), std::env::var("USER").ok().as_deref()))
}

/// 이름을 고르는 규칙 — GECOS는 쉼표로 칸을 가른다(전체 이름 · 방 · 전화 …). 첫 칸이 비면 로그인 이름이다.
fn display_name(gecos: Option<&str>, login: Option<&str>) -> Option<String> {
    let full = gecos.and_then(|gecos| gecos.split(',').next()).map(str::trim).filter(|name| !name.is_empty());
    full.or_else(|| login.map(str::trim).filter(|name| !name.is_empty())).map(str::to_owned)
}

/// 지금 계정의 GECOS 칸. `getpwuid_r`은 부른 쪽의 버퍼에 쓰므로 다른 스레드의 조회와 엇갈리지 않는다.
fn account_full_name() -> Option<String> {
    let mut entry: libc::passwd = unsafe { std::mem::zeroed() };
    let mut buffer = vec![0 as libc::c_char; 4096];
    let mut found: *mut libc::passwd = std::ptr::null_mut();
    // SAFETY: 버퍼와 그 길이를 함께 넘기고, 돌아온 포인터는 그 버퍼 안을 가리킨다 — 이 함수 안에서만 읽는다.
    let status =
        unsafe { libc::getpwuid_r(libc::getuid(), &mut entry, buffer.as_mut_ptr(), buffer.len(), &mut found) };
    if status != 0 || found.is_null() || entry.pw_gecos.is_null() {
        return None;
    }
    // SAFETY: 위에서 널이 아님을 봤고, 글자는 위 버퍼 안의 NUL로 끝나는 C 문자열이다.
    Some(unsafe { std::ffi::CStr::from_ptr(entry.pw_gecos) }.to_string_lossy().into_owned())
}

/// 예외 목록의 기본값(프로세스 결정 5 · 프로세스 스펙 S7). 설정의 `terminal.processExceptions`가 `null`일 때 판정이
/// 쓰는 목록이고, 설정 › 터미널이 그 칸에 보여 준다. **값을 정하는 자리는 Rust 상수 하나다** — 판정이 화면 없이
/// 쓰기 때문이다. 화면이 따로 적으면 한쪽이 조용히 낡는다.
#[tauri::command]
pub async fn default_process_exceptions() -> CmdResult<Vec<String>> {
    Ok(crate::processes::exceptions::defaults())
}

// 에이전트 훅 설치 셋 (#207 · 구현 결정 8). 본체는 `hooks.rs`에 있고 여기는 위임만 한다 —
// 설정 셋과 같은 규칙이다.
//
// **홈이 둘이다.** 훅 처리기가 사는 곳은 `data_root()`(테스트가
// `ATELIER_HOME`으로 옮기는 우리 폴더)이고, 고쳐야 할 설정이 사는 곳은 **진짜 홈**이다
// (`hooks::agent_home` — 그 까닭도 거기 있다).

/// 사용자의 설정에 적어 넣을 훅 처리기의 경로 — 새 처리기다(티켓 21). 옛 python 처리기의 줄은 설치가 이것으로 갈아 끼운다.
fn hook_handler() -> PathBuf {
    crate::shells::handler_path(&data_root())
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
    crate::shells::write_hook_scripts(&data_root())?;
    Ok(crate::hooks::install(&crate::hooks::agent_home(), &hook_handler()))
}

/// 두 설정에서 우리 항목만 걷는다 — 옛 이름의 줄도 새 이름의 줄도. **처리기 파일은 남긴다** — 남아도 무해하고, 지우면
/// 아직 살아 있는 셸의 훅이 그 순간부터 없는 파일을 부른다.
#[tauri::command]
pub async fn uninstall_agent_hooks() -> CmdResult<Vec<crate::hooks::HookStatus>> {
    Ok(crate::hooks::uninstall(&crate::hooks::agent_home(), &hook_handler()))
}

// spec 레이아웃(spec 레이아웃 구현 스펙 3절). 규칙은 전부 코어의 레이아웃 저장소에 있고 여기는 그것을
// 부르기만 한다 — L4 다리도 같은 입구를 부른다. 레이아웃은 데이터 루트 아래의 고정
// 경로에 산다(`layouts/atelier/`). 레이아웃은 하나라 어느 것인지 묻는 인자가 없다(ui-refresh 결정 23).

/// 레이아웃의 상태 — 설정의 「spec 레이아웃」 페이지가 그린다. 아무것도 쓰지 않는다.
#[tauri::command]
pub async fn spec_layout_state() -> CmdResult<atelier_core::LayoutState> {
    Ok(atelier_core::layout_state(&data_root()))
}

/// 레이아웃을 기본값으로 되돌린다 — 레이아웃 폴더를 지운다(spec 레이아웃 결정 7). 깨진 폴더도 지운다.
/// 확인은 화면이 먼저 묻는다. 에이전트에게는 이 길이 없다(spec 레이아웃 결정 21).
#[tauri::command]
pub async fn revert_spec_layout() -> CmdResult<()> {
    atelier_core::revert_layout(&data_root()).map_err(err)
}

/// 편집기가 여는 레이아웃 — 디스크 형식 그대로의 레이아웃과 템플릿 본문, 경고. 깨졌으면 오류와
/// 원문이다(편집기는 그때 편집 UI를 세우지 않는다). 아무것도 쓰지 않는다.
#[tauri::command]
pub async fn read_spec_layout() -> CmdResult<atelier_core::LayoutRead> {
    Ok(atelier_core::read_layout(&data_root()))
}

/// 편집기의 저장. 템플릿은 늘 전부 받는다. **검증이 거절하면 거절이 아니라 답이다** — 위치가 붙은
/// 오류가 성공 응답의 데이터(`{ errors }`)로 가고 아무것도 쓰지 않는다. 명령이 거절하는 것은 쓰다가
/// 실패한 것(IO)뿐이다. `layout`은 값으로 받는다 — 구조체로 받으면 모르는 키가 역직렬화에서 떨어진다.
#[tauri::command]
pub async fn write_spec_layout(
    layout: serde_json::Value,
    templates: std::collections::BTreeMap<String, String>,
) -> CmdResult<atelier_core::SaveOutcome> {
    atelier_core::save_layout(&data_root(), layout, &templates).map_err(err)
}

/// 편집기의 미리보기(티켓 14) — 저장하지 않은 초안을 저장하면 에이전트가 받을 안내문과 그 안의 항목의 줄,
/// 검증 오류, 경고. 편집기는 초안이 바뀔 때마다 부른다 — 팝업을 닫은 동안에도 오류가 서고 저장이 잠긴다.
/// 오류의 모양은 저장(`write_spec_layout`)과 같다. **디스크에 쓰지 않는다.** 규칙은 코어의 미리보기 함수에
/// 있다 — 여기에 두면 L4 다리가 같은 규칙을 한 벌 더 가진다.
#[tauri::command]
pub async fn render_spec_layout(
    layout: serde_json::Value,
    templates: std::collections::BTreeMap<String, String>,
) -> CmdResult<atelier_core::LayoutPreview> {
    Ok(atelier_core::preview_layout(&data_root(), layout, &templates))
}

/// 사람이 종료 확인에서 「종료」를 골랐다(결정 14·15). **「확인됨」을 먼저 세우고** 끈다 — 끄는
/// 사이에 끼어드는 #224의 `terminate:` 훅이 다시 막고 묻지 않게. 셸 정리는 여기서 하지 않는다:
/// `app.exit`가 부르는 `RunEvent::Exit`의 `pty::end_for_exit`가 그대로 돈다(`lib.rs`).
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
#[tauri::command]
pub async fn startup_report(
    holder: tauri::State<'_, Arc<crate::startup::ReportHolder>>,
) -> CmdResult<crate::startup::StartupReport> {
    let holder = Arc::clone(&holder);
    tauri::async_runtime::spawn_blocking(move || holder.answer())
        .await
        .map_err(|e| format!("시작 보고를 읽지 못했습니다: {e}"))
}

// ── Thread 명령(v1 티켓 04 · 구현 스펙 §18) ──────────────────────────────────────────────────────────────────────
//
// 본체는 Thread 엔진(`atelier_acp::ConversationHost`)에 있고 여기는 위임만 한다. 앱이 빌더 앞에서 세워 건 엔진 하나를 `State`로
// 찾는다(`lib.rs`). 명령의 목록과 뜻은 명령마다의 `///`와 `generate_handler!`가 정본이다 — 여기는 규칙만 적는다.
//
// - 명령은 이름 · 인자 · 위임 한 줄이다. 엔진에는 `to_host` 한 길로만 간다 — 어느 부름이 막히는지 명령이 고르지 않는다.
// - 턴은 기다리지 않는다 — 보내기 · 멈추기 · 지금 전하기 · 권한 답은 말이나 멈춤이나 답을 보내고 돌아온다. 열쇠는 Thread id이고,
//   답과 턴 끝은 `thread::RECORD_EVENT`로, 대기 줄은 `thread::QUEUE_EVENT`로, 목록 요약은 `thread::LIST_EVENT`로 온다.
// - 엔진의 오류는 화면에 그대로 보일 글이다(`HostError`의 Display).
// - 다리로 탈 수 없다(`in_app_only`) — 엔진은 오래 사는 Agent를 쥐는데 다리는 부를 때마다 뜨고 끝나는 CLI다.
// - v1은 Claude Code만 띄우므로(S3) 엔진을 고르는 인자가 없다. three-axes의 Work 안 대화창(`chat_*`)은 v1 티켓 08이 걷었다.

/// Thread 엔진으로 가는 한 길 — `thread_` 명령은 모두 이것으로 엔진을 부른다.
///
/// - 부름은 늘 blocking 풀에서 기다린다. 어느 엔진 부름이 막히는지(로그인 셸 · Session 열기 · 끄기 · Session 잠금 ·
///   되살리기)는 엔진 안의 일이라 명령마다 고르지 않는다 — 엔진이 막힘을 바꿔도 여기는 그대로다.
/// - 오류는 화면에 그대로 보일 글 한 갈래다. 엔진의 오류는 그 Display 그대로이고, 답만 있는 부름은 `Ok::<_, Infallible>`로
///   싸서 든다. 부름이 쓰러져(패닉) 답이 없으면 `failed`(무엇을 못 했나)가 앞에 선다.
async fn to_host<T, E>(
    engine: &Arc<atelier_acp::ConversationHost>,
    failed: &'static str,
    call: impl FnOnce(Arc<atelier_acp::ConversationHost>) -> Result<T, E> + Send + 'static,
) -> CmdResult<T>
where
    T: Send + 'static,
    E: std::fmt::Display + Send + 'static,
{
    let host = Arc::clone(engine);
    tauri::async_runtime::spawn_blocking(move || call(host))
        .await
        .map_err(|e| format!("{failed}: {e}"))?
        .map_err(|e| e.to_string())
}

/// Claude Code를 로그인 셸의 PATH에서 찾고 로그인돼 있는지 묻는다. `reread`는 안내 카드의 「다시 확인」이다.
#[tauri::command]
pub async fn thread_check_engine(
    engine: tauri::State<'_, Arc<atelier_acp::ConversationHost>>,
    reread: bool,
) -> CmdResult<atelier_acp::EngineCheck> {
    to_host(&engine, "Claude Code를 확인하지 못했습니다", move |host| host.check_engine(atelier_acp::Agent::Claude, reread)).await
}

/// Claude Code의 로그인 명령을 띄운다. 진행과 끝은 엔진 상태 이벤트(`thread::ENGINE_EVENT`)로 온다.
#[tauri::command]
pub async fn thread_start_login(engine: tauri::State<'_, Arc<atelier_acp::ConversationHost>>) -> CmdResult<()> {
    to_host(&engine, "로그인을 시작하지 못했습니다", |host| host.start_login(atelier_acp::Agent::Claude)).await
}

/// 도는 로그인 명령을 거둔다.
#[tauri::command]
pub async fn thread_cancel_login(engine: tauri::State<'_, Arc<atelier_acp::ConversationHost>>) -> CmdResult<()> {
    to_host(&engine, "로그인을 취소하지 못했습니다", |host| {
        host.cancel_login(atelier_acp::Agent::Claude);
        Ok::<_, Infallible>(())
    })
    .await
}

/// 앱 종료 확인 창의 셈(S40 · three-axes 티켓 23) — 앱 전체에서 턴이 도는 Session · 대기 중인 말 · 답하지 않은 승인. 대기 줄은
/// 엔진 메모리에만 있으므로 엔진이 센다. 메모리만 읽는다.
#[tauri::command]
pub async fn thread_quit_counts(
    engine: tauri::State<'_, Arc<atelier_acp::ConversationHost>>,
) -> CmdResult<atelier_acp::QuitCounts> {
    to_host(&engine, "Thread를 세지 못했습니다", |host| Ok::<_, Infallible>(host.quit_counts())).await
}

/// Thread 목록 — 모든 Thread의 요약, 새것부터. 엔진의 색인을 읽는다.
#[tauri::command]
pub async fn thread_list(
    engine: tauri::State<'_, Arc<atelier_acp::ConversationHost>>,
) -> CmdResult<Vec<atelier_core::ThreadSummary>> {
    to_host(&engine, "Thread 목록을 읽지 못했습니다", |host| host.list_threads()).await
}

/// Thread 하나의 지금 — `thread.json` · 기록의 끝 · 떠 있나 · 대기 줄. 다시 켠 뒤 · ⌘R 뒤 화면이 Thread를 열 때 읽는다.
#[tauri::command]
pub async fn thread_get(
    engine: tauri::State<'_, Arc<atelier_acp::ConversationHost>>,
    thread: String,
) -> CmdResult<atelier_acp::ThreadView> {
    to_host(&engine, "Thread를 읽지 못했습니다", move |host| host.thread(&thread)).await
}

/// 그 Thread의 기록에서 `after` 다음 seq의 줄들 — 화면은 이것으로 그리고, 그 뒤는 기록 줄 이벤트로 잇는다.
#[tauri::command]
pub async fn thread_read_record(
    engine: tauri::State<'_, Arc<atelier_acp::ConversationHost>>,
    thread: String,
    after: u64,
) -> CmdResult<Vec<atelier_acp::RecordLine>> {
    to_host(&engine, "Thread 기록을 읽지 못했습니다", move |host| host.read_thread_record(&thread, after)).await
}

/// 새 Thread의 첫 말 — 어디에 이을지(`link` — Work 없음 · 새 Work로 시작 · 이 Work)와 함께 받는다. Thread를 세우고 받는 Agent(첫
/// @멘션, 없으면 Host)가 들어와 답한다. 세운 Thread의 id를 돌려준다. Session이 열릴 때까지 기다린다. 멘션이 범위 밖 · 깨진
/// 파일이면 아무것도 세우지 않고 그 까닭이 오류 글이다. 첨부(`attachments` — 절대 경로들)는 본문 앞에 경로 목록으로 간다(S30).
/// 물어보는 정도(`mode` — `always` · `edits` · `plan` · `auto`)는 입력창 칩에서 고른 값이다(v1 티켓 23) — 이은 Work면 그 Work의 정도가
/// 된다. 첫 Session의 모델 · 생각 깊이(`model` · `effort`)도 첫 말 전에 칩에서 고른 값이다(v1 티켓 31 · 스토리 33). 고르지 않은 칸은
/// `null`이다.
#[tauri::command]
pub async fn thread_start(
    engine: tauri::State<'_, Arc<atelier_acp::ConversationHost>>,
    text: String,
    attachments: Vec<String>,
    link: atelier_acp::ThreadLink,
    mode: Option<atelier_acp::AskLevel>,
    model: Option<String>,
    effort: Option<String>,
) -> CmdResult<String> {
    let picks = atelier_acp::StartPicks { mode, model, effort };
    to_host(&engine, "Thread를 시작하지 못했습니다", move |host| host.start_thread_picking(&text, &attachments, link, picks)).await
}

/// 있는 Thread에 말한다 — 받는 이는 첫 @멘션의 Agent, 없으면 Host다(아직 참여자가 아니면 들어온다). 턴을 기다리지 않는다. 다시
/// 켠 뒤 · 죽은 뒤면 먼저 같은 Session으로 되살린다. 멘션이 범위 밖 · 깨진 파일 · 없는 첨부면 아무것도 적지 않고 그 까닭이 오류
/// 글이다. 첨부(`attachments` — 절대 경로들)는 본문 앞에 경로 목록으로 간다(S30). 인용(`quote` — 넓힌 카드의 문서에서 고른 글, v1 티켓
/// 35 · S41)은 이은 Work의 spec 폴더를 가리키는 인용 블록으로 본문 앞에 간다 — 올바르지 않으면 아무것도 적지 않는다.
#[tauri::command]
pub async fn thread_send(
    engine: tauri::State<'_, Arc<atelier_acp::ConversationHost>>,
    thread: String,
    text: String,
    attachments: Vec<String>,
    quote: Option<atelier_acp::Quote>,
) -> CmdResult<()> {
    to_host(&engine, "말을 보내지 못했습니다", move |host| {
        host.send_to_thread_quoting(&thread, &text, &attachments, quote.as_ref())
    })
    .await
}

/// 그 Thread의 도는 턴을 모두 멈춘다. 기다리지 않는다 — 멈춘 턴의 끝은 기록 줄로 온다.
#[tauri::command]
pub async fn thread_stop(engine: tauri::State<'_, Arc<atelier_acp::ConversationHost>>, thread: String) -> CmdResult<()> {
    to_host(&engine, "턴을 멈추지 못했습니다", move |host| host.stop_thread(&thread)).await
}

/// 대기 줄의 그 말(`queued` — 대기 id)의 글을 고친다.
#[tauri::command]
pub async fn thread_edit_queued(
    engine: tauri::State<'_, Arc<atelier_acp::ConversationHost>>,
    thread: String,
    queued: String,
    text: String,
) -> CmdResult<()> {
    to_host(&engine, "대기 중인 말을 고치지 못했습니다", move |host| host.edit_thread_queued(&thread, &queued, &text)).await
}

/// 대기 줄에서 그 말을 지운다.
#[tauri::command]
pub async fn thread_delete_queued(
    engine: tauri::State<'_, Arc<atelier_acp::ConversationHost>>,
    thread: String,
    queued: String,
) -> CmdResult<()> {
    to_host(&engine, "대기 중인 말을 지우지 못했습니다", move |host| host.delete_thread_queued(&thread, &queued)).await
}

/// 지금 전하기 — 그 말을 맨 앞에 세우고 도는 턴을 멈춘다. 턴이 `cancelled`로 끝나면 그 말이 먼저 간다.
#[tauri::command]
pub async fn thread_send_now(
    engine: tauri::State<'_, Arc<atelier_acp::ConversationHost>>,
    thread: String,
    queued: String,
) -> CmdResult<()> {
    to_host(&engine, "지금 전하지 못했습니다", move |host| host.send_thread_now(&thread, &queued)).await
}

/// 권한 답 — 그 참여자(`who` — `permission` 줄의 `who`)의 Session에 걸린 요청(`request`)에 고른 선택지(`option`)로 답한다. 승인
/// 카드(v1 티켓 24)의 「다시 묻지 않기」면 `remember`, 「아니요, 다르게 해 주세요」의 입력칸에 쓴 말이 있으면 `words`다.
#[tauri::command]
pub async fn thread_answer_permission(
    engine: tauri::State<'_, Arc<atelier_acp::ConversationHost>>,
    thread: String,
    who: String,
    request: String,
    option: String,
    remember: bool,
    words: Option<String>,
) -> CmdResult<()> {
    to_host(&engine, "권한 요청에 답하지 못했습니다", move |host| {
        host.reply_thread_permission(&thread, &who, &request, &atelier_acp::Reply { option, remember, words })
    })
    .await
}

/// Work 만들기 카드의 답(v1 티켓 30) — 서 있는 카드(`request` — `question` 줄의 `requestId`)에 「Work 만들기」(`create`, 카드에서 고친
/// Project들 · 브랜치)나 「Work 없이 계속」으로 답한다. 만들지 못하면 그 까닭으로 실패하고 카드는 그대로 서 있다.
#[tauri::command]
pub async fn thread_answer_work(
    engine: tauri::State<'_, Arc<atelier_acp::ConversationHost>>,
    thread: String,
    request: String,
    create: bool,
    projects: Vec<String>,
    branch: Option<String>,
) -> CmdResult<()> {
    let choice = if create {
        atelier_acp::WorkChoice::Create { projects, branch }
    } else {
        atelier_acp::WorkChoice::Continue
    };
    to_host(&engine, "Work 만들기 카드에 답하지 못했습니다", move |host| host.answer_work(&thread, &request, choice)).await
}

/// 질문 답(v1 티켓 26) — 그 참여자의 Session에 걸린 질문(`request` — `question` 줄의 요청 id)에 물음마다의 답(`answers`)으로
/// 답한다. 질문 카드의 「나중에」면 `later`이고 답은 비운다.
#[tauri::command]
pub async fn thread_answer_question(
    engine: tauri::State<'_, Arc<atelier_acp::ConversationHost>>,
    thread: String,
    who: String,
    request: String,
    answers: Vec<atelier_acp::QuestionAnswer>,
    later: bool,
) -> CmdResult<()> {
    to_host(&engine, "질문에 답하지 못했습니다", move |host| {
        let reply = if later { atelier_acp::QuestionReply::Later } else { atelier_acp::QuestionReply::Answer(answers) };
        host.answer_thread_question(&thread, &who, &request, &reply)
    })
    .await
}

/// Work 밖 Project 카드의 답(v1 티켓 32 · S22) — 서 있는 카드(`request` — `question` 줄의 `requestId`)에 「붙이고 고치기」(`attach`) ·
/// 「읽기만 하기」(`read`) · 「아니요」(`decline`)로 답한다. 붙이지 못하면 그 까닭으로 실패하고 카드는 그대로 서 있다.
#[tauri::command]
pub async fn thread_answer_project(
    engine: tauri::State<'_, Arc<atelier_acp::ConversationHost>>,
    thread: String,
    request: String,
    choice: String,
) -> CmdResult<()> {
    let choice = match choice.as_str() {
        "attach" => atelier_acp::ProjectChoice::Attach,
        "read" => atelier_acp::ProjectChoice::ReadOnly,
        "decline" => atelier_acp::ProjectChoice::Decline,
        other => return Err(format!("Work 밖 Project 카드에 답하지 못했습니다: 모르는 선택입니다 — {other}")),
    };
    to_host(&engine, "Work 밖 Project 카드에 답하지 못했습니다", move |host| host.answer_project(&thread, &request, choice)).await
}

/// 모델 바꾸기 — 그 참여자의 모델을 바꾼다. 떠 있으면 곧바로 넣고, 아니면 띄울 때 든다. 답은 바뀐 참여자 줄이다.
#[tauri::command]
pub async fn thread_set_model(
    engine: tauri::State<'_, Arc<atelier_acp::ConversationHost>>,
    thread: String,
    who: String,
    model: String,
) -> CmdResult<atelier_core::Participant> {
    to_host(&engine, "모델을 바꾸지 못했습니다", move |host| host.set_thread_model(&thread, &who, &model)).await
}

/// 생각 깊이 바꾸기(v1 티켓 05 · 스토리 33) — claude `--effort`의 값 하나. 쉬는 Session은 같은 Session으로 다시 띄워 다음 턴부터
/// 들고, 떠 있지 않으면 띄울 때 든다. 턴이 도는 동안은 거절된다. 답은 바뀐 참여자 줄이다.
#[tauri::command]
pub async fn thread_set_effort(
    engine: tauri::State<'_, Arc<atelier_acp::ConversationHost>>,
    thread: String,
    who: String,
    effort: String,
) -> CmdResult<atelier_core::Participant> {
    to_host(&engine, "생각 깊이를 바꾸지 못했습니다", move |host| host.set_thread_effort(&thread, &who, &effort)).await
}

/// 물어보는 정도 바꾸기(v1 티켓 23 · S18) — 입력창 아래 칩 · `/plan` · `/policy`. Work에 이은 Thread면 그 Work의 정도다. 판정은 다음
/// 요청부터 따르고, 「계획만」으로 들고 나면 그 정도를 쓰는 떠 있는 Session의 계획 모드도 바뀐다. 바꾼 것은 `mode` 줄로 남는다.
#[tauri::command]
pub async fn thread_set_mode(
    engine: tauri::State<'_, Arc<atelier_acp::ConversationHost>>,
    thread: String,
    mode: atelier_acp::AskLevel,
) -> CmdResult<()> {
    to_host(&engine, "물어보는 정도를 바꾸지 못했습니다", move |host| host.set_thread_mode(&thread, mode)).await
}

/// Thread의 Space 붙이기 · 바꾸기 · 빼기(`space` 없음, 03 티켓 05) — Work에 이은 Thread면 그 Work의 Space가 바뀐다(§9). 떠 있는 Session은
/// 그대로 두고 다음 말부터 새 범위로 이어 연다. 바꾼 것은 Space 줄(`space`)로 남는다. 없는 Space는 그 까닭으로 거절된다.
#[tauri::command]
pub async fn thread_set_space(
    engine: tauri::State<'_, Arc<atelier_acp::ConversationHost>>,
    thread: String,
    space: Option<String>,
) -> CmdResult<()> {
    to_host(&engine, "Space를 바꾸지 못했습니다", move |host| host.set_thread_space(&thread, space.as_deref())).await
}

/// Work의 Space 붙이기 · 바꾸기 · 빼기 — Work 화면 머리의 Space 메뉴(03 티켓 05). 그 Work의 Thread마다 Space 줄이 선다(S9).
#[tauri::command]
pub async fn thread_set_work_space(
    engine: tauri::State<'_, Arc<atelier_acp::ConversationHost>>,
    work: String,
    space: Option<String>,
) -> CmdResult<()> {
    to_host(&engine, "Work의 Space를 바꾸지 못했습니다", move |host| host.set_work_space(&work, space.as_deref())).await
}

/// 그 Work의 지금 물어보는 정도(v1 티켓 31 · S18) — 새 Thread의 Work 칩에서 「최근 Work」를 고르면 물어보는 정도 칩이 이것을 보인다.
/// 읽기만 한다. 없는 Work는 그 까닭이 오류 글이다.
#[tauri::command]
pub async fn thread_work_mode(
    engine: tauri::State<'_, Arc<atelier_acp::ConversationHost>>,
    work: String,
) -> CmdResult<atelier_acp::AskLevel> {
    to_host(&engine, "Work의 물어보는 정도를 읽지 못했습니다", move |host| host.work_ask_level(&work)).await
}

/// 다시 맡기기(v1 티켓 17 · 구현 스펙 §8) — 호출 줄에서 사람이 `from`의 부르기를 같은 글(`text`)로 `to`에게 다시 한다. 기다리지
/// 않는다 — 부르기 · 결과(부른 Agent의 다음 말)는 기록 줄로 온다. 부를 수 없으면 그 까닭으로 거절된다.
#[tauri::command]
pub async fn thread_call_again(
    chats: tauri::State<'_, Arc<atelier_acp::ConversationHost>>,
    thread: String,
    from: String,
    to: String,
    text: String,
) -> CmdResult<()> {
    to_host(&chats, "다시 맡기지 못했습니다", move |host| host.call_again(&thread, &from, &to, &text)).await
}

/// 이름 바꾸기 — 위 막대에서 사람이 고친 이름(v1 티켓 05). `thread.json` · `title` 줄 · 목록 요약이 함께 바뀐다. 답은 바뀐 목록
/// 요약이다. 빈 이름은 거절된다.
#[tauri::command]
pub async fn thread_rename(
    engine: tauri::State<'_, Arc<atelier_acp::ConversationHost>>,
    thread: String,
    title: String,
) -> CmdResult<atelier_core::ThreadSummary> {
    to_host(&engine, "이름을 바꾸지 못했습니다", move |host| host.rename_thread(&thread, &title)).await
}

/// 읽은 자리 적기(v1 티켓 41 · S38) — Thread를 열고 맨 아래가 보일 때 화면이 끝 줄의 seq를 적는다. `thread.json`의 `lastRead`와 목록
/// 요약이 바뀐다(사이드바의 「새 결과」가 걷힌다). 뒤로 가지 않는다. 답은 목록 요약이다.
#[tauri::command]
pub async fn thread_mark_read(
    engine: tauri::State<'_, Arc<atelier_acp::ConversationHost>>,
    thread: String,
    seq: u64,
) -> CmdResult<atelier_core::ThreadSummary> {
    to_host(&engine, "읽은 자리를 적지 못했습니다", move |host| host.mark_thread_read(&thread, seq)).await
}

#[cfg(test)]
mod tests {
    /// 사람 메뉴의 이름(v1 티켓 07) — 계정의 전체 이름(GECOS의 첫 칸)이 먼저고, 비었으면 로그인 이름이다. 둘 다 비면 없다.
    #[test]
    fn 사람의_이름은_계정의_전체_이름이고_없으면_로그인_이름이다() {
        use super::display_name;
        assert_eq!(display_name(Some("홍길동,,,"), Some("gildong")).as_deref(), Some("홍길동"));
        assert_eq!(display_name(Some("  "), Some("gildong")).as_deref(), Some("gildong"));
        assert_eq!(display_name(None, Some("gildong")).as_deref(), Some("gildong"));
        assert_eq!(display_name(Some(""), Some("")), None);
        assert_eq!(display_name(None, None), None);
    }

    use std::convert::Infallible;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, RwLock};
    use std::time::{Duration, Instant};

    use super::to_host;

    /// Thread 엔진 하나 — 데이터 루트만 제 것이고, 셸 · 변환기는 띄울 일이 없다(이 시험들은 엔진 몸통을 타지 않는다).
    fn host(name: &str) -> Arc<atelier_acp::ConversationHost> {
        let root = std::env::temp_dir().join(format!("atelier-commands-{}-{name}", std::process::id()));
        let translator = atelier_acp::TranslatorCommand::new("", Vec::<String>::new());
        let shell = atelier_acp::ShellSource::Path("/bin/false".into());
        Arc::new(atelier_acp::ConversationHost::builder(root, translator, shell, |_| {}).build())
    }

    /// **엔진으로 가는 길은 기다리는 동안 async 워커를 쥐지 않는다**(프로세스 스펙 「가로지르는 규칙 › IPC」). 어느 엔진
    /// 부름이 막히는지(로그인 셸 · Session 열기 · Session 잠금 · 되살리기)는 엔진이 안다 — 명령이 고르지 않으므로 길이 모든
    /// 부름을 워커 밖에서 기다린다. 워커보다 많은 부름이 함께 기다려도 모두 돌고, 그동안 나란히 오는 async 일이 곧바로 돈다.
    #[test]
    fn host_calls_wait_without_holding_the_async_workers() {
        let host = host("off-workers");
        let callers = std::thread::available_parallelism().map_or(8, |n| n.get()) * 2 + 1;
        let gate = Arc::new(RwLock::new(()));
        let started = Arc::new(AtomicUsize::new(0));
        let closed = gate.write().expect("문을 쥔다");
        let calls: Vec<_> = (0..callers)
            .map(|_| {
                let (host, gate, started) = (Arc::clone(&host), Arc::clone(&gate), Arc::clone(&started));
                tauri::async_runtime::spawn(async move {
                    to_host(&host, "기다리지 못했습니다", move |_host| {
                        started.fetch_add(1, Ordering::SeqCst);
                        drop(gate.read());
                        Ok::<_, Infallible>(())
                    })
                    .await
                })
            })
            .collect();

        let deadline = Instant::now() + Duration::from_secs(10);
        while started.load(Ordering::SeqCst) < callers && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        let waiting = started.load(Ordering::SeqCst);
        let (pong_tx, pong_rx) = std::sync::mpsc::channel();
        tauri::async_runtime::spawn(async move {
            let _ = pong_tx.send(());
        });
        let pong = pong_rx.recv_timeout(Duration::from_secs(5));
        drop(closed);

        assert_eq!(waiting, callers, "호스트에서 기다리는 부름이 async 워커를 쥐었다 — {callers}개 가운데 {waiting}개만 돌았다");
        assert!(pong.is_ok(), "호스트에서 기다리는 동안 다른 async 일이 돌지 못했다");
        for call in calls {
            assert_eq!(tauri::async_runtime::block_on(call).expect("명령 task가 끝난다"), Ok(()));
        }
    }

    /// **길의 답은 호스트의 답 그대로이고, 오류는 화면에 보일 글 한 갈래다.** 호스트의 오류는 그 Display 그대로 간다 — 호스트가
    /// 화면 글로 짓는다(`HostError`). 부름이 쓰러져(패닉) 답이 없으면 명령이 넘긴 「무엇을 못 했나」 한 마디가 앞에 선다.
    #[test]
    fn the_host_answer_comes_back_as_is_and_a_fallen_call_says_what_failed() {
        let host = host("answers");
        let ask = |failed, call: fn(Arc<atelier_acp::ConversationHost>) -> Result<u32, &'static str>| {
            tauri::async_runtime::block_on(to_host(&host, failed, call))
        };

        assert_eq!(ask("세지 못했습니다", |_| Ok(3)), Ok(3));
        assert_eq!(
            ask("말을 보내지 못했습니다", |_| Err("그 Thread가 없습니다")),
            Err("그 Thread가 없습니다".to_owned()),
        );
        let fallen = ask("Claude Code를 확인하지 못했습니다", |_| panic!("호스트 부름이 쓰러졌다")).expect_err("쓰러진 부름은 오류다");
        assert!(fallen.starts_with("Claude Code를 확인하지 못했습니다: "), "무엇을 못 했는지가 앞에 서지 않는다: {fallen}");
    }

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
    /// - `list_worktree_tree`(git-integration 판 01): 워크트리 하나에 `git ls-files`를 두 번 기다리고, 걸린 폴더가 있으면(`target/` ·
    ///   `node_modules/` — 거의 모든 워크트리) 감시 경로 판정의 빠른 길을 배우는 `git check-ignore`를 한 번 더 기다린다.
    /// - `list_worktree_folder`(git-integration 판 01): 걸린 폴더 하나를 디스크에서 한 겹 읽는다 — `node_modules/` 바로 아래는
    ///   수백 개다.
    /// - `processes_snapshot`(티켓 26): 화면이 열려 있는 동안 2초마다 오고, 한 번에 이 맥의 프로세스 표 한 장과 판정이 든다(ms).
    /// - `processes_summary`(티켓 29): 답은 대개 배경 표본이 앉힌 장이지만, 첫 장이 아직 없으면(앱이 막 떴다) 그 자리에서 표 한 장과
    ///   판정을 모은다. 부를 때마다 표를 찍지는 않는다(`summarize`가 아니다).
    /// - `processes_end`(티켓 31): 정리 기록에 적을 이름을 떠 두려 신호 전에 표 한 장을 찍는다. 유예와 SIGKILL은 풀의 뒤 스레드가
    ///   돈다(`pty::end_by_hand`).
    /// - `read_worktree_file`(git-integration 판 01): 디스크에서 파일 하나를 읽고 실제 경로를 두 번 푼다 — 파일 탭이 보일 때만 오지만
    ///   큰 파일이면 그 읽기가 ms 단위다.
    /// - `list_agents` · `read_agent_file`(v1 티켓 11): Library와 Work의 Project마다 Agent 폴더를 읽고 파일을 하나씩 읽는다 — @ 메뉴가
    ///   열릴 때마다 온다.
    /// - `list_work_changes`(v1 티켓 33): Project마다 git을 세 번 기다린다(갈라진 커밋 · 증감 · 아직 모르는 파일). Work 카드가
    ///   worktree가 바뀔 때마다 부른다.
    /// - `read_work_diff`(v1 티켓 33): git을 두세 번 기다린다(diff · 아직 모르는 파일이면 그 diff).
    ///
    /// Thread 명령(`thread_work_prs`도 — v1 티켓 36, `gh`를 기다리고 `pr` 줄을 남기는 것이 엔진이다)은 여기 없다 — 어느 엔진 부름이
    /// 막히는지는 엔진이 알고, 엔진으로 가는 한 길(`to_host`)이 모든 부름을 blocking 풀에서 기다린다. 길은
    /// `host_calls_wait_without_holding_the_async_workers`가, 명령이 그 길만 타는 것은 `every_thread_command_goes_to_the_engine_by_the_one_path`
    /// 가 잰다.
    #[test]
    fn the_waiting_commands_wait_off_the_async_workers() {
        for (command, call, once) in [
            ("startup_report", "holder.answer()", "answer()"),
            ("list_works", "atelier_core::list_works(", "list_works("),
            ("list_worktree_tree", "atelier_core::list_worktree_tree(", "list_worktree_tree("),
            ("list_worktree_folder", "atelier_core::list_worktree_folder(", "list_worktree_folder("),
            ("processes_snapshot", "processes.screen()", ".screen("),
            ("processes_summary", "processes.summary()", ".summary("),
            ("processes_end", "pty::end_by_hand(", "pty::end_by_hand("),
            ("read_worktree_file", "atelier_core::read_worktree_file(", "read_worktree_file("),
            ("list_agents", "atelier_core::find_agents(", "find_agents("),
            ("read_agent_file", "atelier_core::read_agent_file(", "read_agent_file("),
            ("reveal_agent_file", "atelier_core::agent_file_path(", "agent_file_path("),
            ("describe_attachments", "atelier_core::describe_attachments(", "describe_attachments("),
            ("list_work_changes", "atelier_core::list_work_changes(", "list_work_changes("),
            ("read_work_diff", "atelier_core::read_work_diff(", "read_work_diff("),
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

    /// **Thread 명령은 엔진으로 가는 한 길만 탄다**(three-axes 티켓 05 · 10 · v1 티켓 04). 어느 엔진 부름이 막히는지는 엔진 안의
    /// 일이라 명령이 고르지 않는다 — 등록된 `thread_` 명령마다 몸통이 `to_host(`를 한 번 부르고, 엔진(`engine`)을 곧바로 부르거나
    /// blocking 풀을 따로 고르지 않는다. 길이 워커 밖에서 기다리는 것은 길의 시험이 잰다.
    ///
    /// three-axes의 `chat_` 명령은 v1 티켓 08이 걷었다 — 다시 등록되면 빨갛다.
    #[test]
    fn every_thread_command_goes_to_the_engine_by_the_one_path() {
        let registered_all: Vec<&str> = include_str!("lib.rs")
            .lines()
            .filter_map(|line| line.trim().strip_prefix("commands::")?.strip_suffix(','))
            .collect();
        assert!(
            !registered_all.iter().any(|name| name.starts_with("chat_")),
            "Work 안 대화창의 명령이 다시 등록됐다(v1 티켓 08)"
        );
        let engine = |name: &&str| name.starts_with("thread_");
        let registered: Vec<&str> = registered_all.into_iter().filter(engine).collect();
        let (commands, _) = include_str!("commands.rs").split_once("#[cfg(test)]\nmod tests").expect("시험 모듈이 있다");
        let defined: Vec<&str> = commands
            .split("pub async fn ")
            .skip(1)
            .filter_map(|rest| rest.split_once('(').map(|(name, _)| name))
            .filter(engine)
            .collect();
        assert!(!defined.is_empty(), "Thread 명령을 하나도 못 찾았다 — 검사가 헛돈다");
        assert_eq!(sorted(defined.clone()), sorted(registered), "commands.rs의 Thread 명령과 등록된 Thread 명령이 다르다");
        for command in defined {
            let body = command_body(command);
            assert_eq!(body.matches("to_host(").count(), 1, "{command}: 엔진으로 가는 길을 한 번 부르지 않는다");
            assert!(!body.contains("engine."), "{command}: 길을 거치지 않고 엔진을 곧바로 부른다");
            assert!(!body.contains("spawn_blocking("), "{command}: blocking 풀을 명령이 따로 고른다");
        }
    }

    fn sorted(mut names: Vec<&str>) -> Vec<&str> {
        names.sort_unstable();
        names
    }

    /// **Finder 열기의 사라진 폴더는 화면 말로 거절한다**(codex-ds 스펙 §6 「지금처럼 오류 문장」 · §11 「화면 말: 해요체」). 화면은 이
    /// 문장을 「Finder에서 열지 못했어요: 」 뒤에 그대로 붙이므로, 코어의 영어 문장(`folder does not exist: …`)이 건너가면 토스트가 반쯤
    /// 영어가 된다. 어느 폴더인지는 남는다 — 손으로 지운 worktree가 이 길이다. 두 명령(work · 아카이브)이 같은 거절을 탄다.
    #[test]
    fn a_missing_folder_is_refused_in_screen_words() {
        let missing = atelier_core::Error::FolderMissing("~/.atelier/works/카트/trees/fe".into());
        assert_eq!(super::folder_err(missing), "~/.atelier/works/카트/trees/fe 폴더가 없어요");
        // 메뉴가 내지 않는 거절(모르는 work · work에 없는 프로젝트)은 코어의 문장 그대로다.
        let unknown = atelier_core::Error::WorkNotFound("없는작업".into());
        assert_eq!(super::folder_err(unknown), "work not found: 없는작업");
        for command in ["open_work_folder", "open_archived_spec_folder"] {
            assert!(command_body(command).contains(".map_err(folder_err)?"), "{command}: Finder 열기의 거절 문장을 안 탄다");
        }
    }

    /// **추이 IPC는 배경 표본의 고리를 돌려줄 뿐이다**(티켓 30). 요약이 올 때마다 부르므로, 여기서 표를 찍거나 요약을 새로 모으면
    /// 화면이 열려 있는 동안 박자마다 표 한 장이 는다.
    #[test]
    fn the_trend_answers_the_ring_without_sampling() {
        let body = command_body("processes_trend");
        assert_eq!(body.matches("processes.trend()").count(), 1, "명령이 배경 표본의 고리를 안 읽는다");
        assert!(!body.contains(".summar") && !body.contains(".screen("), "추이 IPC가 부를 때마다 표를 찍는다");
    }
}
