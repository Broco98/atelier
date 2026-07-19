use serde::{Deserialize, Serialize};

use crate::{Error, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkStatus {
    Active,
    Review,
    Done,
}

impl std::str::FromStr for WorkStatus {
    type Err = Error;

    fn from_str(s: &str) -> Result<Self> {
        match s {
            "active" => Ok(WorkStatus::Active),
            "review" => Ok(WorkStatus::Review),
            "done" => Ok(WorkStatus::Done),
            _ => Err(Error::Validation(format!(
                "invalid status '{s}' (active | review | done)"
            ))),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Work {
    #[serde(skip)]
    pub slug: String,
    pub title: String,
    pub status: WorkStatus,
    pub branch: String,
    pub created_at: String,
    pub projects: Vec<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
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
    pub spec_files: Vec<String>,
}

pub fn parse_work(slug: &str, content: &str) -> Result<Work> {
    let mut work: Work = serde_json::from_str(content).map_err(|e| Error::InvalidFile {
        slug: slug.to_string(),
        message: e.to_string(),
    })?;
    work.slug = slug.to_string();
    Ok(work)
}

pub fn render_work(work: &Work) -> String {
    let mut json = serde_json::to_string_pretty(work).expect("work serializes");
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
    fn status_parses_from_str() {
        assert_eq!("active".parse::<WorkStatus>().unwrap(), WorkStatus::Active);
        assert_eq!("done".parse::<WorkStatus>().unwrap(), WorkStatus::Done);
        assert!("nope".parse::<WorkStatus>().is_err());
    }
}
