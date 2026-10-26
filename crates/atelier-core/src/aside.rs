//! 지운 자리(03 구현 스펙 §9 · §15 · S10 · 결정 07 · 11) — Project 제거와 Space 지우기가 함께 타는 차례 하나다. 지운 파일은 그 폴더
//! (`projects/` · `spaces/`) 아래 `.deleted/<slug>.md`로 옮기고, 곁에 무엇을 고쳤는지(`<slug>.json`)를 적는다. slug마다 마지막
//! 하나다(S10) — 같은 slug를 다시 지우면 앞의 파일 · 기록을 덮는다.
//!
//! - **지우기**: 곁 기록을 먼저 적고 → 파일을 옮긴다. 칸 고치기(Space의 줄 · 이은 칸)는 부르는 쪽이 그 뒤에 한다 — 옮기고 고치는 사이
//!   앱이 꺼져도 되돌리기가 고친 자리를 안다. 반대 차례면 칸만 고친 채 파일이 남아 연결이 몰래 사라진다.
//! - **되돌리기**: 지운 파일이 있어야 하고(없으면 부르는 쪽의 「없다」 오류), 그사이 제자리에 같은 slug가 다시 섰으면 `SlugReused`다 —
//!   새로 선 것을 덮지 않는다. 파일을 제자리로 돌리고 곁 기록을 읽는다. 다시 적기를 마치면 곁 기록을 걷는다.

use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::{Error, Result};

/// 파일 하나의 지운 자리 — 제자리(`<폴더>/<slug>.md`), 지운 파일, 곁 기록.
pub(crate) struct Aside {
    slug: String,
    file: PathBuf,
    deleted: PathBuf,
}

impl Aside {
    /// `folder`의 `<slug>.md` 하나 — slug가 뿌리 밖을 가리키지 않는지는 부르는 쪽이 이미 가렸다(`project_path` · `space_path`).
    pub(crate) fn of(folder: &Path, slug: &str) -> Self {
        Self { slug: slug.to_owned(), file: folder.join(format!("{slug}.md")), deleted: crate::paths::deleted_in(folder) }
    }

    /// 지운 파일의 자리.
    pub(crate) fn kept(&self) -> PathBuf {
        self.deleted.join(format!("{}.md", self.slug))
    }

    fn note(&self) -> PathBuf {
        self.deleted.join(format!("{}.json", self.slug))
    }

    /// 지운다 — 곁 기록(`note` — `what`은 직렬화 실패 글의 목적어)을 먼저 적고 파일을 지운 자리로 옮긴다.
    pub(crate) fn put<T: Serialize>(&self, note: &T, what: &str) -> Result<()> {
        crate::atomic::write_json_atomically(&self.deleted, &format!("{}.json", self.slug), note, what)?;
        std::fs::rename(&self.file, self.kept())?;
        Ok(())
    }

    /// 되돌릴 수 있나 — 지운 파일이 없으면 `missing`, 그사이 제자리에 같은 slug가 다시 섰으면 `SlugReused`다. 아무것도 바꾸지 않는다.
    pub(crate) fn ready(&self, missing: Error) -> Result<()> {
        if !self.kept().is_file() {
            return Err(missing);
        }
        if self.file.exists() {
            return Err(Error::SlugReused(self.slug.clone()));
        }
        Ok(())
    }

    /// 되돌린다 — 파일을 제자리로 옮기고 곁 기록을 읽는다(없거나 깨졌으면 기본값 — `what`은 그때 남기는 글의 이름). [`Self::ready`]를
    /// 지난 뒤에 부른다.
    pub(crate) fn take_back<T: DeserializeOwned + Default>(&self, what: &str) -> Result<T> {
        std::fs::rename(self.kept(), &self.file)?;
        Ok(crate::atomic::read_json_or_default(&self.note(), what))
    }

    /// 곁 기록을 걷는다 — 되돌린 뒤 다시 적기를 마치고 부른다. 못 걷어도 다음 지우기가 덮는다.
    pub(crate) fn forget(&self) {
        let _ = std::fs::remove_file(self.note());
    }
}
