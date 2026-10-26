use serde::{Deserialize, Serialize};

use crate::{Error, Result};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub slug: String,
    pub name: String,
    pub path: String,
    pub base_branch: String,
    pub created_at: String,
    pub description: String,
    #[serde(skip)]
    pub extra: serde_yaml_ng::Mapping,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectView {
    #[serde(flatten)]
    pub project: Project,
    pub git: Option<crate::GitInfo>,
    pub missing: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Frontmatter {
    name: String,
    path: String,
    base_branch: String,
    created_at: String,
    #[serde(flatten)]
    extra: serde_yaml_ng::Mapping,
}

fn invalid(slug: &str, message: impl Into<String>) -> Error {
    Error::InvalidFile { slug: slug.to_string(), message: message.into() }
}

/// frontmatter와 본문을 가른다. **Markdown 파일의 frontmatter 규칙은 이것 하나다** — Project 파일과 Agent 파일(`agents.rs`)이
/// 같이 쓴다. 둘이 따로 가르면 한쪽에서 읽히는 파일이 다른 쪽에서 깨진다.
pub(crate) fn split_frontmatter(content: &str) -> std::result::Result<(&str, &str), &'static str> {
    let rest = content.strip_prefix("---\n").ok_or("missing frontmatter")?;
    match rest.split_once("\n---\n") {
        Some(x) => Ok(x),
        None => rest.strip_suffix("\n---").map(|fm_str| (fm_str, "")).ok_or("unterminated frontmatter"),
    }
}

pub fn parse_project(slug: &str, content: &str) -> Result<Project> {
    let (fm_str, body) = split_frontmatter(content).map_err(|message| invalid(slug, message))?;
    let fm: Frontmatter =
        serde_yaml_ng::from_str(fm_str).map_err(|e| invalid(slug, e.to_string()))?;
    Ok(Project {
        slug: slug.to_string(),
        name: fm.name,
        path: fm.path,
        base_branch: fm.base_branch,
        created_at: fm.created_at,
        description: body.trim().to_string(),
        extra: fm.extra,
    })
}

pub fn render_project(project: &Project) -> String {
    let fm = Frontmatter {
        name: project.name.clone(),
        path: project.path.clone(),
        base_branch: project.base_branch.clone(),
        created_at: project.created_at.clone(),
        extra: project.extra.clone(),
    };
    let yaml = serde_yaml_ng::to_string(&fm).expect("frontmatter serializes");
    let body = project.description.trim();
    if body.is_empty() {
        format!("---\n{yaml}---\n")
    } else {
        format!("---\n{yaml}---\n\n{body}\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "---\nname: billing\npath: ~/dev/billing\nbaseBranch: main\ncreatedAt: 2026-07-19\n---\n\n결제·정산 서비스.\n";

    #[test]
    fn parses_fields_and_body() {
        let p = parse_project("billing", SAMPLE).unwrap();
        assert_eq!(p.slug, "billing");
        assert_eq!(p.name, "billing");
        assert_eq!(p.path, "~/dev/billing");
        assert_eq!(p.base_branch, "main");
        assert_eq!(p.created_at, "2026-07-19");
        assert_eq!(p.description, "결제·정산 서비스.");
    }

    #[test]
    fn roundtrip_is_stable() {
        let p = parse_project("billing", SAMPLE).unwrap();
        assert_eq!(parse_project("billing", &render_project(&p)).unwrap(), p);
    }

    #[test]
    fn roundtrip_preserves_unknown_fields() {
        let src = "---\nname: x\npath: ~/x\nbaseBranch: main\ncreatedAt: 2026-07-19\ncustomField: keep-me\n---\n";
        let p = parse_project("x", src).unwrap();
        let out = render_project(&p);
        assert!(out.contains("customField: keep-me"), "unknown field lost: {out}");
    }

    #[test]
    fn empty_description_renders_without_body() {
        let src = "---\nname: x\npath: ~/x\nbaseBranch: main\ncreatedAt: 2026-07-19\n---\n";
        let p = parse_project("x", src).unwrap();
        assert_eq!(p.description, "");
        assert!(render_project(&p).ends_with("---\n"));
    }

    #[test]
    fn rejects_files_without_frontmatter() {
        assert!(parse_project("x", "그냥 텍스트").is_err());
        assert!(parse_project("x", "---\nname: x\n(끝나지 않음)").is_err());
    }
}
