//! 범위 — Thread가 부를 수 있는 Agent를 찾고, 부르는 이름 하나를 정의 하나로 푼다(v1 구현 스펙 §6 범위 · v1 티켓 11).
//!
//! - **자리.** Work 없는 Thread는 Library만 본다. Work에 이은 Thread는 Library와, 그 Work의 Project마다 레포 안
//!   `.atelier/agents/`를 본다 — worktree가 서 있으면 worktree에서, 없으면(나중으로 미룬 Project, v1 티켓 29) Project 폴더에서
//!   읽는다. 그래서 Agent를 고치는 일도 다른 코드처럼 Work의 PR로 들어간다(스토리 69).
//! - **겹침.** 같은 handle이면 Project 것이 이긴다(그 레포에 맞게 고친 정의다). Project 둘 이상이 가지면 `project/handle`로만
//!   부른다 — 맨 이름은 어느 쪽인지 묻는 답(`Unresolved::Ambiguous`)이고, **Library 것으로 미끄러지지 않는다.** 가리는 것은
//!   파일이 있느냐다: 깨진 Project 파일도 Library 것을 가린다 — 사람이 레포에서 고친 정의가 깨졌다고 다른 정의가 조용히
//!   불리면, 왜 그렇게 답하는지 알 길이 없다.
//! - **`host`는 Library에만 있다.** Project 안의 `host.md`는 Library의 Host를 가리지 않고, 깨진 줄에
//!   `AgentProblem::HostOutsideLibrary`로 선다(흐리게, 까닭과 함께 — 스토리 71).
//!
//! 이 모듈은 **지금 디스크의 정의**를 찾는다. 이미 Thread에 들어온 Agent는 여기서 다시 고르지 않고 스냅숏을 읽는다(S4 ·
//! 스토리 52) — 그것은 참여(v1 티켓 13)의 몫이다.

use std::path::{Path, PathBuf};

use serde::Serialize;

use super::{read_agent, AgentDefinition, AgentProblem};
use crate::paths::{library_agents_in, projects_in, repo_agents_in, works_in};
use crate::store::read_project;
use crate::threads::DefinitionSource;
use crate::{expand_home, read_work, work_places};

/// 범위 안의 Agent — 부를 수 있는 것과 깨진 것. @ 메뉴와 Library 화면이 이것을 그린다(Tauri `list_agents`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRoster {
    /// 부를 수 있는 Agent. 부르는 이름 순이다. 가려진 Library 것은 없다.
    pub agents: Vec<FoundAgent>,
    /// 깨진 파일과 그 까닭 — 부를 수 없다. 부르는 이름 순이다.
    pub broken: Vec<BrokenAgent>,
}

/// 범위 안에서 부를 수 있는 Agent 하나.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FoundAgent {
    /// 부르는 이름(@ 뒤) — 대개 handle이고, Project 둘 이상이 같은 handle을 가지면 `project/handle`이다.
    pub call: String,
    /// 정의가 온 곳 — Thread의 참여자에 그대로 적힌다(v1 티켓 02 · 13).
    pub from: DefinitionSource,
    /// 읽은 파일.
    pub path: PathBuf,
    pub definition: AgentDefinition,
}

/// 범위 안의 깨진 Agent 파일 하나.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokenAgent {
    /// 깨지지 않았다면 불렸을 이름 — 고르기가 이 이름에 까닭으로 답한다. Project 안의 `host`는 늘 `project/host`다(Library의
    /// Host와 이름이 갈리게).
    pub call: String,
    /// 파일 이름 — 정의를 읽지 못했으니 여기 따로 둔다.
    pub handle: String,
    pub from: DefinitionSource,
    pub path: PathBuf,
    pub problem: AgentProblem,
}

/// 이름 하나를 범위 안에서 풀지 못한 까닭.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Unresolved {
    /// 범위 안에 그 이름이 없다.
    NotFound,
    /// Project 둘 이상이 가진 handle이다 — 이 이름들 가운데 하나로 불러야 한다.
    Ambiguous { calls: Vec<String> },
    /// 그 이름의 파일이 깨졌다.
    Broken(AgentProblem),
}

/// 범위 안의 Agent를 찾는다. `work`가 없으면 Library만이다.
///
/// 그 Work가 없으면(지웠거나 보관했다) `WorkNotFound`다 — 범위를 Library로 줄여 답하면, Work의 Agent를 부르던 Thread에서
/// 같은 이름이 조용히 Library 것으로 바뀐다. worktree도 등록도 없는 Project는 읽을 자리가 없어 건너뛴다 — 나머지 범위는 선다.
pub fn find_agents(root: &Path, work: Option<&str>) -> crate::Result<AgentRoster> {
    let mut places = vec![(DefinitionSource::Library, library_agents_in(root))];
    if let Some(slug) = work {
        places.extend(project_places(root, slug)?);
    }
    let mut files = Vec::new();
    for (from, dir) in places {
        files.extend(agent_files(&dir)?.into_iter().map(|path| (from.clone(), handle_of(&path), path)));
    }
    // 그 handle을 가진 Project 파일 수 — 깨진 것까지 센다(가리는 것은 파일이 있느냐다). Project 안의 `host`는 세지 않는다.
    let in_projects =
        |handle: &str| files.iter().filter(|(from, h, _)| is_project(from) && h == handle && h != HOST).count();

    let mut roster = AgentRoster { agents: Vec::new(), broken: Vec::new() };
    for (from, handle, path) in &files {
        if !is_project(from) && in_projects(handle) > 0 {
            continue;
        }
        let call = match from {
            DefinitionSource::Project(project) if handle == HOST || in_projects(handle) > 1 => {
                format!("{project}/{handle}")
            }
            _ => handle.clone(),
        };
        let read = match from {
            DefinitionSource::Project(_) if handle == HOST => Err(AgentProblem::HostOutsideLibrary),
            _ => read_agent(path),
        };
        let (handle, from, path) = (handle.clone(), from.clone(), path.clone());
        match read {
            Ok(definition) => roster.agents.push(FoundAgent { call, from, path, definition }),
            Err(problem) => roster.broken.push(BrokenAgent { call, handle, from, path, problem }),
        }
    }
    roster.agents.sort_by(|a, b| a.call.cmp(&b.call));
    roster.broken.sort_by(|a, b| a.call.cmp(&b.call));
    Ok(roster)
}

/// 범위 안 Agent 파일 하나의 원문 — 부르는 이름으로 고른다. **깨진 파일도 준다** — Library 화면에서 무엇이 틀렸는지 보고
/// 고치게(스토리 71 · 72). 경로를 받지 않는 것은 화면이 범위 밖 파일을 읽을 길을 열지 않기 위해서다.
pub fn read_agent_file(root: &Path, work: Option<&str>, call: &str) -> crate::Result<String> {
    Ok(std::fs::read_to_string(agent_file_path(root, work, call)?)?)
}

/// 범위 안 Agent 파일 하나의 자리 — 부르는 이름으로 고른다(깨진 파일도). Library 화면의 「Finder에서 열기」가 쓴다(v1 티켓 19 ·
/// §16 — 고치는 길의 하나는 외부 편집기다). 파일 읽기와 같은 까닭으로 경로를 받지 않는다.
pub fn agent_file_path(root: &Path, work: Option<&str>, call: &str) -> crate::Result<PathBuf> {
    let roster = find_agents(root, work)?;
    let entry = roster.pick(call).map_err(|unresolved| {
        crate::Error::Validation(match unresolved {
            Unresolved::Ambiguous { calls } => {
                format!("`{call}` Agent가 Project 여럿에 있습니다 — {}로 부릅니다", calls.join(" · "))
            }
            _ => format!("이 범위에 `{call}` Agent가 없습니다"),
        })
    })?;
    Ok(entry.path.to_path_buf())
}

impl AgentRoster {
    /// 부르는 이름 하나를 정의 하나로 푼다 — `reviewer` 또는 `api-server/reviewer`. `project/handle`은 겹치지 않은 Project
    /// 것도 부른다(목록의 이름이 맨 handle이어도).
    pub fn resolve(&self, call: &str) -> Result<&FoundAgent, Unresolved> {
        self.pick(call)?.read.map_err(|problem| Unresolved::Broken(problem.clone()))
    }

    /// 부르는 이름의 파일 하나 — 깨진 것까지.
    fn pick(&self, call: &str) -> Result<Entry<'_>, Unresolved> {
        let entries = self.entries();
        let picked = match call.split_once('/') {
            Some((project, handle)) => entries.iter().find(|entry| {
                matches!(entry.from, DefinitionSource::Project(p) if p == project) && entry.handle == handle
            }),
            None => entries.iter().find(|entry| entry.call == call),
        };
        if let Some(entry) = picked {
            return Ok(*entry);
        }
        // 맨 이름이 목록에 없는데 같은 handle이 있으면 Project끼리 겹친 것이다. Project 안의 `host`는 겹침이 아니다 — 맨
        // `host`는 Library의 Host뿐이다.
        let calls: Vec<String> = match call {
            HOST => Vec::new(),
            _ => entries.iter().filter(|entry| entry.handle == call).map(|entry| entry.call.to_owned()).collect(),
        };
        if calls.is_empty() {
            Err(Unresolved::NotFound)
        } else {
            Err(Unresolved::Ambiguous { calls })
        }
    }

    /// 부를 수 있는 것과 깨진 것을 한 줄로 — 부르는 이름 순이다.
    fn entries(&self) -> Vec<Entry<'_>> {
        let found = self.agents.iter().map(|agent| Entry {
            call: &agent.call,
            handle: &agent.definition.handle,
            from: &agent.from,
            path: &agent.path,
            read: Ok(agent),
        });
        let broken = self.broken.iter().map(|broken| Entry {
            call: &broken.call,
            handle: &broken.handle,
            from: &broken.from,
            path: &broken.path,
            read: Err(&broken.problem),
        });
        let mut entries: Vec<Entry<'_>> = found.chain(broken).collect();
        entries.sort_by(|a, b| a.call.cmp(b.call));
        entries
    }
}

/// 고르기가 보는 파일 하나 — 부를 수 있는 것이든 깨진 것이든.
#[derive(Clone, Copy)]
struct Entry<'a> {
    call: &'a str,
    handle: &'a str,
    from: &'a DefinitionSource,
    path: &'a Path,
    read: Result<&'a FoundAgent, &'a AgentProblem>,
}

/// Library에만 있는 handle — Thread마다 처음부터 있는 Host(agent-definition.md 「파일 위치」). Project마다 다른 Host는 v3이다.
const HOST: &str = "host";

fn is_project(from: &DefinitionSource) -> bool {
    matches!(from, DefinitionSource::Project(_))
}

/// Work의 Project마다 Agent 자리 — `work.json`의 Project 순이다.
///
/// worktree가 「있다」는 그 폴더가 서 있느냐다(`WorktreeView.exists`와 같은 판정). Project 폴더는 등록부에서 git을 캐묻지 않고
/// 읽는다 — @ 메뉴가 열릴 때마다 오는 길이다.
fn project_places(root: &Path, slug: &str) -> crate::Result<Vec<(DefinitionSource, PathBuf)>> {
    let works = works_in(root);
    let work = read_work(&works, slug)?;
    let places = work_places(&works, &work);
    let mut found = Vec::new();
    for (project, tree) in work.projects.iter().zip(places.worktrees) {
        let folder = if tree.is_dir() {
            tree
        } else {
            match read_project(&projects_in(root), project) {
                Ok(registered) => expand_home(&registered.path),
                Err(_) => continue,
            }
        };
        found.push((DefinitionSource::Project(project.clone()), repo_agents_in(&folder)));
    }
    Ok(found)
}

/// 한 자리의 Agent 파일들(`*.md`) — 이름 순이다. 폴더가 없으면 비었다(대개의 레포에는 없다).
///
/// 점으로 시작하는 파일은 Agent가 아니다 — 편집기의 잠금 · 임시 파일(`.#reviewer.md`)이 @ 메뉴에 서면 안 된다(Project
/// 목록 `read_projects`와 같은 규칙).
fn agent_files(dir: &Path) -> crate::Result<Vec<PathBuf>> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };
    let mut files = Vec::new();
    for entry in entries {
        let path = entry?.path();
        let hidden = path.file_name().is_some_and(|name| name.to_string_lossy().starts_with('.'));
        if !hidden && path.extension().is_some_and(|ext| ext == "md") && path.is_file() {
            files.push(path);
        }
    }
    files.sort();
    Ok(files)
}

/// 파일 이름(확장자 뺌)이 handle이다 — `read_agent`와 같은 규칙. 정의를 읽지 못한 깨진 파일에도 이름이 있어야 한다.
fn handle_of(path: &Path) -> String {
    path.file_stem().map(|stem| stem.to_string_lossy().into_owned()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::Tools;
    use std::path::PathBuf;

    /// 그 자리에 Agent 파일 하나를 둔다 — 설명이 곧 지시문이다.
    fn agent(dir: &Path, handle: &str, description: &str) -> PathBuf {
        agent_text(dir, handle, &format!("---\ndescription: {description}\n---\n{description}\n"))
    }

    /// 그 자리에 그 글의 Agent 파일 하나를 둔다. 폴더가 없으면 만든다.
    fn agent_text(dir: &Path, handle: &str, text: &str) -> PathBuf {
        std::fs::create_dir_all(dir).unwrap();
        let path = dir.join(format!("{handle}.md"));
        std::fs::write(&path, text).unwrap();
        path
    }

    fn library(root: &Path) -> PathBuf {
        root.join("library").join("agents")
    }

    /// 부를 수 있는 Agent의 (부르는 이름, 설명) — 설명으로 어느 파일인지 가린다.
    fn callable(roster: &AgentRoster) -> Vec<(&str, &str)> {
        roster.agents.iter().map(|a| (a.call.as_str(), a.definition.description.as_str())).collect()
    }

    #[test]
    fn work_없는_thread는_library만_본다() {
        let root = tempfile::tempdir().unwrap();
        agent(&library(root.path()), "host", "Library Host");
        agent(&library(root.path()), "reviewer", "Library 리뷰어");
        agent(&library(root.path()), ".#reviewer", "편집기의 잠금 파일");
        std::fs::write(library(root.path()).join("notes.txt"), "Agent가 아닌 파일").unwrap();

        let roster = find_agents(root.path(), None).unwrap();

        assert_eq!(callable(&roster), [("host", "Library Host"), ("reviewer", "Library 리뷰어")]);
        assert!(roster.agents.iter().all(|a| a.from == DefinitionSource::Library));
        assert_eq!(roster.broken, []);
    }

    /// 등록부에 Project 하나를 적는다 — 그 폴더(`<tmp>/repos/<slug>`)를 돌려준다.
    fn project(root: &Path, slug: &str) -> PathBuf {
        let folder = root.join("repos").join(slug);
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::create_dir_all(root.join("projects")).unwrap();
        std::fs::write(
            root.join("projects").join(format!("{slug}.md")),
            format!("---\nname: {slug}\npath: {}\nbaseBranch: main\ncreatedAt: 2026-10-23\n---\n", folder.display()),
        )
        .unwrap();
        folder
    }

    /// 그 Project들을 붙인 Work 하나를 적는다. worktree는 만들지 않는다.
    fn work(root: &Path, slug: &str, projects: &[&str]) {
        let dir = root.join("works").join(slug);
        std::fs::create_dir_all(&dir).unwrap();
        let projects = projects.iter().map(|p| format!("\"{p}\"")).collect::<Vec<_>>().join(",");
        std::fs::write(
            dir.join("work.json"),
            format!(r#"{{"title":"{slug}","status":"active","createdAt":"2026-10-23","projects":[{projects}]}}"#),
        )
        .unwrap();
    }

    /// 그 Work의 그 Project worktree 자리 — 폴더를 세운다.
    fn worktree(root: &Path, work: &str, project: &str) -> PathBuf {
        let tree = root.join("works").join(work).join("trees").join(project);
        std::fs::create_dir_all(&tree).unwrap();
        tree
    }

    /// 레포 안 Agent 자리.
    fn in_repo(folder: &Path) -> PathBuf {
        folder.join(".atelier").join("agents")
    }

    fn from(project: &str) -> DefinitionSource {
        DefinitionSource::Project(project.into())
    }

    #[test]
    fn work에_이은_thread는_project_agent를_worktree에서_읽는다() {
        let root = tempfile::tempdir().unwrap();
        agent(&library(root.path()), "host", "Library Host");
        let api = project(root.path(), "api");
        work(root.path(), "w", &["api"]);
        agent(&in_repo(&api), "deployer", "Project 폴더의 것");
        agent(&in_repo(&worktree(root.path(), "w", "api")), "deployer", "worktree의 것");

        let roster = find_agents(root.path(), Some("w")).unwrap();

        assert_eq!(callable(&roster), [("deployer", "worktree의 것"), ("host", "Library Host")]);
        assert_eq!(roster.agents[0].from, from("api"));
        // Library만 보는 범위에는 그대로 없다.
        assert_eq!(callable(&find_agents(root.path(), None).unwrap()), [("host", "Library Host")]);
    }

    #[test]
    fn worktree가_없는_project는_project_폴더에서_읽는다() {
        let root = tempfile::tempdir().unwrap();
        let api = project(root.path(), "api");
        let web = project(root.path(), "web");
        work(root.path(), "w", &["api", "web"]);
        // api는 worktree가 섰고 web은 나중으로 미뤘다(v1 티켓 29).
        agent(&in_repo(&worktree(root.path(), "w", "api")), "deployer", "api worktree의 것");
        agent(&in_repo(&api), "migrator", "api 폴더에만 있는 것");
        agent(&in_repo(&web), "designer", "web 폴더의 것");

        let roster = find_agents(root.path(), Some("w")).unwrap();

        assert_eq!(callable(&roster), [("deployer", "api worktree의 것"), ("designer", "web 폴더의 것")]);
        assert_eq!(roster.agents[1].from, from("web"));
    }

    /// 그 이름을 풀어 얻은 Agent의 설명.
    fn resolved<'a>(roster: &'a AgentRoster, call: &str) -> Result<&'a str, Unresolved> {
        roster.resolve(call).map(|a| a.definition.description.as_str())
    }

    #[test]
    fn library와_project가_같은_handle이면_project_것이_이긴다() {
        let root = tempfile::tempdir().unwrap();
        agent(&library(root.path()), "reviewer", "Library 리뷰어");
        let api = project(root.path(), "api");
        work(root.path(), "w", &["api"]);
        agent(&in_repo(&api), "reviewer", "api 리뷰어");

        let roster = find_agents(root.path(), Some("w")).unwrap();

        assert_eq!(callable(&roster), [("reviewer", "api 리뷰어")], "Library 것은 범위에서 가려진다");
        assert_eq!(resolved(&roster, "reviewer"), Ok("api 리뷰어"));
        // Work가 없으면 Library 것이 그대로 불린다.
        assert_eq!(resolved(&find_agents(root.path(), None).unwrap(), "reviewer"), Ok("Library 리뷰어"));
        assert_eq!(resolved(&roster, "writer"), Err(Unresolved::NotFound));
    }

    #[test]
    fn project_둘이_같은_handle이면_project를_붙여서만_부른다() {
        let root = tempfile::tempdir().unwrap();
        agent(&library(root.path()), "reviewer", "Library 리뷰어");
        let (api, web) = (project(root.path(), "api-server"), project(root.path(), "web"));
        work(root.path(), "w", &["web", "api-server"]);
        agent(&in_repo(&api), "reviewer", "api 리뷰어");
        agent(&in_repo(&web), "reviewer", "web 리뷰어");
        agent(&in_repo(&web), "designer", "web 디자이너");

        let roster = find_agents(root.path(), Some("w")).unwrap();

        assert_eq!(
            callable(&roster),
            [("api-server/reviewer", "api 리뷰어"), ("designer", "web 디자이너"), ("web/reviewer", "web 리뷰어")]
        );
        assert_eq!(resolved(&roster, "api-server/reviewer"), Ok("api 리뷰어"));
        assert_eq!(resolved(&roster, "web/reviewer"), Ok("web 리뷰어"));
        assert_eq!(
            resolved(&roster, "reviewer"),
            Err(Unresolved::Ambiguous { calls: vec!["api-server/reviewer".into(), "web/reviewer".into()] }),
            "Library 것으로 미끄러지지 않는다 — Project 것이 이기는 자리다"
        );
        // 겹치지 않은 Project 것도 붙여 부를 수 있다.
        assert_eq!(resolved(&roster, "web/designer"), Ok("web 디자이너"));
        assert_eq!(resolved(&roster, "api-server/designer"), Err(Unresolved::NotFound));
    }

    /// 깨진 파일의 (부르는 이름, 정의가 온 곳, 까닭).
    fn broken(roster: &AgentRoster) -> Vec<(&str, &DefinitionSource, &AgentProblem)> {
        roster.broken.iter().map(|b| (b.call.as_str(), &b.from, &b.problem)).collect()
    }

    #[test]
    fn host는_library에만_있고_project_안의_host는_까닭과_함께_깨진다() {
        let root = tempfile::tempdir().unwrap();
        agent(&library(root.path()), "host", "Library Host");
        let api = project(root.path(), "api");
        work(root.path(), "w", &["api"]);
        let theirs = agent(&in_repo(&api), "host", "api Host");

        let roster = find_agents(root.path(), Some("w")).unwrap();

        assert_eq!(callable(&roster), [("host", "Library Host")], "Project 것이 이기는 규칙의 예외다");
        assert_eq!(resolved(&roster, "host"), Ok("Library Host"));
        assert_eq!(broken(&roster), [("api/host", &from("api"), &AgentProblem::HostOutsideLibrary)]);
        assert_eq!(roster.broken[0].path, theirs);
        assert_eq!(resolved(&roster, "api/host"), Err(Unresolved::Broken(AgentProblem::HostOutsideLibrary)));
    }

    #[test]
    fn 깨진_파일은_까닭과_함께_서고_부를_수_없으며_깨진_project_것도_library_것을_가린다() {
        let root = tempfile::tempdir().unwrap();
        agent(&library(root.path()), "host", "Library Host");
        agent(&library(root.path()), "reviewer", "Library 리뷰어");
        agent_text(&library(root.path()), "shell", "---\ntools:\n  builtin: [Bash]\n---\n");
        agent_text(&library(root.path()), "plain", "frontmatter 없는 글");
        let api = project(root.path(), "api");
        work(root.path(), "w", &["api"]);
        agent_text(&in_repo(&api), "reviewer", "---\nruntimes: [codex]\n---\n");

        let roster = find_agents(root.path(), Some("w")).unwrap();

        assert_eq!(callable(&roster), [("host", "Library Host")]);
        let unknown = AgentProblem::UnknownTool { tool: "Bash".into() };
        assert_eq!(
            broken(&roster)
                .into_iter()
                .map(|(call, from, problem)| (call, from.clone(), matches!(problem, AgentProblem::Unreadable { .. })))
                .collect::<Vec<_>>(),
            [("plain", DefinitionSource::Library, true), ("reviewer", from("api"), false), ("shell", DefinitionSource::Library, false)],
        );
        assert_eq!(roster.broken[1].problem, AgentProblem::RuntimeNotAccepted);
        assert_eq!(roster.broken[2].problem, unknown);
        assert_eq!(
            resolved(&roster, "reviewer"),
            Err(Unresolved::Broken(AgentProblem::RuntimeNotAccepted)),
            "고친 사람이 뜻한 Project 정의가 깨졌다고 Library 것으로 미끄러지지 않는다"
        );
        assert_eq!(resolved(&roster, "shell"), Err(Unresolved::Broken(unknown)));
    }

    #[test]
    fn 파일_읽기는_부르는_이름으로_범위_안의_원문을_깨졌어도_준다() {
        let root = tempfile::tempdir().unwrap();
        agent(&library(root.path()), "reviewer", "Library 리뷰어");
        let (api, web) = (project(root.path(), "api"), project(root.path(), "web"));
        work(root.path(), "w", &["api", "web"]);
        agent(&in_repo(&api), "reviewer", "api 리뷰어");
        let broken = "---\nruntimes: [codex]\n---\nweb 리뷰어\n";
        agent_text(&in_repo(&web), "reviewer", broken);

        assert_eq!(read_agent_file(root.path(), None, "reviewer").unwrap(), "---\ndescription: Library 리뷰어\n---\nLibrary 리뷰어\n");
        assert_eq!(read_agent_file(root.path(), Some("w"), "web/reviewer").unwrap(), broken);
        for call in ["reviewer", "writer", "../reviewer"] {
            assert!(
                matches!(read_agent_file(root.path(), Some("w"), call), Err(crate::Error::Validation(_))),
                "{call}: 범위 안의 한 파일로 풀리지 않는다"
            );
        }
    }

    #[test]
    fn 파일_자리도_부르는_이름으로_범위_안에서만_푼다() {
        let root = tempfile::tempdir().unwrap();
        agent(&library(root.path()), "reviewer", "Library 리뷰어");
        let web = project(root.path(), "web");
        work(root.path(), "w", &["web"]);
        let broken = "---\nruntimes: [codex]\n---\nweb 리뷰어\n";
        agent_text(&in_repo(&web), "reviewer", broken);

        assert_eq!(agent_file_path(root.path(), None, "reviewer").unwrap(), library(root.path()).join("reviewer.md"));
        assert_eq!(
            agent_file_path(root.path(), Some("w"), "reviewer").unwrap(),
            in_repo(&web).join("reviewer.md"),
            "Project 것이 이기고, 깨진 파일도 자리는 있다 — Finder에서 열어 고친다"
        );
        for call in ["writer", "../reviewer"] {
            assert!(matches!(agent_file_path(root.path(), Some("w"), call), Err(crate::Error::Validation(_))), "{call}");
        }
    }

    #[test]
    fn 없는_work는_오류이고_등록이_사라진_project는_건너뛴다() {
        let root = tempfile::tempdir().unwrap();
        agent(&library(root.path()), "host", "Library Host");
        let api = project(root.path(), "api");
        work(root.path(), "w", &["gone", "api"]);
        agent(&in_repo(&api), "deployer", "api 배포");

        assert!(matches!(find_agents(root.path(), Some("archived")), Err(crate::Error::WorkNotFound(_))));
        assert_eq!(
            callable(&find_agents(root.path(), Some("w")).unwrap()),
            [("deployer", "api 배포"), ("host", "Library Host")],
            "worktree도 등록도 없는 Project는 읽을 자리가 없다 — 나머지 범위는 선다"
        );
    }

    #[test]
    fn 화면에_가는_꼴은_파일의_말을_camel_case로_싣는다() {
        let root = tempfile::tempdir().unwrap();
        let reviewer = agent_text(
            &library(root.path()),
            "reviewer",
            "---\nname: 리뷰어\navatar:\n  shape: hexagon\nmodel:\n  effort: high\ntools:\n  builtin: [read, shell]\n  cli: [gh]\n  agents: any\npolicy:\n  ask_before: [push]\nruntimes: [claude-code]\n---\n읽는다.\n",
        );
        let shell = agent_text(&library(root.path()), "shell", "---\ntools:\n  builtin: [Bash]\n---\n");
        let api = project(root.path(), "api");
        work(root.path(), "w", &["api"]);
        let host = agent(&in_repo(&api), "host", "api Host");

        let json = serde_json::to_value(find_agents(root.path(), Some("w")).unwrap()).unwrap();

        assert_eq!(
            json["agents"],
            serde_json::json!([{
                "call": "reviewer",
                "from": "library",
                "path": reviewer,
                "definition": {
                    "handle": "reviewer",
                    "name": "리뷰어",
                    "description": "",
                    "avatar": { "shape": "hexagon", "color": null },
                    "model": { "prefer": null, "effort": "high" },
                    "tools": { "builtin": ["read", "shell"], "cli": ["gh"], "agents": "any" },
                    "policy": { "askBefore": ["push"], "forbid": [] },
                    "runtimes": ["claude-code"],
                    "instructions": "읽는다.",
                },
            }])
        );
        assert_eq!(
            json["broken"],
            serde_json::json!([
                {
                    "call": "api/host",
                    "handle": "host",
                    "from": { "project": "api" },
                    "path": host,
                    "problem": { "kind": "hostOutsideLibrary" },
                },
                {
                    "call": "shell",
                    "handle": "shell",
                    "from": "library",
                    "path": shell,
                    "problem": { "kind": "unknownTool", "tool": "Bash" },
                },
            ])
        );
        let default_tools = serde_json::to_value(Tools::default()).unwrap();
        assert_eq!(default_tools, serde_json::json!({ "builtin": null, "cli": [], "agents": [] }), "기본 도구 전부는 null이다");
    }
}
