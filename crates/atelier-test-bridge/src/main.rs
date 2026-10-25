//! L4 관통 테스트가 브라우저 밖으로 나가는 **다리**.
//!
//! 브라우저에서 `invoke("create_project", …)`가 불리면 Playwright가 그 호출을 Node로
//! 꺼내 이 바이너리를 부른다. 여기서 진짜 `atelier-core`·파일시스템·git을 탄다.
//! 데이터 루트는 `ATELIER_HOME`으로 임시 폴더에 묶여 있어 실제 `~/.atelier`는 안 건드린다.

use std::ffi::OsString;
use std::path::PathBuf;

use atelier_core::{archive_dir, data_root, projects_dir, works_dir, ProjectPatch};
use serde_json::{Map, Value};

/// 커맨드 하나가 받는 인자. Tauri와 같게 **snake_case로 정규화된 뒤** 들어온다.
type Args = Map<String, Value>;
type Handled = Result<Value, String>;
type Handler = fn(&Args) -> Handled;

/// 이 다리가 아는 커맨드. **이 표가 유일한 목록이다** — 이름 목록과 분기를 따로 두면
/// 둘이 어긋날 수 있고, 그 어긋남은 아무 신호도 내지 않는다.
///
/// 각 항목은 `src-tauri/src/commands.rs`의 같은 이름 함수와 짝이다. 그 함수들은
/// `#[tauri::command]`라 여기서 부를 수 없어(AppHandle·런타임이 필요하다) 코어를 직접
/// 부른다 — 그래서 **래퍼 자체는 이 층에서도 안 탄다**(D8이 인정한 사각지대).
const HANDLERS: &[(&str, Handler)] = &[
    ("list_projects", |_| ok(atelier_core::list_projects(&projects_dir()))),
    ("get_project", |a| ok(atelier_core::get_project(&projects_dir(), &text(a, "slug")?))),
    // 추가 창(03 구현 스펙 §15) — 살피기 · 추가 · 새로 만들 자리 · 새로 만들기가 모두 core 하나라 다리로 진짜를 탄다(L4가 진짜 git으로
    // 「git init 하고 추가」 · 「새로 만들기」를 잰다).
    ("inspect_project_folder", |a| {
        ok(Ok(atelier_core::inspect_folder(&projects_dir(), &PathBuf::from(text(a, "folder")?))))
    }),
    ("create_project", |a| {
        let add = atelier_core::AddProject { name: maybe_text(a, "name"), init_git: flag(a, "init_git")? };
        ok(atelier_core::add_project(&projects_dir(), &PathBuf::from(text(a, "folder")?), add))
    }),
    ("new_project_place", |a| {
        ok(Ok(atelier_core::new_project_place(&PathBuf::from(text(a, "parent")?), &text(a, "name")?)))
    }),
    ("new_project", |a| {
        ok(atelier_core::new_project(&projects_dir(), &PathBuf::from(text(a, "parent")?), &text(a, "name")?))
    }),
    ("update_project", |a| {
        ok(atelier_core::update_project(
            &projects_dir(),
            &text(a, "slug")?,
            ProjectPatch {
                name: maybe_text(a, "name"),
                description: maybe_text(a, "description"),
                base_branch: maybe_text(a, "base_branch"),
            },
        ))
    }),
    // 재설정(03 구현 스펙 §15) — 진짜 git이 「저장소의 뿌리인가」를 본다.
    ("relocate_project", |a| {
        ok(atelier_core::relocate_project(&projects_dir(), &text(a, "slug")?, &PathBuf::from(text(a, "folder")?)))
    }),
    // 제거 · 되돌리기(03 구현 스펙 §15) — 등록부 · Space · Work 파일을 함께 보니 데이터 루트를 넘긴다.
    ("project_usage", |a| ok(atelier_core::project_usage(&data_root(), &text(a, "slug")?))),
    ("remove_project", |a| ok(atelier_core::remove_project(&data_root(), &text(a, "slug")?))),
    ("restore_project", |a| ok(atelier_core::restore_project(&data_root(), &text(a, "slug")?))),
    ("open_project_folder", |_| in_app_only("탐색기를 여는 일이라 대응하는 코어 함수가 없습니다")),
    // Space(03 구현 스펙 §8)는 파일이라 코어를 진짜로 탄다 — `commands.rs`와 같은 입구다.
    ("list_spaces", |_| ok(atelier_core::list_spaces(&data_root()))),
    ("get_space", |a| ok(atelier_core::space_detail(&data_root(), &text(a, "slug")?))),
    ("update_space", |a| {
        ok(atelier_core::update_space(
            &data_root(),
            &text(a, "slug")?,
            atelier_core::SpacePatch {
                name: maybe_text(a, "name"),
                description: maybe_text(a, "description"),
                add: maybe_texts(a, "add")?,
                before: maybe_text(a, "before"),
                remove: maybe_texts(a, "remove")?,
            },
        ))
    }),
    ("read_space_text", |a| ok(atelier_core::read_space_text(&data_root(), &text(a, "slug")?))),
    ("check_space", |a| {
        ok(atelier_core::draft_space(&data_root(), maybe_text(a, "slug").as_deref(), &text(a, "text")?))
    }),
    ("save_space_text", |a| {
        ok(atelier_core::save_space_text(&data_root(), maybe_text(a, "slug").as_deref(), &text(a, "text")?))
    }),
    // 읽는 범위(03 구현 스펙 §7) — 읽기만 하는 core 입구다(`commands.rs`와 같다).
    // Space 지우기 확인 창의 쓰임(03 티켓 07) — 읽기만 하는 core 입구다.
    ("space_usage", |a| ok(atelier_core::space_usage(&data_root(), &text(a, "slug")?))),
    ("reading_scope", |a| {
        ok(atelier_core::reading_scope_of(
            &data_root(),
            maybe_text(a, "thread").as_deref(),
            maybe_text(a, "work").as_deref(),
            maybe_text(a, "space").as_deref(),
        ))
    }),
    // 목록·단건·옮기기는 spec 트리를 싣는다 — `commands.rs`와 같은 코어 입구(`with_spec_trees`)를
    // **진짜로** 탄다. 레이아웃은 데이터 루트 아래에 산다(`layouts/atelier/`).
    ("list_works", |_| {
        ok(atelier_core::list_works(&works_dir())
            .map(|works| atelier_core::with_spec_trees(&data_root(), works)))
    }),
    ("get_work", |a| {
        // 하나를 넣으면 하나가 나온다
        ok(atelier_core::get_work(&works_dir(), &text(a, "slug")?)
            .map(|work| atelier_core::with_spec_trees(&data_root(), vec![work]).remove(0)))
    }),
    ("set_work_title", |a| {
        ok(atelier_core::update_work_title(
            &works_dir(),
            &text(a, "slug")?,
            &text(a, "title")?,
        ))
    }),
    ("set_work_status", |a| {
        let status = text(a, "status")?.parse().map_err(err)?;
        ok(atelier_core::update_work_status(&works_dir(), &text(a, "slug")?, status))
    }),
    ("set_work_pinned", |a| {
        let pinned = flag(a, "pinned")?;
        ok(atelier_core::update_work_pinned(&works_dir(), &text(a, "slug")?, pinned))
    }),
    // `before`는 없어도 된다(= 목표 구획의 끝) — 프런트는 `null`로 싣고, 그것이 여기서 「없음」이다.
    ("move_work", |a| {
        let pinned = flag(a, "pinned")?;
        ok(atelier_core::move_work(
            &works_dir(),
            &text(a, "slug")?,
            pinned,
            maybe_text(a, "before").as_deref(),
        )
        .map(|works| atelier_core::with_spec_trees(&data_root(), works)))
    }),
    ("archive_work", |a| {
        ok(atelier_core::archive_work(&works_dir(), &archive_dir(), &projects_dir(), &text(a, "slug")?)
            .map(|_| ()))
    }),
    // commands.rs와 같이 force를 노출하지 않는다 — 커밋 안 된 변경이 있으면 거부한다.
    ("remove_work", |a| {
        ok(atelier_core::remove_work(&works_dir(), &text(a, "slug")?, false))
    }),
    ("read_spec_file", |a| {
        ok(atelier_core::read_spec_file(&works_dir(), &text(a, "slug")?, &text(a, "path")?))
    }),
    // 워크트리 읽기는 다른 읽기 명령과 같이 코어를 진짜로 탄다(git-integration 판 01 — 진짜 git이 판정한다).
    ("list_worktree_tree", |a| {
        ok(atelier_core::list_worktree_tree(&works_dir(), &text(a, "slug")?, &text(a, "project")?))
    }),
    ("list_worktree_folder", |a| {
        let (slug, project, path) = (text(a, "slug")?, text(a, "project")?, text(a, "path")?);
        ok(atelier_core::list_worktree_folder(&works_dir(), &slug, &project, &path))
    }),
    ("list_archive", |_| ok(atelier_core::list_archive(&archive_dir()))),
    // 아카이브 문서 목록도 spec 트리를 싣는다 — `commands.rs`와 같은 코어 입구
    // (`with_archived_spec_tree`)를 진짜로 탄다.
    ("list_archived_docs", |a| {
        ok(atelier_core::list_archived_docs(&archive_dir(), &text(a, "slug")?)
            .map(|docs| atelier_core::with_archived_spec_tree(&data_root(), docs)))
    }),
    ("read_archived_file", |a| {
        ok(atelier_core::read_work_file(&archive_dir(), &text(a, "slug")?, &text(a, "path")?))
    }),
    // Finder에서 열기 둘(codex-ds 스펙 S6)은 `open_project_folder`와 같다 — 경로를 푸는 코어 함수(`work_folder` ·
    // `archived_spec_folder`)는 있어도 하는 일이 탐색기를 여는 것이라, 풀기만 하고 성공을 답하면 열지 않은 것을 「열었다」로 통과시킨다.
    ("open_work_folder", |_| in_app_only("탐색기를 여는 일입니다 — 경로 풀기는 코어 단위 검사가 잽니다")),
    ("open_archived_spec_folder", |_| in_app_only("탐색기를 여는 일입니다 — 경로 풀기는 코어 단위 검사가 잽니다")),
    // 워크트리 파일 읽기도 다른 읽기 명령과 같이 코어를 진짜로 탄다(git-integration 판 01).
    ("read_worktree_file", |a| {
        let (slug, project, path) = (text(a, "slug")?, text(a, "project")?, text(a, "path")?);
        ok(atelier_core::read_worktree_file(&works_dir(), &slug, &project, &path))
    }),
    // Work 카드의 자료(v1 티켓 33)도 코어를 진짜로 탄다 — 진짜 git이 변경과 diff를 판정한다.
    ("list_work_changes", |a| ok(atelier_core::list_work_changes(&works_dir(), &projects_dir(), &text(a, "slug")?))),
    ("read_work_diff", |a| {
        let (slug, project, path) = (text(a, "slug")?, text(a, "project")?, text(a, "path")?);
        ok(atelier_core::read_work_diff(&works_dir(), &projects_dir(), &slug, &project, &path))
    }),
    ("search", |a| {
        ok(atelier_core::search(
            // **반드시 코어의 데이터 루트다.** 다른 값을 넘기면 L4가 sandbox 밖(진짜 홈)을 봐서,
            // 관통 검사가 개발자의 실제 사용 기록에 따라 초록·빨강을 오간다.
            &data_root(),
            &text(a, "query")?,
            &destinations(a)?,
        ))
    }),
    // **진짜 핸들러다 — 스텁이 아니다.** 이 커맨드가 하는 일이 파일 한 장을 쓰는 것이고
    // 그 코드가 코어에 살아서, 다리가 그대로 탈 수 있다. 스텁으로 때우면 L4가 관통하는
    // 것이 「이력이 실제로 써진다」가 아니라 「호출이 나갔다」로 줄어든다.
    //
    // **루트는 반드시 코어의 것을 넘긴다** — 다른 값을 넘기면 L4가 sandbox 밖(진짜 홈)을 본다.
    ("touch_recent_work", |a| ok(atelier_core::touch_recent_work(&data_root(), &text(a, "slug")?))),
    // Agent 목록 · 파일 읽기(v1 티켓 11)는 코어만 거친다 — 같은 입구(`find_agents` · `read_agent_file`)가 다리의 데이터 루트에서
    // Library와 Work의 Project 폴더를 **진짜로** 읽는다. `work`가 없으면(`null`) Library만이다.
    ("list_agents", |a| ok(atelier_core::find_agents(&data_root(), maybe_text(a, "work").as_deref()))),
    ("read_agent_file", |a| {
        ok(atelier_core::read_agent_file(&data_root(), maybe_text(a, "work").as_deref(), &text(a, "call")?))
    }),
    // 「Finder에서 열기」(v1 티켓 19)는 Finder 열기 둘과 같다 — 경로 풀기(`agent_file_path`)는 코어 단위 검사가 잰다.
    ("reveal_agent_file", |_| in_app_only("탐색기를 여는 일입니다 — 경로 풀기는 코어 단위 검사가 잽니다")),
    // 입력창의 첨부 칩(v1 티켓 06)은 코어만 거친다 — 같은 입구가 다리의 파일 시스템에서 경로를 **진짜로** 잰다.
    ("describe_attachments", |a| ok(atelier_core::describe_attachments(&texts(a, "paths")?))),
    // 셸 일곱은 PTY 풀이라는 **앱 프로세스의 상태**를 받는다. 다리는 호출마다 새 프로세스라
    // 그 풀이 없고, 있다 해도 프로세스가 끝나는 순간 셸도 죽는다.
    ("pty_spawn", |_| in_app_only("PTY 풀이 앱 프로세스의 상태입니다")),
    ("pty_write", |_| in_app_only("PTY 풀이 앱 프로세스의 상태입니다")),
    ("pty_resize", |_| in_app_only("PTY 풀이 앱 프로세스의 상태입니다")),
    ("pty_kill", |_| in_app_only("PTY 풀이 앱 프로세스의 상태입니다")),
    ("pty_close_check", |_| in_app_only("PTY 풀이 앱 프로세스의 상태입니다")),
    ("pty_close_checks", |_| in_app_only("PTY 풀이 앱 프로세스의 상태입니다")),
    ("pty_first_input", |_| in_app_only("PTY 풀이 앱 프로세스의 상태입니다")),
    // `Processes` 화면의 스냅샷(프로세스 티켓 26)도 **그 풀을 읽는다** — 판정이 풀의 셸 목록과 이 실행의 인스턴스 기록을 입력으로
    // 받는다. 호출마다 새로 뜨는 다리에는 셸도 기록도 없고, 있다 해도 이 맥의 프로세스 표 전체를 판정하는 일을 검증 층에서
    // 태울 까닭이 없다. 거절되면 화면은 제목만 선다.
    ("processes_snapshot", |_| in_app_only("PTY 풀과 인스턴스 기록이 앱 프로세스의 상태입니다")),
    // nav 메타의 요약(프로세스 티켓 29)은 **앱 프로세스의 배경 표본이 앉힌 값**이다 — 10초마다 그 풀을 판정하는 스레드가 앱에 산다. 다리에는
    // 표본을 모을 실행이 없다. 거절되면 nav 메타가 안 선다(부팅 때의 시작 보고와 같다).
    ("processes_summary", |_| in_app_only("요약은 앱 프로세스의 배경 표본이 모은 값입니다")),
    // 요약 카드의 추이(프로세스 티켓 30)도 **그 배경 표본이 든 고리**다 — 앱 프로세스의 메모리에만 산다(앱을 다시 켜면 빈다). 거절되면
    // 카드에 스파크라인이 안 선다.
    ("processes_trend", |_| in_app_only("추이는 앱 프로세스의 배경 표본이 든 값입니다")),
    // 정리 기록(프로세스 티켓 32)은 **앱 프로세스가 연 인스턴스 기록의 자리**에서 읽는다 — 그 자리는 앱이 뜰 때 이 실행의 신원과 함께 선다.
    // 다리에는 연 기록이 없고, 데이터 루트를 여기서 다시 짚으면 이 층이 앱이 아니라 다리를 검증한다. 거절되면 정리 기록 묶음이
    // 안 선다.
    ("processes_cleanup_log", |_| in_app_only("정리 기록은 앱 프로세스가 연 인스턴스 기록의 자리에서 읽습니다")),
    // 손으로 끝내기(프로세스 티켓 31)는 **그 풀의 진행 중인 끝내기 목록에 오르고 그 인스턴스 기록에 적는다** — 앱이 닫히면 종료가 그 목록을
    // 마감하고, 기록은 앱 실행 폴더에 산다. 다리에는 둘 다 없고, 있다 해도 검증 층에서 이 맥의 프로세스에 신호를 보낼 까닭이 없다.
    // 거절되면 [끝내기] · [정리]가 문제 창을 띄운다.
    ("processes_end", |_| in_app_only("PTY 풀의 진행 중인 끝내기와 인스턴스 기록이 앱 프로세스의 상태입니다")),
    // 설정 둘은 **위 넷과 이유가 다르다.** `~/.atelier/settings.json` 한 장이라 다리가 못 탈
    // 성질이 아닌데, 읽고 쓰는 코드가 앱 크레이트(`src-tauri/src/settings.rs`)에 살고 다리는
    // 코어만 본다. 여기서 파일 규칙을 다시 적지 않는다 — 그 순간 이 층이 검증하는 것이 앱이
    // 아니라 다리가 된다(`ok`의 머리말과 같은 이유).
    //
    // 그래서 L4가 설정 화면을 관통해야 하는 날, 고칠 곳은 이 표가 아니라 저 모듈의 자리다 —
    // 코어로 옮기면 위 항목들처럼 진짜 핸들러가 된다.
    ("read_settings", |_| in_app_only("설정 모듈이 앱 크레이트에 있습니다")),
    ("write_settings", |_| in_app_only("설정 모듈이 앱 크레이트에 있습니다")),
    // 예외 목록의 기본값(프로세스 스펙 S7)은 **판정이 쓰는 앱 크레이트의 상수**다. 코어가 모르는 값이라 여기서
    // 다시 적으면 이 층이 앱이 아니라 다리를 검증한다(위 설정 둘과 같은 이유).
    ("default_process_exceptions", |_| in_app_only("예외 목록의 기본값이 앱 크레이트의 상수입니다")),
    // 사람 메뉴의 이름(v1 티켓 07)은 이 컴퓨터 계정에서 읽는다 — 다리는 L4 sandbox 안이라 그 사람이 없다. 거절되면 화면은 「나」로 선다.
    ("person_name", |_| in_app_only("사람의 이름은 앱이 이 컴퓨터의 계정에서 읽습니다")),
    // 에이전트 훅 셋(#207)도 같은 이유다 — 병합 모듈이 앱 크레이트에 산다
    // (`src-tauri/src/hooks.rs`). 게다가 이쪽이 고치는 것은 `~/.atelier` 밖의 파일
    // (`~/.claude`·`~/.codex`)이라, 다리가 그것을 진짜로 태우면 검증 한 번이 이 기계를
    // 쓰는 사람의 설정을 고친다. **여기서 그 길을 열지 않는다.**
    ("agent_hooks", |_| in_app_only("훅 설치 모듈이 앱 크레이트에 있습니다")),
    ("install_agent_hooks", |_| in_app_only("훅 설치 모듈이 앱 크레이트에 있습니다")),
    ("uninstall_agent_hooks", |_| in_app_only("훅 설치 모듈이 앱 크레이트에 있습니다")),
    // spec 레이아웃 상태 — `commands.rs`와 같은 코어 입구(`layout_state`)를 **진짜로** 탄다. 레이아웃은
    // 데이터 루트 아래의 고정 경로에 산다(`layouts/atelier/`). 읽기가 실패하는 길이 없다:
    // 못 읽는 폴더는 오류가 실린 상태로 선다.
    ("spec_layout_state", |_| ok(Ok(atelier_core::layout_state(&data_root())))),
    // 기본값으로 되돌리기 — 같은 코어 입구(`revert_layout`)가 다리의 데이터 루트에서 **진짜로** 폴더를
    // 지운다.
    ("revert_spec_layout", |_| ok(atelier_core::revert_layout(&data_root()))),
    // 편집기의 읽기와 저장(티켓 11) — 같은 코어 입구(`read_layout`·`save_layout`)가 다리의 데이터 루트에서
    // **진짜로** 읽고 쓴다. 저장의 검증 거절은 답의 데이터(`{ errors }`)라 여기서도 성공으로 나간다.
    ("read_spec_layout", |_| ok(Ok(atelier_core::read_layout(&data_root())))),
    ("write_spec_layout", |a| {
        ok(atelier_core::save_layout(
            &data_root(),
            value(a, "layout")?,
            &serde_json::from_value(value(a, "templates")?).map_err(err)?,
        ))
    }),
    // 편집기의 미리보기(티켓 14) — 같은 코어 입구(`preview_layout`)를 **진짜로** 탄다. 규칙이 코어에 있어
    // 여기가 한 벌 더 갖지 않는다. 다리의 데이터 루트의 템플릿을 보되 아무것도 쓰지 않는다.
    ("render_spec_layout", |a| {
        ok(Ok(atelier_core::preview_layout(
            &data_root(),
            value(a, "layout")?,
            &serde_json::from_value(value(a, "templates")?).map_err(err)?,
        )))
    }),
    // 종료 확인의 「종료」(결정 14). 끌 대상이 **앱 프로세스 자신**이라 다리에는 끌 것이 없다.
    ("quit_app", |_| in_app_only("앱 프로세스를 끄는 일입니다")),
    // 시작 보고(프로세스 스펙 S11)는 **이 실행이 뜰 때 한 일**이다 — 앱 프로세스가 붙잡아 둔 값이라, 호출마다
    // 새로 뜨는 다리에는 붙잡을 실행이 없다. 거절되면 프런트는 토스트 없이 넘어간다(부팅 때의 설정 읽기와 같다).
    ("startup_report", |_| in_app_only("시작 보고는 앱 프로세스가 붙잡아 둔 값입니다")),
    // Thread 명령(v1 티켓 04 · 구현 스펙 §18)은 **앱 프로세스가 쥔 Thread 엔진**을 부른다 — 엔진은 오래 사는 Agent 프로세스와 그
    // 연결을 쥔다. 호출마다 새로 뜨고 끝나는 다리는 Agent를 쥘 수 없고, 띄운다 해도 다리가 끝나는 순간 함께 끊긴다. 목록 · 기록
    // 읽기도 같이 둔다 — 색인과 떠 있는 Session의 기록 끝은 엔진 메모리에 있다. 로그인 시작 · 취소도 엔진이 쥔 로그인 명령
    // 프로세스를 띄우고 거둔다. Thread 엔진은 L4로 재지 않는다(구현 스펙 「L4는 더하지 않는다」). three-axes의 `chat_` 명령은 v1
    // 티켓 08이 걷었다.
    ("thread_check_engine", |_| in_app_only("Thread 엔진이 앱 프로세스의 상태입니다")),
    ("thread_start_login", |_| in_app_only("Thread 엔진이 앱 프로세스의 상태입니다")),
    ("thread_cancel_login", |_| in_app_only("Thread 엔진이 앱 프로세스의 상태입니다")),
    ("thread_quit_counts", |_| in_app_only("Thread 엔진이 앱 프로세스의 상태입니다")),
    ("thread_list", |_| in_app_only("Thread 엔진이 앱 프로세스의 상태입니다")),
    ("thread_get", |_| in_app_only("Thread 엔진이 앱 프로세스의 상태입니다")),
    ("thread_read_record", |_| in_app_only("Thread 엔진이 앱 프로세스의 상태입니다")),
    ("thread_start", |_| in_app_only("Thread 엔진이 앱 프로세스의 상태입니다")),
    ("thread_send", |_| in_app_only("Thread 엔진이 앱 프로세스의 상태입니다")),
    ("thread_stop", |_| in_app_only("Thread 엔진이 앱 프로세스의 상태입니다")),
    ("thread_edit_queued", |_| in_app_only("Thread 엔진이 앱 프로세스의 상태입니다")),
    ("thread_delete_queued", |_| in_app_only("Thread 엔진이 앱 프로세스의 상태입니다")),
    ("thread_send_now", |_| in_app_only("Thread 엔진이 앱 프로세스의 상태입니다")),
    ("thread_answer_permission", |_| in_app_only("Thread 엔진이 앱 프로세스의 상태입니다")),
    ("thread_answer_work", |_| in_app_only("Thread 엔진이 앱 프로세스의 상태입니다")),
    ("thread_answer_question", |_| in_app_only("Thread 엔진이 앱 프로세스의 상태입니다")),
    ("thread_answer_project", |_| in_app_only("Thread 엔진이 앱 프로세스의 상태입니다")),
    ("thread_answer_space", |_| in_app_only("Thread 엔진이 앱 프로세스의 상태입니다")),
    ("thread_answer_project_add", |_| in_app_only("Thread 엔진이 앱 프로세스의 상태입니다")),
    ("thread_set_model", |_| in_app_only("Thread 엔진이 앱 프로세스의 상태입니다")),
    ("thread_set_effort", |_| in_app_only("Thread 엔진이 앱 프로세스의 상태입니다")),
    ("thread_set_mode", |_| in_app_only("Thread 엔진이 앱 프로세스의 상태입니다")),
    ("thread_set_space", |_| in_app_only("Thread 엔진이 앱 프로세스의 상태입니다")),
    ("thread_set_work_space", |_| in_app_only("Thread 엔진이 앱 프로세스의 상태입니다")),
    // Space 지우기 · 되돌리기(03 티켓 07)는 비운 곳마다 엔진이 「지워짐」 · 「되돌림」 줄을 남긴다 — 파일은 core L1(`space_delete`), 줄은
    // 기록 테스트(`thread_space_delete`)가 잰다.
    ("thread_delete_space", |_| in_app_only("Thread 엔진이 앱 프로세스의 상태입니다")),
    ("thread_restore_space", |_| in_app_only("Thread 엔진이 앱 프로세스의 상태입니다")),
    ("thread_work_mode", |_| in_app_only("Thread 엔진이 앱 프로세스의 상태입니다")),
    // Work의 PR(v1 티켓 36)은 엔진이 읽고 `pr` 줄을 남긴다 — 읽기 · 셈은 L1(`atelier-core` `pr` · `atelier-acp` `thread_pr`)이 잰다.
    ("thread_work_prs", |_| in_app_only("Thread 엔진이 앱 프로세스의 상태입니다")),
    ("thread_rename", |_| in_app_only("Thread 엔진이 앱 프로세스의 상태입니다")),
    ("thread_mark_read", |_| in_app_only("Thread 엔진이 앱 프로세스의 상태입니다")),
    ("thread_call_again", |_| in_app_only("Thread 엔진이 앱 프로세스의 상태입니다")),
];

/// 앱 프로세스 안에서만 뜻이 있는 커맨드. **표에는 남긴다** — 빼면 드리프트 검사가
/// "덮지 않은 커맨드"로 읽어 진짜 누락과 구별되지 않는다. 스텁으로 조용히 성공시키지도
/// 않는다: 검증 층에서 아무것도 확인하지 않은 통과는 실패보다 나쁘다.
fn in_app_only(why: &str) -> Handled {
    Err(format!("이 커맨드는 다리로 탈 수 없습니다: {why}"))
}

/// 코어의 결과를 그대로 JSON으로 옮긴다. **여기서 모양을 손보지 않는다** — 손보는 순간
/// 이 층이 검증하는 것이 앱이 아니라 다리가 된다.
fn ok<T: serde::Serialize>(result: atelier_core::Result<T>) -> Handled {
    let value = result.map_err(err)?;
    serde_json::to_value(value).map_err(err)
}

fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn text(args: &Args, key: &str) -> Result<String, String> {
    maybe_text(args, key).ok_or_else(|| format!("인자 '{key}'(문자열)가 필요합니다"))
}

/// JSON 값 그대로의 인자 — 모양을 여기서 보지 않는다. 받는 코어가 본다(레이아웃은 모르는 키까지 값으로 건넨다).
fn value(args: &Args, key: &str) -> Result<Value, String> {
    args.get(key).cloned().ok_or_else(|| format!("인자 '{key}'가 필요합니다"))
}

fn maybe_text(args: &Args, key: &str) -> Option<String> {
    args.get(key).and_then(Value::as_str).map(str::to_string)
}

/// 프런트가 건네는 「가는 곳」 목록(결정 21). **여기서 모양을 손보지 않는다** — 라벨은
/// 프런트 것이고 코어가 그것으로 맞춘다.
fn destinations(args: &Args) -> Result<Vec<atelier_core::Destination>, String> {
    let value = args
        .get("destinations")
        .ok_or_else(|| "인자 'destinations'(배열)가 필요합니다".to_string())?;
    serde_json::from_value(value.clone()).map_err(err)
}

/// 문자열 배열 인자 — 첨부의 경로들처럼 모양이 단순한 목록.
fn texts(args: &Args, key: &str) -> Result<Vec<String>, String> {
    let value = args.get(key).ok_or_else(|| format!("인자 '{key}'(문자열 배열)가 필요합니다"))?;
    serde_json::from_value(value.clone()).map_err(err)
}

/// 없어도 되는 문자열 배열 인자 — 없거나 `null`이면 빈 목록이다.
fn maybe_texts(args: &Args, key: &str) -> Result<Vec<String>, String> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(value) => serde_json::from_value(value.clone()).map_err(err),
    }
}

fn flag(args: &Args, key: &str) -> Result<bool, String> {
    args.get(key)
        .and_then(Value::as_bool)
        .ok_or_else(|| format!("인자 '{key}'(불리언)가 필요합니다"))
}

fn main() {
    if let Err(reason) = require_isolated_home(std::env::var_os("ATELIER_HOME")) {
        die(2, &reason);
    }

    let mut argv = std::env::args().skip(1);
    let Some(cmd) = argv.next() else {
        die(2, "사용법: atelier-test-bridge <커맨드> [JSON 인자]");
    };
    let raw = argv.next().unwrap_or_else(|| "{}".to_string());

    let Some((_, handler)) = HANDLERS.iter().find(|(name, _)| *name == cmd) else {
        die(2, &format!("이 다리가 모르는 커맨드입니다: {cmd}"));
    };

    let args = match parse_args(&raw) {
        Ok(args) => args,
        Err(message) => die(2, &message),
    };

    match handler(&args) {
        Ok(value) => println!("{value}"),
        Err(message) => die(1, &message),
    }
}

/// 이 다리는 **격리된 데이터 루트에서만** 돈다. 부르는 쪽이 `ATELIER_HOME`을 빠뜨리면
/// 코어가 조용히 진짜 `~/.atelier`를 쓴다 — 테스트는 "파일이 안 생겼다"로 실패하지만
/// 그때는 이미 개발자의 실제 데이터에 프로젝트가 하나 추가된 뒤다.
fn require_isolated_home(home: Option<OsString>) -> Result<(), String> {
    match home {
        Some(value) if !value.is_empty() => Ok(()),
        _ => Err("ATELIER_HOME이 없습니다. 이 다리는 임시 데이터 루트에서만 돕니다.".to_string()),
    }
}

fn die(code: i32, message: &str) -> ! {
    eprintln!("{message}");
    std::process::exit(code)
}

/// 프런트엔드는 camelCase로 보내고 Tauri가 snake_case 파라미터에 맞춰 준다.
/// 다리도 같은 자리에서 같은 변환을 한다 — 브라우저 쪽이 다리의 존재를 몰라야 한다.
fn parse_args(raw: &str) -> Result<Args, String> {
    let value: Value = serde_json::from_str(raw).map_err(|e| format!("인자가 JSON이 아닙니다: {e}"))?;
    let Value::Object(object) = value else {
        return Err(format!("인자는 JSON 객체여야 합니다: {raw}"));
    };
    Ok(object.into_iter().map(|(key, value)| (to_snake_case(&key), value)).collect())
}

fn to_snake_case(key: &str) -> String {
    let mut out = String::with_capacity(key.len() + 2);
    for ch in key.chars() {
        if ch.is_ascii_uppercase() {
            out.push('_');
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push(ch);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{require_isolated_home, HANDLERS};

    #[test]
    fn 격리되지_않은_데이터_루트에서는_돌지_않는다() {
        assert!(require_isolated_home(None).is_err());
        assert!(require_isolated_home(Some("".into())).is_err());
        assert!(require_isolated_home(Some("/tmp/atelier-home".into())).is_ok());
    }

    /// Tauri가 등록한 커맨드 이름. `include_str!`이라 파일이 사라지면 **컴파일이** 깨진다.
    fn registered() -> Vec<String> {
        let source = include_str!("../../../src-tauri/src/lib.rs");
        let open = "generate_handler![";
        let start = source.find(open).expect("generate_handler! 블록을 찾지 못했다") + open.len();
        let end = start + source[start..].find(']').expect("generate_handler! 블록이 닫히지 않았다");
        let mut names: Vec<String> = source[start..end]
            .split(',')
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(|item| {
                // 모르는 모양을 **건너뛰지 않는다.** 건너뛰면 그 커맨드가 이 검사의 눈에서
                // 통째로 사라지고, 다리에도 없으면 양쪽에서 같이 빠져 초록이 된다.
                // `use commands::*;`로 접두사 없이 등록하면 실제로 그렇게 샜다.
                item.strip_prefix("commands::")
                    .unwrap_or_else(|| panic!("등록부에서 예상 못 한 항목을 봤다: {item}"))
                    .to_string()
            })
            .collect();
        names.sort();
        names
    }

    /// 다리가 배포되는 크레이트의 의존성이 되면 그 코드가 릴리스 바이너리 안으로 들어간다.
    /// 릴리스 워크플로가 패키징 대상을 이름으로 고르므로 tar 줄이 늘 일은 없지만, **의존성
    /// 한 줄은 아무도 안 보는 사이에 늘 수 있다.** 매니페스트는 `include_str!`로 읽으므로
    /// 파일이 옮겨지면 컴파일이 깨진다.
    #[test]
    fn 배포되는_크레이트는_다리에_의존하지_않는다() {
        for (name, manifest) in [
            ("atelier-app", include_str!("../../../src-tauri/Cargo.toml")),
            ("atelier-cli", include_str!("../../atelier-cli/Cargo.toml")),
            // Thread 엔진이 사는 크레이트 — 앱 실행 파일 안으로 들어간다(three-axes 결정 12).
            ("atelier-acp", include_str!("../../atelier-acp/Cargo.toml")),
        ] {
            assert!(
                !manifest.contains("atelier-test-bridge"),
                "{name}이 다리에 의존한다 — 릴리스 산출물에 다리 코드가 섞인다"
            );
        }
    }

    /// 앱 크레이트 `src/` 아래의 소스 전부. **`include_str!`이라 파일이 사라지면 컴파일이
    /// 깨진다** — 검사가 읽을 것을 못 찾아 조용히 통과하는 길이 없다 (위 등록부 스캔과
    /// 같은 관례).
    ///
    /// **키는 `src/` 기준 상대 경로다.** 파일명만 적으면 `pty/mod.rs`처럼 하위 폴더로
    /// 태어난 모듈을 적을 자리가 없고, 두 폴더의 같은 이름이 한 칸을 다툰다.
    ///
    /// `src-tauri/build.rs`는 일부러 밖이다 — 빌드 스크립트는 컴파일 시각에 돌고 앱
    /// 프로세스가 아니다. 그래서 이 표가 덮는 것은 「앱 크레이트 전부」가 아니라
    /// **`src-tauri/src/` 전부**다.
    ///
    /// 이 표가 다리에 사는 것은 **제 자신을 안 읽기 때문이다.** 앱 크레이트 안에 두면
    /// 아래 검사가 찾는 낱말이 그 검사의 문자열로도 파일에 있어, 스스로를 읽고 빨개진다.
    const APP_SOURCES: [(&str, &str); 29] = [
        ("commands.rs", include_str!("../../../src-tauri/src/commands.rs")),
        ("hooks.rs", include_str!("../../../src-tauri/src/hooks.rs")),
        ("lib.rs", include_str!("../../../src-tauri/src/lib.rs")),
        ("main.rs", include_str!("../../../src-tauri/src/main.rs")),
        ("processes/cleanup_log.rs", include_str!("../../../src-tauri/src/processes/cleanup_log.rs")),
        ("processes/clock.rs", include_str!("../../../src-tauri/src/processes/clock.rs")),
        ("processes/ending.rs", include_str!("../../../src-tauri/src/processes/ending.rs")),
        ("processes/exceptions.rs", include_str!("../../../src-tauri/src/processes/exceptions.rs")),
        ("processes/instances.rs", include_str!("../../../src-tauri/src/processes/instances.rs")),
        ("processes/metrics.rs", include_str!("../../../src-tauri/src/processes/metrics.rs")),
        ("processes/mod.rs", include_str!("../../../src-tauri/src/processes/mod.rs")),
        ("processes/procargs.rs", include_str!("../../../src-tauri/src/processes/procargs.rs")),
        ("processes/screen.rs", include_str!("../../../src-tauri/src/processes/screen.rs")),
        ("processes/service.rs", include_str!("../../../src-tauri/src/processes/service.rs")),
        ("processes/shell_key.rs", include_str!("../../../src-tauri/src/processes/shell_key.rs")),
        ("processes/snapshot.rs", include_str!("../../../src-tauri/src/processes/snapshot.rs")),
        ("processes/summary.rs", include_str!("../../../src-tauri/src/processes/summary.rs")),
        ("processes/testkit.rs", include_str!("../../../src-tauri/src/processes/testkit.rs")),
        ("processes/verdict.rs", include_str!("../../../src-tauri/src/processes/verdict.rs")),
        ("pty.rs", include_str!("../../../src-tauri/src/pty.rs")),
        ("quit.rs", include_str!("../../../src-tauri/src/quit.rs")),
        ("settings.rs", include_str!("../../../src-tauri/src/settings.rs")),
        ("shells.rs", include_str!("../../../src-tauri/src/shells.rs")),
        ("shells/testkit.rs", include_str!("../../../src-tauri/src/shells/testkit.rs")),
        ("startup.rs", include_str!("../../../src-tauri/src/startup.rs")),
        ("terminate.rs", include_str!("../../../src-tauri/src/terminate.rs")),
        ("thread.rs", include_str!("../../../src-tauri/src/thread.rs")),
        ("watcher.rs", include_str!("../../../src-tauri/src/watcher.rs")),
        ("webview.rs", include_str!("../../../src-tauri/src/webview.rs")),
    ];

    /// CLI 크레이트 `src/` 아래의 소스 전부. 위 표와 같은 관례다 — 원본을 읽는 검사가 CLI 쪽에 서면
    /// 이 표를 읽는다.
    const CLI_SOURCES: [(&str, &str); 10] = [
        ("main.rs", include_str!("../../atelier-cli/src/main.rs")),
        ("mcp/install.rs", include_str!("../../atelier-cli/src/mcp/install.rs")),
        ("mcp/instructions.rs", include_str!("../../atelier-cli/src/mcp/instructions.rs")),
        ("mcp/layout_tools.rs", include_str!("../../atelier-cli/src/mcp/layout_tools.rs")),
        ("mcp/mod.rs", include_str!("../../atelier-cli/src/mcp/mod.rs")),
        ("mcp/project_tools.rs", include_str!("../../atelier-cli/src/mcp/project_tools.rs")),
        ("mcp/read_tools.rs", include_str!("../../atelier-cli/src/mcp/read_tools.rs")),
        ("mcp/skill_cleanup.rs", include_str!("../../atelier-cli/src/mcp/skill_cleanup.rs")),
        ("mcp/tool_error.rs", include_str!("../../atelier-cli/src/mcp/tool_error.rs")),
        ("mcp/work_tools.rs", include_str!("../../atelier-cli/src/mcp/work_tools.rs")),
    ];

    /// core 크레이트 `src/` 아래의 소스 전부(v1 티켓 02 인수 기준 · 코드 리뷰 1차 B13). 위 표와 같은 관례다 — 원본을 읽는 검사가
    /// core 쪽에 서면 이 표를 읽는다. Thread · Agent의 파일 모양(`threads.rs` · `agents.rs` …)이 여기 산다.
    const CORE_SOURCES: [(&str, &str); 36] = [
        ("agents.rs", include_str!("../../atelier-core/src/agents.rs")),
        ("agents/scope.rs", include_str!("../../atelier-core/src/agents/scope.rs")),
        ("atomic.rs", include_str!("../../atelier-core/src/atomic.rs")),
        ("attachments.rs", include_str!("../../atelier-core/src/attachments.rs")),
        ("changes.rs", include_str!("../../atelier-core/src/changes.rs")),
        ("git.rs", include_str!("../../atelier-core/src/git.rs")),
        ("layout/builtin.rs", include_str!("../../atelier-core/src/layout/builtin.rs")),
        ("layout/classify.rs", include_str!("../../atelier-core/src/layout/classify.rs")),
        ("layout/mod.rs", include_str!("../../atelier-core/src/layout/mod.rs")),
        ("layout/model.rs", include_str!("../../atelier-core/src/layout/model.rs")),
        ("layout/parse.rs", include_str!("../../atelier-core/src/layout/parse.rs")),
        ("layout/pattern.rs", include_str!("../../atelier-core/src/layout/pattern.rs")),
        ("layout/render.rs", include_str!("../../atelier-core/src/layout/render.rs")),
        ("layout/resolve.rs", include_str!("../../atelier-core/src/layout/resolve.rs")),
        ("layout/states.rs", include_str!("../../atelier-core/src/layout/states.rs")),
        ("layout/store.rs", include_str!("../../atelier-core/src/layout/store.rs")),
        ("layout/work_trees.rs", include_str!("../../atelier-core/src/layout/work_trees.rs")),
        ("lib.rs", include_str!("../../atelier-core/src/lib.rs")),
        ("order.rs", include_str!("../../atelier-core/src/order.rs")),
        ("paths.rs", include_str!("../../atelier-core/src/paths.rs")),
        ("policy_file.rs", include_str!("../../atelier-core/src/policy_file.rs")),
        ("pr.rs", include_str!("../../atelier-core/src/pr.rs")),
        ("project.rs", include_str!("../../atelier-core/src/project.rs")),
        ("recent.rs", include_str!("../../atelier-core/src/recent.rs")),
        ("reading_scope.rs", include_str!("../../atelier-core/src/reading_scope.rs")),
        ("records.rs", include_str!("../../atelier-core/src/records.rs")),
        ("search.rs", include_str!("../../atelier-core/src/search.rs")),
        ("slug.rs", include_str!("../../atelier-core/src/slug.rs")),
        ("space.rs", include_str!("../../atelier-core/src/space.rs")),
        ("store.rs", include_str!("../../atelier-core/src/store.rs")),
        ("threads.rs", include_str!("../../atelier-core/src/threads.rs")),
        ("work.rs", include_str!("../../atelier-core/src/work.rs")),
        ("works.rs", include_str!("../../atelier-core/src/works.rs")),
        ("worktree.rs", include_str!("../../atelier-core/src/worktree.rs")),
        ("worktree_file.rs", include_str!("../../atelier-core/src/worktree_file.rs")),
        ("worktree_watch.rs", include_str!("../../atelier-core/src/worktree_watch.rs")),
    ];

    /// `dir` 아래의 `.rs`를 **재귀로** 모아 `dir` 기준 상대 경로로 돌려준다.
    ///
    /// **재귀가 요점이다.** 한 겹만 읽으면 디렉터리 항목은 `.rs`로 안 끝나 필터에서 조용히
    /// 버려지고, 하위 폴더로 태어난 모듈은 디스크 목록에도 표에도 없어 두 집합이 그대로
    /// 맞는다 — 그 모듈이 무슨 짓을 하든 아래 검사들이 한 줄도 안 읽는다. 새 파일이 검사
    /// 밖에서 태어나는 것을 막으려고 만든 커버리지 검사가 정확히 그 경우를 놓친다.
    fn rust_sources_under(dir: &std::path::Path, prefix: &str, out: &mut Vec<String>) {
        let entries = std::fs::read_dir(dir)
            .unwrap_or_else(|e| panic!("소스 폴더를 못 읽었다 ({}): {e}", dir.display()));
        for entry in entries {
            let entry = entry.unwrap();
            let name = entry.file_name().to_string_lossy().into_owned();
            let path = entry.path();
            if path.is_dir() {
                rust_sources_under(&path, &format!("{prefix}{name}/"), out);
            } else if name.ends_with(".rs") {
                out.push(format!("{prefix}{name}"));
            }
        }
    }

    /// 표가 폴더를 **전부** 덮는지. 표에만 기대면 새 파일이 검사 밖에서 태어나고, 하필 그
    /// 파일이 규칙을 깨는 파일일 수 있다. 폴더를 못 읽으면 순회에서 터지고, 한 개도 못
    /// 모으면 여기서 터진다 — 「읽을 게 없어서 통과」가 이 검사에는 없다.
    fn 표가_폴더를_덮는다(relative: &str, listed: &[(&str, &str)]) {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(relative);
        let mut on_disk = Vec::new();
        rust_sources_under(&dir, "", &mut on_disk);
        assert!(!on_disk.is_empty(), "{relative} 아래에서 소스를 하나도 못 읽었다 — 순회가 샜다");
        on_disk.sort();

        let mut listed: Vec<String> = listed.iter().map(|(name, _)| name.to_string()).collect();
        listed.sort();

        assert_eq!(listed, on_disk, "{relative}의 소스가 늘거나 줄었다 — 표에 함께 적어라");
    }

    #[test]
    fn 앱_소스_표가_폴더_전체를_덮는다() {
        표가_폴더를_덮는다("../../src-tauri/src", &APP_SOURCES);
    }

    #[test]
    fn cli_소스_표가_폴더_전체를_덮는다() {
        표가_폴더를_덮는다("../atelier-cli/src", &CLI_SOURCES);
    }

    #[test]
    fn core_소스_표가_폴더_전체를_덮는다() {
        표가_폴더를_덮는다("../atelier-core/src", &CORE_SOURCES);
    }

    /// **「확인됨」을 세우는 것은 `quit_app` 하나이고, 끄기 전에 세운다**(결정 14 · #223).
    ///
    /// 표시를 뒤집는 L1(`quit.rs`)은 표시가 뒤집히는지만 본다. 지키려는 것은 그 너머다 —
    /// `quit_app`이 세우지 않으면 #224의 `terminate:` 훅이 「종료」를 누른 사람 앞에서 다시 막고,
    /// 다른 자리가 세우면 빨간 버튼이 묻지 않고 앱을 끈다. L3의 픽스처는 `quit_app`에 `null`로만
    /// 답하므로 이 둘은 **여기서만** 잰다. 이 검사가 다리에 사는 이유는 `APP_SOURCES`의 머리말과
    /// 같다 — 앱 크레이트 안에 두면 찾는 낱말을 제 문자열로 읽는다.
    ///
    /// **부르는 모양을 가리지 않고 센다.** `quit::confirm()`만 세면 `use crate::quit::confirm;`
    /// 뒤의 맨 `confirm()`이 안 보인다 — 그래서 주석 줄을 뺀 소스에서 낱말 `confirm`(뒤에
    /// `ed`가 붙은 `confirmed`는 다른 낱말)을 전부 세고, 정의 파일 밖에서는 한 번뿐이어야 한다.
    #[test]
    fn 확인됨은_quit_app만_끄기_전에_세운다() {
        fn words(source: &str) -> Vec<usize> {
            // 주석 줄 비우기는 `src-tauri/src/lib.rs`의 `without_comment_lines`와 같은 규칙의 사본이다 —
            // 다리는 바이너리 크레이트라 그것을 못 가져온다. 규칙을 바꾸면 둘을 함께 고치고, 규칙의
            // 검사(`자리_검사는_주석_처리된_호출에_안_속는다`)는 그쪽에 산다.
            let code: String = source
                .lines()
                .map(|line| if line.trim_start().starts_with("//") { "" } else { line })
                .collect::<Vec<_>>()
                .join("\n");
            let bytes = code.as_bytes();
            code.match_indices("confirm")
                .filter(|(at, word)| {
                    let before = at.checked_sub(1).map(|i| bytes[i]);
                    let after = bytes.get(at + word.len()).copied();
                    let ident = |b: u8| b.is_ascii_alphanumeric() || b == b'_';
                    !before.is_some_and(ident) && !after.is_some_and(ident)
                })
                .map(|(at, _)| at)
                .collect()
        }

        let mut callers = Vec::new();
        for (file, source) in APP_SOURCES {
            if file == "quit.rs" {
                continue;
            }
            for _ in words(source) {
                callers.push(file);
            }
        }
        assert_eq!(
            callers,
            ["commands.rs"],
            "「확인됨」을 세우는 자리가 `quit_app` 하나가 아니다 — 없으면 끄는 길이 다시 막히고, 늘면 안 묻고 끈다"
        );

        let commands = APP_SOURCES.iter().find(|(file, _)| *file == "commands.rs").unwrap().1;
        let body = commands
            .split_once("pub async fn quit_app(")
            .expect("commands.rs에 `quit_app`이 없다")
            .1
            .split_once("\n}\n")
            .expect("`quit_app`의 끝을 못 찾았다")
            .0;
        let confirm = body.find("crate::quit::confirm();").expect("`quit_app`이 「확인됨」을 안 세운다");
        let exit = body.find("app.exit(0);").expect("`quit_app`이 앱을 안 끈다");
        assert!(confirm < exit, "`quit_app`이 끈 뒤에 「확인됨」을 세운다 — 끄는 사이의 `terminate:`가 다시 막는다");
    }

    /// **Thread 명령(`thread_`)은 전부 앱 안에서만 돈다**(three-axes 구현 스펙 「앱 잇기」 · v1 구현 스펙 §18). Thread 엔진은 오래 사는
    /// Agent 프로세스를 쥐는데, 다리는 부를 때마다 뜨고 끝나는 CLI라 쥘 수 없다 — 성공으로 때우는 스텁을 두면 L4가 Thread 화면을
    /// 관통한 것처럼 보인다. 등록부에서 이름을 읽어 표의 처리기를 **실제로 불러** 거절의 말을 본다(인자 없이 — 인자를 요구하는 진짜
    /// 처리기라면 다른 말로 거절한다). Thread 명령을 하나도 못 읽으면 읽기가 샌 것이다.
    #[test]
    fn thread_명령은_모두_다리로_탈_수_없다() {
        let thread: Vec<String> = registered().into_iter().filter(|name| name.starts_with("thread_")).collect();
        assert!(!thread.is_empty(), "등록부에서 Thread 명령을 하나도 못 읽었다 — 앱이 Thread 엔진을 안 잇거나 읽기가 샜다");
        for name in thread {
            let (_, handler) = HANDLERS
                .iter()
                .find(|(handled, _)| *handled == name)
                .unwrap_or_else(|| panic!("다리의 표에 {name}이 없다"));
            let answer = handler(&serde_json::Map::new());
            assert!(
                matches!(&answer, Err(reason) if reason.starts_with("이 커맨드는 다리로 탈 수 없습니다")),
                "{name}이 앱 밖에서 답한다 — {answer:?}"
            );
        }
    }

    /// 커맨드가 하나 늘었는데 다리가 그대로면, 그 커맨드를 쓰는 화면은 L4에서 조용히
    /// 실패한다 — "이 다리가 모르는 커맨드"라는 말은 테스트를 돌려 봐야만 나온다.
    /// 그래서 목록이 어긋나는 순간 여기서 먼저 빨간불이 켜진다.
    #[test]
    fn 다리가_등록된_커맨드를_빠짐없이_덮는다() {
        let registered = registered();
        assert!(!registered.is_empty(), "등록된 커맨드를 하나도 읽지 못했다 — 파싱이 샜다");

        let mut handled: Vec<String> = HANDLERS.iter().map(|(name, _)| name.to_string()).collect();
        handled.sort();

        assert_eq!(handled, registered, "다리의 표와 Tauri 등록부가 어긋났다");
    }
}
