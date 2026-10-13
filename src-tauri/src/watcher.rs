use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, Sender};
use std::sync::Arc;
use std::time::Duration;

use atelier_acp::ConversationHost;
use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode, DebounceEventResult};
use tauri::{AppHandle, Emitter};

/// `~/.atelier/projects/` 감시 → 관련 변경 시 `projects:changed` emit.
/// 진행 중 루트(`~/.atelier/works/`) 감시 → 관련 변경 시 `works:changed` emit, 그리고 대화 호스트에게 사라진 work를 묻는다.
/// 워크트리 안의 변경은 판정을 거쳐 쌍마다 `worktree:changed { slug, project }` emit(git-integration 티켓 10).
/// `~/.atelier/layouts/` 감시 → 관련 변경 시 `layouts:changed` emit.
/// dotfile(자기 쓰기의 `.tmp` 단계 포함)은 무시한다 — 워크트리 갈래는 빼고(점 파일도 트리에 선다).
///
/// `chats`는 앱이 쥔 그 대화 호스트다(셋업이 빌더 앞의 값을 건넨다).
pub fn start(app: AppHandle, chats: Arc<ConversationHost>) {
    for watch in watches() {
        spawn_watch(app.clone(), watch, Arc::clone(&chats));
    }
}

/// 감시 하나의 **계획.** 자리·재귀 여부·디바운스·쏘는 이름·거르는 규칙이 한 값에 모인다.
///
/// **정하는 것과 거는 것을 가른 자리다.** 인자 여섯을 `start`에서 곧바로 넘기면 「어느
/// 자리를 어떤 규칙으로 보는가」라는 답이 호출 순서에만 있고, 그것은 `AppHandle`과 스레드
/// 없이는 못 읽는다 — 진행 중 루트가 한 겹만 감시되게 바뀌거나 다른 이벤트를 쏘게 바뀌어도
/// 아무 검사가 안 빨개진다. 계획을 값으로 두면 그것을 그대로 잴 수 있다.
struct Watch {
    dir: PathBuf,
    recursive: RecursiveMode,
    debounce: Duration,
    event: &'static str,
    relevant: fn(&Path) -> bool,
    /// 종을 친 회차마다 대화 호스트에게 사라진 work의 쉬는 대화를 끄게 하나(three-axes 티켓 11 · S10). work가 사라지는 소식은
    /// 진행 중 루트의 감시로만 온다 — 사이드바의 아카이브 · 삭제도, 앱 밖 MCP의 아카이브도.
    tells_chats: bool,
    /// 둘째 갈래 — 진행 중 루트만 갖는다(git-integration S7). 위 규칙이 버리는 워크트리(`trees/`) 안의 변경을 판정에 넘긴다.
    worktrees: Option<WorktreeBranch>,
}

/// 워크트리 갈래(git-integration 티켓 10). **새 OS 감시가 아니다**(사실 13) — 진행 중 루트의 감시가 이미 받는 `trees/` 아래
/// 이벤트를 코어의 감시 경로 판정(`atelier_core::worktree_changes`)에 넘겨, 걸리지 않은 변경이 있었던 (slug, 프로젝트) 쌍마다
/// `event`를 쏜다. 빌드가 `target/`에 쏟는 것은 판정이 거른다.
struct WorktreeBranch {
    event: &'static str,
    judge: fn(&[PathBuf]) -> Vec<atelier_core::WorktreeChange>,
}

/// 앱이 거는 감시 **전부.** 감시는 걸 때 그 폴더를 만든다(`spawn_watch`) — 여기 없는 자리는
/// 앱이 켜져도 생기지 않는다.
///
/// **아카이브는 안 본다.** 아카이빙은 늘 진행 중 루트에서 하나가 사라지는 일이라, 거기 걸린
/// 감시가 이미 그것을 본다.
fn watches() -> Vec<Watch> {
    let mut all = vec![Watch {
        dir: atelier_core::projects_dir(),
        recursive: RecursiveMode::NonRecursive,
        debounce: Duration::from_millis(500),
        event: "projects:changed",
        relevant: project_change_is_relevant,
        tells_chats: false,
        worktrees: None,
    }];
    // works는 spec/ 하위까지 재귀 감시하되, 코드 체크아웃인 trees/ 하위는
    // 빌드 등으로 이벤트가 폭주하므로 `works:changed`로는 무시한다. 대화 기록인 <slug>/agents/ 하위도
    // 흐르는 답이 줄마다 쓰므로 무시한다(`in_conversation_records`).
    // spec 라이브 리로드는 반응성이 중요해 더 짧게 디바운스한다 (스펙: 300ms)
    //
    // trees/ 하위는 둘째 갈래가 받는다(git-integration S7) — gitignore에 걸리지 않은 변경만 워크트리마다 `worktree:changed`로
    // 쏜다. 디바운스는 같은 값을 같이 쓴다.
    all.push(Watch {
        dir: atelier_core::works_dir(),
        recursive: RecursiveMode::Recursive,
        debounce: Duration::from_millis(300),
        event: "works:changed",
        relevant: works_change_is_relevant,
        tells_chats: true,
        worktrees: Some(WorktreeBranch { event: "worktree:changed", judge: worktree_changes_in_works }),
    });
    // spec 레이아웃 폴더(spec 레이아웃 결정 22) — 에이전트가 저장하거나 손으로 고친 레이아웃을 설정의
    // 「spec 레이아웃」과 `spec` 패널이 따라온다. 레이아웃은 이 폴더 안의 `atelier/`에 살고 이벤트는
    // 하나다. 반응성도 spec 라이브 리로드와 같은 값이다(spec 레이아웃 구현 스펙 3절: 기존 감시와 같은 규격).
    //
    // 기동 때 폴더를 만드는 것은 다른 감시와 같다(`spawn_watch`). 빈 `layouts/`는 resolve에 아무
    // 영향이 없다 — resolve는 `atelier/`만 본다. 「읽기는 아무것도 쓰지 않는다」는 엔진의 약속이고
    // 감시자는 앱의 것이다.
    all.push(Watch {
        dir: atelier_core::layouts_dir(),
        recursive: RecursiveMode::Recursive,
        debounce: Duration::from_millis(300),
        event: "layouts:changed",
        relevant: layout_change_is_relevant,
        tells_chats: false,
        worktrees: None,
    });
    all
}

/// 진행 중 루트 아래 경로들의 감시 경로 판정 — 갈래가 부르는 것. 트리 목록이 읽는 뿌리와 같은 뿌리라 빠른 길(S6)이 맞물린다.
fn worktree_changes_in_works(paths: &[PathBuf]) -> Vec<atelier_core::WorktreeChange> {
    atelier_core::worktree_changes(&atelier_core::works_dir(), paths)
}

/// 프로젝트 등록부는 파일 하나가 프로젝트 하나다 — 그 `.md`가 아니면 화면이 바뀔 일이 없다.
fn project_change_is_relevant(path: &Path) -> bool {
    path.file_name().is_some_and(|n| {
        let n = n.to_string_lossy();
        !n.starts_with('.') && n.ends_with(".md")
    })
}

/// 재귀 감시가 걸린 루트 아래에서 **화면을 다시 그릴 만한 변경인가.**
fn works_change_is_relevant(path: &Path) -> bool {
    let in_trees = path
        .components()
        .any(|c| matches!(c, std::path::Component::Normal(n) if n == "trees"));
    !in_trees && !in_conversation_records(path) && !is_dotfile(path)
}

/// work 폴더 바로 아래의 대화 기록(`<slug>/agents/`, three-axes 결정 18)인가. 흐르는 답이 줄마다 이 폴더를 쓰는데,
/// 화면은 대화를 기록 줄 이벤트로 그리므로 종을 칠 까닭이 없다(three-axes 구현 스펙 S17).
///
/// **works 루트에서 둘째 마디만 본다** — `trees`처럼 어느 마디든 거르면 spec 안의 `agents/` 폴더 문서까지 죽는다.
/// 루트는 계획이 쥘 수 없어(`fn` 포인터) 여기서 부른다. 루트 밖의 경로로 오면(FSEvents가 심링크를 푼 경로를 줄 수
/// 있다) 거르지 않는다 — 기록 한 줄에 종이 한 번 더 우는 쪽이 문서의 바뀜을 놓치는 쪽보다 낫다.
fn in_conversation_records(path: &Path) -> bool {
    let Ok(rest) = path.strip_prefix(atelier_core::works_dir()) else {
        return false;
    };
    let mut parts = rest.components().skip(1);
    matches!(parts.next(), Some(std::path::Component::Normal(n)) if n == "agents")
}

/// 레이아웃 폴더 아래는 점 파일만 거른다 — 저장의 원자적 쓰기가 남기는 tmp 단계다. 나머지는 모두
/// 소식이다: `layout.json`도, 어느 깊이의 템플릿도, 되돌리기로 사라지는 `atelier/` 폴더 자체도.
/// works의 체크아웃 거르기(`trees/`)는 빌리지 않는다 — 레이아웃에는 체크아웃이 없고, 템플릿 파일은
/// 레이아웃 폴더 안의 `trees/`라는 하위 폴더에도 설 수 있다(손으로 적은 템플릿 경로는 폴더 안 어느
/// 상대 경로든 된다).
fn layout_change_is_relevant(path: &Path) -> bool {
    !is_dotfile(path)
}

fn is_dotfile(path: &Path) -> bool {
    path.file_name().is_some_and(|n| n.to_string_lossy().starts_with('.'))
}

/// 폴더 하나를 디바운스로 보며 **종만 친다** — 무엇이 바뀌었는지는 안 싣고, 프런트가 그
/// 종을 듣고 다시 물어본다. 워크트리 갈래만 어느 워크트리인지(slug · 프로젝트)를 싣는다.
/// 회차 루프는 `ring`이다.
///
/// **`shells.rs`의 `watch_into`와 짝이다.** 디바운서를 세우는 앞 절반(`create_dir_all` →
/// 채널 → `new_debouncer` → `watch`)이 줄 단위로 같고 오류 문구까지 겹친다. 회차 루프는 이쪽만
/// 쌓인 묶음을 합치고 판정을 따로 된 스레드에 넘긴다(`ring`).
/// 그쪽이 따로 선 근거는 **나가는 것**이지(바뀐 셸을 페이로드로 싣는다) 이 배선이 아니므로,
/// notify의 API가 바뀌거나 오류 처리를 고칠 때는 두 자리를 함께 고쳐야 한다.
fn spawn_watch(app: AppHandle, watch: Watch, chats: Arc<ConversationHost>) {
    std::thread::spawn(move || {
        let _ = std::fs::create_dir_all(&watch.dir);
        let (tx, rx) = std::sync::mpsc::channel();
        let mut debouncer = match new_debouncer(watch.debounce, tx) {
            Ok(d) => d,
            Err(e) => {
                eprintln!("atelier: watcher init failed for {}: {e}", watch.dir.display());
                return;
            }
        };
        if let Err(e) = debouncer.watcher().watch(&watch.dir, watch.recursive) {
            eprintln!("atelier: failed to watch {}: {e}", watch.dir.display());
            return;
        }
        ring(rx, watch, chats, move |event, change| {
            let _ = match change {
                Some(change) => app.emit(event, change),
                None => app.emit(event, ()),
            };
        });
    });
}

/// 종을 치는 자리 — 이름과, 워크트리 갈래면 그 쌍. `AppHandle`은 창과 웹뷰가 있어야 서서, 검사는 이 자리를 갈아 끼운다.
type Bell = dyn Fn(&'static str, Option<atelier_core::WorktreeChange>) + Send + Sync;

/// 감시의 회차 루프 — 디바운서가 보낸 묶음을 받아 종을 친다. 디바운서가 서 있는 동안 돌아오지 않는다.
///
/// **워크트리 갈래의 판정은 이 고리 밖, 판정 스레드에서 돈다**(git-integration 티켓 10 · 리뷰 반영). 판정은 git에 묻느라 디바운스보다
/// 오래 걸릴 수 있다 — 인덱스가 큰 저장소의 폭주면 몇 초다. 이 고리가 그것을 기다리면 그동안 에이전트가 고친 spec이 판정이 끝나야
/// `works:changed`로 나가, 300ms로 잡은 spec 라이브 리로드가 판정 시간만큼 밀린다. 그래서 이 고리는 `works:changed`를 곧바로 치고
/// 경로는 판정 스레드에 넘기기만 한다.
///
/// **밀리면 쌓인 묶음과 합친다.** 이 고리도 판정 스레드도 받을 때마다 쌓인 것을 다 꺼내 한 번에 본다 — 판정이 밀린 동안 온 묶음을
/// 하나씩 따로 판정하면 판정이 판정을 쫓는다.
///
/// 회차마다 종을 치고 대화 호스트에게 사라진 work를 묻는 것은 `on_news`다(three-axes 티켓 11) — 묻기도 띄운 스레드가 해서 이
/// 고리를 붙잡지 않는다. 판정 스레드에 넘기는 것은 그 뒤다.
fn ring<C: VanishedWorks>(
    rx: Receiver<DebounceEventResult>,
    mut watch: Watch,
    chats: Arc<C>,
    emit: impl Fn(&'static str, Option<atelier_core::WorktreeChange>) + Send + Sync + 'static,
) {
    let emit: Arc<Bell> = Arc::new(emit);
    let judging = watch.worktrees.take().map(|branch| spawn_judge(branch, Arc::clone(&emit)));
    while let Ok(first) = rx.recv() {
        let paths: Vec<PathBuf> = std::iter::once(first)
            .chain(rx.try_iter())
            .filter_map(Result::ok)
            .flatten()
            .map(|e| e.path)
            .collect();
        // 묻는 스레드는 기다리지 않고 놓는다
        let _ = on_news(&watch, paths.iter().map(PathBuf::as_path), |event| emit(event, None), &chats);
        if let Some(judging) = &judging {
            // 판정 스레드가 없으면(죽었다) 그 갈래만 멎는다 — `works:changed`는 계속 운다
            let _ = judging.send(paths);
        }
    }
}

/// 워크트리 갈래의 판정 스레드를 세우고, 경로 묶음을 넘길 자리를 돌려준다. 받을 때마다 쌓인 묶음을 다 꺼내 한 번에 판정하고, 쌍마다
/// 종을 친다. 넘길 자리가 닫히면(감시 고리가 끝났다) 끝난다.
fn spawn_judge(branch: WorktreeBranch, emit: Arc<Bell>) -> Sender<Vec<PathBuf>> {
    let (tx, rx) = std::sync::mpsc::channel::<Vec<PathBuf>>();
    std::thread::spawn(move || {
        while let Ok(first) = rx.recv() {
            let paths: Vec<PathBuf> = std::iter::once(first).chain(rx.try_iter()).flatten().collect();
            for change in (branch.judge)(&paths) {
                emit(branch.event, Some(change));
            }
        }
    });
    tx
}

/// 감시가 사라진 work를 알리는 곳 — 앱에서는 앱이 쥔 대화 호스트다(three-axes 티켓 11 · S10). 감시의 회차가 호스트에 닿는 길을
/// 검사가 가짜 호스트로 그대로 타려고 둔 자리다.
trait VanishedWorks: Send + Sync + 'static {
    /// 사라진 work의 쉬는 대화를 끈다 — 끌 대화가 있으면 1초 남짓 막힌다.
    fn check_vanished_works(&self);
}

impl VanishedWorks for ConversationHost {
    fn check_vanished_works(&self) {
        ConversationHost::check_vanished_works(self);
    }
}

/// 감시 한 회차 — 바뀐 경로 가운데 화면을 다시 그릴 만한 것이 있으면 종을 치고(`bell`), 대화 호스트에게 알리는 감시면 사라진
/// work를 묻는다(`chats`). 거를 것만 바뀐 회차는 아무것도 하지 않는다. 워크트리 갈래의 판정은 이 밖이다(`ring`이 넘긴다).
///
/// 묻기는 따로 띄운 스레드가 한다 — 끌 대화가 있으면 끄기가 최대 1초 남짓 막히는데, 감시의 회차를 붙잡지 않게. 띄운 스레드를
/// 돌려준다(물을 일이 없었으면 `None`). 감시는 기다리지 않고 놓는다.
fn on_news<'a, C: VanishedWorks>(
    watch: &Watch,
    paths: impl IntoIterator<Item = &'a Path>,
    bell: impl FnOnce(&'static str),
    chats: &Arc<C>,
) -> Option<std::thread::JoinHandle<()>> {
    if !paths.into_iter().any(|path| (watch.relevant)(path)) {
        return None;
    }
    bell(watch.event);
    if !watch.tells_chats {
        return None;
    }
    let chats = Arc::clone(chats);
    Some(std::thread::spawn(move || chats.check_vanished_works()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify_debouncer_mini::{DebouncedEvent, DebouncedEventKind};
    use std::sync::{Condvar, LazyLock, Mutex};

    fn watch_on(dir: &Path) -> Watch {
        watches()
            .into_iter()
            .find(|w| w.dir == dir)
            .unwrap_or_else(|| panic!("{}를 아무도 안 본다", dir.display()))
    }

    /// **진행 중 루트는 재귀로 본다.** 한 겹만 보면 밖에서(에이전트가) 쓴 `<slug>/spec/` 아래가 화면에 안 오고,
    /// 이벤트 이름이 틀리면 아무도 안 듣는 종이 울린다.
    #[test]
    fn the_work_root_is_watched_recursively_and_rings_works_changed() {
        let watch = watch_on(&atelier_core::works_dir());
        assert_eq!(
            watch.recursive,
            RecursiveMode::Recursive,
            "목록이 한 겹만 감시된다 — spec/ 아래를 고쳐도 화면이 안 바뀐다"
        );
        assert_eq!(watch.event, "works:changed", "다른 이름을 쏜다 — 아무도 안 듣는다");
        assert_eq!(watch.debounce, Duration::from_millis(300));
    }

    /// **아카이브는 감시 밖이다.** 아카이빙은 늘 진행 중 루트에서 하나가 사라지는 일이라 그쪽 감시가 이미 본다.
    #[test]
    fn the_archive_root_is_not_watched() {
        let watched: Vec<PathBuf> = watches().into_iter().map(|w| w.dir).collect();
        assert!(!watched.contains(&atelier_core::archive_dir()), "아카이브가 감시 목록에 있다");
    }

    /// 프로젝트 등록부는 파일 하나가 프로젝트 하나라 한 겹만 본다.
    #[test]
    fn the_project_registry_is_watched_only_one_layer_deep() {
        let watch = watch_on(&atelier_core::projects_dir());
        assert_eq!(watch.recursive, RecursiveMode::NonRecursive);
        assert_eq!(watch.event, "projects:changed");
    }

    /// **진행 중 루트는 워크트리의 변경도 쏜다**(git-integration 티켓 10 · S7). 새 OS 감시를 걸지 않는다 — 진행 중 루트의 감시가
    /// 이미 `trees/` 아래 이벤트를 받고 있어(사실 13) 같은 감시가 갈래를 하나 더 갖는다. 그 갈래는 코어의 감시 경로 판정이고,
    /// 쌍마다 `worktree:changed`를 쏜다. 다른 감시에는 갈래가 없다.
    #[test]
    fn the_work_root_also_rings_worktree_changed_for_its_worktrees() {
        let works = atelier_core::works_dir();
        let branch = watch_on(&works).worktrees.expect("진행 중 루트에 워크트리 갈래가 없다");
        assert_eq!(branch.event, "worktree:changed", "다른 이름을 쏜다 — 아무도 안 듣는다");
        // 갈래는 코어의 판정이다 — 워크트리 밖은 쌍을 내지 않고, 워크트리 안은 그 쌍을 낸다(없는 워크트리라 git에 묻지 않고
        // 바뀐 것으로 친다)
        assert_eq!((branch.judge)(&[works.join("cart/spec/overview.md")]), vec![]);
        assert_eq!(
            (branch.judge)(&[works.join("no-such-work-t10/trees/web/src/main.rs")]),
            vec![atelier_core::WorktreeChange { slug: "no-such-work-t10".into(), project: "web".into() }]
        );
        for dir in [atelier_core::projects_dir(), atelier_core::layouts_dir()] {
            assert!(watch_on(&dir).worktrees.is_none(), "{}가 워크트리 갈래를 갖는다", dir.display());
        }
    }

    /// 붙드는 판정이 선 자리 — (불렸다, 놓였다). 아래 검사 하나만 쓴다.
    static HELD: LazyLock<(Mutex<(bool, bool)>, Condvar)> = LazyLock::new(Default::default);

    /// 놓일 때까지 붙드는 판정 — 놓이면 진짜 판정을 한다. 인덱스가 큰 저장소에서 git이 오래 걸리는 판정의 흉내다.
    fn held_judge(paths: &[PathBuf]) -> Vec<atelier_core::WorktreeChange> {
        let (lock, turn) = &*HELD;
        let mut held = lock.lock().unwrap();
        held.0 = true;
        turn.notify_all();
        drop(turn.wait_while(held, |(_, released)| !*released).unwrap());
        worktree_changes_in_works(paths)
    }

    /// **워크트리 판정이 도는 동안에도 spec 변경은 곧바로 운다**(리뷰 반영). 판정은 git에 묻느라 오래 걸릴 수 있다 — 인덱스가 큰
    /// 저장소의 폭주면 몇 초다. 감시 고리가 그것을 기다리면 그동안 에이전트가 고친 spec은 판정이 끝나야 `works:changed`로 나가,
    /// 300ms로 잡은 spec 라이브 리로드가 판정 시간만큼 밀린다. 진행 중 루트의 계획 그대로에 판정만 갈아 끼운다.
    #[test]
    fn a_spec_change_rings_while_a_worktree_judgment_is_still_running() {
        let works = atelier_core::works_dir();
        let mut watch = watch_on(&works);
        watch.worktrees = Some(WorktreeBranch { event: "worktree:changed", judge: held_judge });
        let (batches, rx) = std::sync::mpsc::channel();
        let (rang, rings) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            ring(rx, watch, Arc::new(Host::default()), move |event, change| {
                let _ = rang.send((event, change));
            })
        });
        let batch = |rel: &str| Ok(vec![DebouncedEvent::new(works.join(rel), DebouncedEventKind::Any)]);
        let release = || {
            let (lock, turn) = &*HELD;
            lock.lock().unwrap().1 = true;
            turn.notify_all();
        };

        batches.send(batch("no-such-work-t10/trees/web/src/main.rs")).unwrap();
        let (lock, turn) = &*HELD;
        let (held, waited) =
            turn.wait_timeout_while(lock.lock().unwrap(), Duration::from_secs(10), |(called, _)| !*called).unwrap();
        drop(held);
        if waited.timed_out() {
            release();
            panic!("판정이 불리지 않았다");
        }
        batches.send(batch("no-such-work-t10/spec/overview.md")).unwrap();
        let spec = rings.recv_timeout(Duration::from_secs(10));
        release();
        assert_eq!(spec, Ok(("works:changed", None)), "판정이 도는 동안 spec 변경이 울리지 않았다");
        // 판정이 끝나면 그 워크트리도 운다
        assert_eq!(
            rings.recv_timeout(Duration::from_secs(10)),
            Ok((
                "worktree:changed",
                Some(atelier_core::WorktreeChange { slug: "no-such-work-t10".into(), project: "web".into() })
            ))
        );
    }

    /// **앱이 거는 감시는 셋이다** — 프로젝트 등록부 · 진행 중 루트 · 레이아웃 폴더. 감시는 걸 때 그 폴더를
    /// 만들므로(`spawn_watch`), 이 목록에 없는 자리는 앱을 켜도 생기지 않는다(ui-refresh 결정 23).
    #[test]
    fn the_app_watches_the_registry_the_work_root_and_the_layouts_folder() {
        let watched: Vec<PathBuf> = watches().into_iter().map(|w| w.dir).collect();
        assert_eq!(
            watched,
            vec![
                atelier_core::projects_dir(),
                atelier_core::works_dir(),
                atelier_core::layouts_dir(),
            ],
            "감시가 늘거나 줄었다"
        );
    }

    /// **레이아웃 폴더도 기존 감시와 같은 규격으로 본다**(spec 레이아웃 결정 22). 에이전트가 레이아웃을
    /// 저장하거나 사람이 손으로 고치면 설정의 「spec 레이아웃」과 `spec` 패널이 따라와야 한다.
    /// 템플릿은 `atelier/` 아래 하위 폴더에도 서므로 재귀다 — 한 겹만 보면 `tickets/` 아래 템플릿을
    /// 고쳐도 화면이 안 바뀐다. 이벤트 이름이 틀리면 아무도 안 듣는 종이 울린다.
    #[test]
    fn the_layouts_folder_is_watched_recursively_and_rings_layouts_changed() {
        let watch = watch_on(&atelier_core::layouts_dir());
        assert_eq!(
            watch.recursive,
            RecursiveMode::Recursive,
            "레이아웃 폴더가 한 겹만 감시된다 — atelier/ 아래를 고쳐도 화면이 안 바뀐다"
        );
        assert_eq!(watch.event, "layouts:changed", "레이아웃 감시가 다른 이름을 쏜다 — 아무도 안 듣는다");
        assert_eq!(watch.debounce, Duration::from_millis(300));
    }

    /// 레이아웃 폴더 아래는 **점 파일만** 거른다. 저장은 파일마다 점으로 시작하는 tmp를 쓰고 옮기므로
    /// (`atomic.rs`의 `tmp_name`), 그 중간 단계가 새면 저장 한 번이 종을 여러 번 친다.
    ///
    /// **works의 규칙을 빌리지 않는다** — 그쪽은 코드 체크아웃(`trees/`)도 거르는데, 레이아웃에는 체크아웃이
    /// 없고 레이아웃 폴더 안의 `trees/`라는 하위 폴더에 템플릿 파일이 설 수 있다. 계획에 실린 함수로
    /// 잰다(아래 진행 중 루트 검사와 같은 이유).
    #[test]
    fn a_layout_or_template_is_news_but_dotfiles_are_not() {
        let layouts = atelier_core::layouts_dir();
        let relevant = watch_on(&layouts).relevant;
        assert!(relevant(&layouts.join("atelier/layout.json")));
        assert!(relevant(&layouts.join("atelier/decisions.md")));
        assert!(relevant(&layouts.join("atelier/tickets/ticket.md")), "하위 폴더의 템플릿이 안 들린다");
        assert!(relevant(&layouts.join("atelier/trees/a.md")), "works의 체크아웃 거르기가 레이아웃에 샌다");
        // 되돌리기는 레이아웃 폴더를 통째로 지운다
        assert!(relevant(&layouts.join("atelier")));
        for dotfile in [
            "atelier/.layout.json.4242.0.tmp",
            "atelier/tickets/.ticket.md.4242.1.tmp",
            "atelier/.DS_Store",
            ".DS_Store",
        ] {
            assert!(!relevant(&layouts.join(dotfile)), "점 파일 {dotfile}이 새어 들어온다");
        }
    }

    /// 진행 중 루트 아래에서 거르는 규칙. **계획에 실린 함수로 잰다** — 자유 함수를 직접
    /// 부르면 계획이 다른 것을 달고 있어도 이 검사가 초록이다.
    #[test]
    fn a_works_document_is_news_but_dotfiles_and_checkouts_are_not() {
        let works = atelier_core::works_dir();
        let relevant = watch_on(&works).relevant;
        assert!(relevant(&works.join("cart/work.json")));
        assert!(relevant(&works.join("cart/spec/overview.md")));
        assert!(
            !relevant(&works.join("cart/trees/atelier/src/main.rs")),
            "코드 체크아웃 아래가 새어 들어온다 — 빌드 한 번에 이벤트가 폭주한다"
        );
        assert!(
            !relevant(&works.join("cart/.DS_Store")),
            "dotfile이 새어 들어온다 — 자기 쓰기의 .tmp 단계가 스스로를 다시 읽게 한다"
        );
        // 루트의 순서 파일과 그 원자 쓰기 tmp도 점 파일이다(UI개선 S1).
        // 순서만 바뀐 쓰기는 종을 안 친다. 순서 파일을 쓰는 길은 셋이다 — `move_work`(끌기) ·
        // 고정 토글(`update_work_pinned`: 앱 · 다리 · MCP `atelier_edit_work`) · 지우기(`forget_in_order`).
        // - 같은 구획 안의 끌기는 순서 파일만 써서 종이 안 울린다. 앱은 `move_work`의 **응답**으로
        //   캐시를 갈아 끼운다(`hooks.ts`의 `moveWorkOptions`).
        // - 구획을 넘는 끌기와 고정 토글은 `work.json`도 쓰고 그 쓰기가 종을 친다. `reorder`가
        //   순서 파일을 **먼저** 쓰는 차례라(works.rs `reorder`의 3) 그 재조회가 새 순서를 읽는다.
        // - 지우기는 폴더도 지워 어차피 종을 친다.
        // 남는 것은 손으로 고친 순서 파일뿐이고, 그것은 새로고침에야 보인다 — 알고 둔 틈이다.
        assert!(!relevant(&works.join(".order.json")), "순서 파일이 새어 들어온다");
        assert!(!relevant(&works.join(".order.json.4242.0.tmp")), "순서 파일 쓰기의 tmp 단계가 새어 들어온다");
        // 깨진 순서 파일을 옮기기가 덮기 전에 떠 두는 벌(D2 · `atomic.rs`의 `keep_aside`).
        for backup in [".order.json.bak", ".order.json.1.bak"] {
            assert!(!relevant(&works.join(backup)), "순서 파일의 벌 {backup}이 새어 들어온다");
        }
    }

    /// **대화 기록(`<slug>/agents/`)은 소식이 아니다**(three-axes 구현 스펙 S17). 흐르는 답이 줄마다 기록을 쓰는데, 종이
    /// 울릴 때마다 화면이 work 목록(work마다 `git status`)과 열린 문서를 다시 읽는다. 화면은 대화를 기록 줄 이벤트로 그린다.
    ///
    /// **work 폴더 바로 아래의 `agents/`만 거른다** — `trees/`처럼 「어느 마디든」으로 거르면 사람이 spec 안에 둔
    /// `agents/` 폴더의 문서까지 라이브 리로드가 죽는다. work 폴더 자체가 사라지는 일(아카이브 · 삭제)은 그대로 소식이다.
    #[test]
    fn a_conversation_record_is_not_news_but_the_spec_still_is() {
        let works = atelier_core::works_dir();
        let relevant = watch_on(&works).relevant;
        for record in ["cart/agents/3f2a.jsonl", "cart/agents/agents.json", "cart/agents"] {
            assert!(!relevant(&works.join(record)), "대화 기록 {record}이 새어 들어온다 — 흐르는 답 한 줄마다 화면이 다시 읽는다");
        }
        for document in ["cart/spec/overview.md", "cart/spec/agents/roles.md", "cart/spec/agents", "agents/spec/a.md"] {
            assert!(relevant(&works.join(document)), "spec 문서 {document}의 바뀜이 안 들린다");
        }
        assert!(relevant(&works.join("cart")), "work 폴더가 사라진 것이 안 들린다");
        assert!(relevant(&works.join("agents")), "이름이 agents인 work 폴더를 기록으로 읽는다");
    }

    /// 대화 호스트 자리에 서는 가짜 — 사라진 work를 물은 스레드를 적는다.
    #[derive(Default)]
    struct Host {
        asked_on: std::sync::Mutex<Vec<std::thread::ThreadId>>,
    }

    impl VanishedWorks for Host {
        fn check_vanished_works(&self) {
            self.asked_on.lock().unwrap().push(std::thread::current().id());
        }
    }

    /// **진행 중 루트의 소식은 대화 호스트에게도 간다**(three-axes 티켓 11 · S10). 사람이 사이드바에서 work를 아카이브하거나
    /// 지우면 그 소식이 이 감시로만 온다 — 호스트가 그것을 모르면 쉬던 대화의 에이전트가 cwd 없이 앱을 끌 때까지 남는다. 종을 친
    /// 회차마다 호스트에게 사라진 work를 묻는다. 기록 줄만 바뀐 회차(종이 안 울림)와 다른 감시의 소식은 묻지 않는다 — 기록
    /// 쓰기는 흐르는 답 한 줄마다 온다. 계획에 실린 그대로 잰다.
    ///
    /// **묻는 것은 감시의 회차 밖이다** — 끌 대화가 있으면 끄기가 1초 남짓 막히는데, 그동안 회차를 붙잡으면 다음 소식이 밀린다.
    /// 호스트에 닿는 길(회차 → 띄운 스레드 → 호스트)을 그대로 탄다: 그 스레드가 호스트를 안 부르거나 회차 안에서 부르면 빨갛다.
    #[test]
    fn works_news_asks_the_chat_host_for_vanished_works_off_the_watch_round_but_other_news_does_not() {
        let news = |dir: &Path, path: PathBuf| {
            let host = Arc::new(Host::default());
            let mut rung = Vec::new();
            if let Some(asking) = on_news(&watch_on(dir), [path.as_path()], |event| rung.push(event), &host) {
                asking.join().expect("호스트에 묻던 스레드가 죽었다");
            }
            let asked_on = std::mem::take(&mut *host.asked_on.lock().unwrap());
            assert!(
                !asked_on.contains(&std::thread::current().id()),
                "감시의 회차 안에서 호스트를 부른다 — 끌 대화가 있으면 회차가 1초 남짓 막힌다"
            );
            (rung, asked_on.len())
        };
        let works = atelier_core::works_dir();
        assert_eq!(news(&works, works.join("cart")), (vec!["works:changed"], 1), "사라진 work 폴더가 호스트에 안 간다");
        assert_eq!(news(&works, works.join("cart/spec/overview.md")), (vec!["works:changed"], 1));
        assert_eq!(news(&works, works.join("cart/agents/c1.jsonl")), (vec![], 0), "기록 한 줄마다 호스트를 부른다");
        let projects = atelier_core::projects_dir();
        assert_eq!(news(&projects, projects.join("atelier.md")), (vec!["projects:changed"], 0), "프로젝트 소식이 호스트에 간다");
        let layouts = atelier_core::layouts_dir();
        assert_eq!(news(&layouts, layouts.join("atelier/layout.json")), (vec!["layouts:changed"], 0), "레이아웃 소식이 호스트에 간다");
    }

    /// 프로젝트 쪽 규칙은 그대로다 — `.md` 하나가 프로젝트 하나이므로 그 밖은 소식이 아니다.
    #[test]
    fn only_a_project_markdown_is_news_in_the_registry() {
        let projects = atelier_core::projects_dir();
        let relevant = watch_on(&projects).relevant;
        assert!(relevant(&projects.join("atelier.md")));
        assert!(!relevant(&projects.join("atelier.md.tmp")), "자기 쓰기의 중간 단계가 새어 들어온다");
        assert!(!relevant(&projects.join(".DS_Store")));
    }
}
