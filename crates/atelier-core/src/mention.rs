//! 입력창의 「@」 언급이 찾는 파일(restart 02b-3 · 구현 스펙 「02b — 대화창」 `@` 파일 언급). **찾는 자리와 글에 넣을 모양을 여기 하나가
//! 정한다** — 화면은 받은 파일을 친 글자로 거르고 고른 것을 `@` 뒤에 넣기만 한다.
//!
//! - **자리는 작업 폴더 · spec 폴더 · 읽는 범위의 Project다.** 작업 폴더는 Session의 cwd다 — Work면 [`WorkPlaces::cwd`](crate::WorkPlaces::cwd)
//!   (worktree가 없으면 spec 폴더, 하나면 그 worktree, 여럿이면 `trees/`), 작업공간 밖 채팅이면 Thread 폴더의 `work/`, 보내기 전의 작업공간
//!   없는 새 채팅이면 없다. 읽는 범위는 [`reading_scope_of`](crate::reading_scope_of) 그대로다 — 범위 없음은 등록된 Project 전부이고, worktree가
//!   아직 없는 Work의 Project도 등록된 자리에서 찾는다. Codex의 `additionalDirectories`로 대신하지 않는다(읽는 범위가 빠져 있다).
//! - **명령은 경로를 받지 않는다** — 채팅 id와 입력창이 쥔 Work · Service · Project의 slug를 받고, 자리는 등록부 · Work 파일에서 푼다. 밖을
//!   가리키는 slug는 Work · Thread 읽기가 거절한다.
//! - **작업 폴더 안은 상대 경로, 밖은 절대 경로다** — 자리마다 `root`가 그 앞부분이다(`""` · `web-app/` · `/…/repos/api-server/`). 글은
//!   그대로 Runtime에 간다.
//! - **파일은 git 저장소면 git이 고른다**(추적 중 + 추적 안 됐지만 걸리지 않은 것 — 트리 목록과 같은 부름). 저장소가 아니면(spec 폴더 ·
//!   Thread의 `work/`) 디스크를 걷고 점으로 시작하는 것은 건너뛴다. 한 자리는 [`PLACE_LIMIT`]까지만 싣는다.
//!
//! 읽기만 한다. 자리가 없는 폴더는 건너뛴다.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::Result;

/// 파일을 찾는 자리 하나와 그 안의 파일 — 화면이 받는 모양 그대로다(앱 명령 `mention_files`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MentionPlace {
    /// 메뉴가 줄 끝에 다는 자리의 이름 — Project 이름, spec 폴더면 `spec`. 작업 폴더 안의 자리면 `None`이다(넣는 글이 곧 보이는 이름이다).
    pub name: Option<String>,
    /// 글에 넣을 때 파일 앞에 붙는 것 — 작업 폴더 안이면 그 안의 상대 자리(`""` · `web-app/`), 밖이면 그 자리의 절대 경로와 `/`.
    pub root: String,
    /// 자리 안의 파일 — 자리 기준 상대 경로이고 조각은 `/`로 잇는다. 경로 차례다.
    pub files: Vec<String>,
}

/// 「@」 언급이 찾는 자리와 파일. `thread`가 있으면 그 채팅의 자리, 없으면 보내기 전의 새 채팅이 쥔 Work · Service · Project의 자리다(읽는
/// 범위와 같은 인자 — 둘을 함께 주면 거절한다). 차례는 작업 폴더 안 → spec 폴더 → 읽는 범위의 Project다.
pub fn mention_files(
    data_root: &Path,
    thread: Option<&str>,
    work: Option<&str>,
    service: Option<&str>,
    project: Option<&str>,
) -> Result<Vec<MentionPlace>> {
    let scope = crate::reading_scope::reading_scope_of(data_root, thread, work, service, project)?;
    let works = crate::paths::works_in(data_root);
    let mut dirs: Vec<(Option<String>, PathBuf)> = Vec::new();
    let mut cwd = None;
    let linked = match thread {
        Some(id) => match crate::threads::read_thread(data_root, id)?.work {
            Some(slug) => crate::works::read_work(&works, &slug).ok(),
            None => {
                let dir = crate::threads::thread_work_dir(data_root, id)?;
                dirs.push((None, dir.clone()));
                cwd = Some(dir);
                None
            }
        },
        None => work.map(|slug| crate::works::read_work(&works, slug)).transpose()?,
    };
    if let Some(work) = &linked {
        let places = crate::works::work_places(&works, work);
        for (project, tree) in work.projects.iter().zip(&places.worktrees) {
            dirs.push((Some(project.clone()), tree.clone()));
        }
        dirs.push((Some(SPEC.to_owned()), places.spec.clone()));
        cwd = Some(places.cwd());
    }
    dirs.extend(scope.projects.into_iter().map(|project| (Some(project.name), project.folder)));
    Ok(dirs
        .into_iter()
        .filter(|(_, dir)| dir.is_dir())
        .map(|(name, dir)| {
            let inside = cwd.as_deref().and_then(|cwd| dir.strip_prefix(cwd).ok()).map(|rel| {
                rel.iter().map(|part| format!("{}/", part.to_string_lossy())).collect::<String>()
            });
            let files = files_in(&dir);
            match inside {
                Some(root) => MentionPlace { name: None, root, files },
                None => MentionPlace { name, root: format!("{}/", dir.display()), files },
            }
        })
        .collect())
}

/// spec 폴더 자리의 이름.
const SPEC: &str = "spec";

/// 한 자리가 싣는 파일의 상한 — 넘는 큰 저장소는 경로 차례로 앞에서부터 싣는다. 걷는 자리는 여기서 멈춘다. 이만큼이면 답이 1MB 남짓이고
/// 화면이 칠 때마다 거르는 데 ms 단위다.
const PLACE_LIMIT: usize = 20_000;

fn files_in(dir: &Path) -> Vec<String> {
    let mut files: Vec<String> = if dir.join(".git").exists() {
        crate::worktree::ls_files(dir, &["--cached", "--others", "--exclude-standard"])
            .unwrap_or_default()
            .into_iter()
            .filter(|rel| std::fs::symlink_metadata(dir.join(rel)).is_ok_and(|meta| !meta.is_dir()))
            .collect()
    } else {
        let mut out = Vec::new();
        walk(dir, "", &mut out);
        out
    };
    files.sort();
    files.truncate(PLACE_LIMIT);
    files
}

/// 저장소가 아닌 자리(spec 폴더)를 걷는다 — 점으로 시작하는 것은 건너뛴다(spec 트리 · `spec_files`와 같다).
fn walk(dir: &Path, prefix: &str, out: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        if out.len() >= PLACE_LIMIT {
            return;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let rel = format!("{prefix}{name}");
        match entry.file_type() {
            Ok(kind) if kind.is_dir() => walk(&entry.path(), &format!("{rel}/"), out),
            Ok(_) => out.push(rel),
            Err(_) => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    /// 데이터 루트 하나와 그 곁의 저장소들(`repos/<slug>`). 저장소는 git 저장소다 — 커밋 없이도 `ls-files --others`가 파일을 낸다.
    struct Home {
        dir: tempfile::TempDir,
    }

    impl Home {
        fn new() -> Self {
            Self { dir: tempfile::tempdir().unwrap() }
        }

        fn root(&self) -> PathBuf {
            self.dir.path().join("home")
        }

        fn folder(&self, slug: &str) -> PathBuf {
            self.dir.path().join("repos").join(slug)
        }

        /// 저장소 하나를 세우고 Project로 등록한다 — 이름은 slug와 같다.
        fn repo(&self, slug: &str, files: &[&str]) -> &Self {
            let folder = self.folder(slug);
            std::fs::create_dir_all(&folder).unwrap();
            git(&folder, &["init", "-q", "-b", "main"]);
            for rel in files {
                write(&folder, rel);
            }
            let projects = crate::paths::projects_in(&self.root());
            std::fs::create_dir_all(&projects).unwrap();
            let file = format!("---\nname: {slug}\npath: {}\nbaseBranch: main\ncreatedAt: 2026-10-01\n---\n", folder.display());
            std::fs::write(projects.join(format!("{slug}.md")), file).unwrap();
            self
        }

        /// Work `refund` — `projects`를 적고, `trees`에 든 Project만 worktree가 선다(그 자리의 git 저장소). spec 폴더에는 `spec`의 파일을 둔다.
        fn work(&self, projects: &[&str], trees: &[(&str, &[&str])], spec: &[&str]) -> PathBuf {
            let dir = crate::paths::works_in(&self.root()).join("refund");
            std::fs::create_dir_all(dir.join("spec")).unwrap();
            let listed = projects.iter().map(|one| format!("\"{one}\"")).collect::<Vec<_>>().join(",");
            std::fs::write(
                dir.join("work.json"),
                format!(r#"{{"title":"환불","status":"active","createdAt":"2026-10-01","projects":[{listed}]}}"#),
            )
            .unwrap();
            for (project, files) in trees {
                let tree = dir.join("trees").join(project);
                std::fs::create_dir_all(&tree).unwrap();
                git(&tree, &["init", "-q", "-b", "main"]);
                files.iter().for_each(|rel| write(&tree, rel));
            }
            spec.iter().for_each(|rel| write(&dir.join("spec"), rel));
            dir
        }
    }

    fn git(dir: &Path, args: &[&str]) {
        let out = Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
        assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    }

    fn write(root: &Path, rel: &str) {
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, "x").unwrap();
    }

    fn abs(dir: &Path) -> String {
        format!("{}/", dir.display())
    }

    #[test]
    fn 범위가_없는_새_채팅은_등록된_project_전부에서_찾고_절대_경로로_넣는다() {
        let home = Home::new();
        home.repo("web-app", &[".gitignore", "src/main.ts", "dist/app.js"]);
        std::fs::write(home.folder("web-app").join(".gitignore"), "dist/\n").unwrap();
        home.repo("api-server", &["src/lib.rs"]);

        let places = mention_files(&home.root(), None, None, None, None).unwrap();

        assert_eq!(
            places,
            [
                MentionPlace { name: Some("api-server".into()), root: abs(&home.folder("api-server")), files: vec!["src/lib.rs".into()] },
                MentionPlace {
                    name: Some("web-app".into()),
                    root: abs(&home.folder("web-app")),
                    files: vec![".gitignore".into(), "src/main.ts".into()],
                },
            ],
            "읽는 범위의 차례(이름 차례)이고, gitignore에 걸린 파일은 없다"
        );
    }

    /// worktree 하나인 Work의 작업 폴더는 그 worktree다(Session의 cwd) — 그 안의 파일은 상대 경로, spec 폴더와 읽는 범위의 Project는 절대 경로다.
    #[test]
    fn 작업_폴더의_파일은_상대_경로이고_spec_폴더와_범위의_project는_절대_경로다() {
        let home = Home::new();
        home.repo("web-app", &["README.md"]).repo("api-server", &["src/lib.rs"]);
        let dir = home.work(&["web-app"], &[("web-app", &["src/watcher.rs"])], &["overview.md", "notes/plan.md", ".draft.md"]);

        let places = mention_files(&home.root(), None, Some("refund"), None, None).unwrap();

        assert_eq!(
            places,
            [
                MentionPlace { name: None, root: String::new(), files: vec!["src/watcher.rs".into()] },
                MentionPlace {
                    name: Some("spec".into()),
                    root: abs(&dir.join("spec")),
                    files: vec!["notes/plan.md".into(), "overview.md".into()],
                },
                MentionPlace { name: Some("api-server".into()), root: abs(&home.folder("api-server")), files: vec!["src/lib.rs".into()] },
            ],
            "worktree가 선 web-app은 그 worktree에서 찾고 등록된 자리에서 다시 찾지 않는다 — spec의 점 파일은 spec 트리처럼 없다"
        );
    }

    /// worktree가 아직 없는 Work — 작업 폴더는 spec 폴더이고, Work의 Project는 읽는 범위로 등록된 자리에서 찾는다.
    #[test]
    fn worktree가_없는_작업공간은_spec_폴더가_작업_폴더이고_project는_등록된_자리에서_찾는다() {
        let home = Home::new();
        home.repo("web-app", &["src/main.ts"]);
        home.work(&["web-app"], &[], &["overview.md"]);

        let places = mention_files(&home.root(), None, Some("refund"), None, None).unwrap();

        assert_eq!(
            places,
            [
                MentionPlace { name: None, root: String::new(), files: vec!["overview.md".into()] },
                MentionPlace { name: Some("web-app".into()), root: abs(&home.folder("web-app")), files: vec!["src/main.ts".into()] },
            ]
        );
    }

    /// worktree가 여럿이면 작업 폴더는 `trees/`다 — 파일은 Project 폴더부터 적는 상대 경로다.
    #[test]
    fn worktree가_여럿이면_project_폴더부터_적는_상대_경로다() {
        let home = Home::new();
        home.repo("web-app", &[]).repo("api-server", &[]);
        let dir = home.work(&["web-app", "api-server"], &[("web-app", &["a.ts"]), ("api-server", &["b.rs"])], &["overview.md"]);

        let places = mention_files(&home.root(), None, Some("refund"), None, None).unwrap();

        assert_eq!(
            places,
            [
                MentionPlace { name: None, root: "web-app/".into(), files: vec!["a.ts".into()] },
                MentionPlace { name: None, root: "api-server/".into(), files: vec!["b.rs".into()] },
                MentionPlace { name: Some("spec".into()), root: abs(&dir.join("spec")), files: vec!["overview.md".into()] },
            ],
            "Work에 적힌 차례다"
        );
    }

    fn thread(home: &Home, new: crate::NewThread) -> String {
        crate::threads::create_thread(&home.root(), new, crate::RecordKind::Sent, serde_json::json!({"text": "봐 줘"})).unwrap().id
    }

    /// 작업공간 밖 채팅 — 작업 폴더는 Thread 폴더의 `work/`이고, 그 Thread가 쥔 범위(Project 범위)의 Project에서 찾는다.
    #[test]
    fn 작업공간_밖_채팅은_thread의_work_폴더가_작업_폴더이고_그_범위의_project에서_찾는다() {
        let home = Home::new();
        home.repo("web-app", &["src/main.ts"]).repo("api-server", &["src/lib.rs"]);
        let id = thread(&home, crate::NewThread { title: "환불".into(), project: Some("api-server".into()), ..Default::default() });
        let work = crate::threads::open_thread_work_dir(&home.root(), &id).unwrap();
        write(&work, "notes.md");

        let places = mention_files(&home.root(), Some(&id), None, None, None).unwrap();

        assert_eq!(
            places,
            [
                MentionPlace { name: None, root: String::new(), files: vec!["notes.md".into()] },
                MentionPlace { name: Some("api-server".into()), root: abs(&home.folder("api-server")), files: vec!["src/lib.rs".into()] },
            ]
        );
    }

    /// 작업공간의 채팅 — 그 Thread가 이은 Work의 자리에서 찾는다(새 채팅 때 Work를 준 것과 같다).
    #[test]
    fn 작업공간의_채팅은_이은_work의_자리에서_찾는다() {
        let home = Home::new();
        home.repo("web-app", &[]).repo("api-server", &["src/lib.rs"]);
        home.work(&["web-app"], &[("web-app", &["src/watcher.rs"])], &[]);
        let id = thread(&home, crate::NewThread { title: "환불".into(), work: Some("refund".into()), ..Default::default() });

        let places = mention_files(&home.root(), Some(&id), None, None, None).unwrap();

        assert_eq!(places, mention_files(&home.root(), None, Some("refund"), None, None).unwrap());
        assert_eq!(places[0], MentionPlace { name: None, root: String::new(), files: vec!["src/watcher.rs".into()] });
    }

    /// 명령은 경로가 아니라 등록된 slug를 받는다 — 밖을 가리키는 slug · 없는 Work는 찾지 않고 거절한다. 채팅과 입력창의 범위를 함께 주는 것도
    /// 읽는 범위와 같이 거절한다.
    #[test]
    fn 밖을_가리키는_slug와_없는_work와_채팅과_범위를_함께_준_것은_거절한다() {
        let home = Home::new();
        home.repo("web-app", &["a.ts"]);
        home.work(&[], &[], &[]);
        let id = thread(&home, crate::NewThread { title: "환불".into(), ..Default::default() });

        assert!(matches!(mention_files(&home.root(), None, Some(".."), None, None), Err(crate::Error::WorkNotFound(_))));
        assert!(matches!(mention_files(&home.root(), None, Some("nope"), None, None), Err(crate::Error::WorkNotFound(_))));
        assert!(mention_files(&home.root(), Some("../x"), None, None, None).is_err());
        assert!(matches!(mention_files(&home.root(), Some(&id), Some("refund"), None, None), Err(crate::Error::Validation(_))));
        assert_eq!(
            mention_files(&home.root(), None, None, None, Some("../web-app")).unwrap(),
            mention_files(&home.root(), None, None, None, None).unwrap(),
            "등록되지 않은 Project 범위는 범위가 없는 것이다(읽는 범위와 같다)"
        );
    }

    #[test]
    fn 답은_camel_case이고_작업_폴더의_자리는_이름이_없다() {
        let home = Home::new();
        home.repo("web-app", &[]);
        home.work(&["web-app"], &[("web-app", &["a.ts"])], &[]);

        let json = serde_json::to_value(mention_files(&home.root(), None, Some("refund"), None, None).unwrap()).unwrap();

        assert_eq!(json[0], serde_json::json!({ "name": null, "root": "", "files": ["a.ts"] }));
    }

    /// 한 자리가 싣는 파일의 상한 — 넘으면 상한까지만 싣는다. 걷는 자리는 상한에서 멈춘다(`node_modules`를 끝까지 걷지 않는다).
    #[test]
    fn 한_자리는_상한까지만_싣는다() {
        let home = Home::new();
        let id = thread(&home, crate::NewThread { title: "환불".into(), ..Default::default() });
        let work = crate::threads::open_thread_work_dir(&home.root(), &id).unwrap();
        for folder in ["a", "b"] {
            std::fs::create_dir_all(work.join(folder)).unwrap();
            for n in 0..PLACE_LIMIT / 2 + 1 {
                std::fs::write(work.join(folder).join(format!("{n}")), "").unwrap();
            }
        }

        let places = mention_files(&home.root(), Some(&id), None, None, None).unwrap();

        assert_eq!(places[0].files.len(), PLACE_LIMIT);
    }
}
