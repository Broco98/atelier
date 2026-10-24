//! **첨부**(v1 티켓 06 · 구현 스펙 §14 S30) — 사람이 입력창의 `+`로 고르거나 끌어다 놓은 파일 · 폴더.
//!
//! Agent에게는 **절대 경로만** 넘긴다 — 내용은 읽지 않는다(그림도 같다). 여기서는 그 경로가 첨부가 될 수 있는지 보고, 칩에
//! 보일 크기와 폴더인지만 잰다. 입력창의 칩(Tauri 명령)과 엔진의 `sent` 줄이 이 한 입구를 지난다 — 그래서 칩에 선 것과 기록에
//! 남는 것이 같은 판정이다.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::{Error, Result};

/// 첨부 하나 — 보낸 말의 `sent` 줄(`attachments`)에 그대로 남고, 화면이 말풍선 위 칩으로 그린다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    /// 절대 경로 — 받은 그대로다(링크를 풀지 않는다). Agent가 읽는 자리다.
    pub path: String,
    /// 파일의 크기(바이트) — 잰 그때의 값이다. 폴더면 `None`.
    pub size: Option<u64>,
    pub folder: bool,
}

/// 경로들을 첨부로 잰다 — 받은 차례대로, 같은 경로는 한 번만.
///
/// 하나라도 첨부가 될 수 없으면(절대 경로가 아님 · 없음) 그 까닭으로 전체를 거절한다 — 보낼 말에서 첨부 하나가 조용히 빠지면
/// Agent는 사람이 보였다고 믿는 파일을 모른 채 답한다.
pub fn describe_attachments(paths: &[String]) -> Result<Vec<Attachment>> {
    let mut described: Vec<Attachment> = Vec::with_capacity(paths.len());
    for path in paths {
        if described.iter().any(|seen| &seen.path == path) {
            continue;
        }
        described.push(describe(path)?);
    }
    Ok(described)
}

fn describe(path: &str) -> Result<Attachment> {
    if !Path::new(path).is_absolute() {
        return Err(Error::Validation(format!("첨부는 절대 경로여야 해요: {path}")));
    }
    let meta = std::fs::metadata(path).map_err(|_| Error::Validation(format!("첨부한 파일을 찾지 못했어요: {path}")))?;
    let folder = meta.is_dir();
    Ok(Attachment { path: path.to_owned(), size: (!folder).then(|| meta.len()), folder })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(path: &Path) -> String {
        path.to_str().unwrap().to_owned()
    }

    #[test]
    fn 파일은_크기와_폴더는_폴더로_받은_차례대로_재고_같은_경로는_한_번만_든다() {
        let tmp = tempfile::tempdir().unwrap();
        let log = tmp.path().join("error.log");
        std::fs::write(&log, vec![b'x'; 12_288]).unwrap();
        let shots = tmp.path().join("재현 화면");
        std::fs::create_dir(&shots).unwrap();

        let described = describe_attachments(&[text(&log), text(&shots), text(&log)]).unwrap();

        assert_eq!(
            described,
            [
                Attachment { path: text(&log), size: Some(12_288), folder: false },
                Attachment { path: text(&shots), size: None, folder: true },
            ]
        );
    }

    #[test]
    fn 절대_경로가_아니거나_없는_경로는_그_경로를_들어_거절한다() {
        let tmp = tempfile::tempdir().unwrap();
        let gone = text(&tmp.path().join("지운.txt"));

        let relative = describe_attachments(&["notes/a.md".to_owned()]).unwrap_err().to_string();
        let missing = describe_attachments(&[gone.clone()]).unwrap_err().to_string();

        assert_eq!(relative, "첨부는 절대 경로여야 해요: notes/a.md");
        assert_eq!(missing, format!("첨부한 파일을 찾지 못했어요: {gone}"));
    }
}
