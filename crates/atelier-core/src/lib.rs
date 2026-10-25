#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("project not found: {0}")]
    NotFound(String),
    #[error("invalid project file for '{slug}': {message}")]
    InvalidFile { slug: String, message: String },
    #[error("folder does not exist: {0}")]
    FolderMissing(String),
    #[error("name must not be empty")]
    EmptyName,
    #[error("Space를 찾지 못했어요: {0}")]
    SpaceNotFound(String),
    /// Space 파일에 문제가 있어 쓰지 않았다 — 검사가 낸 문제들(03 구현 스펙 §8).
    #[error("{}", space::describe_problems(.0))]
    SpaceProblems(Vec<space::SpaceProblem>),
    #[error("work not found: {0}")]
    WorkNotFound(String),
    #[error("{0}")]
    Validation(String),
    // "uncommitted"만으로는 거짓이다 — 이 게이트가 실전에서 잡는 것은 거의 다 **추적조차
    // 안 된** 파일이고, 그 말을 믿고 `git stash`(`-u` 없이)를 하면 똑같이 막힌 채 이유를
    // 알 수 없다. 사용자가 실제로 그렇게 막혔다.
    #[error("uncommitted or untracked files in: {0}")]
    DirtyWorktrees(String),
    #[error("git: {0}")]
    Git(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

mod paths;
mod agents;
mod slug;
mod project;
mod git;
mod store;
mod work;
mod works;
mod atomic;
mod order;
mod recent;
mod search;
mod layout;
mod worktree;
mod worktree_file;
mod worktree_watch;
mod records;
mod threads;
mod policy_file;
mod attachments;
mod changes;
mod pr;
mod space;

// 원자 쓰기 둘을 낸다 — 폴더를 만드는 쪽 · 만들지 않는 쪽. 읽기(`read_json_or_default`)는 안 낸다: 기록은 「깨졌으면 기록
// 없음」이라 기본값으로 눕는 그 읽기와 뜻이 다르다.
// 폴더를 만드는 쪽 — 앱의 인스턴스 기록이 같은 규칙으로 쓴다(`atomic.rs`의 그 함수 주석).
pub use atomic::write_json_atomically;
// 폴더를 만들지 않는 쪽 — 대화 호스트가 쓴다: `agents.json`이 사라진 work 폴더를 되살리지 않게(three-axes 결정 18), 엔진
// 목록 파일이 데이터 루트를 새로 세우지 않게(three-axes 구현 스펙 S16).
pub use atomic::write_json_into_existing_dir;
pub use paths::{
    archive_dir, archive_in, collapse_home, data_root, default_data_root, expand_home, layouts_dir, library_agents_in,
    projects_dir, projects_in, spaces_dir, spaces_in, threads_dir, works_dir, works_in,
};
// Agent 정의(v1 구현 스펙 §6) — 앱이 뜰 때 Library의 기본 파일을 세우고, Thread 엔진(`atelier-acp`)이 Host를 읽는다.
// 범위 찾기 · 고르기(v1 티켓 11)는 @ 메뉴 · Library 화면(Tauri 명령)과 엔진의 참여가 같이 쓴다. Library에 저장하기(v1 티켓 19)는
// 엔진의 Thread 도구 「Agent 저장」이 쓴다.
pub use agents::{
    agent_file_path, ensure_default_agents, find_agents, read_agent, read_agent_file, save_agent, AgentCalls, AgentDefinition, AgentProblem,
    AgentRoster, AgentSaveRefusal, Avatar, BrokenAgent, BuiltinTool, FoundAgent, ModelPreference, Policy, SavedAgent, Tools,
    Unresolved,
};
// **`touch_recent_work` 하나만 밖으로 낸다.** 읽는 쪽은 크레이트 안의 검색뿐이라
// (`search.rs`가 `crate::recent::read_recent`로 직접 부른다) 나머지를 내면 아무도 안 읽는
// 값이 계약에 남는다 — 이 크레이트가 `truncated`를 걷을 때 든 근거가 그것이다.
pub use recent::touch_recent_work;
pub use search::{search, Destination, SearchHit, SearchResults};
pub use slug::slugify;
pub use layout::{
    builtin_layout, classify, classify_archived_docs, classify_works, layout_state, parse_layout,
    preview_layout, read_layout, render_layout, resolve_layout, revert_layout, save_layout,
    serialize_layout, serialize_layout_value, with_archived_spec_tree, with_spec_trees,
    ArchivedDocs, EntryKind, EntryLines, Fallback, LayoutContent, LayoutEntry, LayoutError, LayoutPreview,
    LayoutRead, LayoutSource, LayoutState, Rendered, Resolved, SaveOutcome, SpecLayout, SpecTree, SpecTreeGroup,
    SpecTreeItem, TemplateVerdict, WorkWithSpecTree,
};
pub use project::{parse_project, render_project, Project, ProjectView};
pub use git::{detect as detect_git, origin_head, GitInfo};
pub use store::{
    create_project, delete_project, get_project, list_projects, project_folders, update_project, ProjectPatch,
};
// Space(03 구현 스펙 §8) — 파일 하나가 Space 하나다. 검사 · 읽기 · 만들기 · 고치기(글 단위)가 여기 하나이고, 앱 명령 · Host 도구 ·
// 읽는 범위가 모두 이것을 부른다(S7).
pub use space::{
    check_space, create_space, edit_space_text, get_space, list_spaces, new_space_slug, shared_spaces, space_detail, update_space,
    Lines, NewSpace, SharedSpace, Space, SpaceCheck, SpaceDetail, SpacePatch, SpacePieces, SpaceProblem, SpaceProblemKind,
};
pub use work::{parse_work, render_work, WorktreeView, Work, WorkStatus, WorkView};
pub use works::{
    archive_work, archived_spec_folder, attach_project, get_work, list_archive, list_archived_docs, list_works,
    move_work, read_spec_file, read_work_file, remove_work, render_record, start_work, start_work_deferred,
    update_work_pinned, update_work_status, update_work_title, work_folder, ArchiveEntry, WorkReport, WorktreeError,
};
// 대화 호스트(`atelier-acp`)가 데이터 루트를 받아 work의 제목 · 프로젝트와 자리를 읽는다. `get_work`는 워크트리마다
// `git status`를 돌고 `~` 축약 문자열을 주므로 그 자리에 맞지 않는다.
pub use works::{read_work, work_places, WorkPlaces};
// 대화 호스트가 턴 앞뒤로 spec 폴더를 찍을 때 스펙 트리 · 검색과 같은 목록을 걷는다 — 트리에 안 보이는 파일
// (점 파일)의 고친 곳이 생기지 않게(three-axes 결정 22).
pub use works::spec_files;
// 기록 줄 — Thread의 `events.jsonl`과 three-axes 대화 기록이 함께 딛는 한 벌(v1 티켓 02). 줄 종류는 여기서만 정한다.
pub use records::{last_record_seq, parse_records, read_records, record_time, RecordKind, RecordLine, RecordLog};
// Thread 저장(v1 구현 스펙 §4) — Thread 엔진(`atelier-acp`)이 쓴다.
pub use threads::{
    create_thread, open_thread_log, read_thread, read_thread_records, thread_dir, thread_kept, update_thread, work_gone,
    CreatedThread, DefinitionSource, NewThread, Participant, ThreadFile, ThreadIndex, ThreadSummary, WorkGone, THREAD_SNAPSHOTS,
};
// 물어보는 정도와 「다시 묻지 않기」 허락의 점 파일(v1 구현 스펙 S18 · v1 티켓 22) — Thread 엔진의 판정이 받은 요청마다 읽는다.
pub use policy_file::{read_policy, update_policy, PolicyFile, PolicyPlace};
// 첨부(v1 티켓 06 · S30) — 입력창의 칩(Tauri 명령)과 Thread 엔진의 `sent` 줄이 같은 판정을 지난다.
pub use attachments::{describe_attachments, Attachment};
pub use worktree::{list_worktree_folder, list_worktree_tree, WorktreeEntry, WorktreeEntryKind, WorktreeTree};
pub use worktree_file::{read_worktree_file, WorktreeFile};
pub use worktree_watch::{worktree_changes, WorktreeChange};
// Work 카드의 자료(v1 구현 스펙 §12) — 변경 · 한 파일 diff(S23)와 PR(S24). 앱 명령과 L4 다리가 같은 입구를 부른다.
pub use changes::{list_work_changes, read_work_diff, ChangedFile, Changes, FileDiff, ProjectChanges};
pub use pr::{read_work_prs, Ci, PrLookup, PrState, ProjectPr, PullRequest};
