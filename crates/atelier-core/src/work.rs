use serde::{Deserialize, Serialize};

use crate::{Error, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkStatus {
    /// 적어만 두고 아직 시작하지 않은 것. **선언된 상태**이지 프로젝트 유무에서
    /// 파생되지 않는다 — 프로젝트 없이 진행 중인 리서치 work는 `Active`가 맞다.
    Draft,
    Active,
    Review,
    Done,
}

impl WorkStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            WorkStatus::Draft => "draft",
            WorkStatus::Active => "active",
            WorkStatus::Review => "review",
            WorkStatus::Done => "done",
        }
    }
}

impl std::fmt::Display for WorkStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::str::FromStr for WorkStatus {
    type Err = Error;

    fn from_str(s: &str) -> Result<Self> {
        match s {
            "draft" => Ok(WorkStatus::Draft),
            "active" => Ok(WorkStatus::Active),
            "review" => Ok(WorkStatus::Review),
            "done" => Ok(WorkStatus::Done),
            _ => Err(Error::Validation(format!(
                "invalid status '{s}' (draft | active | review | done)"
            ))),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Work {
    pub slug: String,
    pub title: String,
    pub status: WorkStatus,
    pub branch: String,
    pub created_at: String,
    pub projects: Vec<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

/// work.json 파일 직렬화 전용 — slug는 디렉터리명이 원천이라 파일에 저장하지 않는다
/// (projects의 Frontmatter 패턴과 동일)
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileWork {
    title: String,
    status: WorkStatus,
    branch: String,
    created_at: String,
    projects: Vec<String>,
    #[serde(flatten)]
    extra: serde_json::Map<String, serde_json::Value>,
}

/// 프로젝트별 워크트리의 파생 정보 (조회 시 계산)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeView {
    pub project: String,
    pub path: String,
    pub exists: bool,
    pub dirty: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkView {
    #[serde(flatten)]
    pub work: Work,
    pub trees: Vec<TreeView>,
    /// spec 문서를 두는 디렉터리 (홈 축약 경로). 에이전트가 여기에 직접 쓴다.
    pub spec_dir: String,
    pub spec_files: Vec<String>,
}

pub fn parse_work(slug: &str, content: &str) -> Result<Work> {
    let file: FileWork = serde_json::from_str(content).map_err(|e| Error::InvalidFile {
        slug: slug.to_string(),
        message: e.to_string(),
    })?;
    Ok(Work {
        slug: slug.to_string(),
        title: file.title,
        status: file.status,
        branch: file.branch,
        created_at: file.created_at,
        projects: file.projects,
        extra: file.extra,
    })
}

pub fn render_work(work: &Work) -> String {
    let file = FileWork {
        title: work.title.clone(),
        status: work.status,
        branch: work.branch.clone(),
        created_at: work.created_at.clone(),
        projects: work.projects.clone(),
        extra: work.extra.clone(),
    };
    let mut json = serde_json::to_string_pretty(&file).expect("work serializes");
    json.push('\n');
    json
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{
  "title": "카트 아이템 추가",
  "status": "active",
  "branch": "feat/cart-add-item",
  "createdAt": "2026-07-19",
  "projects": ["frontend", "backend"]
}"#;

    #[test]
    fn parses_fields() {
        let w = parse_work("cart-add-item", SAMPLE).unwrap();
        assert_eq!(w.slug, "cart-add-item");
        assert_eq!(w.title, "카트 아이템 추가");
        assert_eq!(w.status, WorkStatus::Active);
        assert_eq!(w.branch, "feat/cart-add-item");
        assert_eq!(w.created_at, "2026-07-19");
        assert_eq!(w.projects, vec!["frontend", "backend"]);
    }

    #[test]
    fn roundtrip_is_stable_and_preserves_unknown_fields() {
        let src = r#"{"title":"x","status":"review","branch":"b","createdAt":"2026-07-19","projects":[],"customField":"keep-me"}"#;
        let w = parse_work("x", src).unwrap();
        let out = render_work(&w);
        assert!(out.contains("\"customField\": \"keep-me\""), "unknown field lost: {out}");
        assert_eq!(parse_work("x", &out).unwrap(), w);
    }

    #[test]
    fn rejects_invalid_json_and_unknown_status() {
        assert!(parse_work("x", "not json").is_err());
        assert!(parse_work(
            "x",
            r#"{"title":"x","status":"paused","branch":"b","createdAt":"d","projects":[]}"#
        )
        .is_err());
    }

    #[test]
    fn view_serialization_includes_slug_but_file_does_not() {
        let w = parse_work("cart-add-item", SAMPLE).unwrap();
        // API(Tauri/CLI --json) 응답에는 slug가 반드시 포함돼야 한다
        let json = serde_json::to_value(&w).unwrap();
        assert_eq!(json["slug"], "cart-add-item");
        // 파일(work.json)에는 저장하지 않는다 — 디렉터리명이 원천
        assert!(!render_work(&w).contains("\"slug\""), "slug must not be persisted to work.json");
    }

    #[test]
    fn status_parses_from_str() {
        assert_eq!("draft".parse::<WorkStatus>().unwrap(), WorkStatus::Draft);
        assert_eq!("active".parse::<WorkStatus>().unwrap(), WorkStatus::Active);
        assert_eq!("done".parse::<WorkStatus>().unwrap(), WorkStatus::Done);
        assert!("nope".parse::<WorkStatus>().is_err());
        // 거부 메시지는 유효값 목록이자 유일한 안내다 — 새 상태가 빠지면 안 된다
        let msg = "nope".parse::<WorkStatus>().unwrap_err().to_string();
        for valid in ["draft", "active", "review", "done"] {
            assert!(msg.contains(valid), "'{valid}' missing from the error message: {msg}");
        }
    }

    /// 선언된 상태다 — 파일에 그대로 남고 그대로 돌아온다.
    #[test]
    fn draft_survives_a_file_roundtrip() {
        let src = r#"{"title":"적어만 둔 것","status":"draft","branch":"b","createdAt":"2026-07-29","projects":[]}"#;
        let w = parse_work("적어만-둔-것", src).unwrap();
        assert_eq!(w.status, WorkStatus::Draft);
        assert!(render_work(&w).contains("\"status\": \"draft\""), "{}", render_work(&w));
        assert_eq!(parse_work("적어만-둔-것", &render_work(&w)).unwrap(), w);
    }
}
