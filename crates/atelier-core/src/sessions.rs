//! 세션의 신원 저장소. 세션 하나가 폴더 하나이고, 그 안의 `session.json`이 신원이다.
//!
//! **살아 있음은 여기 적히지 않는다.** 프로세스는 앱의 자식이라 앱이 새로 뜨는 순간 모든 세션이
//! 죽어 있다. 디스크에 적으면 크래시 직후 그 값이 거짓말이 된다.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::{collapse_home, Error, Result};

/// 세션이 어디서 뜨는가. 판 01은 등록된 프로젝트만이고, 워크트리는 판 03이 같은 자리에 더한다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum StartPoint {
    Project { slug: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    /// 아틀리에가 만든 id. 폴더 이름이 된다.
    pub id: String,
    /// ACP `session/new`가 돌려준 id. 재개에 쓴다.
    ///
    /// 스펙 표는 이 자리를 null 가능이라 적었지만, 같은 스펙이 **`session/new`가 성공한 뒤에만
    /// 세션 폴더를 만든다**고 못박았으므로 신원 파일이 존재하는 한 이 값은 언제나 있다.
    /// 도달할 수 없는 상태를 타입에 남기지 않는다.
    pub agent_session_id: String,
    /// 어댑터 키(예: `codex`).
    pub agent: String,
    pub start_point: StartPoint,
    /// 실제로 세션이 뜬 디렉터리. `~/` 축약 형식.
    pub cwd: String,
    /// 첫 사용자 프롬프트의 첫 줄. 아직 프롬프트가 없으면 없다.
    #[serde(default)]
    pub title: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// 세션을 만들 때 부르는 쪽이 아는 것 전부. 나머지(id·시각)는 저장소가 정한다.
pub struct NewSession {
    pub agent: String,
    pub agent_session_id: String,
    pub start_point: StartPoint,
    /// 절대 경로. 저장할 때 `~/` 축약형으로 접힌다.
    pub cwd: PathBuf,
}

pub fn create_session(root: &Path, new: NewSession) -> Result<Session> {
    std::fs::create_dir_all(root)?;
    let now = chrono::Local::now().to_rfc3339();
    let session = Session {
        id: unique_id(
            root,
            &chrono::Local::now().format("%Y%m%d-%H%M%S").to_string(),
        ),
        agent_session_id: new.agent_session_id,
        agent: new.agent,
        start_point: new.start_point,
        cwd: collapse_home(&new.cwd),
        title: None,
        created_at: now.clone(),
        updated_at: now,
    };
    write_session(root, &session)?;
    Ok(session)
}

/// 최근 것부터. 깨진 파일 하나가 목록 전체를 막지 않는다.
pub fn list_sessions(root: &Path) -> Result<Vec<Session>> {
    std::fs::create_dir_all(root)?;
    let mut sessions = Vec::new();
    for entry in std::fs::read_dir(root)? {
        let entry = entry?;
        let id = entry.file_name().to_string_lossy().to_string();
        if !crate::slug::is_safe_slug(&id) || !entry.path().is_dir() {
            continue;
        }
        if let Ok(session) = get_session(root, &id) {
            sessions.push(session);
        }
    }
    // 시각이 같을 때도 순서가 흔들리지 않도록 id를 두 번째 열쇠로 둔다.
    sessions.sort_by(|a, b| (&b.created_at, &b.id).cmp(&(&a.created_at, &a.id)));
    Ok(sessions)
}

pub fn get_session(root: &Path, id: &str) -> Result<Session> {
    let path = session_file(root, id)?;
    let content =
        std::fs::read_to_string(&path).map_err(|_| Error::SessionNotFound(id.to_string()))?;
    let mut session: Session =
        serde_json::from_str(&content).map_err(|_| Error::SessionNotFound(id.to_string()))?;
    // 폴더 이름이 신원의 원천이다. 파일 안의 id는 사람이 읽으라고 있는 것이고,
    // 둘이 어긋나면 파일을 찾은 경로 쪽이 이긴다.
    session.id = id.to_string();
    Ok(session)
}

fn session_file(root: &Path, id: &str) -> Result<PathBuf> {
    if !crate::slug::is_safe_slug(id) {
        return Err(Error::SessionNotFound(id.to_string()));
    }
    Ok(root.join(id).join("session.json"))
}

/// 같은 디렉터리 tmp 파일 → rename 원자적 쓰기 (프로젝트 저장소와 같은 규칙)
fn write_session(root: &Path, session: &Session) -> Result<()> {
    let dir = root.join(&session.id);
    std::fs::create_dir_all(&dir)?;
    let tmp_path = dir.join(".session.json.tmp");
    std::fs::write(
        &tmp_path,
        serde_json::to_string_pretty(session).map_err(io_err)?,
    )?;
    std::fs::rename(&tmp_path, dir.join("session.json"))?;
    Ok(())
}

fn io_err(e: serde_json::Error) -> Error {
    Error::Io(std::io::Error::other(e))
}

fn unique_id(root: &Path, base: &str) -> String {
    let mut id = base.to_string();
    let mut n = 2;
    while root.join(&id).exists() {
        id = format!("{base}-{n}");
        n += 1;
    }
    id
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("sessions");
        (tmp, root)
    }

    fn new_session(slug: &str) -> NewSession {
        NewSession {
            agent: "codex".to_string(),
            agent_session_id: format!("agent-{slug}"),
            start_point: StartPoint::Project {
                slug: slug.to_string(),
            },
            cwd: PathBuf::from("/tmp/work"),
        }
    }

    #[test]
    fn create_writes_the_identity_and_reads_back_the_same() {
        let (_tmp, root) = setup();
        let created = create_session(&root, new_session("my-app")).unwrap();

        let reread = get_session(&root, &created.id).unwrap();
        assert_eq!(reread, created);
        assert_eq!(reread.agent, "codex");
        assert_eq!(reread.agent_session_id, "agent-my-app");
        assert_eq!(
            reread.start_point,
            StartPoint::Project {
                slug: "my-app".into()
            }
        );
        assert_eq!(reread.cwd, "/tmp/work");
        assert!(reread.title.is_none());

        // 디스크에 남은 모양도 확인한다 — 이 파일은 사람이 읽는다
        let raw = std::fs::read_to_string(root.join(&created.id).join("session.json")).unwrap();
        let json: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(json["id"], created.id);
        assert_eq!(json["agentSessionId"], "agent-my-app");
        assert_eq!(json["startPoint"]["kind"], "project");
        assert_eq!(json["startPoint"]["slug"], "my-app");
        assert!(
            json.get("alive").is_none(),
            "살아있음은 디스크에 적지 않는다"
        );
    }

    #[test]
    fn two_sessions_from_the_same_project_are_two_rows() {
        let (_tmp, root) = setup();
        let a = create_session(&root, new_session("my-app")).unwrap();
        let b = create_session(&root, new_session("my-app")).unwrap();

        assert_ne!(a.id, b.id, "같은 초에 두 번 시작해도 폴더가 갈린다");
        assert_eq!(list_sessions(&root).unwrap().len(), 2);
    }

    #[test]
    fn list_is_newest_first() {
        let (_tmp, root) = setup();
        let older = create_session(&root, new_session("a")).unwrap();
        let newer = create_session(&root, new_session("b")).unwrap();

        let ids: Vec<String> = list_sessions(&root)
            .unwrap()
            .into_iter()
            .map(|s| s.id)
            .collect();
        assert_eq!(ids, vec![newer.id, older.id]);
    }

    #[test]
    fn rejects_path_traversal_ids() {
        let (_tmp, root) = setup();
        create_session(&root, new_session("a")).unwrap();
        let outside = root.parent().unwrap().join("victim");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("session.json"), "{}").unwrap();

        assert!(matches!(
            get_session(&root, "../victim"),
            Err(Error::SessionNotFound(_))
        ));
        assert!(matches!(
            get_session(&root, ".hidden"),
            Err(Error::SessionNotFound(_))
        ));
        assert!(
            std::fs::read_to_string(outside.join("session.json")).unwrap() == "{}",
            "데이터 루트 밖 파일은 건드려지지 않는다"
        );
    }

    #[test]
    fn write_leaves_no_tmp_files() {
        let (_tmp, root) = setup();
        let created = create_session(&root, new_session("a")).unwrap();
        let leftovers: Vec<_> = std::fs::read_dir(root.join(&created.id))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .filter(|name| name.ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "남은 임시 파일: {leftovers:?}");
    }

    #[test]
    fn broken_identity_file_does_not_block_the_list() {
        let (_tmp, root) = setup();
        create_session(&root, new_session("a")).unwrap();
        std::fs::create_dir_all(root.join("broken")).unwrap();
        std::fs::write(root.join("broken").join("session.json"), "not json").unwrap();

        assert_eq!(list_sessions(&root).unwrap().len(), 1);
        assert!(matches!(
            get_session(&root, "broken"),
            Err(Error::SessionNotFound(_))
        ));
    }
}
