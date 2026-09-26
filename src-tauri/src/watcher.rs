use std::path::{Path, PathBuf};
use std::time::Duration;

use atelier_core::Mode;
use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode};
use tauri::{AppHandle, Emitter};

/// `~/.atelier/projects/` 감시 → 관련 변경 시 `projects:changed` emit.
/// 두 모드의 진행 중 루트 감시 → 관련 변경 시 `works:changed` emit.
/// `~/.atelier/layouts/` 감시 → 관련 변경 시 `layouts:changed` emit.
/// dotfile(자기 쓰기의 `.tmp` 단계 포함)은 무시한다.
pub fn start(app: AppHandle) {
    for watch in watches() {
        spawn_watch(app.clone(), watch);
    }
}

/// 감시 하나의 **계획.** 자리·재귀 여부·디바운스·쏘는 이름·거르는 규칙이 한 값에 모인다.
///
/// **정하는 것과 거는 것을 가른 자리다.** 인자 여섯을 `start`에서 곧바로 넘기면 「어느
/// 자리를 어떤 규칙으로 보는가」라는 답이 호출 순서에만 있고, 그것은 `AppHandle`과 스레드
/// 없이는 못 읽는다 — Maison 루트가 한 겹만 감시되게 바뀌거나 다른 이벤트를 쏘게 바뀌어도
/// 아무 검사가 안 빨개진다. 계획을 값으로 두면 그것을 그대로 잴 수 있다.
struct Watch {
    dir: PathBuf,
    recursive: RecursiveMode,
    debounce: Duration,
    event: &'static str,
    relevant: fn(&Path) -> bool,
}

/// 앱이 거는 감시 **전부.**
///
/// works 쪽은 **두 모드의 진행 중 루트 둘 다**이고, 이벤트는 **하나**다. 이벤트를 모드별로
/// 나누지 않는다 — 프런트는 쿼리 키 접두사로 무효화하므로, 저쪽 목록을 한 번 더 읽는 비용이
/// 이벤트 종류를 늘리는 비용보다 싸다. 나누면 이벤트를 받는 자리마다 「둘 중 어느 것인가」를
/// 기억해야 하고, 하나가 잊으면 그 화면만 안 갱신된다.
///
/// **아카이브는 두 모드 다 안 본다.** 아카이빙은 늘 진행 중 루트에서 하나가 사라지는
/// 일이라, 거기 걸린 감시가 이미 그것을 본다.
fn watches() -> Vec<Watch> {
    let mut all = vec![Watch {
        dir: atelier_core::projects_dir(),
        recursive: RecursiveMode::NonRecursive,
        debounce: Duration::from_millis(500),
        event: "projects:changed",
        relevant: project_change_is_relevant,
    }];
    // works는 spec/ 하위까지 재귀 감시하되, 코드 체크아웃인 trees/ 하위는
    // 빌드 등으로 이벤트가 폭주하므로 무시한다.
    // spec 라이브 리로드는 반응성이 중요해 더 짧게 디바운스한다 (스펙: 300ms)
    all.extend([Mode::Atelier, Mode::Maison].into_iter().map(|mode| Watch {
        dir: atelier_core::works_dir(mode),
        recursive: RecursiveMode::Recursive,
        debounce: Duration::from_millis(300),
        event: "works:changed",
        relevant: works_change_is_relevant,
    }));
    // spec 레이아웃 폴더(spec 레이아웃 결정 22) — 에이전트가 저장하거나 손으로 고친 레이아웃을 설정의
    // 「spec 레이아웃」과 spec 패널 탭이 따라온다. 모드가 둘이어도 폴더는 하나이고(`<id>/`가 그 안에
    // 나란히 산다) 이벤트도 하나다 — 근거는 위 works의 그것과 같다. 반응성도 spec 라이브 리로드와
    // 같은 값이다(spec 레이아웃 구현 스펙 3절: 기존 감시와 같은 규격).
    //
    // 기동 때 폴더를 만드는 것은 다른 감시와 같다(`spawn_watch`). 빈 `layouts/`는 resolve에 아무
    // 영향이 없다 — resolve는 `<id>/`만 본다. 「읽기는 아무것도 쓰지 않는다」는 엔진의 약속이고
    // 감시자는 앱의 것이다.
    all.push(Watch {
        dir: atelier_core::layouts_dir(),
        recursive: RecursiveMode::Recursive,
        debounce: Duration::from_millis(300),
        event: "layouts:changed",
        relevant: layout_change_is_relevant,
    });
    all
}

/// 프로젝트 등록부는 파일 하나가 프로젝트 하나다 — 그 `.md`가 아니면 화면이 바뀔 일이 없다.
fn project_change_is_relevant(path: &Path) -> bool {
    path.file_name().is_some_and(|n| {
        let n = n.to_string_lossy();
        !n.starts_with('.') && n.ends_with(".md")
    })
}

/// 재귀 감시가 걸린 루트 아래에서 **화면을 다시 그릴 만한 변경인가.** 두 모드가 같은
/// 규칙을 쓴다 — Room의 파일은 work.json 그대로이므로(결정 2) 가를 이유가 없다.
fn works_change_is_relevant(path: &Path) -> bool {
    let in_trees = path
        .components()
        .any(|c| matches!(c, std::path::Component::Normal(n) if n == "trees"));
    !in_trees && !is_dotfile(path)
}

/// 레이아웃 폴더 아래는 점 파일만 거른다 — 저장의 원자적 쓰기가 남기는 tmp 단계다. 나머지는 모두
/// 소식이다: `layout.json`도, 어느 깊이의 템플릿도, 되돌리기로 사라지는 `<id>/` 폴더 자체도.
/// works의 체크아웃 거르기(`trees/`)는 빌리지 않는다 — 레이아웃에는 체크아웃이 없고, 그 이름의
/// 폴더 항목에 템플릿이 설 수 있다.
fn layout_change_is_relevant(path: &Path) -> bool {
    !is_dotfile(path)
}

fn is_dotfile(path: &Path) -> bool {
    path.file_name().is_some_and(|n| n.to_string_lossy().starts_with('.'))
}

/// 폴더 하나를 디바운스로 보며 **종만 친다** — 무엇이 바뀌었는지는 안 싣고, 프런트가 그
/// 종을 듣고 다시 물어본다.
///
/// **`shells.rs`의 `watch_into`와 짝이다.** 디바운서를 세우는 앞 절반(`create_dir_all` →
/// 채널 → `new_debouncer` → `watch` → 회차 루프)이 줄 단위로 같고 오류 문구까지 겹친다.
/// 그쪽이 따로 선 근거는 **나가는 것**이지(바뀐 셸을 페이로드로 싣는다) 이 배선이 아니므로,
/// notify의 API가 바뀌거나 오류 처리를 고칠 때는 두 자리를 함께 고쳐야 한다.
fn spawn_watch(app: AppHandle, watch: Watch) {
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
        for result in rx {
            let Ok(events) = result else { continue };
            if events.iter().any(|e| (watch.relevant)(&e.path)) {
                let _ = app.emit(watch.event, ());
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn watch_on(dir: &Path) -> Watch {
        watches()
            .into_iter()
            .find(|w| w.dir == dir)
            .unwrap_or_else(|| panic!("{}를 아무도 안 본다", dir.display()))
    }

    /// **두 세계의 목록이 같은 규칙으로 감시된다.** Maison을 빼면 밖에서(에이전트가) 쓴
    /// Room의 spec이 화면에 안 오고, 사용자는 앱을 다시 띄워야 그것을 본다 — Atelier에서
    /// 당연한 반응성이 Maison에서만 없다.
    ///
    /// **규칙까지 함께 잰다.** 자리만 보면 Maison 루트를 한 겹만(`NonRecursive`) 보게
    /// 바꾸거나 다른 이름을 쏘게 바꿔도 초록이다 — 그러면 `rooms/<slug>/spec/` 아래가
    /// 통째로 안 보이거나, 이벤트가 아무도 안 듣는 이름으로 나간다.
    #[test]
    fn both_modes_have_their_work_root_watched_by_the_same_rules() {
        for mode in [Mode::Atelier, Mode::Maison] {
            let watch = watch_on(&atelier_core::works_dir(mode));
            assert_eq!(
                watch.recursive,
                RecursiveMode::Recursive,
                "{mode}의 목록이 한 겹만 감시된다 — spec/ 아래를 고쳐도 화면이 안 바뀐다"
            );
            assert_eq!(watch.event, "works:changed", "{mode}가 다른 이름을 쏜다 — 아무도 안 듣는다");
            assert_eq!(watch.debounce, Duration::from_millis(300));
        }
    }

    /// **아카이브는 감시 밖이다** — 두 세계 다. 아카이빙은 늘 진행 중 루트에서 하나가
    /// 사라지는 일이라 그쪽 감시가 이미 본다.
    #[test]
    fn no_archive_root_is_watched() {
        let watched: Vec<PathBuf> = watches().into_iter().map(|w| w.dir).collect();
        for mode in [Mode::Atelier, Mode::Maison] {
            let archive = atelier_core::archive_dir(mode);
            assert!(!watched.contains(&archive), "{mode} 아카이브가 감시 목록에 있다");
        }
    }

    /// **프로젝트 등록부는 Atelier 전용이라 하나뿐이다** (결정 17). 모드별로 늘리면
    /// 「Maison의 프로젝트 폴더」라는 없는 자리가 감시 목록에서부터 생긴다.
    #[test]
    fn the_project_registry_is_watched_once_and_only_one_layer_deep() {
        let watch = watch_on(&atelier_core::projects_dir());
        assert_eq!(watch.recursive, RecursiveMode::NonRecursive);
        assert_eq!(watch.event, "projects:changed");
        assert_eq!(
            watches().len(),
            4,
            "감시가 늘거나 줄었다 — 프로젝트 하나 + 모드별 목록 둘 + 레이아웃 폴더 하나다"
        );
    }

    /// **레이아웃 폴더도 기존 감시와 같은 규격으로 본다**(spec 레이아웃 결정 22). 에이전트가 레이아웃을
    /// 저장하거나 사람이 손으로 고치면 설정의 「spec 레이아웃」과 `spec` 패널 탭이 따라와야 한다.
    /// 템플릿은 `<id>/` 아래 하위 폴더에도 서므로 재귀다 — 한 겹만 보면 `tickets/` 아래 템플릿을
    /// 고쳐도 화면이 안 바뀐다. 이벤트 이름이 틀리면 아무도 안 듣는 종이 울린다.
    #[test]
    fn the_layouts_folder_is_watched_recursively_and_rings_layouts_changed() {
        let watch = watch_on(&atelier_core::layouts_dir());
        assert_eq!(
            watch.recursive,
            RecursiveMode::Recursive,
            "레이아웃 폴더가 한 겹만 감시된다 — <id>/ 아래를 고쳐도 화면이 안 바뀐다"
        );
        assert_eq!(watch.event, "layouts:changed", "레이아웃 감시가 다른 이름을 쏜다 — 아무도 안 듣는다");
        assert_eq!(watch.debounce, Duration::from_millis(300));
    }

    /// 레이아웃 폴더 아래는 **점 파일만** 거른다. 저장은 파일마다 점으로 시작하는 tmp를 쓰고 옮기므로
    /// (`atomic.rs`의 `tmp_name`), 그 중간 단계가 새면 저장 한 번이 종을 여러 번 친다.
    ///
    /// **works의 규칙을 빌리지 않는다** — 그쪽은 코드 체크아웃(`trees/`)도 거르는데, 레이아웃에는 체크아웃이
    /// 없고 `trees/`라는 폴더 항목의 템플릿이 설 수 있다. 계획에 실린 함수로 잰다(위 Room 검사와 같은 이유).
    #[test]
    fn a_layout_or_template_is_news_but_dotfiles_are_not() {
        let layouts = atelier_core::layouts_dir();
        let relevant = watch_on(&layouts).relevant;
        assert!(relevant(&layouts.join("atelier/layout.json")));
        assert!(relevant(&layouts.join("maison/decisions.md")));
        assert!(relevant(&layouts.join("atelier/tickets/ticket.md")), "하위 폴더의 템플릿이 안 들린다");
        assert!(relevant(&layouts.join("atelier/trees/a.md")), "works의 체크아웃 거르기가 레이아웃에 샌다");
        // 되돌리기는 모드의 폴더를 통째로 지운다
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

    /// Room 아래에서도 거르는 규칙이 같다. **계획에 실린 함수로 잰다** — 자유 함수를 직접
    /// 부르면 계획이 다른 것을 달고 있어도 이 검사가 초록이다.
    #[test]
    fn a_rooms_document_is_news_but_dotfiles_and_checkouts_are_not() {
        let rooms = atelier_core::works_dir(Mode::Maison);
        let relevant = watch_on(&rooms).relevant;
        assert!(relevant(&rooms.join("finance/work.json")));
        assert!(relevant(&rooms.join("finance/spec/overview.md")));
        assert!(
            !relevant(&rooms.join("finance/trees/atelier/src/main.rs")),
            "코드 체크아웃 아래가 새어 들어온다 — 빌드 한 번에 이벤트가 폭주한다"
        );
        assert!(
            !relevant(&rooms.join("finance/.DS_Store")),
            "dotfile이 새어 들어온다 — 자기 쓰기의 .tmp 단계가 스스로를 다시 읽게 한다"
        );
        // 루트의 순서 파일과 그 원자 쓰기 tmp도 점 파일이다(UI개선 S1) — 두 세계 루트 다.
        // 순서만 바뀐 쓰기는 종을 안 친다. 순서 파일을 쓰는 길은 셋이다 — `move_work`(끌기) ·
        // 고정 토글(`update_work_pinned`: 앱 · 다리 · MCP `atelier_edit_work`) · 지우기(`forget_in_order`).
        // - 같은 구획 안의 끌기는 순서 파일만 써서 종이 안 울린다. 앱은 `move_work`의 **응답**으로
        //   캐시를 갈아 끼운다(`hooks.ts`의 `moveWorkOptions`).
        // - 구획을 넘는 끌기와 고정 토글은 `work.json`도 쓰고 그 쓰기가 종을 친다. `reorder`가
        //   순서 파일을 **먼저** 쓰는 차례라(works.rs `reorder`의 3) 그 재조회가 새 순서를 읽는다.
        // - 지우기는 폴더도 지워 어차피 종을 친다.
        // 남는 것은 손으로 고친 순서 파일뿐이고, 그것은 새로고침에야 보인다 — 알고 둔 틈이다.
        for root in [rooms.clone(), atelier_core::works_dir(Mode::Atelier)] {
            let relevant = watch_on(&root).relevant;
            assert!(!relevant(&root.join(".order.json")), "{}: 순서 파일이 새어 들어온다", root.display());
            assert!(
                !relevant(&root.join(".order.json.4242.0.tmp")),
                "{}: 순서 파일 쓰기의 tmp 단계가 새어 들어온다",
                root.display()
            );
            // 깨진 순서 파일을 옮기기가 덮기 전에 떠 두는 벌(D2 · `atomic.rs`의 `keep_aside`).
            for backup in [".order.json.bak", ".order.json.1.bak"] {
                assert!(!relevant(&root.join(backup)), "{}: 순서 파일의 벌 {backup}이 새어 들어온다", root.display());
            }
        }
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
