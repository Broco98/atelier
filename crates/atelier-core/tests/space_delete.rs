//! Space 지우기 · 되돌리기 · 쓰임 읽기(03 구현 스펙 §8 「쓰임」 · §9 「Space 지우기」 · 「Space 되돌리기」 · S10).
//!
//! Space · Work · Thread 파일을 손으로 세운 데이터 루트 하나에서 잰다. 기록 줄(「지워짐」 · 「되돌림」)은 엔진이 남기므로 여기서는 보지
//! 않는다 — 파일만 본다(`atelier-acp`의 `thread_space_delete.rs`가 줄을 잰다).

use std::path::{Path, PathBuf};

use atelier_core::{Error, SpaceLinks, SpaceUsage};
use serde_json::{json, Value};

struct Home {
    _tmp: tempfile::TempDir,
    root: PathBuf,
}

impl Home {
    fn space(&self, slug: &str, text: &str) -> &Self {
        write(&self.space_file(slug), text);
        self
    }

    fn space_file(&self, slug: &str) -> PathBuf {
        atelier_core::spaces_in(&self.root).join(format!("{slug}.md"))
    }

    /// 진행 중인 Work(`works/`) 하나 — `space`가 있으면 적는다.
    fn work(&self, slug: &str, space: Option<&str>) -> &Self {
        write(&self.work_file(slug), &work_json(slug, space).to_string());
        self
    }

    fn work_file(&self, slug: &str) -> PathBuf {
        atelier_core::works_in(&self.root).join(slug).join("work.json")
    }

    /// 보관된 Work(`archive/`) 하나.
    fn archived(&self, slug: &str, space: Option<&str>) -> &Self {
        write(&atelier_core::archive_in(&self.root).join(slug).join("work.json"), &work_json(slug, space).to_string());
        self
    }

    /// Thread 하나 — `work`가 있으면 그 Work에 이은 Thread다. 모르는 칸(`later`)을 하나 품는다.
    fn thread(&self, id: &str, work: Option<&str>, space: Option<&str>) -> &Self {
        let mut file = json!({ "title": format!("{id} 이야기"), "createdAt": "2026-10-24T10:00:00.000+09:00", "work": work, "later": 7 });
        if let Some(space) = space {
            file["space"] = json!(space);
        }
        write(&self.thread_file(id), &file.to_string());
        self
    }

    fn thread_file(&self, id: &str) -> PathBuf {
        self.root.join("threads").join(id).join("thread.json")
    }

    fn json(&self, path: &Path) -> Value {
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    fn work_space(&self, slug: &str) -> Value {
        self.json(&self.work_file(slug)).get("space").cloned().unwrap_or(Value::Null)
    }

    fn thread_space(&self, id: &str) -> Value {
        self.json(&self.thread_file(id)).get("space").cloned().unwrap_or(Value::Null)
    }

    fn listed(&self) -> Vec<String> {
        atelier_core::list_spaces(&self.root).unwrap().into_iter().map(|space| space.slug).collect()
    }
}

fn home() -> Home {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().to_path_buf();
    Home { root, _tmp: tmp }
}

fn write(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn work_json(slug: &str, space: Option<&str>) -> Value {
    let mut work = json!({ "title": format!("{slug} Work"), "status": "active", "createdAt": "2026-10-20", "projects": [] });
    if let Some(space) = space {
        work["space"] = json!(space);
    }
    work
}

fn links(works: &[&str], threads: &[&str]) -> SpaceLinks {
    SpaceLinks { works: works.iter().map(|one| (*one).to_owned()).collect(), threads: threads.iter().map(|one| (*one).to_owned()).collect() }
}

/// 사람이 손으로 적은 Space — 주석 · 모르는 칸 · 본문이 지우고 되돌린 뒤에도 그대로여야 한다.
const PAYMENTS: &str = "---\n# 결제팀이 관리\nname: 결제 서비스\nowner: 결제팀\nprojects:\n  - web-app\n  - api-server\ncreatedAt: 2026-10-23\n---\n\n결제와 환불을 한 흐름으로 다뤄요.\n";
const TOOLS: &str = "---\nname: 사내 도구\nprojects:\n  - api-server\n  - backoffice\n---\n";

/// 결제 서비스에 Work 하나(refund-api — 그 Work의 Thread 둘)와 Work 없는 Thread 하나, 사내 도구에 Work 하나 · Thread 하나, Space 없는 것들.
fn payments_home() -> Home {
    let home = home();
    home.space("결제-서비스", PAYMENTS).space("사내-도구", TOOLS);
    home.work("refund-api", Some("결제-서비스")).work("backoffice-ui", Some("사내-도구")).work("docs", None);
    home.archived("old-checkout", Some("결제-서비스"));
    home.thread("20261024-100000", None, Some("결제-서비스"))
        .thread("20261024-110000", None, Some("사내-도구"))
        .thread("20261024-120000", Some("refund-api"), None)
        .thread("20261024-130000", Some("refund-api"), None)
        .thread("20261024-140000", None, None);
    home
}

#[test]
fn 쓰임은_이_space에_이은_진행_중인_work_수와_그_space로_읽는_thread_수다() {
    let home = payments_home();

    assert_eq!(
        atelier_core::space_usage(&home.root, "결제-서비스").unwrap(),
        SpaceUsage { works: 1, threads: 3 },
        "Work refund-api, Thread는 Work 없는 하나와 refund-api의 둘 — 보관된 Work는 세지 않는다"
    );
    assert_eq!(atelier_core::space_usage(&home.root, "사내-도구").unwrap(), SpaceUsage { works: 1, threads: 1 });
    home.space("빈-것", "---\nname: 빈 것\nprojects: []\n---\n");
    assert_eq!(atelier_core::space_usage(&home.root, "빈-것").unwrap(), SpaceUsage { works: 0, threads: 0 });
    assert!(matches!(atelier_core::space_usage(&home.root, "없는-것"), Err(Error::SpaceNotFound(_))));
}

#[test]
fn 지우면_파일이_지운_자리로_가고_그_slug를_적은_work와_work_없는_thread의_space만_빈다() {
    let home = payments_home();

    let deleted = atelier_core::delete_space(&home.root, "결제-서비스").unwrap();

    assert_eq!(deleted.space.name, "결제 서비스");
    assert_eq!(deleted.unlinked, links(&["refund-api"], &["20261024-100000"]), "비운 곳 — Work의 Thread는 Work를 따르므로 Work 하나다");
    assert!(!home.space_file("결제-서비스").exists());
    assert_eq!(home.listed(), ["사내-도구"], "목록에서 빠진다");
    let kept = atelier_core::spaces_in(&home.root).join(".deleted").join("결제-서비스.md");
    assert_eq!(std::fs::read_to_string(kept).unwrap(), PAYMENTS, "지운 자리에 글 그대로 둔다");

    assert_eq!(home.work_space("refund-api"), Value::Null);
    assert_eq!(home.json(&home.work_file("refund-api"))["title"], "refund-api Work", "Work의 다른 칸은 그대로다");
    assert_eq!(home.thread_space("20261024-100000"), Value::Null);
    let thread = home.json(&home.thread_file("20261024-100000"));
    assert_eq!((thread["title"].as_str(), thread["later"].as_i64()), (Some("20261024-100000 이야기"), Some(7)), "모르는 칸도 남는다");

    assert_eq!(home.work_space("backoffice-ui"), "사내-도구", "다른 Space를 적은 것은 그대로다");
    assert_eq!(home.thread_space("20261024-110000"), "사내-도구");
    let archived = atelier_core::archive_in(&home.root).join("old-checkout").join("work.json");
    assert_eq!(home.json(&archived)["space"], "결제-서비스", "보관된 Work는 읽기만이라 건드리지 않는다");
    assert!(matches!(atelier_core::delete_space(&home.root, "결제-서비스"), Err(Error::SpaceNotFound(_))));
}

#[test]
fn 되돌리면_파일이_제자리로_가고_비웠던_칸_가운데_아직_빈_것만_다시_적는다() {
    let home = payments_home();
    home.work("checkout", Some("결제-서비스")).thread("20261024-150000", None, Some("결제-서비스"));
    atelier_core::delete_space(&home.root, "결제-서비스").unwrap();
    // 그사이 — checkout은 사람이 다른 Space에 붙였고, 한 Thread는 Work가 됐고, 하나는 지워졌다.
    atelier_core::update_work_space(&atelier_core::works_in(&home.root), "checkout", Some("사내-도구")).unwrap();
    home.thread("20261024-150000", Some("docs"), None);
    std::fs::remove_dir_all(home.thread_file("20261024-100000").parent().unwrap()).unwrap();

    let restored = atelier_core::restore_space(&home.root, "결제-서비스").unwrap();

    assert_eq!(std::fs::read_to_string(home.space_file("결제-서비스")).unwrap(), PAYMENTS, "글 그대로 제자리다");
    assert_eq!(home.listed(), ["결제-서비스", "사내-도구"]);
    assert_eq!(restored.space.name, "결제 서비스");
    assert_eq!(restored.relinked, links(&["refund-api"], &[]), "다시 적은 곳");
    assert_eq!(home.work_space("refund-api"), "결제-서비스");
    assert_eq!(home.work_space("checkout"), "사내-도구", "그사이 채운 칸은 건드리지 않는다");
    assert_eq!(home.thread_space("20261024-150000"), Value::Null, "Work가 된 Thread는 Work를 따른다 — 칸을 적지 않는다");
    assert!(!home.thread_file("20261024-100000").exists(), "지워진 Thread를 되살리지 않는다");
    assert!(
        matches!(atelier_core::restore_space(&home.root, "결제-서비스"), Err(Error::SpaceNotFound(_))),
        "되돌린 뒤에는 지운 자리에 없다"
    );
}

#[test]
fn 되돌리면_비웠던_thread의_칸도_다시_적는다() {
    let home = payments_home();
    atelier_core::delete_space(&home.root, "결제-서비스").unwrap();

    let restored = atelier_core::restore_space(&home.root, "결제-서비스").unwrap();

    assert_eq!(restored.relinked, links(&["refund-api"], &["20261024-100000"]));
    assert_eq!(home.thread_space("20261024-100000"), "결제-서비스");
    assert_eq!(home.json(&home.thread_file("20261024-100000"))["later"], 7);
}

#[test]
fn 그사이_같은_slug가_다시_쓰였으면_되돌리지_않고_아무것도_바꾸지_않는다() {
    let home = payments_home();
    atelier_core::delete_space(&home.root, "결제-서비스").unwrap();
    let again = "---\nname: 결제 서비스\nprojects: []\n---\n";
    home.space("결제-서비스", again);

    assert!(matches!(atelier_core::restore_space(&home.root, "결제-서비스"), Err(Error::SlugReused(slug)) if slug == "결제-서비스"));
    assert_eq!(std::fs::read_to_string(home.space_file("결제-서비스")).unwrap(), again, "새로 선 것을 덮지 않는다");
    assert_eq!(home.work_space("refund-api"), Value::Null, "연결도 다시 적지 않는다");
    assert_eq!(home.thread_space("20261024-100000"), Value::Null);
}

#[test]
fn 지운_자리에는_slug마다_마지막_하나만_남는다() {
    let home = payments_home();
    atelier_core::delete_space(&home.root, "결제-서비스").unwrap();
    let second = "---\nname: 결제 서비스\nprojects:\n  - web-app\n---\n";
    home.space("결제-서비스", second).thread("20261024-160000", None, Some("결제-서비스"));
    atelier_core::delete_space(&home.root, "결제-서비스").unwrap();

    let restored = atelier_core::restore_space(&home.root, "결제-서비스").unwrap();

    assert_eq!(std::fs::read_to_string(home.space_file("결제-서비스")).unwrap(), second, "마지막에 지운 것이 돌아온다");
    assert_eq!(restored.relinked, links(&[], &["20261024-160000"]), "마지막 지우기가 비운 곳만 다시 적는다");
    assert_eq!(home.work_space("refund-api"), Value::Null);
}

#[test]
fn 지운_적이_없는_slug와_뿌리_밖을_가리키는_slug는_되돌리지_못한다() {
    let home = payments_home();
    assert!(matches!(atelier_core::restore_space(&home.root, "결제-서비스"), Err(Error::SpaceNotFound(_))), "지운 자리에 없다");
    assert!(matches!(atelier_core::restore_space(&home.root, "없는-것"), Err(Error::SpaceNotFound(_))));
    assert!(matches!(atelier_core::restore_space(&home.root, "../사내-도구"), Err(Error::SpaceNotFound(_))));
    assert!(matches!(atelier_core::delete_space(&home.root, "../사내-도구"), Err(Error::SpaceNotFound(_))));
}
