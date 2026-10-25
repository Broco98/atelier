//! core 통합 시험이 함께 쓰는 git 자리(03 코드 리뷰 — 시험 git 도우미 사본). 시험 파일마다 따로 엮이는 모듈이라 쓰지 않는 파일도 있다.
//!
//! **git의 이름 · 이메일은 이 실행이 정한다.** 추가 · 새로 만들기는 빈 첫 커밋을 하고, 그 커밋은 git 설정의 이름 · 이메일을 읽는다 — 그
//! 값은 기계의 것이라 개발 기계(있음)와 CI 러너(없음)가 갈린다. 이 모듈의 [`place`]는 이름이 있는 전역 설정 한 장(`GIT_CONFIG_GLOBAL`)으로
//! 돈다. 이름이 없어 git이 실패하는 길은 따로 한 파일이다(`project_new_without_git_name.rs`) — 같은 실행 안에서 환경을 바꾸면 나란히 도는
//! 시험이 서로의 설정을 읽는다.

#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

/// 이 실행의 git 전역 설정 — 이름 · 이메일만 든 한 장. 시스템 설정도 끈다(기계마다 다른 `init.defaultBranch` · 훅이 끼지 않게). 파일
/// 이름에 시험 크레이트 이름을 넣어 나란히 도는 시험 실행끼리 갈린다.
fn git_env() {
    static ONCE: OnceLock<PathBuf> = OnceLock::new();
    ONCE.get_or_init(|| {
        let file = std::env::temp_dir().join(format!("atelier-{}-{}.gitconfig", env!("CARGO_CRATE_NAME"), std::process::id()));
        std::fs::write(&file, "[user]\n\tname = t\n\temail = t@t\n").unwrap();
        std::env::set_var("GIT_CONFIG_GLOBAL", &file);
        std::env::set_var("GIT_CONFIG_NOSYSTEM", "1");
        file
    });
}

pub fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git").arg("-C").arg(dir).args(args).output().expect("git");
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_owned()
}

/// 빈 첫 커밋 하나가 있는 저장소(브랜치 `main`).
pub fn repo(dir: &Path) -> PathBuf {
    std::fs::create_dir_all(dir).unwrap();
    git(dir, &["init", "-q", "-b", "main"]);
    git(dir, &["commit", "-q", "--allow-empty", "-m", "first"]);
    dir.to_path_buf()
}

/// 시험 하나의 자리 — 임시 폴더(`at`)와 그 아래 등록부(`projects`).
pub struct Place {
    pub _tmp: tempfile::TempDir,
    pub at: PathBuf,
    pub projects: PathBuf,
}

pub fn place() -> Place {
    git_env();
    let tmp = tempfile::tempdir().unwrap();
    let at = tmp.path().to_path_buf();
    Place { projects: at.join("projects"), at, _tmp: tmp }
}
