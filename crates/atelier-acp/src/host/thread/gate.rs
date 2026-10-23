//! 판정의 문 — Session 하나가 받은 권한 요청을 판정(`policy.rs`)의 입력으로 읽어 넘기고, 내린 것을 런타임의 답으로 옮긴다(v1 티켓 22
//! · 구현 스펙 §9).
//!
//! - **요청을 받은 그때 읽는다** — 물어보는 정도와 「다시 묻지 않기」 허락(S18: Work에 이은 Thread면 Work 폴더의 점 파일, 아니면
//!   `thread.json`의 `mode`와 Thread 폴더의 점 파일), 고칠 수 있는 자리(Work의 선 worktree · spec 폴더 · Thread 폴더 — Atelier만 쓰는
//!   Thread 파일은 빼고, 코드 리뷰 1차 A2), 등록된 Project,
//!   쓰기 자리 주인(§10). 칩이 바꾼 정도 · 카드가 준 허락 · 「Project 고치기 시작」이 세운 worktree(v1 티켓 32)가 다음 요청부터 든다.
//!   자리 · Project는 편집일 때만 읽는다.
//! - **아직 서지 않은 worktree의 자리는 고칠 수 있는 자리가 아니다**(S21 · v1 티켓 32) — 그 자리에 먼저 쓰면 git worktree가 아닌 폴더가
//!   서고, 뒤의 「Project 고치기 시작」이 그것을 worktree로 알고 짓지 않는다. 그 자리는 그 Project의 자리로 쳐서 거절 글이 도구를
//!   가리킨다.
//! - **Session을 열 때 읽는다** — 그 Agent의 Policy · `tools.cli`(정의 스냅숏, §19)와 작업 폴더(상대 경로를 푸는 자리).
//! - 경로는 심볼릭 링크를 풀어 견준다([`resolve`]) — Runtime은 제 작업 폴더를 링크를 푼 꼴로 쓴다(macOS의 `/tmp` → `/private/tmp`).
//! - **허용**은 허락 선택지로 닫고, 편집이면 그 순간 쓰기 자리를 쥔다(S20) — 그사이 다른 Session이 쥐었으면 그 주인의 글로 거절한다.
//!   **거절**은 거부 선택지로 닫고 글을 Agent에게 준다. **물음**은 카드 종류 · Policy 이름 · 「다시 묻지 않기」로 줄 허락을 물음 줄에
//!   달고, 선택지와 함께 적어 둔다(사람이 편집을 허락하면 쥐고, 다시 묻지 않기를 고르면 그 허락을 적는다 — v1 티켓 24). 고를 선택지가
//!   없는 요청은 사람에게 묻는다.

use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use atelier_core::{Policy, PolicyPlace};

use super::seat::{allowing, options_of, rejecting, Writer};
use crate::policy::{self, Act, AskLevel, Card, Case, Verdict};
use crate::runtime::{Asking, Judge, Judgement, PermissionAsked, Ruling};

/// Session 하나의 판정 문 — Session을 열 때마다 짓는다.
pub(super) struct Gate {
    pub(super) data_root: PathBuf,
    pub(super) thread: String,
    /// 이 Session의 작업 폴더 — 상대 경로를 여기서 푼다.
    pub(super) cwd: PathBuf,
    /// 그 Agent의 Policy(정의 스냅숏).
    pub(super) policy: Policy,
    /// 그 Agent의 `tools.cli`(정의 스냅숏).
    pub(super) cli: Vec<String>,
    pub(super) writer: Arc<Writer>,
}

impl Gate {
    /// 런타임에 넘기는 판정.
    pub(super) fn judge(self) -> Judge {
        let gate = Arc::new(self);
        Judge(Arc::new(move |asked| gate.rule(asked)))
    }

    fn rule(&self, asked: &PermissionAsked) -> Judgement {
        // Agent의 질문(v1 티켓 26) — 판정의 표가 가를 일이 아니라 사람이 답할 일이다. 판정을 지나지 않고 질문 카드로 묻는다(「알아서」
        // 여도). Runtime이 물음들을 `_meta.atelier.questions`에 실었다(Claude 변환기 — `AskUserQuestion`).
        if asked.request["_meta"]["atelier"]["questions"].is_array() {
            let question = Asking { card: Card::Question, policy: String::new(), grant: Vec::new() };
            return self.ask(asked, &Act::Other, options_of(&asked.request), question);
        }
        let act = match Act::of(&asked.tool_call) {
            Act::Edit(paths) => Act::Edit(paths.iter().map(|path| resolve(path, &self.cwd)).collect()),
            act => act,
        };
        let editing = matches!(act, Act::Edit(_));
        // 이은 Work는 쓰기 자리 손이 든다 — Work 만들기 카드로 턴 가운데 이어져도 다음 요청부터 그 Work다(v1 티켓 30).
        let work = self.writer.work();
        let (level, grants) = asking(&self.data_root, &self.thread, work.as_deref());
        let roots = if editing { self.roots(work.as_deref()) } else { Vec::new() };
        let kept = if editing { self.kept() } else { Vec::new() };
        let projects: Vec<(String, PathBuf)> = if editing {
            let mut folders = atelier_core::project_folders(&self.data_root);
            folders.extend(self.unplanted(work.as_deref()));
            folders.into_iter().map(|(slug, folder)| (slug, resolve(&folder, &self.cwd))).collect()
        } else {
            Vec::new()
        };
        let seat = if editing { self.writer.blocker() } else { None };
        let verdict = policy::judge(&Case {
            act: &act,
            policy: &self.policy,
            cli: &self.cli,
            level,
            grants: &grants,
            in_work: work.is_some(),
            roots: &roots,
            kept: &kept,
            projects: &projects,
            seat: seat.as_deref(),
        });
        let options = options_of(&asked.request);
        // 판정의 답으로 닫지 못해 묻는 것(고를 선택지가 없다) — 판정이 넘기지 않을 일이라 「다시 묻지 않기」를 주지 않는다.
        let unsure = Asking { card: act.card(), policy: level.name().to_owned(), grant: Vec::new() };
        match verdict {
            Verdict::Allow { reason } => {
                let Some(option_id) = allowing(&options) else { return self.ask(asked, &act, options, unsure) };
                if editing {
                    if let Err(busy) = self.writer.take() {
                        return self.refuse(asked, &act, options, busy, unsure);
                    }
                }
                Judgement::Decide(Ruling { option_id, reason })
            }
            Verdict::Refuse { message } => self.refuse(asked, &act, options, message, unsure),
            Verdict::Ask { card, policy, grant } => self.ask(asked, &act, options, Asking { card, policy, grant }),
        }
    }

    /// 거부 선택지로 닫는다 — 없으면 묻는다.
    fn refuse(&self, asked: &PermissionAsked, act: &Act, options: Vec<(String, String)>, message: String, unsure: Asking) -> Judgement {
        match rejecting(&options) {
            Some(option_id) => Judgement::Decide(Ruling { option_id, reason: message }),
            None => self.ask(asked, act, options, unsure),
        }
    }

    /// 사람에게 묻는다 — 선택지 · 편집인가 · 「다시 묻지 않기」로 줄 허락을 적어 둔다. 사람이 편집을 허락하면 쓰기 자리를 쥐고,
    /// 다시 묻지 않기를 고르면 그 허락을 점 파일에 적는다([`super::seat::Writer::note`]).
    fn ask(&self, asked: &PermissionAsked, act: &Act, options: Vec<(String, String)>, asking: Asking) -> Judgement {
        self.writer.note(&asked.request_id, options, asking.card, matches!(act, Act::Edit(_)), asking.grant.clone());
        Judgement::Ask(asking)
    }

    /// 고칠 수 있는 자리 — Thread 폴더, 그리고 이은 Work의 spec 폴더와 선 worktree들. Work를 읽지 못하면(사라졌다) Thread 폴더뿐이다.
    fn roots(&self, work: Option<&str>) -> Vec<PathBuf> {
        let mut roots: Vec<PathBuf> = atelier_core::thread_dir(&self.data_root, &self.thread).into_iter().collect();
        if let Some(slug) = work {
            let works = atelier_core::works_in(&self.data_root);
            if let Ok(meta) = atelier_core::read_work(&works, slug) {
                let places = atelier_core::work_places(&works, &meta);
                roots.push(places.spec);
                roots.extend(places.worktrees.into_iter().filter(|tree| tree.is_dir()));
            }
        }
        roots.iter().map(|root| resolve(root, &self.cwd)).collect()
    }

    /// 고칠 수 있는 자리 안이어도 고칠 수 없는 자리 — Atelier만 쓰는 Thread 폴더의 파일 · 폴더(코드 리뷰 1차 A2).
    fn kept(&self) -> Vec<PathBuf> {
        let dir = atelier_core::thread_dir(&self.data_root, &self.thread).into_iter();
        dir.flat_map(|dir| atelier_core::thread_kept(&dir)).map(|path| resolve(&path, &self.cwd)).collect()
    }

    /// 이은 Work의 아직 서지 않은 worktree 자리 — (Project slug, 자리). 그 자리의 편집은 그 Project를 고치는 것이라 거절 글이 「Project
    /// 고치기 시작」을 가리킨다.
    fn unplanted(&self, work: Option<&str>) -> Vec<(String, PathBuf)> {
        let works = atelier_core::works_in(&self.data_root);
        let Some(meta) = work.and_then(|slug| atelier_core::read_work(&works, slug).ok()) else { return Vec::new() };
        let places = atelier_core::work_places(&works, &meta);
        meta.projects.into_iter().zip(places.worktrees).filter(|(_, tree)| !tree.is_dir()).collect()
    }
}

/// 그 Thread의 물어보는 정도와 「다시 묻지 않기」 허락(S18) — Work에 이은 Thread면 Work 폴더의 점 파일, 아니면 `thread.json`의
/// `mode`와 Thread 폴더의 점 파일이다. 못 읽으면 매번 묻기 · 허락 없음이다.
pub(super) fn asking(data_root: &Path, thread: &str, work: Option<&str>) -> (AskLevel, Vec<String>) {
    match work {
        Some(slug) => work_asking(data_root, slug),
        None => {
            let mode = atelier_core::read_thread(data_root, thread).ok().and_then(|file| file.mode);
            (AskLevel::read(mode.as_deref()), atelier_core::read_policy(data_root, PolicyPlace::Thread(thread)).grants)
        }
    }
}

/// 그 Work의 물어보는 정도와 허락 — Work 폴더의 점 파일이다(S18). 그 Work에 이은 Thread들이 함께 쓴다.
pub(super) fn work_asking(data_root: &Path, slug: &str) -> (AskLevel, Vec<String>) {
    let file = atelier_core::read_policy(data_root, PolicyPlace::Work(slug));
    (AskLevel::read(file.mode.as_deref()), file.grants)
}

/// 견줄 꼴의 경로 — 상대 경로는 `base`에서 풀고, `.` · `..`를 접고, 있는 데까지 심볼릭 링크를 푼다. 아직 없는 파일(새로 쓸 파일)은
/// 있는 가장 가까운 위 폴더를 풀고 나머지를 붙인다. 문서 쓰는 중(v1 티켓 34)도 spec 폴더를 이 꼴로 견준다.
pub(super) fn resolve(path: &Path, base: &Path) -> PathBuf {
    let joined = if path.is_absolute() { path.to_path_buf() } else { base.join(path) };
    let mut normal = PathBuf::new();
    for component in joined.components() {
        match component {
            Component::ParentDir => {
                normal.pop();
            }
            Component::CurDir => {}
            other => normal.push(other),
        }
    }
    let mut rest = Vec::new();
    let mut existing = normal.as_path();
    loop {
        if let Ok(real) = existing.canonicalize() {
            return rest.iter().rev().fold(real, |path, name| path.join(name));
        }
        match (existing.parent(), existing.file_name()) {
            (Some(parent), Some(name)) => {
                rest.push(name.to_owned());
                existing = parent;
            }
            _ => return normal,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 경로는_작업_폴더에서_풀고_점_마디를_접고_있는_데까지_링크를_푼다() {
        let root = tempfile::tempdir().unwrap();
        let real = root.path().canonicalize().unwrap();
        std::fs::create_dir_all(real.join("work/spec")).unwrap();
        std::os::unix::fs::symlink(real.join("work"), real.join("link")).unwrap();

        assert_eq!(resolve(Path::new("spec/a.md"), &real.join("link")), real.join("work/spec/a.md"), "상대 경로 · 링크");
        assert_eq!(resolve(&real.join("link/spec/new/b.md"), Path::new("/")), real.join("work/spec/new/b.md"), "아직 없는 파일");
        assert_eq!(resolve(&real.join("work/spec/../../etc/x"), Path::new("/")), real.join("etc/x"), "`..`로 자리를 벗어나는 경로");
    }
}
