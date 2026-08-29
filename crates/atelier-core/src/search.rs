use std::path::{Path, PathBuf};
use std::time::SystemTime;

use crate::store::read_projects;
use crate::works::{read_works, spec_dir, spec_files};
use crate::{list_archive, list_archived_docs, Result, Work};

/// 프런트가 건네는 **「무엇이 있는가」**(결정 21). main nav의 라우트 문자열은 프런트 것이고,
/// 코어가 그것을 알면 목적지가 늘 때마다 Rust를 고쳐야 한다 — `nav-items.ts`가 「앞으로 늘어날
/// 목적지는 이 배열에 한 줄」이라고 못 박아 둔 것이 깨진다. 그렇다고 프런트가 그 층만 직접
/// 맞추면 **AND·대소문자 규칙과 층 순서가 두 곳으로 갈린다.** 인자로 받으면 둘 다 안 깨진다.
///
/// **맞추는 재료는 라벨이다** — 화면에 적히는 것이 그것이라 왜 떴는지가 줄 안에서 설명된다
/// (문서 층이 제목과 경로를 재료로 쓰는 것과 같은 규칙).
///
/// CLI·MCP가 나중에 부를 때는 **빈 목록을 넘긴다** — 「나는 목적지가 없다」는 멀쩡한 답이다.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct Destination {
    pub key: String,
    pub label: String,
}

/// 팔레트가 보여 주는 한 줄. **결과 종류마다 무엇을 실어 오는가를 못 박는 자리다.**
///
/// 갈래를 태그로 두는 것은 화면이 줄마다 다른 것을 그리기 때문이고, 그 태그가 없으면
/// 프런트가 필드 유무로 종류를 되짚어야 한다.
///
/// **셸은 여기 없다**(결정 2). 셸을 고르는 자리는 이미 둘이고(머리행 탭·⌘1~9) 세 번째를
/// 만들 이유가 없다. **실행되는 것도 없다**(결정 1): 갈래 다섯이 전부 「가는 곳」이라
/// Enter가 언제나 한 가지 뜻이다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SearchHit {
    /// **`key`만 돌아간다**(결정 21). 라벨과 라우트를 되돌려 보내면 정본이 둘이 된다 —
    /// 프런트가 건넨 말을 코어가 다시 말해 주는 순간, 어긋나는 날 어느 쪽이 맞는지 아무도
    /// 모른다.
    Destination { key: String },
    /// **문서가 0개인 work도 여기 선다.** 문서만 결과가 되면 그런 work은 검색에 영영 안 뜬다 —
    /// 실측(2026-08-29) 활성 10개 중 3개가 그렇고, 방금 만든 것들이라 문서가 아직 없다(결정 14).
    ///
    /// 고르면 **그 work의 마지막 화면**으로 간다 — 문서 줄과 다른 일이다(그쪽은 spec으로
    /// 떨어진다). 어느 화면인지는 `archived`가 말한다.
    Work { slug: String, title: String, archived: bool },
    Project { slug: String, name: String },
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
    /// 본문에서 맞은 문서. **문서 줄과 같은 곳으로 가고**(둘 다 그 문서를 연다) 실린 것도
    /// 하나만 다르다 — 왜 떴는지를 말하는 스니펫이다.
    ///
    /// **`heading`은 아직 없다**(결정 31). 판 03이 그때 더한다 — 그전까지 실어 두면 아무도
    /// 안 읽는 필드로 살고, 쓰임이 없으면 틀려도 안 드러난다.
    Text {
        slug: String,
        title: String,
        path: String,
        archived: bool,
        /// **맞은 문단을 한 줄로 편 것.** 문단이 단위인 것은 이 문서들이 손으로 접혀 있기
        /// 때문인데(결정 10), 그러면 스니펫도 접힌 채로는 토큰을 다 못 보여 준다 — 편 줄
        /// 하나여야 「왜 떴는지」가 그 줄 안에서 설명된다.
        ///
        /// **자르지 않는다.** 자르려면 어디를 남길지에 새 규칙과 새 숫자가 필요하고, 화면은
        /// 이미 한 줄에 맞춰 줄이는 자리를 갖고 있다 — 상한이 두 자리에 사는 것을 피한
        /// 것과 같은 이유다(`SearchResults::truncated`).
        snippet: String,
    },
}

/// 한 층이 낼 수 있는 줄 수. **전체 상한이 아니라 층마다다** — 앞 층이 상한을 먹으면 뒤
/// 층이 영영 안 보인다.
///
/// **20은 실측이 하한을 정했다**: work 하나가 가진 문서가 최대 11개라 그보다 작으면
/// 「work 이름을 치면 그 문서가 전부 뜬다」가 잘린다. 상한이 필요한 것도 실측이다 —
/// 빈 질의가 낼 줄이 197개(활성 38 + 아카이브 159)다.
pub(crate) const LAYER_LIMIT: usize = 20;

/// 팔레트가 한 번에 받는 것. **줄들만으로는 「잘렸다」를 말할 수 없다** — 딱 20줄이 온 것과
/// 21번째부터 잘린 것이 목록으로는 같은 모양이라, 화면이 그것을 가르려면 상한을 자기도
/// 알고 세어야 한다. 그러면 상한이 두 자리에 살고, 고치는 날 어긋나도 화면에 티가 안 난다
/// (결정 15가 순위·층 규칙을 코어에 몰아둔 것과 같은 이유다).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    pub hits: Vec<SearchHit>,
    /// **어느 층인가에서** 상한에 걸려 못 나온 줄이 있는가. 「더 보기」는 만들지 않는다
    /// (결정 24) — 걸리면 질의를 좁히는 것이 답이고, 목록이 그렇게 말하려면 이 한 값이 필요하다.
    ///
    /// **층마다 가르지 않는다.** 화면이 하는 말이 「일부만 보입니다 — 더 치면 좁혀집니다」
    /// 하나이고, 그 말은 어느 층이 걸렸든 똑같이 참이다. 층마다 실으면 아무도 안 읽는 값이
    /// 계약에 눌러앉는다.
    pub truncated: bool,
}

/// 질의에 맞는 것들. **인덱스도 캐시도 없다** — 부를 때마다 디스크를 걷는다.
///
/// **파일을 읽는 것은 본문 층뿐이고** 나머지 층은 디렉터리만 걷는다. 실측(2026-08-30):
/// 실제 코퍼스 216파일 3.7MB에서 본문 층이 얹는 값이 **약 18ms**다(빈 질의 대비, 릴리스
/// 빌드). 인덱스가 없으면 무효화를 정할 필요가 없고, **세션이 밖에서 문서를 고쳐도 늘
/// 최신**이라는 성질이 공짜로 따라온다 — 이 앱에서 spec은 늘 밖에서 바뀐다.
///
/// **층 순서는 「가는 곳 → 작업 → 프로젝트 → 문서 → 본문」이다**(결정 13). **본문이 맨
/// 아래인 것은 「이름을 안다」가 「내용이 들었다」보다 항상 정확하기 때문이다.** 활성과
/// 아카이브는 **각 층 안에서** 가르고 **층을 가로질러 앞서지 않는다** — 아카이브 work
/// 이름을 정확히 쳤는데 그 문서들이 활성 work의 어설픈 매치보다 아래로 밀리면, 아카이브를
/// 포함시킨 것(결정 5)이 오히려 방해가 된다.
///
/// **상한은 층마다 20줄이다**(결정 24). 전체 상한이면 앞 층이 그것을 먹고 뒤 층이 영영 안 보인다.
pub fn search(
    works_root: &Path,
    archive_root: &Path,
    projects_root: &Path,
    query: &str,
    destinations: &[Destination],
) -> Result<SearchResults> {
    let tokens = tokens(query);
    let layers = [
        destination_hits(destinations, &tokens),
        work_hits(works_root, archive_root, &tokens)?,
        project_hits(projects_root, &tokens)?,
        doc_hits(works_root, archive_root, &tokens)?,
        text_hits(works_root, archive_root, &tokens)?,
    ];

    let mut hits = Vec::new();
    let mut truncated = false;
    for mut layer in layers {
        truncated |= layer.len() > LAYER_LIMIT;
        layer.truncate(LAYER_LIMIT);
        hits.extend(layer);
    }
    Ok(SearchResults { hits, truncated })
}

/// 질의를 **공백으로 나눈 소문자 토막들**로(결정 9). 여기서 소문자로 접어 두면 문서마다
/// 다시 접을 일이 없다.
fn tokens(query: &str) -> Vec<String> {
    query.split_whitespace().map(str::to_lowercase).collect()
}

/// 토큰은 대소문자를 무시한 **부분 문자열**이고(접두사도 단어 경계도 아니다), **전부 맞아야**
/// 맞은 것이다(결정 9·22).
///
/// **부분 문자열인 것은 말이 한글이기 때문이다** — 「터미널 2판」은 앞 글자만으로는 못 좁힌다.
/// 퍼지도 초성도 없다: 라틴 낙타등을 노린 규칙을 한글 음절에 걸면 거의 모든 문서가 맞는다.
///
/// **맞추는 재료가 화면에 적히는 것과 같다.** 줄에 서는 말을 그대로 건네므로, 왜 떴는지가
/// 줄 안에서 설명된다.
fn matches(hay: &str, tokens: &[String]) -> bool {
    // 빈 질의가 여기서 갈린다 — 접을 문자열도 안 만든다. (문서 층만 이 길로 온다: 나머지
    // 층은 토큰이 없으면 아예 안 선다.)
    if tokens.is_empty() {
        return true;
    }
    let hay = hay.to_lowercase();
    tokens.iter().all(|token| hay.contains(token))
}

/// **질의가 비면 문서 말고는 아무것도 안 선다**(결정 25). 토큰이 없으면 목적지·작업·프로젝트가
/// 전부 공허참으로 맞아 늘 문서 위에 서는데, 빈 팔레트의 노림수가 「걔가 방금 뭐 썼지가 키
/// 두 번」이다(결정 11) — 그것들이 위에 서면 방향키를 그만큼 더 눌러야 한다.
fn silent_when_empty(tokens: &[String]) -> bool {
    tokens.is_empty()
}

/// 「가는 곳」 층. **순서는 프런트가 건넨 그대로다** — 목적지가 사이드바에 선 순서이고,
/// 코어가 그것을 다시 정렬하면 두 세상이 생긴다.
fn destination_hits(destinations: &[Destination], tokens: &[String]) -> Vec<SearchHit> {
    if silent_when_empty(tokens) {
        return Vec::new();
    }
    destinations
        .iter()
        .filter(|dest| matches(&dest.label, tokens))
        .map(|dest| SearchHit::Destination { key: dest.key.clone() })
        .collect()
}

/// 「작업」 층. **순서를 새로 발명하지 않는다**(결정 23) — 활성은 목록 함수와 같은 비교자를
/// 쓰는 `read_works`가 주고(고정 먼저 → 만든 순 → slug), 아카이브는 `list_archive`가 준다
/// (치운 순 → slug). 팔레트가 다른 순서를 쓰면 사이드바·Archive 화면과 어긋난 두 세상이 생긴다.
///
/// **아카이브는 이 층 안에서 활성 아래다**(결정 5·13) — 층을 가로지르지는 않는다.
///
/// 맞추는 재료는 **제목**이다: 줄에 서는 것이 그것이다.
fn work_hits(works_root: &Path, archive_root: &Path, tokens: &[String]) -> Result<Vec<SearchHit>> {
    if silent_when_empty(tokens) {
        return Ok(Vec::new());
    }
    let mut hits: Vec<SearchHit> = read_works(works_root)?
        .into_iter()
        .filter(|work| matches(&work.title, tokens))
        .map(|work| SearchHit::Work { slug: work.slug, title: work.title, archived: false })
        .collect();
    hits.extend(
        list_archive(archive_root)?
            .into_iter()
            .filter(|entry| matches(&entry.title, tokens))
            .map(|entry| SearchHit::Work {
                slug: entry.slug,
                title: entry.title,
                archived: true,
            }),
    );
    Ok(hits)
}

/// 「프로젝트」 층. 순서는 `read_projects`가 주는 이름 사전순 그대로다(결정 23).
/// 아카이브가 없는 층이라 갈래도 하나다.
fn project_hits(projects_root: &Path, tokens: &[String]) -> Result<Vec<SearchHit>> {
    if silent_when_empty(tokens) {
        return Ok(Vec::new());
    }
    Ok(read_projects(projects_root)?
        .into_iter()
        .filter(|project| matches(&project.name, tokens))
        .map(|project| SearchHit::Project { slug: project.slug, name: project.name })
        .collect())
}

/// 「문서」 층. 맞추는 것은 **「work 제목 / 경로」를 이어 붙인 한 문자열**이다(결정 12).
///
/// 이 한 줄에서 주 쓰임이 통째로 나온다 — work 이름만 치면 그 work의 문서가 전부 뜨고
/// (「A」→ a·b·c), 한 단어를 더하면 그 안에서 좁혀진다. 「부모를 맞추면 자식을 펼친다」는
/// 별도 규칙이 필요 없다.
///
/// **질의가 비면 전부 맞는다** — 「최근 고쳐진 문서」가 별도 갈래가 아니라 토큰 0개의 자연스러운
/// 답이다(결정 11). 그래서 이 층에는 질의 있는 길과 없는 길이 따로 없다.
///
/// **본문은 안 본다** — 파일을 열지 않는다. 그 일은 아래 본문 층의 몫이고, 둘이 **같은
/// 걷기와 같은 정렬**(`doc_layer`)을 쓰되 맞추는 재료만 다르다.
fn doc_hits(works_root: &Path, archive_root: &Path, tokens: &[String]) -> Result<Vec<SearchHit>> {
    doc_layer(works_root, archive_root, &mut |work, rel, _, archived| {
        matches(&format!("{}/{}", work.title, rel), tokens).then(|| SearchHit::Doc {
            slug: work.slug.clone(),
            title: work.title.clone(),
            path: rel.to_string(),
            archived,
        })
    })
}

/// 「본문」 층. 맞추는 것은 **문단 하나**다(결정 10) — 빈 줄로 나눈 덩어리를 한 줄로 펴서
/// 거기에 토큰을 전부 건다.
///
/// **줄이 단위일 수 없는 이유는 이 문서들의 생김새 자체다**: 실측으로 `decisions.md`가
/// 581줄에 문단 201개, 평균 57자 — 한 문장이 손으로 접혀 여러 줄에 걸친다. 그래서 「주소
/// tab」이 줄 기준으로는 **조용히** 안 잡힌다. **문서 전체가 단위일 수 없는 이유는 반대쪽이다**:
/// 그 크기면 흔한 단어 둘로 거의 항상 맞고, 스니펫이 모든 토큰을 못 보여줘 왜 떴는지를 설명
/// 못 하게 된다.
///
/// **여기서 처음 파일을 읽는다.** 그래도 인덱스도 캐시도 디바운스도 두지 않는다 —
/// 실측(2026-08-30) 코퍼스 216파일 3.7MB 전량을 읽고 문단을 거는 데 약 18ms이고, 인덱스가
/// 없으면 세션이 밖에서 문서를 고쳐도 늘 최신이다(결정 29).
///
/// **질의가 비면 안 선다**(결정 25). 토큰이 없으면 문단마다 공허참으로 맞아 문서마다 줄이
/// 하나씩 더 서는데, 빈 팔레트의 노림수는 「최근 고쳐진 문서」 하나다.
fn text_hits(works_root: &Path, archive_root: &Path, tokens: &[String]) -> Result<Vec<SearchHit>> {
    if silent_when_empty(tokens) {
        return Ok(Vec::new());
    }
    doc_layer(works_root, archive_root, &mut |work, rel, abs, archived| {
        first_paragraph(abs, tokens).map(|snippet| SearchHit::Text {
            slug: work.slug.clone(),
            title: work.title.clone(),
            path: rel.to_string(),
            archived,
            snippet,
        })
    })
}

/// 문서를 재료로 삼는 층의 **몸통**. 활성이 먼저 서고 아카이브가 그 아래이며(결정 5·13),
/// 각 루트 안에서는 mtime 내림차순이다(결정 11·23).
///
/// 문서 층과 본문 층이 이것을 함께 쓴다. **줄을 짓는 규칙만 부르는 쪽이 준다** — 걷는 법과
/// 순서를 층마다 다시 적으면, 한쪽만 고쳐진 채 두 층의 순서가 어긋나도 화면에 티가 안 난다.
fn doc_layer(
    works_root: &Path,
    archive_root: &Path,
    row: &mut dyn FnMut(&Work, &str, &Path, bool) -> Option<SearchHit>,
) -> Result<Vec<SearchHit>> {
    let mut dated = walk_docs(works_root, false, row)?;
    dated.extend(walk_docs(archive_root, true, row)?);
    Ok(dated.into_iter().map(|d| d.hit).collect())
}

/// 고쳐진 때를 단 줄. 시각은 정렬에만 쓰이고 화면까지 가지 않는다 — 화면이 그것을 그리는
/// 자리가 없고(줄에 날짜가 없다), 실으면 아무도 안 읽는 필드가 계약에 눌러앉는다.
struct Dated {
    at: SystemTime,
    hit: SearchHit,
}

/// 한 루트의 문서를 전부 걷고, 줄이 선 것만 **mtime 내림차순**으로 세운다.
///
/// 루트가 없으면 빈 목록이다 — 아카이브 폴더는 첫 아카이빙이 만드므로 그전까지 없는 것이
/// 정상이고(`list_archive`와 같은 규칙), 검색이 그것을 만들어서도 안 된다.
fn walk_docs(
    root: &Path,
    archived: bool,
    row: &mut dyn FnMut(&Work, &str, &Path, bool) -> Option<SearchHit>,
) -> Result<Vec<Dated>> {
    let mut docs = Vec::new();
    for work in read_works(root)? {
        let (base, rels) = docs_of(root, &work.slug, archived);
        for rel in rels {
            let abs = base.join(&rel);
            let Some(hit) = row(&work, &rel, &abs, archived) else { continue };
            docs.push(Dated { at: modified_at(&abs), hit });
        }
    }
    // 같은 시각이면 순서를 디스크가 정하게 두지 않는다 — 목록이 새로고침마다 흔들린다.
    docs.sort_by(|a, b| b.at.cmp(&a.at).then_with(|| tie(&a.hit).cmp(&tie(&b.hit))));
    Ok(docs)
}

/// 같은 시각일 때의 갈림돌. **문서 줄과 본문 줄이 같은 것으로 갈린다** — 둘 다 그 문서를
/// 가리키므로 (slug, 경로)면 족하다.
fn tie(hit: &SearchHit) -> (&str, &str) {
    match hit {
        SearchHit::Doc { slug, path, .. } | SearchHit::Text { slug, path, .. } => (slug, path),
        // 이 몸통은 문서·본문 줄만 짓는다 — 다른 갈래가 여기 오면 그것이 버그다.
        _ => ("", ""),
    }
}

/// **처음 맞은 문단**을 한 줄로 편 것(결정 26). 맞는 문단이 없으면 `None`이다.
///
/// 문단은 **빈 줄로 나눈 덩어리 하나**이고, 이어 붙일 때 줄마다의 들여쓰기는 접기의 흔적이라
/// 남기지 않는다. 「제일 좋은 문단」을 점수로 정의하지 않는 것은 **설명 못 하는 순서가 목록을
/// 못 믿게 만들기** 때문이다.
///
/// **UTF-8로 안 읽히면 글이 아니다**(결정 27). 확장자 목록으로 가르지 않는다 — 프런트에
/// 이미 이미지 확장자 목록이 있어서 코어에 또 두면 판정이 갈리고, 새 이진 형식이 들어오면
/// 둘 다 고쳐야 한다. **읽기 실패가 곧 판정이라 목록이 필요 없다.**
fn first_paragraph(path: &Path, tokens: &[String]) -> Option<String> {
    let body = std::fs::read_to_string(path).ok()?;
    let mut para: Vec<&str> = Vec::new();
    // 마지막 빈 줄을 하나 얹어 **끝난 문단도 같은 길로** 판정한다 — 안 얹으면 파일 끝의
    // 문단만 루프 밖에서 다시 판정해야 하고, 그 갈래가 조용히 낡는다.
    for line in body.lines().chain(std::iter::once("")) {
        let line = line.trim();
        if !line.is_empty() {
            para.push(line);
            continue;
        }
        if para.is_empty() {
            continue;
        }
        let folded = para.join(" ");
        if matches(&folded, tokens) {
            return Some(folded);
        }
        para.clear();
    }
    None
}

/// 그 work이 가진 문서들의 **`?file=` 값**과 그 값들이 딛는 **디렉터리**. 활성과 아카이브가
/// 갈리는 자리는 여기 하나다.
///
/// **둘을 함께 돌려주는 것이 이 함수의 이유다.** 따로 두면 한쪽만 고쳐도 컴파일이 통과하고,
/// 그때 mtime을 엉뚱한 파일에서 읽어 **순서가 조용히 무너진다** — 못 읽은 것은 에러가 아니라
/// `UNIX_EPOCH`로 떨어져(`modified_at`) 목록 맨 아래로 밀릴 뿐이라 검사도 화면도 조용하다.
///
/// 아카이브가 spec이 아니라 **work 루트**를 딛는 것은 기록(`record.md`)이 spec 밖에 있어서다.
/// 그 목록을 짓는 규칙이 이미 한 자리에 있으므로 여기서 다시 적지 않는다.
fn docs_of(root: &Path, slug: &str, archived: bool) -> (PathBuf, Vec<String>) {
    let dir = root.join(slug);
    if archived {
        (dir, list_archived_docs(root, slug).unwrap_or_default())
    } else {
        (spec_dir(&dir), spec_files(&dir))
    }
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
        work_at(root, slug, title, "2026-08-01", false);
    }

    /// 고정 여부와 만든 날을 못 박는 work. **작업 층의 순서를 재는 검사만 쓴다** — 나머지는
    /// 그 둘을 안 보므로 `work`이 기본값으로 덮는다.
    fn work_at(root: &Path, slug: &str, title: &str, created_at: &str, pinned: bool) {
        let dir = root.join(slug);
        std::fs::create_dir_all(dir.join("spec")).unwrap();
        std::fs::write(
            dir.join("work.json"),
            format!(
                r#"{{"title":"{title}","status":"active","createdAt":"{created_at}","projects":[],"pinned":{pinned}}}"#
            ),
        )
        .unwrap();
    }

    /// 문서 하나를 놓고 **고쳐진 때를 못 박는다.** 파일을 연달아 쓰면 mtime이 같아질 수
    /// 있어, 순서를 재는 검사가 파일시스템의 해상도에 걸린다.
    fn doc(root: &Path, slug: &str, rel: &str, at: u64) {
        doc_with(root, slug, rel, at, "본문\n".as_bytes());
    }

    /// 본문까지 못 박는 문서. **바이트로 받는다** — 본문 층이 「UTF-8로 읽히면 뒤지고 아니면
    /// 뺀다」로 가르므로(결정 27), 글이 아닌 것을 놓을 수 있어야 그 판정을 잰다.
    fn doc_with(root: &Path, slug: &str, rel: &str, at: u64, body: &[u8]) {
        let path = root.join(slug).join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, body).unwrap();
        std::fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(at))
            .unwrap();
    }

    /// 프로젝트 하나를 짓는다. 파일명이 slug이고 이름은 frontmatter에 산다.
    fn project(root: &Path, slug: &str, name: &str) {
        std::fs::create_dir_all(root).unwrap();
        std::fs::write(
            root.join(format!("{slug}.md")),
            format!("---\nname: {name}\npath: ~/dev/{slug}\nbaseBranch: main\ncreatedAt: 2026-08-01\n---\n"),
        )
        .unwrap();
    }

    /// 문서 줄만 있는 답을 읽는 자리. **다른 갈래가 오면 터진다** — 조용히 걸러내면 층이
    /// 새어 나온 것을 검사가 못 본다.
    fn rows(hits: &[SearchHit]) -> Vec<(&str, &str, bool)> {
        hits.iter()
            .map(|hit| match hit {
                SearchHit::Doc { slug, path, archived, .. } => {
                    (slug.as_str(), path.as_str(), *archived)
                }
                other => panic!("문서 줄이 아니다: {other:?}"),
            })
            .collect()
    }

    /// 갈래가 섞인 목록을 **한 줄씩 글로** 눕힌다. 층 순서를 재는 검사는 갈래가 넷이라
    /// 튜플로는 나란히 못 놓는다.
    fn lines(hits: &[SearchHit]) -> Vec<String> {
        hits.iter()
            .map(|hit| match hit {
                SearchHit::Destination { key } => format!("가는곳 {key}"),
                SearchHit::Work { slug, archived, .. } => {
                    format!("작업 {slug}{}", if *archived { " (아카이브)" } else { "" })
                }
                SearchHit::Project { slug, .. } => format!("프로젝트 {slug}"),
                SearchHit::Doc { slug, path, archived, .. } => {
                    format!("문서 {slug}/{path}{}", if *archived { " (아카이브)" } else { "" })
                }
                SearchHit::Text { slug, path, archived, .. } => {
                    format!("본문 {slug}/{path}{}", if *archived { " (아카이브)" } else { "" })
                }
            })
            .collect()
    }

    /// 본문 줄들이 든 스니펫. **다른 갈래가 오면 터진다** — 조용히 걸러내면 층이 새어 나온
    /// 것을 검사가 못 본다(`rows`와 같은 규칙).
    fn snippets(hits: &[SearchHit]) -> Vec<&str> {
        hits.iter()
            .map(|hit| match hit {
                SearchHit::Text { snippet, .. } => snippet.as_str(),
                other => panic!("본문 줄이 아니다: {other:?}"),
            })
            .collect()
    }

    fn dest(key: &str, label: &str) -> Destination {
        Destination { key: key.to_string(), label: label.to_string() }
    }

    /// main nav가 지금 가진 목적지 셋. **라벨이 재료다** — 프런트의 `nav-items.ts`와 같은 말이다.
    fn nav() -> Vec<Destination> {
        vec![dest("projects", "Projects"), dest("terminal", "Terminal"), dest("archive", "Archive")]
    }

    fn roots() -> (tempfile::TempDir, PathBuf, PathBuf, PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let works = tmp.path().join("works");
        let archive = tmp.path().join("archive");
        let projects = tmp.path().join("projects");
        std::fs::create_dir_all(&works).unwrap();
        (tmp, works, archive, projects)
    }

    /// 결정 11. 「걔가 방금 뭐 썼지」가 키 두 번이 되려면 방금 고친 것이 맨 위여야 한다.
    #[test]
    fn 최근_고쳐진_문서가_먼저_선다() {
        let (_tmp, works, archive, projects) = roots();
        work(&works, "가", "가 작업");
        doc(&works, "가", "spec/overview.md", 100);
        doc(&works, "가", "spec/01-판/spec.md", 300);
        doc(&works, "가", "spec/decisions.md", 200);

        let hits = search(&works, &archive, &projects, "", &[]).unwrap().hits;
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
        let (_tmp, works, archive, projects) = roots();
        work(&works, "가", "가 작업");
        doc(&works, "가", "spec/overview.md", 100);
        work(&archive, "옛일", "옛 작업");
        doc(&archive, "옛일", "record.md", 999);

        assert_eq!(
            rows(&search(&works, &archive, &projects, "", &[]).unwrap().hits),
            vec![("가", "overview.md", false), ("옛일", "record.md", true)]
        );
    }

    /// 결정 24. 빈 질의가 낼 줄이 실측 197개다 — 안 막으면 방향키로 훑는 것이 고르는 것보다
    /// 비싸진다.
    #[test]
    fn 스무_줄에서_자른다() {
        let (_tmp, works, archive, projects) = roots();
        work(&works, "가", "가 작업");
        for n in 0..25 {
            doc(&works, "가", &format!("spec/{n:02}.md"), 1000 - n as u64);
        }
        // 아카이브에도 있지만 활성이 상한을 먹는다 — 층 안의 순서가 그렇게 정해져 있다.
        work(&archive, "옛일", "옛 작업");
        doc(&archive, "옛일", "record.md", 5000);

        let results = search(&works, &archive, &projects, "", &[]).unwrap();
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
        let (_tmp, works, archive, projects) = roots();
        work(&works, "가", "가 작업");
        for n in 0..LAYER_LIMIT {
            doc(&works, "가", &format!("spec/{n:02}.md"), 1000 - n as u64);
        }

        let results = search(&works, &archive, &projects, "", &[]).unwrap();
        assert_eq!(results.hits.len(), LAYER_LIMIT);
        assert!(!results.truncated, "안 잘렸는데 잘렸다고 말했다");
    }

    /// 결정 28. `path`는 파일 시스템 경로가 아니라 **그 화면이 `?file=`로 읽는 값**이다 —
    /// 활성은 spec 루트 기준, 아카이브는 work 루트 기준이다.
    #[test]
    fn 경로가_그_화면의_file_값이다() {
        let (_tmp, works, archive, projects) = roots();
        work(&works, "가", "가 작업");
        doc(&works, "가", "spec/01-판/spec.md", 100);
        work(&archive, "옛일", "옛 작업");
        doc(&archive, "옛일", "record.md", 90);
        doc(&archive, "옛일", "spec/overview.md", 80);

        assert_eq!(
            rows(&search(&works, &archive, &projects, "", &[]).unwrap().hits),
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
        let (_tmp, works, archive, projects) = roots();
        work(&works, "가", "터미널 2판");
        doc(&works, "가", "spec/overview.md", 100);

        let hits = search(&works, &archive, &projects, "", &[]).unwrap().hits;
        let SearchHit::Doc { title, .. } = &hits[0] else { panic!("문서 줄이 아니다") };
        assert_eq!(title, "터미널 2판");
    }

    /// `list_works`와 같은 규칙 — AI가 망가뜨린 파일 하나가 목록을 통째로 막지 않는다.
    #[test]
    fn 망가진_work_json은_건너뛴다() {
        let (_tmp, works, archive, projects) = roots();
        work(&works, "성한것", "성한 작업");
        doc(&works, "성한것", "spec/overview.md", 100);
        let broken = works.join("망가진것");
        std::fs::create_dir_all(broken.join("spec")).unwrap();
        std::fs::write(broken.join("work.json"), "not json").unwrap();
        doc(&works, "망가진것", "spec/overview.md", 999);

        assert_eq!(rows(&search(&works, &archive, &projects, "", &[]).unwrap().hits), vec![("성한것", "overview.md", false)]);
    }

    /// 아카이브 폴더는 첫 아카이빙이, 프로젝트 폴더는 첫 등록이 만든다 — **검색은 만들지
    /// 않는다.** 목록 함수들은 없으면 만들지만(첫 실행이 그 자리를 지난다), 글자마다 부르는
    /// 자리가 폴더를 만들면 「읽기만 한다」가 거짓이 된다.
    #[test]
    fn 없는_폴더가_있어도_돌고_만들지도_않는다() {
        let (_tmp, works, archive, projects) = roots();
        work(&works, "가", "가 작업");
        doc(&works, "가", "spec/overview.md", 100);

        assert_eq!(rows(&search(&works, &archive, &projects, "", &[]).unwrap().hits), vec![("가", "overview.md", false)]);
        assert!(!archive.exists(), "조회가 아카이브 폴더를 만들었다");
        assert!(!projects.exists(), "조회가 프로젝트 폴더를 만들었다");
    }

    /// 문서가 하나도 없는 work은 **문서 층에** 줄을 안 낸다 — 그 work을 세우는 것은 작업
    /// 층의 일이고, 빈 질의에는 그 층이 서지 않는다(결정 25).
    #[test]
    fn 문서가_없는_work은_문서_줄을_안_낸다() {
        let (_tmp, works, archive, projects) = roots();
        work(&works, "빈것", "빈 작업");

        assert!(search(&works, &archive, &projects, "", &[]).unwrap().hits.is_empty());
    }

    /// 갈래를 태그로 싣는다 — 프런트가 필드 유무로 종류를 되짚지 않게. 「잘렸다」가 줄이
    /// 아니라 **목록의 성질**로 실리는 것도 여기서 못 박는다.
    #[test]
    fn 문서_줄은_갈래를_달고_나간다() {
        let (_tmp, works, archive, projects) = roots();
        work(&works, "가", "가 작업");
        doc(&works, "가", "spec/overview.md", 100);

        let json = serde_json::to_value(search(&works, &archive, &projects, "", &[]).unwrap()).unwrap();
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
        let (_tmp, works, archive, projects) = roots();
        work(&works, "가", "네비게이션 개편");
        doc(&works, "가", "spec/overview.md", 300);
        doc(&works, "가", "spec/decisions.md", 200);
        doc(&works, "가", "spec/01-첫판/spec.md", 100);
        work(&works, "나", "다른 작업");
        doc(&works, "나", "spec/overview.md", 400);

        // **work 줄이 그 문서들 위에 함께 선다**(결정 14) — 층 순서가 「작업 → 문서」다.
        assert_eq!(
            lines(&search(&works, &archive, &projects, "네비게이션", &[]).unwrap().hits),
            vec![
                "작업 가",
                "문서 가/overview.md",
                "문서 가/decisions.md",
                "문서 가/01-첫판/spec.md",
            ]
        );
        // 다 지우면 남의 것까지 도로 선다 — 가장 최근에 고쳐진 것이 맨 위다.
        assert_eq!(
            rows(&search(&works, &archive, &projects, "", &[]).unwrap().hits)[0],
            ("나", "overview.md", false)
        );
    }

    /// 결정 12. 한 단어를 더하면 **그 안에서** 좁혀진다. 맞추는 것이 「제목 / 판 폴더 / 파일명」을
    /// 이어 붙인 **한 문자열**이라, 토큰이 제목과 판 폴더에 걸쳐 있어도 맞는다.
    #[test]
    fn 단어를_더하면_그_안에서_좁혀진다() {
        let (_tmp, works, archive, projects) = roots();
        work(&works, "가", "네비게이션 개편");
        doc(&works, "가", "spec/01-첫판/spec.md", 200);
        doc(&works, "가", "spec/02-둘째판/spec.md", 100);

        assert_eq!(
            rows(&search(&works, &archive, &projects, "네비게이션 둘째", &[]).unwrap().hits),
            vec![("가", "02-둘째판/spec.md", false)]
        );
    }

    /// 결정 22. **접두사가 아니다** — 이름의 가운데 토막으로도 맞는다. work 제목이 한글이라
    /// (「터미널 2판」) 앞 글자만으로는 못 좁히는 일이 많다.
    #[test]
    fn 이름의_가운데_토막으로도_맞는다() {
        let (_tmp, works, archive, projects) = roots();
        work(&works, "가", "터미널 2판");
        doc(&works, "가", "spec/overview.md", 100);

        assert_eq!(
            lines(&search(&works, &archive, &projects, "미널", &[]).unwrap().hits),
            vec!["작업 가", "문서 가/overview.md"]
        );
    }

    /// 결정 9. 대소문자를 무시하고, **토큰이 하나라도 안 맞으면 안 뜬다**(AND).
    #[test]
    fn 대소문자를_무시하고_하나라도_안_맞으면_안_뜬다() {
        let (_tmp, works, archive, projects) = roots();
        work(&works, "가", "Cart 개편");
        doc(&works, "가", "spec/Overview.md", 100);

        assert_eq!(
            rows(&search(&works, &archive, &projects, "cart OVERVIEW", &[]).unwrap().hits),
            vec![("가", "Overview.md", false)]
        );
        assert!(search(&works, &archive, &projects, "cart 없는말", &[]).unwrap().hits.is_empty());
    }

    /// 결정 22. **최소 질의 길이가 없다** — 주 쓰임이 「한 글자를 치는 순간」이다.
    #[test]
    fn 한_글자로도_좁혀진다() {
        let (_tmp, works, archive, projects) = roots();
        work(&works, "가", "가 작업");
        doc(&works, "가", "spec/overview.md", 100);
        work(&works, "나", "나 작업");
        doc(&works, "나", "spec/overview.md", 200);

        assert_eq!(
            lines(&search(&works, &archive, &projects, "나", &[]).unwrap().hits),
            vec!["작업 나", "문서 나/overview.md"]
        );
    }

    /// 결정 5·13. **좁힌 안에서도** 활성이 아카이브보다 위다.
    #[test]
    fn 좁힌_안에서도_활성이_아카이브보다_위다() {
        let (_tmp, works, archive, projects) = roots();
        work(&works, "가", "공통말 작업");
        doc(&works, "가", "spec/overview.md", 100);
        work(&archive, "옛일", "공통말 옛 작업");
        doc(&archive, "옛일", "record.md", 999);

        // **층마다 따로 갈린다** — 아카이브 work이 활성 work 아래이되, 그 work의 문서가
        // 활성 work의 문서보다 위로 올라오지는 않는다(결정 13).
        assert_eq!(
            lines(&search(&works, &archive, &projects, "공통말", &[]).unwrap().hits),
            vec![
                "작업 가",
                "작업 옛일 (아카이브)",
                "문서 가/overview.md",
                "문서 옛일/record.md (아카이브)",
            ]
        );
    }

    // ── 본문 층 (결정 10·13·26·27·31)

    /// 「그 표현이 어디 있었더라」에 답하는 자리다. **이름에 없는 말을 치면 본문에서 찾고**,
    /// 그 줄은 「문서」가 아니라 **「본문」 층에** 선다 — 갈래가 갈려야 화면이 왜 떴는지를
    /// 말할 수 있다.
    #[test]
    fn 이름에_없는_말은_본문에서_찾는다() {
        let (_tmp, works, archive, projects) = roots();
        work(&works, "가", "가 작업");
        doc_with(&works, "가", "spec/overview.md", 100, "빈자리인 것도 확인했다\n".as_bytes());

        let hits = search(&works, &archive, &projects, "빈자리", &nav()).unwrap().hits;
        assert_eq!(lines(&hits), vec!["본문 가/overview.md"]);
        // 스니펫 한 줄이 **맞은 대목**을 보여 준다 — 열기 전에 왜 떴는지가 그 줄 안에서 설명된다.
        assert_eq!(snippets(&hits), vec!["빈자리인 것도 확인했다"]);
    }

    /// 결정 10. **AND의 범위는 문단이다** — 문서 전체를 단위로 삼으면 581줄짜리 문서가 흔한
    /// 단어 둘로 거의 항상 맞고, 스니펫이 모든 토큰을 못 보여줘 왜 떴는지를 설명 못 하게 된다.
    #[test]
    fn 토큰들이_한_문단에_있어야_맞는다() {
        let (_tmp, works, archive, projects) = roots();
        work(&works, "가", "가 작업");
        doc_with(
            &works,
            "가",
            "spec/흩어진.md",
            100,
            "앞 문단에 주소가 있다\n\n뒤 문단에 tab이 있다\n".as_bytes(),
        );
        doc_with(&works, "가", "spec/모인.md", 200, "한 문단에 주소와 tab이 함께 있다\n".as_bytes());

        let hits = search(&works, &archive, &projects, "주소 tab", &nav()).unwrap().hits;
        assert_eq!(lines(&hits), vec!["본문 가/모인.md"]);
    }

    /// 결정 10. 실측: `decisions.md`는 581줄에 문단 201개, 평균 57자 — **한 문장이 손으로
    /// 접혀 여러 줄에 걸친다.** 줄을 단위로 삼으면 「주소 tab」이 **조용히** 안 잡힌다.
    #[test]
    fn 줄이_갈려_있어도_맞는다() {
        let (_tmp, works, archive, projects) = roots();
        work(&works, "가", "가 작업");
        doc_with(
            &works,
            "가",
            "spec/접힌.md",
            100,
            "주소가 위치의 정본이라 문서는 `?file=`,\n  탭은 `tab`으로 산다\n".as_bytes(),
        );

        let hits = search(&works, &archive, &projects, "주소 tab", &nav()).unwrap().hits;
        assert_eq!(lines(&hits), vec!["본문 가/접힌.md"]);
        // **스니펫도 한 줄이다** — 접힌 것을 펴서 내보내야 토큰이 그 줄 안에 함께 선다.
        // 이어 붙이는 자리의 들여쓰기는 접기의 흔적이라 남기지 않는다.
        assert_eq!(
            snippets(&hits),
            vec!["주소가 위치의 정본이라 문서는 `?file=`, 탭은 `tab`으로 산다"]
        );
    }

    /// 결정 6·26. 「제일 좋은」을 점수로 정의하면 그 점수를 설명해야 하고, **설명 못 하는
    /// 순서는 목록을 못 믿게 만든다.** 그래서 **처음 맞은 문단**이고, 문서 하나에 줄은 하나다.
    #[test]
    fn 여러_문단이_맞아도_처음_맞은_문단_한_줄이다() {
        let (_tmp, works, archive, projects) = roots();
        work(&works, "가", "가 작업");
        doc_with(
            &works,
            "가",
            "spec/여럿.md",
            100,
            "먼저 맞는 문단\n\n사이에 낀 문단\n\n나중에 맞는 문단\n".as_bytes(),
        );

        let hits = search(&works, &archive, &projects, "맞는", &nav()).unwrap().hits;
        assert_eq!(lines(&hits), vec!["본문 가/여럿.md"]);
        assert_eq!(snippets(&hits), vec!["먼저 맞는 문단"]);
    }

    /// 결정 27. **확장자 목록으로 가르지 않는다** — 프런트에 이미 이미지 확장자 목록이 있어서
    /// 코어에 또 두면 판정이 갈리고, 새 이진 형식이 들어오면 둘 다 고쳐야 한다. **UTF-8로
    /// 읽히면 뒤지고 아니면 뺀다.** 그리고 **이름 층은 그대로 전부 낸다** — 그림도 앱이 열 수
    /// 있는 문서다.
    #[test]
    fn utf8로_안_읽히면_본문_층에서_빠지고_이름_층에는_선다() {
        let (_tmp, works, archive, projects) = roots();
        work(&works, "가", "가 작업");
        doc_with(&works, "가", "spec/cat.png", 100, b"\x89PNG\r\n\x1a\n\xff\xfe cat");
        doc_with(&works, "가", "spec/cat.md", 200, "cat 이야기\n".as_bytes());

        let hits = search(&works, &archive, &projects, "cat", &nav()).unwrap().hits;
        assert_eq!(lines(&hits), vec!["문서 가/cat.md", "문서 가/cat.png", "본문 가/cat.md"]);
    }

    /// 결정 5·13. **본문 층은 맨 아래다** — 「이름을 안다」는 「내용이 들었다」보다 항상
    /// 정확하다. 활성과 아카이브는 **그 층 안에서** 갈리고 층을 가로질러 앞서지 않는다.
    #[test]
    fn 본문_층은_맨_아래이고_활성이_아카이브보다_위다() {
        let (_tmp, works, archive, projects) = roots();
        work(&works, "활성것", "가 작업");
        doc_with(&works, "활성것", "spec/메아리.md", 100, "다른 말\n".as_bytes());
        doc_with(&works, "활성것", "spec/본문것.md", 50, "메아리가 여기 있다\n".as_bytes());
        work(&archive, "옛것", "옛 작업");
        // **아카이브 본문이 활성 본문보다 최근이다** — mtime만 보면 위로 올라올 자리다.
        doc_with(&archive, "옛것", "record.md", 999, "메아리가 저기 있다\n".as_bytes());

        assert_eq!(
            lines(&search(&works, &archive, &projects, "메아리", &nav()).unwrap().hits),
            vec![
                "문서 활성것/메아리.md",
                "본문 활성것/본문것.md",
                "본문 옛것/record.md (아카이브)",
            ]
        );
    }

    /// **이름으로도 본문으로도 맞으면 두 층에 선다.** 두 층이 답하는 물음이 다르기 때문이다 —
    /// 「이름에 그 말이 있다」와 「본문에 그 말이 있다」는 서로를 대신하지 못하고, 구획 머리가
    /// 그 둘을 갈라 말한다. 한쪽을 지우려면 「어느 쪽을 지우는가」에 새 규칙이 필요한데,
    /// 스펙에 그 규칙이 없다.
    #[test]
    fn 이름과_본문이_함께_맞으면_두_층에_선다() {
        let (_tmp, works, archive, projects) = roots();
        work(&works, "가", "가 작업");
        doc_with(&works, "가", "spec/메아리.md", 100, "메아리가 이름에도 본문에도 있다\n".as_bytes());

        assert_eq!(
            lines(&search(&works, &archive, &projects, "메아리", &nav()).unwrap().hits),
            vec!["문서 가/메아리.md", "본문 가/메아리.md"]
        );
    }

    /// 결정 23. 본문 층도 **mtime 내림차순**이다 — 팔레트에 시간 규칙이 하나만 남는다.
    #[test]
    fn 본문도_mtime_내림차순이다() {
        let (_tmp, works, archive, projects) = roots();
        work(&works, "가", "가 작업");
        doc_with(&works, "가", "spec/먼저.md", 100, "메아리\n".as_bytes());
        doc_with(&works, "가", "spec/나중.md", 300, "메아리\n".as_bytes());
        doc_with(&works, "가", "spec/가운데.md", 200, "메아리\n".as_bytes());

        assert_eq!(
            lines(&search(&works, &archive, &projects, "메아리", &nav()).unwrap().hits),
            vec!["본문 가/나중.md", "본문 가/가운데.md", "본문 가/먼저.md"]
        );
    }

    /// 결정 24. **상한은 층마다다.** 본문 층도 그 자리에서 잘리고, 잘렸다는 것을 답이 말한다.
    #[test]
    fn 본문도_스무_줄에서_자른다() {
        let (_tmp, works, archive, projects) = roots();
        work(&works, "가", "가 작업");
        for n in 0..LAYER_LIMIT + 5 {
            doc_with(&works, "가", &format!("spec/{n:02}.md"), 100 + n as u64, "메아리\n".as_bytes());
        }

        let results = search(&works, &archive, &projects, "메아리", &nav()).unwrap();
        assert_eq!(results.hits.len(), LAYER_LIMIT);
        assert!(results.truncated, "잘렸는데 잘렸다고 말하지 않았다");
    }

    /// **인덱스도 캐시도 없다** — 부를 때마다 디스크에서 읽는다. 이 앱에서 spec은 늘 밖에서
    /// 바뀌므로(세션이 병렬로 문서를 쓴다), 밖에서 고친 직후에 검색하면 새 내용이 잡혀야 한다.
    #[test]
    fn 밖에서_고친_내용이_바로_잡힌다() {
        let (_tmp, works, archive, projects) = roots();
        work(&works, "가", "가 작업");
        doc_with(&works, "가", "spec/overview.md", 100, "예전 말\n".as_bytes());
        assert!(search(&works, &archive, &projects, "새말", &nav()).unwrap().hits.is_empty());

        doc_with(&works, "가", "spec/overview.md", 200, "새말이 들어왔다\n".as_bytes());

        let hits = search(&works, &archive, &projects, "새말", &nav()).unwrap().hits;
        assert_eq!(snippets(&hits), vec!["새말이 들어왔다"]);
    }

    /// 결정 25. 질의가 비면 **최근 고쳐진 문서만** 선다 — 본문 층도 안 선다. 토큰이 없으면
    /// 문단마다 공허참으로 맞아 문서마다 줄이 하나씩 더 서고, 빈 팔레트의 노림수(「걔가 방금
    /// 뭐 썼지가 키 두 번」)가 그만큼 밀린다.
    #[test]
    fn 질의가_비면_본문_층은_안_선다() {
        let (_tmp, works, archive, projects) = roots();
        work(&works, "가", "가 작업");
        doc(&works, "가", "spec/overview.md", 100);

        assert_eq!(
            lines(&search(&works, &archive, &projects, "", &nav()).unwrap().hits),
            vec!["문서 가/overview.md"]
        );
    }

    /// 결정 31. **`heading`은 판 03이 더한다** — 그때까지 아무도 안 읽는 필드로 살면 틀려도
    /// 안 드러난다. 계약에 아직 없다는 것을 여기서 못 박는다.
    #[test]
    fn 본문_줄에_heading이_없다() {
        let (_tmp, works, archive, projects) = roots();
        work(&works, "가", "가 작업");
        doc_with(&works, "가", "spec/overview.md", 100, "메아리\n".as_bytes());

        let hits = search(&works, &archive, &projects, "메아리", &nav()).unwrap().hits;
        let json = serde_json::to_value(&hits[0]).unwrap();
        let mut keys: Vec<&str> = json.as_object().unwrap().keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, vec!["archived", "kind", "path", "slug", "snippet", "title"]);
    }

    /// 결정 18. 범위는 **건네받은 루트들뿐**이다 — 저장소의 `CONTEXT.md`·`docs/`·소스는
    /// 결과가 아니다. 앱이 열 수 있는 것만 결과가 된다.
    #[test]
    fn 건네받은_루트_밖은_안_걷는다() {
        let (tmp, works, archive, projects) = roots();
        work(&works, "가", "가 작업");
        doc(&works, "가", "spec/overview.md", 100);
        std::fs::write(tmp.path().join("CONTEXT.md"), "말의 정본\n").unwrap();

        assert!(search(&works, &archive, &projects, "context", &[]).unwrap().hits.is_empty());
    }

    // ── 「가는 곳」·작업·프로젝트 층 (결정 13·14·21·23·25)

    /// **주 쓰임이 이 검사다**: `Pro`를 치면 Projects 목적지가 **맨 위에** 뜬다.
    /// 층 순서가 「가는 곳 → 작업 → 문서」라 같은 말이 다른 층에도 맞을 때 목적지가 먼저 선다.
    #[test]
    fn 목적지가_맨_위에_선다() {
        let (_tmp, works, archive, projects) = roots();
        work(&works, "가", "Projects 흉내낸 작업");
        doc(&works, "가", "spec/overview.md", 100);

        assert_eq!(
            lines(&search(&works, &archive, &projects, "Pro", &nav()).unwrap().hits),
            vec!["가는곳 projects", "작업 가", "문서 가/overview.md"]
        );
        // Terminal·Archive도 같다 — 셋이 같은 규칙 하나를 지난다.
        assert_eq!(
            lines(&search(&works, &archive, &projects, "term", &nav()).unwrap().hits),
            vec!["가는곳 terminal"]
        );
        assert_eq!(
            lines(&search(&works, &archive, &projects, "archi", &nav()).unwrap().hits),
            vec!["가는곳 archive"]
        );
    }

    /// 결정 21. **`key`만 돌아간다.** 라벨과 라우트를 되돌려 보내면 정본이 둘이 된다 —
    /// 프런트가 건넨 말을 코어가 다시 말해 주는 순간, 어긋나는 날 어느 쪽이 맞는지 모른다.
    #[test]
    fn 목적지_줄은_key만_싣는다() {
        let (_tmp, works, archive, projects) = roots();

        let answer = search(&works, &archive, &projects, "Pro", &nav()).unwrap();
        let json = serde_json::to_value(&answer).unwrap();
        let row = &json["hits"][0];
        assert_eq!(row["kind"], "destination");
        assert_eq!(row["key"], "projects");
        // 갈래 태그와 key **둘뿐이다.** 라벨이 실려 오면 여기가 빨개진다.
        assert_eq!(row.as_object().unwrap().len(), 2, "목적지 줄이 key 말고 다른 것을 실었다: {row}");
    }

    /// 결정 21. CLI·MCP가 부를 때는 **빈 목록을 넘긴다** — 「나는 목적지가 없다」는 멀쩡한
    /// 답이고, 나머지 층은 그대로 돈다.
    #[test]
    fn 빈_목적지_목록을_넘겨도_나머지가_돈다() {
        let (_tmp, works, archive, projects) = roots();
        work(&works, "가", "Projects 흉내낸 작업");
        doc(&works, "가", "spec/overview.md", 100);

        assert_eq!(
            lines(&search(&works, &archive, &projects, "Pro", &[]).unwrap().hits),
            vec!["작업 가", "문서 가/overview.md"]
        );
    }

    /// 결정 25. **질의가 비면 최근 고쳐진 문서만 선다.** 토큰이 없으면 목적지·작업·프로젝트가
    /// 전부 공허참으로 맞아 늘 문서 위에 서는데, 빈 팔레트의 노림수가 「걔가 방금 뭐 썼지가
    /// 키 두 번」이다(결정 11) — 그것들이 위에 서면 방향키를 그만큼 더 눌러야 한다.
    #[test]
    fn 질의가_비면_최근_고쳐진_문서만_선다() {
        let (_tmp, works, archive, projects) = roots();
        work(&works, "가", "가 작업");
        doc(&works, "가", "spec/overview.md", 100);
        project(&projects, "billing", "빌링");

        assert_eq!(
            lines(&search(&works, &archive, &projects, "", &nav()).unwrap().hits),
            vec!["문서 가/overview.md"]
        );
        // 공백만 친 것도 토큰 0개다 — 「비었다」의 판정이 한 자리다.
        assert_eq!(
            lines(&search(&works, &archive, &projects, "   ", &nav()).unwrap().hits),
            vec!["문서 가/overview.md"]
        );
    }

    /// 결정 14. **문서만 결과가 되면 spec 문서가 0개인 work은 검색에 영영 안 뜬다** —
    /// 실측(2026-08-29) 활성 10개 중 3개가 그렇고, 방금 만든 것들이라 문서가 아직 없다.
    #[test]
    fn 문서가_0개인_work도_결과에_선다() {
        let (_tmp, works, archive, projects) = roots();
        work(&works, "방금만든것", "방금 만든 작업");

        assert_eq!(
            lines(&search(&works, &archive, &projects, "방금", &[]).unwrap().hits),
            vec!["작업 방금만든것"]
        );
    }

    /// 결정 23. **작업 층의 순서는 `list_works`가 쓰는 것과 같은 비교자다** — 고정 먼저,
    /// 그다음 만든 순 내림차순, 같은 날이면 slug 오름차순. 팔레트가 다른 순서를 쓰면
    /// 사이드바와 어긋난 두 세상이 생긴다.
    #[test]
    fn 작업_층은_목록_함수와_같은_순서다() {
        let (_tmp, works, archive, projects) = roots();
        work_at(&works, "old", "묶음 오래된것", "2026-08-01", false);
        work_at(&works, "new-b", "묶음 새것 나", "2026-08-05", false);
        work_at(&works, "new-a", "묶음 새것 가", "2026-08-05", false);
        // 고정된 것은 **가장 오래됐어도** 맨 위다.
        work_at(&works, "pinned", "묶음 고정", "2026-07-01", true);

        assert_eq!(
            lines(&search(&works, &archive, &projects, "묶음", &[]).unwrap().hits),
            vec!["작업 pinned", "작업 new-a", "작업 new-b", "작업 old"]
        );
    }

    /// 결정 23. **프로젝트 층은 `list_projects`와 같은 이름 사전순이다**(대소문자 무시).
    #[test]
    fn 프로젝트_층은_이름_사전순이다() {
        let (_tmp, works, archive, projects) = roots();
        project(&projects, "b", "beta");
        project(&projects, "a", "Alpha");
        project(&projects, "g", "gamma");

        assert_eq!(
            lines(&search(&works, &archive, &projects, "a", &[]).unwrap().hits),
            vec!["프로젝트 a", "프로젝트 b", "프로젝트 g"]
        );
    }

    /// 결정 5·13. **층 순서는 「가는 곳 → 작업 → 프로젝트 → 문서」이고, 활성과 아카이브는
    /// 각 층 안에서만 갈린다.** 아카이브 work 이름을 정확히 쳤는데 그 문서가 활성 work의
    /// 어설픈 매치보다 아래로 밀리면, 아카이브를 포함시킨 것이 오히려 방해가 된다.
    #[test]
    fn 층을_가로질러_앞서지_않는다() {
        let (_tmp, works, archive, projects) = roots();
        work(&works, "활성것", "arc 활성 작업");
        doc(&works, "활성것", "spec/overview.md", 100);
        work(&archive, "옛것", "옛 arc 작업");
        // **아카이브 문서가 활성 문서보다 최근이다** — mtime만 보면 위로 올라올 자리다.
        doc(&archive, "옛것", "record.md", 999);
        project(&projects, "argo", "argo");

        assert_eq!(
            lines(&search(&works, &archive, &projects, "ar", &nav()).unwrap().hits),
            vec![
                "가는곳 archive",
                "작업 활성것",
                "작업 옛것 (아카이브)",
                "프로젝트 argo",
                "문서 활성것/overview.md",
                "문서 옛것/record.md (아카이브)",
            ]
        );
    }

    /// 결정 24. **상한은 층마다다** — 앞 층이 전체 상한을 먹으면 뒤 층이 영영 안 보인다.
    #[test]
    fn 상한은_층마다_따로_센다() {
        let (_tmp, works, archive, projects) = roots();
        for n in 0..LAYER_LIMIT + 5 {
            work(&works, &format!("묶음{n:02}"), &format!("묶음 {n:02}"));
        }
        work(&works, "문서집", "묶음 문서집");
        doc(&works, "문서집", "spec/overview.md", 100);

        let results = search(&works, &archive, &projects, "묶음", &[]).unwrap();
        // 작업 층이 스무 줄에서 잘려도 **문서 층은 그대로 선다.**
        assert_eq!(results.hits.len(), LAYER_LIMIT + 1);
        assert_eq!(lines(&results.hits)[LAYER_LIMIT], "문서 문서집/overview.md");
        assert!(results.truncated, "잘렸는데 잘렸다고 말하지 않았다");
    }
}
