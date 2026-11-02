//! 옛 이름의 자료(스펙 「01a — Service」). `spaces` 폴더와 파일의 `space` 칸은 이행하지 않고, 읽지 않고, 지우지 않는다.

use std::path::{Path, PathBuf};

use atelier_core::{Error, NewService};
use serde_json::{json, Value};

const OLD_FILE: &str = "---\nname: 옛 묶음\nprojects:\n  - web-app\n---\n\n옛 설명\n";

fn home() -> (tempfile::TempDir, PathBuf) {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().to_path_buf();
    (tmp, root)
}

fn write(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn json_of(path: &Path) -> Value {
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

#[test]
fn the_old_spaces_folder_is_neither_read_nor_touched() {
    let (_tmp, root) = home();
    let old = root.join("spaces").join("옛-묶음.md");
    write(&old, OLD_FILE);

    assert_eq!(atelier_core::list_services(&root).unwrap(), vec![], "옛 폴더의 파일이 목록에 선다");
    assert!(matches!(atelier_core::get_service(&root, "옛-묶음"), Err(Error::ServiceNotFound(_))));

    let made = atelier_core::create_service(
        &root,
        NewService { name: "새 묶음".to_owned(), projects: vec![], description: String::new(), created_by: None },
    )
    .unwrap();
    assert_eq!(made.file_in(&root), root.join("services").join("새-묶음.md"));
    assert!(made.file_in(&root).exists(), "새 파일이 `services` 폴더에 서지 않았다");
    atelier_core::delete_service(&root, &made.slug).unwrap();

    assert_eq!(std::fs::read_to_string(&old).unwrap(), OLD_FILE, "옛 파일이 바뀌었다");
    assert_eq!(std::fs::read_dir(root.join("spaces")).unwrap().count(), 1, "옛 폴더에 무언가 들고 났다");
}

#[test]
fn the_old_space_value_of_a_thread_stays_in_its_file_unread() {
    let (_tmp, root) = home();
    let id = "20261102-090000";
    let file = root.join("threads").join(id).join("thread.json");
    write(
        &file,
        &json!({ "title": "옛 채팅", "createdAt": "2026-10-24T10:00:00.000+09:00", "work": null, "runtime": "claude-code", "space": "옛-묶음" })
            .to_string(),
    );

    assert_eq!(atelier_core::read_thread(&root, id).unwrap().service, None, "옛 칸을 읽었다");

    atelier_core::update_thread(&root, id, |thread| thread.service = Some("새-묶음".to_owned())).unwrap();
    let kept = json_of(&file);
    assert_eq!(kept["space"], json!("옛-묶음"), "다시 쓰면서 옛 칸을 지웠다");
    assert_eq!(kept["service"], json!("새-묶음"));
}

#[test]
fn the_old_space_value_of_a_work_stays_in_its_file_unread() {
    let (_tmp, root) = home();
    let works = atelier_core::works_in(&root);
    let file = works.join("refund-api").join("work.json");
    write(&file, &json!({ "title": "환불", "status": "active", "createdAt": "2026-10-20", "projects": [], "space": "옛-묶음" }).to_string());

    assert_eq!(atelier_core::read_work(&works, "refund-api").unwrap().service, None, "옛 칸을 읽었다");

    atelier_core::update_work_service(&works, "refund-api", Some("새-묶음")).unwrap();
    let kept = json_of(&file);
    assert_eq!(kept["space"], json!("옛-묶음"), "다시 쓰면서 옛 칸을 지웠다");
    assert_eq!(kept["service"], json!("새-묶음"));
}
