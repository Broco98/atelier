use std::path::{Path, PathBuf};
use std::time::SystemTime;

use crate::works::{read_work, spec_dir, spec_files};
use crate::{list_archived_docs, Result};

/// 팔레트가 보여 주는 한 줄. **결과 종류마다 무엇을 실어 오는가를 못 박는 자리다.**
///
/// 지금은 갈래가 문서 하나뿐이다 — 「가는 곳」·작업·프로젝트·본문은 뒤 판이 변형으로 더한다.
/// 갈래를 태그로 두는 것은 화면이 줄마다 다른 것을 그리기 때문이고, 그 태그가 없으면
/// 프런트가 필드 유무로 종류를 되짚어야 한다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SearchHit {
    Doc {
        slug: String,
        /// **work 제목이다 — 파일명이 아니다.** `overview.md`가 29개라 「무슨 파일이냐」로는
        /// 아무것도 못 고른다. 「무엇이냐」는 `path`가 말한다.
        title: String,
        /// **파일 시스템 경로가 아니라 「가는 주소의 `file` 값」이다.** 활성 문서는 spec
        /// 루트 기준(`overview.md`)이고 아카이브 문서는 work 루트 기준(`record.md` ·
        /// `spec/overview.md`)인데, 그 둘은 각 화면이 `?file=`을 읽는 방식 그대로다.
        /// 뜻이 둘인 것이 아니라 하나이고, 어느 화면인지는 `archived`가 말한다.
        path: String,
        archived: bool,
    },
}

/// 한 층이 낼 수 있는 줄 수. **전체 상한이 아니라 층마다다** — 앞 층이 상한을 먹으면 뒤
/// 층이 영영 안 보인다. 지금은 층이 문서 하나뿐이라 둘이 같은 값을 가리킨다.
///
/// **20은 실측이 하한을 정했다**: work 하나가 가진 문서가 최대 11개라 그보다 작으면
/// 「work 이름을 치면 그 문서가 전부 뜬다」가 잘린다. 상한이 필요한 것도 실측이다 —
/// 빈 질의가 낼 줄이 197개(활성 38 + 아카이브 159)다.
pub const LAYER_LIMIT: usize = 20;

/// 팔레트가 한 번에 받는 것. **줄들만으로는 「잘렸다」를 말할 수 없다** — 딱 20줄이 온 것과
/// 21번째부터 잘린 것이 목록으로는 같은 모양이라, 화면이 그것을 가르려면 상한을 자기도
/// 알고 세어야 한다. 그러면 상한이 두 자리에 살고, 고치는 날 어긋나도 화면에 티가 안 난다
/// (결정 15가 순위·층 규칙을 코어에 몰아둔 것과 같은 이유다).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct SearchResults {
    pub hits: Vec<SearchHit>,
    /// 상한에 걸려 **못 나온 줄이 있는가.** 「더 보기」는 만들지 않는다(결정 24) — 걸리면
    /// 질의를 좁히는 것이 답이고, 목록이 그렇게 말하려면 이 한 값이 필요하다.
    ///
    /// 지금은 층이 문서 하나뿐이라 값도 하나다. 층이 늘면 층마다 갈린다.
    pub truncated: bool,
}

/// 질의에 맞는 문서들. **인덱스도 캐시도 없다** — 부를 때마다 디스크를 걷는다.
///
/// 실측(2026-08-29): 전량 2.69MB(164파일)을 훑는 데 셸 grep으로 10~20ms이고 여기서는
/// 파일을 열지도 않는다(디렉터리만 걷고 mtime만 읽는다). 인덱스가 없으면 무효화를 정할
/// 필요가 없고, **세션이 밖에서 문서를 고쳐도 늘 최신**이라는 성질이 공짜로 따라온다.
///
/// **질의가 비면 전부 맞는다** — 「최근 고쳐진 문서」가 별도 갈래가 아니라 토큰 0개의
/// 자연스러운 답이다(결정 11). 그래서 이 함수에 질의 있는 길과 없는 길이 따로 없다.
///
/// **순서는 새로 발명하지 않는다**(결정 23): 좁힌 안에서도 mtime 내림차순이고, **활성이
/// 아카이브보다 위다 — 단 그것은 층 안의 규칙이다.** 지금은 층이 하나라 목록 전체가 그렇게
/// 보이지만, 층이 늘어도 활성이 층을 가로질러 앞서지는 않는다.
pub fn search(works_root: &Path, archive_root: &Path, query: &str) -> Result<SearchResults> {
    let tokens = tokens(query);
    let mut docs = recent_docs(works_root, false, &tokens)?;
    docs.extend(recent_docs(archive_root, true, &tokens)?);
    let truncated = docs.len() > LAYER_LIMIT;
    docs.truncate(LAYER_LIMIT);
    Ok(SearchResults { hits: docs.into_iter().map(|dated| dated.hit).collect(), truncated })
}

/// 질의를 **공백으로 나눈 소문자 토막들**로(결정 9). 여기서 소문자로 접어 두면 문서마다
/// 다시 접을 일이 없다.
fn tokens(query: &str) -> Vec<String> {
    query.split_whitespace().map(str::to_lowercase).collect()
}

/// 맞추는 것은 **「work 제목 / 경로」를 이어 붙인 한 문자열**이다(결정 12). 토큰은 대소문자를
/// 무시한 **부분 문자열**이고(접두사도 단어 경계도 아니다), **전부 맞아야** 맞은 것이다.
///
/// 이 한 줄에서 주 쓰임이 통째로 나온다 — work 이름만 치면 그 work의 문서가 전부 뜨고
/// (「A」→ a·b·c), 한 단어를 더하면 그 안에서 좁혀진다. 「부모를 맞추면 자식을 펼친다」는
/// 별도 규칙이 필요 없다.
///
/// **부분 문자열인 것은 말이 한글이기 때문이다**(결정 22) — 「터미널 2판」은 앞 글자만으로는
/// 못 좁힌다. 퍼지도 초성도 없다: 라틴 낙타등을 노린 규칙을 한글 음절에 걸면 거의 모든
/// 문서가 맞는다.
///
/// **맞추는 재료가 화면에 적히는 것과 같다.** 줄에 서는 것이 work 제목과 경로이므로
/// (`SearchHit::Doc`), 왜 떴는지가 줄 안에서 설명된다.
///
/// **본문은 안 본다.** 파일을 열지 않으므로 이 층은 디렉터리만 걷는다.
fn matches(title: &str, path: &str, tokens: &[String]) -> bool {
    // 빈 질의가 여기서 갈린다 — 접을 문자열도 안 만든다.
    if tokens.is_empty() {
        return true;
    }
    let hay = format!("{title}/{path}").to_lowercase();
    tokens.iter().all(|token| hay.contains(token))
}

/// 고쳐진 때를 단 줄. 시각은 정렬에만 쓰이고 화면까지 가지 않는다 — 화면이 그것을 그리는
/// 자리가 없고(줄에 날짜가 없다), 실으면 아무도 안 읽는 필드가 계약에 눌러앉는다.
struct Dated {
    at: SystemTime,
    hit: SearchHit,
}

/// 한 루트에서 **질의에 맞는** 문서들을 **mtime 내림차순**으로.
///
/// 루트가 없으면 빈 목록이다 — 아카이브 폴더는 첫 아카이빙이 만들므로 그전까지 없는 것이
/// 정상이고(`list_archive`와 같은 규칙), 검색이 그것을 만들어서도 안 된다.
fn recent_docs(root: &Path, archived: bool, tokens: &[String]) -> Result<Vec<Dated>> {
    let entries = match std::fs::read_dir(root) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };
    let mut docs = Vec::new();
    for entry in entries {
        let entry = entry?;
        let slug = entry.file_name().to_string_lossy().to_string();
        if slug.starts_with('.') || !entry.path().is_dir() {
            continue;
        }
        // 망가진 파일 하나가 전체 목록을 막지 않게 한다 (`list_works`와 같은 규칙)
        let Ok(work) = read_work(root, &slug) else { continue };
        for rel in doc_paths(root, &slug, archived) {
            if !matches(&work.title, &rel, tokens) {
                continue;
            }
            let at = modified_at(&doc_base(root, &slug, archived).join(&rel));
            docs.push(Dated {
                at,
                hit: SearchHit::Doc {
                    slug: slug.clone(),
                    title: work.title.clone(),
                    path: rel,
                    archived,
                },
            });
        }
    }
    // 같은 시각이면 순서를 디스크가 정하게 두지 않는다 — 목록이 새로고침마다 흔들린다.
    docs.sort_by(|a, b| {
        b.at.cmp(&a.at).then_with(|| match (&a.hit, &b.hit) {
            (
                SearchHit::Doc { slug: x, path: p, .. },
                SearchHit::Doc { slug: y, path: q, .. },
            ) => x.cmp(y).then_with(|| p.cmp(q)),
        })
    });
    Ok(docs)
}

/// 그 work이 가진 문서들의 **`?file=` 값**. 활성과 아카이브가 갈리는 자리는 여기 하나다.
fn doc_paths(root: &Path, slug: &str, archived: bool) -> Vec<String> {
    if archived {
        // 기록(`record.md`)이 spec 밖에 있어서 아카이브 화면은 work 루트를 기준으로 읽는다.
        // 그 목록을 짓는 규칙이 이미 한 자리에 있으므로 여기서 다시 적지 않는다.
        list_archived_docs(root, slug).unwrap_or_default()
    } else {
        spec_files(&root.join(slug))
    }
}

/// 위 경로들이 딛는 디렉터리. `doc_paths`와 **짝이다** — 한쪽만 고치면 mtime을 엉뚱한
/// 파일에서 읽어 순서가 조용히 무너진다.
fn doc_base(root: &Path, slug: &str, archived: bool) -> PathBuf {
    let dir = root.join(slug);
    if archived { dir } else { spec_dir(&dir) }
}

/// 못 읽으면 **가장 오래된 것으로 친다.** 걷는 사이에 지워진 파일이 목록 맨 위에 서는 것이
/// 최악이고, 여기서 실패를 올려 보내면 파일 하나 때문에 검색이 통째로 죽는다.
fn modified_at(path: &Path) -> SystemTime {
    std::fs::metadata(path).and_then(|meta| meta.modified()).unwrap_or(SystemTime::UNIX_EPOCH)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    /// work 하나를 짓는다. `spec/`은 비워 두고 문서는 `doc`이 놓는다.
    fn work(root: &Path, slug: &str, title: &str) {
        let dir = root.join(slug);
        std::fs::create_dir_all(dir.join("spec")).unwrap();
        std::fs::write(
            dir.join("work.json"),
            format!(
                r#"{{"title":"{title}","status":"active","createdAt":"2026-08-01","projects":[]}}"#
            ),
        )
        .unwrap();
    }

    /// 문서 하나를 놓고 **고쳐진 때를 못 박는다.** 파일을 연달아 쓰면 mtime이 같아질 수
    /// 있어, 순서를 재는 검사가 파일시스템의 해상도에 걸린다.
    fn doc(root: &Path, slug: &str, rel: &str, at: u64) {
        let path = root.join(slug).join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "본문\n").unwrap();
        std::fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(at))
            .unwrap();
    }

    fn rows(hits: &[SearchHit]) -> Vec<(&str, &str, bool)> {
        hits.iter()
            .map(|hit| match hit {
                SearchHit::Doc { slug, path, archived, .. } => {
                    (slug.as_str(), path.as_str(), *archived)
                }
            })
            .collect()
    }

    fn roots() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let works = tmp.path().join("works");
        let archive = tmp.path().join("archive");
        std::fs::create_dir_all(&works).unwrap();
        (tmp, works, archive)
    }

    /// 결정 11. 「걔가 방금 뭐 썼지」가 키 두 번이 되려면 방금 고친 것이 맨 위여야 한다.
    #[test]
    fn 최근_고쳐진_문서가_먼저_선다() {
        let (_tmp, works, archive) = roots();
        work(&works, "가", "가 작업");
        doc(&works, "가", "spec/overview.md", 100);
        doc(&works, "가", "spec/01-판/spec.md", 300);
        doc(&works, "가", "spec/decisions.md", 200);

        let hits = search(&works, &archive, "").unwrap().hits;
        assert_eq!(
            rows(&hits),
            vec![
                ("가", "01-판/spec.md", false),
                ("가", "decisions.md", false),
                ("가", "overview.md", false),
            ]
        );
    }

    /// 결정 5·13. 아카이브가 아무리 최근이어도 **그 층 안에서** 활성 아래다.
    #[test]
    fn 활성이_아카이브보다_위다() {
        let (_tmp, works, archive) = roots();
        work(&works, "가", "가 작업");
        doc(&works, "가", "spec/overview.md", 100);
        work(&archive, "옛일", "옛 작업");
        doc(&archive, "옛일", "record.md", 999);

        assert_eq!(
            rows(&search(&works, &archive, "").unwrap().hits),
            vec![("가", "overview.md", false), ("옛일", "record.md", true)]
        );
    }

    /// 결정 24. 빈 질의가 낼 줄이 실측 197개다 — 안 막으면 방향키로 훑는 것이 고르는 것보다
    /// 비싸진다.
    #[test]
    fn 스무_줄에서_자른다() {
        let (_tmp, works, archive) = roots();
        work(&works, "가", "가 작업");
        for n in 0..25 {
            doc(&works, "가", &format!("spec/{n:02}.md"), 1000 - n as u64);
        }
        // 아카이브에도 있지만 활성이 상한을 먹는다 — 층 안의 순서가 그렇게 정해져 있다.
        work(&archive, "옛일", "옛 작업");
        doc(&archive, "옛일", "record.md", 5000);

        let results = search(&works, &archive, "").unwrap();
        assert_eq!(results.hits.len(), LAYER_LIMIT);
        assert_eq!(rows(&results.hits)[0], ("가", "00.md", false));
        assert_eq!(rows(&results.hits)[LAYER_LIMIT - 1], ("가", "19.md", false));
        // 「더 보기」는 안 만든다(결정 24). 걸렸다는 것만 말하고, 좁히는 것은 사람이 한다.
        assert!(results.truncated, "잘렸는데 잘렸다고 말하지 않았다");
    }

    /// 상한과 **같은 수**는 잘린 것이 아니다. 목록 길이만으로는 이 둘이 같은 모양이라,
    /// 「잘렸다」를 세는 자리가 코어 밖으로 나가면 여기서 조용히 거짓말을 하게 된다.
    #[test]
    fn 딱_스무_줄이면_안_잘렸다고_한다() {
        let (_tmp, works, archive) = roots();
        work(&works, "가", "가 작업");
        for n in 0..LAYER_LIMIT {
            doc(&works, "가", &format!("spec/{n:02}.md"), 1000 - n as u64);
        }

        let results = search(&works, &archive, "").unwrap();
        assert_eq!(results.hits.len(), LAYER_LIMIT);
        assert!(!results.truncated, "안 잘렸는데 잘렸다고 말했다");
    }

    /// 결정 28. `path`는 파일 시스템 경로가 아니라 **그 화면이 `?file=`로 읽는 값**이다 —
    /// 활성은 spec 루트 기준, 아카이브는 work 루트 기준이다.
    #[test]
    fn 경로가_그_화면의_file_값이다() {
        let (_tmp, works, archive) = roots();
        work(&works, "가", "가 작업");
        doc(&works, "가", "spec/01-판/spec.md", 100);
        work(&archive, "옛일", "옛 작업");
        doc(&archive, "옛일", "record.md", 90);
        doc(&archive, "옛일", "spec/overview.md", 80);

        assert_eq!(
            rows(&search(&works, &archive, "").unwrap().hits),
            vec![
                ("가", "01-판/spec.md", false),
                ("옛일", "record.md", true),
                ("옛일", "spec/overview.md", true),
            ]
        );
    }

    /// 결정 12. 파일명은 어느 work의 것인지를 말하지 않는다 — 줄이 드는 이름은 work 제목이다.
    #[test]
    fn 문서_줄이_드는_이름은_work_제목이다() {
        let (_tmp, works, archive) = roots();
        work(&works, "가", "터미널 2판");
        doc(&works, "가", "spec/overview.md", 100);

        let hits = search(&works, &archive, "").unwrap().hits;
        let SearchHit::Doc { title, .. } = &hits[0];
        assert_eq!(title, "터미널 2판");
    }

    /// `list_works`와 같은 규칙 — AI가 망가뜨린 파일 하나가 목록을 통째로 막지 않는다.
    #[test]
    fn 망가진_work_json은_건너뛴다() {
        let (_tmp, works, archive) = roots();
        work(&works, "성한것", "성한 작업");
        doc(&works, "성한것", "spec/overview.md", 100);
        let broken = works.join("망가진것");
        std::fs::create_dir_all(broken.join("spec")).unwrap();
        std::fs::write(broken.join("work.json"), "not json").unwrap();
        doc(&works, "망가진것", "spec/overview.md", 999);

        assert_eq!(rows(&search(&works, &archive, "").unwrap().hits), vec![("성한것", "overview.md", false)]);
    }

    /// 아카이브 폴더는 첫 아카이빙이 만든다 — 검색이 만들지 않는다.
    #[test]
    fn 아카이브_폴더가_없어도_돌고_만들지도_않는다() {
        let (_tmp, works, archive) = roots();
        work(&works, "가", "가 작업");
        doc(&works, "가", "spec/overview.md", 100);

        assert_eq!(rows(&search(&works, &archive, "").unwrap().hits), vec![("가", "overview.md", false)]);
        assert!(!archive.exists(), "조회가 폴더를 만들었다");
    }

    /// 문서가 하나도 없는 work은 문서 층에 줄을 안 낸다 — 그 work을 결과에 세우는 것은
    /// work 층의 일이고, 아직 없다.
    #[test]
    fn 문서가_없는_work은_문서_줄을_안_낸다() {
        let (_tmp, works, archive) = roots();
        work(&works, "빈것", "빈 작업");

        assert!(search(&works, &archive, "").unwrap().hits.is_empty());
    }

    /// 갈래를 태그로 싣는다 — 프런트가 필드 유무로 종류를 되짚지 않게. 「잘렸다」가 줄이
    /// 아니라 **목록의 성질**로 실리는 것도 여기서 못 박는다.
    #[test]
    fn 문서_줄은_갈래를_달고_나간다() {
        let (_tmp, works, archive) = roots();
        work(&works, "가", "가 작업");
        doc(&works, "가", "spec/overview.md", 100);

        let json = serde_json::to_value(search(&works, &archive, "").unwrap()).unwrap();
        assert_eq!(json["truncated"], false);
        let row = &json["hits"][0];
        assert_eq!(row["kind"], "doc");
        assert_eq!(row["slug"], "가");
        assert_eq!(row["title"], "가 작업");
        assert_eq!(row["path"], "overview.md");
        assert_eq!(row["archived"], false);
    }

    // ── 질의로 좁히는 규칙 (결정 9·12·22)

    /// **주 쓰임이 이 검사다**(결정 12): work 이름을 치면 그 work의 문서가 전부 뜬다
    /// (「A」→ a·b·c). 좁힌 안에서도 순서는 mtime 내림차순이고(결정 23), **질의를 다 지우면**
    /// 최근 고쳐진 문서로 돌아온다(결정 11).
    #[test]
    fn work_이름을_치면_그_work의_문서가_전부_뜬다() {
        let (_tmp, works, archive) = roots();
        work(&works, "가", "네비게이션 개편");
        doc(&works, "가", "spec/overview.md", 300);
        doc(&works, "가", "spec/decisions.md", 200);
        doc(&works, "가", "spec/01-첫판/spec.md", 100);
        work(&works, "나", "다른 작업");
        doc(&works, "나", "spec/overview.md", 400);

        assert_eq!(
            rows(&search(&works, &archive, "네비게이션").unwrap().hits),
            vec![
                ("가", "overview.md", false),
                ("가", "decisions.md", false),
                ("가", "01-첫판/spec.md", false),
            ]
        );
        // 다 지우면 남의 것까지 도로 선다 — 가장 최근에 고쳐진 것이 맨 위다.
        assert_eq!(
            rows(&search(&works, &archive, "").unwrap().hits)[0],
            ("나", "overview.md", false)
        );
    }

    /// 결정 12. 한 단어를 더하면 **그 안에서** 좁혀진다. 맞추는 것이 「제목 / 판 폴더 / 파일명」을
    /// 이어 붙인 **한 문자열**이라, 토큰이 제목과 판 폴더에 걸쳐 있어도 맞는다.
    #[test]
    fn 단어를_더하면_그_안에서_좁혀진다() {
        let (_tmp, works, archive) = roots();
        work(&works, "가", "네비게이션 개편");
        doc(&works, "가", "spec/01-첫판/spec.md", 200);
        doc(&works, "가", "spec/02-둘째판/spec.md", 100);

        assert_eq!(
            rows(&search(&works, &archive, "네비게이션 둘째").unwrap().hits),
            vec![("가", "02-둘째판/spec.md", false)]
        );
    }

    /// 결정 22. **접두사가 아니다** — 이름의 가운데 토막으로도 맞는다. work 제목이 한글이라
    /// (「터미널 2판」) 앞 글자만으로는 못 좁히는 일이 많다.
    #[test]
    fn 이름의_가운데_토막으로도_맞는다() {
        let (_tmp, works, archive) = roots();
        work(&works, "가", "터미널 2판");
        doc(&works, "가", "spec/overview.md", 100);

        assert_eq!(
            rows(&search(&works, &archive, "미널").unwrap().hits),
            vec![("가", "overview.md", false)]
        );
    }

    /// 결정 9. 대소문자를 무시하고, **토큰이 하나라도 안 맞으면 안 뜬다**(AND).
    #[test]
    fn 대소문자를_무시하고_하나라도_안_맞으면_안_뜬다() {
        let (_tmp, works, archive) = roots();
        work(&works, "가", "Cart 개편");
        doc(&works, "가", "spec/Overview.md", 100);

        assert_eq!(
            rows(&search(&works, &archive, "cart OVERVIEW").unwrap().hits),
            vec![("가", "Overview.md", false)]
        );
        assert!(search(&works, &archive, "cart 없는말").unwrap().hits.is_empty());
    }

    /// 결정 22. **최소 질의 길이가 없다** — 주 쓰임이 「한 글자를 치는 순간」이다.
    #[test]
    fn 한_글자로도_좁혀진다() {
        let (_tmp, works, archive) = roots();
        work(&works, "가", "가 작업");
        doc(&works, "가", "spec/overview.md", 100);
        work(&works, "나", "나 작업");
        doc(&works, "나", "spec/overview.md", 200);

        assert_eq!(
            rows(&search(&works, &archive, "나").unwrap().hits),
            vec![("나", "overview.md", false)]
        );
    }

    /// 결정 5·13. **좁힌 안에서도** 활성이 아카이브보다 위다.
    #[test]
    fn 좁힌_안에서도_활성이_아카이브보다_위다() {
        let (_tmp, works, archive) = roots();
        work(&works, "가", "공통말 작업");
        doc(&works, "가", "spec/overview.md", 100);
        work(&archive, "옛일", "공통말 옛 작업");
        doc(&archive, "옛일", "record.md", 999);

        assert_eq!(
            rows(&search(&works, &archive, "공통말").unwrap().hits),
            vec![("가", "overview.md", false), ("옛일", "record.md", true)]
        );
    }

    /// **이 판의 검색은 파일을 안 읽는다** — 디렉터리만 걷는다. `doc`이 넣는 본문이 「본문」인데,
    /// 그 말은 어느 이름에도 없다: 본문을 뒤졌다면 여기가 빨개진다. (본문 층은 판 02다.)
    #[test]
    fn 본문은_안_뒤진다() {
        let (_tmp, works, archive) = roots();
        work(&works, "가", "가 작업");
        doc(&works, "가", "spec/overview.md", 100);

        assert!(search(&works, &archive, "본문").unwrap().hits.is_empty());
    }

    /// 결정 18. 범위는 **건네받은 두 루트뿐**이다 — 저장소의 `CONTEXT.md`·`docs/`·소스는
    /// 결과가 아니다. 앱이 열 수 있는 것만 결과가 된다.
    #[test]
    fn 건네받은_루트_밖은_안_걷는다() {
        let (tmp, works, archive) = roots();
        work(&works, "가", "가 작업");
        doc(&works, "가", "spec/overview.md", 100);
        std::fs::write(tmp.path().join("CONTEXT.md"), "말의 정본\n").unwrap();

        assert!(search(&works, &archive, "context").unwrap().hits.is_empty());
    }
}
