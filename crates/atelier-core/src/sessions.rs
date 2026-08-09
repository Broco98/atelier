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

/// 제목은 **처음 한 번만** 붙는다. 이미 있으면 그대로 두고 지금 값을 돌려준다 — 부르는 쪽이
/// "처음인가"를 따로 기억하지 않아도 되도록 그 판단을 여기 한 곳에 둔다.
pub fn set_session_title_once(root: &Path, id: &str, title: &str) -> Result<Session> {
    let mut session = get_session(root, id)?;
    if session.title.is_some() {
        return Ok(session);
    }
    session.title = Some(title.to_string());
    session.updated_at = chrono::Local::now().to_rfc3339();
    write_session(root, &session)?;
    Ok(session)
}

/// 재개가 지난 에이전트 세션을 되살리지 못해 **새로 열었다.** 그 id만 갈아 끼운다.
///
/// 제목도 만든 시각도 시작점도 대화 기록도 그대로다 — 세션은 같은 세션이고 말할 상대만
/// 새로 생긴 것이다. 상대가 불러오기를 지원하는지 아닌지가 사용자에게 보이지 않아야 하고,
/// 그러려면 이 자리에서 바뀌는 것이 id 하나뿐이어야 한다.
pub fn set_session_agent_session_id(
    root: &Path,
    id: &str,
    agent_session_id: &str,
) -> Result<Session> {
    let mut session = get_session(root, id)?;
    session.agent_session_id = agent_session_id.to_string();
    session.updated_at = chrono::Local::now().to_rfc3339();
    write_session(root, &session)?;
    Ok(session)
}

/// 대화 기록 한 줄을 덧붙인다. **덧붙이기만 한다** — 되감거나 고쳐 쓰지 않는다.
///
/// 줄의 모양은 여기서 정하지 않는다. 저장소는 사람이 읽을 수 있는 JSON 한 줄이라는 것까지만 안다.
pub fn append_update(root: &Path, id: &str, line: &serde_json::Value) -> Result<()> {
    use std::io::Write;
    // 줄바꿈까지 한 번에 내보낸다. 내가 친 말과 에이전트가 보낸 조각은 서로 다른 스레드에서
    // 오므로, 나눠 쓰면 두 줄이 서로의 사이에 끼어들 수 있다.
    let mut bytes = serde_json::to_vec(line).map_err(io_err)?;
    bytes.push(b'\n');
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(updates_file(root, id)?)?
        .write_all(&bytes)?;
    Ok(())
}

/// 쓴 순서 그대로. 읽을 수 없는 줄은 건너뛴다 — 앱이 죽는 순간 반쯤 쓰인 한 줄이
/// 지난 대화 전체를 삼키면 안 된다.
pub fn read_updates(root: &Path, id: &str) -> Result<Vec<serde_json::Value>> {
    use std::io::BufRead;
    let path = updates_file(root, id)?;
    let Ok(file) = std::fs::File::open(&path) else {
        // 아직 아무것도 오가지 않은 세션이다.
        return Ok(Vec::new());
    };
    Ok(std::io::BufReader::new(file)
        .lines()
        .map_while(std::result::Result::ok)
        .filter_map(|line| serde_json::from_str(&line).ok())
        .collect())
}

fn updates_file(root: &Path, id: &str) -> Result<PathBuf> {
    Ok(session_dir(root, id)?.join("updates.jsonl"))
}

fn session_file(root: &Path, id: &str) -> Result<PathBuf> {
    Ok(session_dir(root, id)?.join("session.json"))
}

/// 세션 id는 프런트에서 오는 값이다. 폴더로 내려가는 길은 여기 하나뿐이고, 여기서 막는다.
fn session_dir(root: &Path, id: &str) -> Result<PathBuf> {
    if !crate::slug::is_safe_slug(id) {
        return Err(Error::SessionNotFound(id.to_string()));
    }
    Ok(root.join(id))
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
        // 대화 기록도 같은 문을 지난다 — 세션 id는 앞으로 프런트에서 오는 값이다
        assert!(matches!(
            read_updates(&root, "../victim"),
            Err(Error::SessionNotFound(_))
        ));
        assert!(matches!(
            append_update(&root, "../victim", &serde_json::json!({})),
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
    fn updates_replay_in_the_order_they_were_written() {
        let (_tmp, root) = setup();
        let session = create_session(&root, new_session("a")).unwrap();

        assert!(
            read_updates(&root, &session.id).unwrap().is_empty(),
            "아직 오간 것이 없으면 빈 대화다"
        );

        for n in 0..3 {
            append_update(&root, &session.id, &serde_json::json!({"n": n})).unwrap();
        }

        let replayed = read_updates(&root, &session.id).unwrap();
        let order: Vec<i64> = replayed.iter().map(|line| line["n"].as_i64().unwrap()).collect();
        assert_eq!(order, vec![0, 1, 2], "쓴 순서 그대로 나온다");
    }

    #[test]
    fn a_broken_line_does_not_block_the_replay() {
        let (_tmp, root) = setup();
        let session = create_session(&root, new_session("a")).unwrap();
        let tear = |bytes: &[u8]| {
            std::fs::OpenOptions::new()
                .append(true)
                .open(root.join(&session.id).join("updates.jsonl"))
                .and_then(|mut f| std::io::Write::write_all(&mut f, bytes))
                .unwrap()
        };

        append_update(&root, &session.id, &serde_json::json!({"n": 0})).unwrap();
        // 읽을 수 없는 줄 하나. 줄바꿈이 있으므로 딱 그 줄에서 끝난다.
        tear(b"{\"n\": 1\n");
        append_update(&root, &session.id, &serde_json::json!({"n": 2})).unwrap();
        // 앱이 죽는 순간의 진짜 모양 — 줄바꿈도 없이 끊긴 꼬리. 뒤에 붙는 줄이 여기 말려들어
        // **둘이 함께** 사라진다. 그래도 그 앞의 대화는 그대로 나온다.
        tear(b"{\"n\": 3");
        append_update(&root, &session.id, &serde_json::json!({"n": 4})).unwrap();
        append_update(&root, &session.id, &serde_json::json!({"n": 5})).unwrap();

        let order: Vec<i64> = read_updates(&root, &session.id)
            .unwrap()
            .iter()
            .map(|line| line["n"].as_i64().unwrap())
            .collect();
        assert_eq!(order, vec![0, 2, 5]);
    }

    #[test]
    fn the_title_is_written_once_and_keeps_the_rest_of_the_identity() {
        let (_tmp, root) = setup();
        let created = create_session(&root, new_session("a")).unwrap();

        let titled = set_session_title_once(&root, &created.id, "첫 지시").unwrap();
        assert_eq!(titled.title.as_deref(), Some("첫 지시"));

        let again = set_session_title_once(&root, &created.id, "두 번째 지시").unwrap();
        assert_eq!(
            again.title.as_deref(),
            Some("첫 지시"),
            "제목은 첫 프롬프트로만 정해진다"
        );

        let reread = get_session(&root, &created.id).unwrap();
        assert_eq!(reread.title.as_deref(), Some("첫 지시"));
        assert_eq!(reread.agent_session_id, created.agent_session_id);
        assert_eq!(reread.start_point, created.start_point);
        assert_eq!(reread.cwd, created.cwd);
        assert_eq!(reread.created_at, created.created_at, "만든 시각은 그대로다");

        let leftovers: Vec<_> = std::fs::read_dir(root.join(&created.id))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .filter(|name| name.ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "남은 임시 파일: {leftovers:?}");
    }

    /// 재개가 새 에이전트 세션을 열었을 때 **id만** 갈리는가. 나머지가 함께 흔들리면
    /// 상대가 불러오기를 지원하는지가 사용자 눈에 보이게 된다.
    #[test]
    fn swapping_the_agent_session_id_keeps_everything_else_and_the_record() {
        let (_tmp, root) = setup();
        let created = create_session(&root, new_session("a")).unwrap();
        set_session_title_once(&root, &created.id, "첫 지시").unwrap();
        for n in 0..3 {
            append_update(&root, &created.id, &serde_json::json!({"n": n})).unwrap();
        }

        let swapped = set_session_agent_session_id(&root, &created.id, "agent-새것").unwrap();

        assert_eq!(swapped.agent_session_id, "agent-새것");
        assert_eq!(swapped.id, created.id);
        assert_eq!(swapped.title.as_deref(), Some("첫 지시"));
        assert_eq!(swapped.start_point, created.start_point);
        assert_eq!(swapped.cwd, created.cwd);
        assert_eq!(swapped.agent, created.agent);
        assert_eq!(swapped.created_at, created.created_at, "만든 시각은 그대로다");
        assert_eq!(get_session(&root, &created.id).unwrap(), swapped, "디스크에도 남는다");

        // 지난 대화는 재개의 1차 경로다. 여기서 한 줄이라도 사라지면 화면이 비어 버린다.
        let replayed = read_updates(&root, &created.id).unwrap();
        let order: Vec<i64> = replayed.iter().map(|l| l["n"].as_i64().unwrap()).collect();
        assert_eq!(order, vec![0, 1, 2]);
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
