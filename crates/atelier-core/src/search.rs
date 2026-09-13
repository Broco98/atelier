use std::cmp::Reverse;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use crate::paths::{archive_in, projects_in, works_in};
use crate::recent::read_recent;
use crate::store::read_projects;
use crate::works::{read_works, spec_dir, spec_files};
use crate::{list_archive, list_archived_docs, Mode, Result, Work};

// **이 파일에는 결정 번호 세 벌이 산다.** 맨 `결정 N`은 이 검색을 지은 판(`spec-search`,
// 이슈 #149)의 것이고, **`팔레트 결정 N`**은 그 뒤 판(`palette-key-and-home`, 이슈 #176)의
// 것이며, **`UI개선 결정 N`**은 그다음 판(`ui-improvement`, 이슈 #213)의 것이다. 번호가
// 겹치는 것이 여럿이라(맨·팔레트 사이만 5·6·9·10·11·13·15·23·24·25) 수식 없이 두면 다음 사람이
// 정반대의 규칙을 읽는다 — 이를테면 맨 `결정 11`은 「빈 질의는 최근 고쳐진 문서」이고
// `팔레트 결정 11`은 「작업 층은 MRU」다. 뒤집힌 옛 결정을 가리킬 때는 수식 앞에 `옛`을 붙여
// `옛 결정 N`·`옛 팔레트 결정 N`으로 적는다.

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
        /// 이미 한 줄에 맞춰 줄이는 자리를 갖고 있다 — 상한(`LAYER_LIMIT`)이 이 파일 한
        /// 자리에만 사는 것과 같은 이유다.
        snippet: String,
    },
}

/// 한 층이 낼 수 있는 줄 수. **전체 상한이 아니라 층마다다** — 앞 층이 상한을 먹으면 뒤
/// 층이 영영 안 보인다.
///
/// **20은 실측이 하한을 정했다**: work 하나가 가진 문서가 최대 11개라 그보다 작으면
/// 「work 이름을 치면 그 문서가 전부 뜬다」가 잘린다.
///
/// **상한이 필요한 근거가 갈렸다.** 한때는 「빈 질의가 낼 줄이 197개(활성 38 + 아카이브
/// 159)」였는데, 빈 질의가 문서·본문 층을 안 세우게 되면서(팔레트 결정 5·6) 그 숫자가 사라졌다.
/// 남은 근거는 **친 질의**다 — 흔한 토큰 하나면 문서·본문 층이 그만큼 나오고, 작업 층도
/// 활성 18 + 아카이브 29를 함께 센다.
///
/// **팔레트 결정 10의 표제(「작업 층에 상한을 두지 않는다」)와 이 상수가 어긋난 채로 남는다.**
/// 결정문 자신이 「넘는 날 다시 볼 자리」로 넘겼는데, **넘는 날 아무도 안 알려준다** —
/// 값이 안 바뀌므로 컴파일도 검사도 침묵한다. 그래서 작업 층이 이 값에 닿는 검사를 하나
/// 세워 기록으로 남긴다(`빈_질의의_작업_층이_상한에_닿으면_잘린다`). 실측(2026-09-07)
/// 빈 질의의 작업 층이 **18줄이라 여유가 2줄**이다 — 상한이 층마다이므로 가는 곳 층의 넷은
/// 이 셈에 안 들어간다(빈 화면에 서는 줄은 스물둘이지만 어느 층도 상한에 안 닿는다).
pub(crate) const LAYER_LIMIT: usize = 20;

/// 팔레트가 한 번에 받는 것. **줄들만으로는 「잘렸다」를 말할 수 없다** — 딱 20줄이 온 것과
/// 21번째부터 잘린 것이 목록으로는 같은 모양이라, 화면이 그것을 가르려면 상한을 자기도
/// 알고 세어야 한다. 그러면 상한이 두 자리에 살고, 고치는 날 어긋나도 화면에 티가 안 난다
/// (결정 15가 순위·층 규칙을 코어에 몰아둔 것과 같은 이유다).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    pub hits: Vec<SearchHit>,
}

// **한때 `truncated: bool`이 함께 실려 나갔다.** 화면이 바닥에 「일부만 보입니다 — 더 치면
// 좁혀집니다」를 세우기 위한 값이었는데, 그 줄이 걷히면서(결정 24 — 이제 바닥이 **녹아서**
// 말한다) 읽는 자리가 하나도 안 남았다. 그때 실측이 그 줄을 편들지 않았다: 빈 질의가 문서
// 층을 전량 세우므로 `truncated`는 **팔레트를 열 때마다 참**이었고, 늘 켜진 신호가 나르는
// 정보는 0이다. 아무도 안 읽는 값을 계약에 남기면 다음 사람이 그것을 뜻 있는 것으로 읽는다.
//
// **그 실측은 이제 사실이 아니다** — 빈 질의가 문서 층을 안 세운다(팔레트 결정 5·6). 값을 되살릴
// 이유는 여전히 없다: 읽는 자리가 없다는 첫째 근거가 그대로이고, 바닥이 녹어 말하는 그 길이
// 「더 있다」를 화면에서 이미 답한다.

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
///
/// **이력도 이 안에서 읽는다**(팔레트 결정 13). 「마지막으로 연 순」은 작업 층의 순서 규칙이고
/// 순서 규칙은 코어의 것이라, 그 재료도 코어가 읽어야 한다 — 프런트가 정렬된 slug 배열을
/// 건네게 되는 순간 정책이 바깥으로 샌다.
///
/// **루트를 인자로 받지, 안에서 `data_root()`를 부르지 않는다.** 코어의 어떤 함수도 그것을
/// 부르지 않고, 단위 검사 전체가 임시 폴더를 넘기는 구조에 기대고 있다 — 박으면 `cargo test`가
/// 개발자의 **진짜** `~/.atelier/recent.json`을 읽고 쓴다. 팔레트 결정 13의 「`search` 계약은 안
/// 는다」는 **IPC 계약**을 말한 것이고, 프런트가 보내는 것은 계속 질의와 목적지 둘뿐이다.
///
/// **받는 루트는 그 세계의 홈 하나다 — 층마다 넷을 받지 않는다.** 한때 works·archive·projects·
/// 이력을 따로 받았는데, 네 값은 언제나 한 루트에서 파생되는 한 벌이라 **부르는 쪽이 넷을
/// 맞춰 주는 일**이 생겼다: 실제로 두 어댑터(`commands.rs`·다리)가 「반드시 코어의 데이터
/// 루트다」를 각자 주석으로 경고하고 있었고, 그 경고는 어긋나도 컴파일이 안 잡는다.
/// 여기서 `paths.rs`의 파생을 부르면 그 어긋남이 **일어날 자리 자체가 없다** — 규약이 구조가
/// 된다(같은 크레이트의 `archive_dir`이 든 논거다).
///
/// **루트와 함께 모드를 받는다** — 루트만으로는 파생이 안 끝난다. 진행 중인 항목의 폴더
/// 이름이 세계마다 다르고(`works`/`rooms`), 프로젝트 층은 Maison에 **아예 없다**(결정 17).
/// 층을 뒤에서 걸러 내지 않고 **읽을 루트를 안 주는 것**이라, 걸러야 할 것을 잊는 자리가
/// 안 생긴다. 등록부를 건네면 공부하다 ⇧⇧를 눌렀을 때 `feat/spec-search`가 뜬다(US 49).
///
/// **이력도 세계마다 한 장이다** — 루트가 그 세계의 홈이므로 `maison/recent.json`이 따로
/// 선다. 한 장으로 합치면 두 세계에 같은 slug가 설 수 있다는 것(결정 10)이 그대로 새어,
/// Maison에서 연 「reading」이 Atelier 팔레트의 「reading」을 맨 위로 올린다.
pub fn search(
    root: &Path,
    mode: Mode,
    query: &str,
    destinations: &[Destination],
) -> Result<SearchResults> {
    // 파생은 `paths.rs`가 정본이다 — 여기서 `root.join("works")`를 적으면 배치가 두 벌이 된다.
    let works_root = works_in(root, mode);
    let archive_root = archive_in(root);
    let projects_root = match mode {
        Mode::Atelier => Some(projects_in(root)),
        Mode::Maison => None,
    };
    let tokens = tokens(query);
    let layers = [
        destination_hits(destinations, &tokens),
        // 이력은 그 세계의 홈 **바로 아래** 한 장이라(`recent.rs`) 루트가 그대로 들어간다.
        work_hits(&works_root, &archive_root, root, &tokens)?,
        project_hits(projects_root.as_deref(), &tokens)?,
        doc_hits(&works_root, &archive_root, &tokens)?,
        text_hits(&works_root, &archive_root, &tokens)?,
    ];

    let mut hits = Vec::new();
    for mut layer in layers {
        layer.truncate(LAYER_LIMIT);
        hits.extend(layer);
    }
    Ok(SearchResults { hits })
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
    // 빈 질의가 여기서 갈린다 — 접을 문자열도 안 만든다. **이 길로 오는 것은 목적지 층이다**
    // (작업 층은 빈 질의에서 아예 다른 술어를 쓰고, 프로젝트·문서·본문은 안 선다).
    //
    // **이 한 줄이 「빈 팔레트가 가는 곳을 낸다」의 전부다.** 여기를 좁혀 「토큰이 없으면
    // 거짓」으로 만들면 빈 화면이 통째로 빈다 — 그 갈래를 세는 검사가 코어 단위에 있다.
    if tokens.is_empty() {
        return true;
    }
    let hay = hay.to_lowercase();
    tokens.iter().all(|token| hay.contains(token))
}

/// 질의가 비었는가. **이 한 줄을 이름으로 부르는 것은 층들이 그 답으로 갈리기 때문이다** —
/// `tokens.is_empty()`를 층마다 적으면 「빈 질의의 화면이 어떻게 생겼나」를 물었을 때 읽을
/// 자리가 없다. 여기를 grep하면 갈리는 자리 넷이 한 번에 나온다.
///
/// **한때 이름이 `silent_when_empty`였다.** 부르는 자리가 셋일 때는 참이었는데(층이 통째로
/// 침묵한다), 작업 층이 넷째로 붙으면서 거짓이 됐다 — 그쪽은 **침묵하지 않고** 멤버십 술어만
/// 바꾼다. 이름이 답을 넘어 용도까지 말하면 용도가 늘 때 거짓이 되므로, 답만 말하는 이름으로
/// 되돌렸다.
///
/// 답을 받아 무엇을 하는지는 **부르는 층이 각자 적는다**:
///
/// - **프로젝트·문서·본문 — 통째로 침묵한다**(팔레트 결정 5·6). 이 셋의 집합이 곧 빈 화면의
///   모양이라, 한 자리만 빠져도 화면이 갈린다(문서 층에서 이 호출을 빼면 빈 팔레트에 문서
///   줄이 그대로 남는데, 컴파일도 다른 검사도 그것을 안 잡는다).
/// - **작업 — 멤버십만 바꾸고 줄은 낸다**(팔레트 결정 16 — 갈리는 것은 멤버십뿐이고 순서는
///   공통이다). 빈 질의가 작업 층에서 빼는 것은 이제 **아카이브뿐이다** — 초안은 일부러
///   세운다(UI개선 결정 29). 여기를 「부르면 침묵한다」로 읽고 지우면 빈 팔레트의 작업 층이
///   아카이브까지 통째로 낸다.
/// - **가는 곳 — 아예 안 묻는다.** 토큰 0개에 참을 주는 `matches`가 그대로 통과시킨다.
///
/// **팔레트 결정 25를 개정한 결과다.** 그때는 정확히 반대였다 — 문서만 서고 나머지가 침묵했다.
/// 뒤집은 근거는 실물로 그려 본 겹침이다: 빈 화면의 문서 줄 넷 중 셋이 **이미 위에 선
/// work의 것**이라 같은 사실을 두 번 말했고, 정작 「Projects로 가자」·「그 work으로 가자」는
/// 팔레트를 연 뒤에도 글자를 쳐야 시작됐다.
fn query_is_empty(tokens: &[String]) -> bool {
    tokens.is_empty()
}

/// 「가는 곳」 층. **순서는 프런트가 건넨 그대로다** — 목적지가 사이드바에 선 순서이고,
/// 코어가 그것을 다시 정렬하면 두 세상이 생긴다.
///
/// **빈 질의에 전부 선다**(팔레트 결정 5·9). `query_is_empty`를 안 묻고, 토큰 0개에 참을 주는
/// `matches`가 그대로 통과시킨다 — 사이드바를 ⌘B로 접어 뒀을 때 그것을 펴는 것보다
/// ⌘K 한 번이 먼저인 자리가 여기다. 넷뿐이라 상한에 닿을 일도 없다.
fn destination_hits(destinations: &[Destination], tokens: &[String]) -> Vec<SearchHit> {
    destinations
        .iter()
        .filter(|dest| matches(&dest.label, tokens))
        .map(|dest| SearchHit::Destination { key: dest.key.clone() })
        .collect()
}

/// 「작업」 층. **순서는 고정 먼저 → 각 무리 안에서 마지막으로 연 순 → 이력에 없는 것은 목록
/// 함수(`read_works`)의 순서다**(팔레트 결정 11 · UI개선 결정 1).
///
/// ```text
/// pinned desc  →  recent_rank asc (이력에 없으면 MAX)  →  read_works의 순서
/// ```
///
/// 마지막 단(순서 파일 · 만든 순 · slug — `works.rs`의 `order_works`)은 **다시 안 적는다** —
/// `read_works`가 이미 그 순서로 주고 아래 정렬이 안정 정렬이라 동점의 상대 순서가 그대로
/// 남는다. 이력이 비면 결과가 `read_works`의 순서(순서 파일 → 만든 순 → slug) 그대로인 것도
/// 그래서다: 첫 화면이 사이드바와 같고, 쓰면서 갈라진다. 순서 파일이 없으면 판 02와 한 글자도
/// 다르지 않다.
///
/// **고정이 이력을 이긴다**(팔레트 결정 11). 선언이 관찰에 지면 「이미 자주 여는 것을 고정했더니
/// 아무것도 안 바뀌는」 날이 생기고, 그러면 고정을 켜는 행위가 뜻을 잃는다.
///
/// **한때 「순서를 새로 발명하지 않는다」였다** — 목록 함수와 같은 비교자를 그대로 썼다.
/// 뒤집은 것은 팔레트 결정 11이고, 바뀐 것은 **팔레트 쪽뿐이다**(팔레트 결정 16): 목록 함수는 사이드바와
/// 팔레트가 같이 쓰는 한 함수이고 「보이는 첫 항목 = 무선택 정규화가 고르는 항목」이라는
/// 등식(#58)이 그 순서에 매달려 있어서, **사이드바는 MRU가 아니다** — 행이 손 밑에서
/// 움직이면 클릭 대상이 어긋난다. 그래서 정렬은 **이 층 안에서만** 하고 목록 함수는 안 건드린다.
/// **거르는 것도 이 층이 따로 하지 않는다** — 빈 질의에 서는 작업은 목록 함수가 준 전부다(아래).
///
/// **아카이브는 이 정렬 밖이다.** 친 질의에서만 서고, 활성 아래에 `list_archive`가 주는 순서
/// (치운 순 → slug) 그대로 붙는다 — 아카이브 work을 여는 문이 별도 화면이라 이력에 그 slug가
/// 들어갈 길도 없다.
///
/// **층 자르기가 이 뒤에 돈다** — 상한이 먼저 잘리면 MRU가 상한 안에서만 도는 셈이 된다.
///
/// **빈 질의와 친 질의가 가르는 것은 멤버십뿐이다 — 순서는 두 갈래 공통이다**(팔레트 결정 16).
/// 갈래를 순서까지 끌고 가면 **첫 타자에 작업 줄들이 서로 자리를 바꾼다**: 이 층에는
/// 디바운스가 없어서 그 재배열이 즉시 일어난다.
///
/// **빈 질의에는 상태 술어가 없다 — 모든 작업이 선다**(UI개선 결정 29). 한때
/// `pinned || status != Draft`였다(옛 팔레트 결정 7): 사이드바가 초안을 접힌 구역에 격리했으므로
/// 팔레트도 첫 화면에서 뺐다. 그 구역이 사라져 초안이 다른 작업들 사이에 서면서(UI개선 결정 5)
/// 술어를 걷었다 — 사이드바에 서는 것과 팔레트 빈 화면에 서는 것이 **같은 멤버십**이다.
/// 초안이 뒤로 밀리지도 않는다: 이력에 없는 것들의 동점은 아래 안정 정렬이 목록 함수의
/// 순서를 그대로 남긴다.
///
/// **빈 질의는 아카이브 목록을 아예 안 부른다**(팔레트 결정 8). 부르면 실측(2026-09-07) 활성 18 +
/// 아카이브 29 = 47줄이 나와 상한 20에서 **활성 18 + 아카이브 2**로 잘린다 — 치운 것과
/// 지금 것이 스무 번째 자리를 두고 다툰다. IO가 함께 준다.
///
/// **아카이브는 친 질의에서만 서고, 그때 이 층 안에서 활성 아래다**(팔레트 결정 8·13) — 층을
/// 가로지르지는 않는다. 아카이브 본문까지 찾는 유일한 길이 그쪽이라 팔레트에서 빼지 않는다.
///
/// 맞추는 재료는 **제목**이다: 줄에 서는 것이 그것이다.
fn work_hits(
    works_root: &Path,
    archive_root: &Path,
    recent_root: &Path,
    tokens: &[String],
) -> Result<Vec<SearchHit>> {
    let empty = query_is_empty(tokens);
    // 빈 질의는 **아무것도 거르지 않는다**(UI개선 결정 29) — 위 머리말.
    let standing = |work: &Work| empty || matches(&work.title, tokens);
    let mut works: Vec<Work> = read_works(works_root)?.into_iter().filter(standing).collect();

    // 이력에 **없는** 것은 무리 끝이다. 없는 slug를 청소하지 않는 것도 이 한 줄이 든다
    // (팔레트 결정 15) — 목록에 없으면 여기 rank를 못 받을 뿐이다.
    let recent = read_recent(recent_root);
    let rank: HashMap<&str, usize> =
        recent.works.iter().enumerate().map(|(at, work)| (work.slug.as_str(), at)).collect();
    // **안정 정렬이다.** 동점(둘 다 이력에 없음)의 상대 순서가 `read_works`의 것 그대로
    // 남으므로 목록의 순서 규칙(순서 파일 → 만든 순 → slug)을 여기서 다시 적지 않는다.
    works.sort_by_key(|work| {
        (Reverse(work.pinned), rank.get(work.slug.as_str()).copied().unwrap_or(usize::MAX))
    });

    let mut hits: Vec<SearchHit> = works
        .into_iter()
        .map(|work| SearchHit::Work { slug: work.slug, title: work.title, archived: false })
        .collect();
    if empty {
        return Ok(hits);
    }
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
/// **루트가 없으면 층이 빈다** — 등록부가 없는 세계에는 이 층에 설 것이 없다. 빈 폴더를
/// 걷게 하는 것과 결과는 같지만, 없는 폴더를 만들어 두는 쪽은 「Maison에도 프로젝트
/// 자리가 있다」는 거짓을 디스크에 남긴다.
fn project_hits(projects_root: Option<&Path>, tokens: &[String]) -> Result<Vec<SearchHit>> {
    let Some(projects_root) = projects_root else {
        return Ok(Vec::new());
    };
    if query_is_empty(tokens) {
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
/// **질의가 비면 안 선다**(팔레트 결정 5). 이 층에 갈래가 생긴 것이 이 판이다 — 전에는 빈 질의가
/// 「최근 고쳐진 문서」를 세우는 유일한 층이었고(옛 결정 11), 그래서 질의 있는 길과 없는
/// 길이 따로 없었다. 걷어낸 근거는 실물로 그려 본 겹침이다: **빈 화면의 문서 줄 넷 중 셋이
/// 이미 위에 선 work의 것**이었다.
///
/// **빈 질의 IO가 이 한 줄로 준다.** 전에는 팔레트를 열 때마다 두 루트의 work 목록을 걷고
/// 문서마다 mtime을 쳤다 — 이제 빈 질의에서는 아무 폴더도 안 연다.
///
/// **본문은 안 본다** — 파일을 열지 않는다. 그 일은 아래 본문 층의 몫이고, 둘이 **같은
/// 걷기와 같은 정렬**(`doc_layer`)을 쓰되 맞추는 재료만 다르다.
fn doc_hits(works_root: &Path, archive_root: &Path, tokens: &[String]) -> Result<Vec<SearchHit>> {
    if query_is_empty(tokens) {
        return Ok(Vec::new());
    }
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
/// **질의가 비면 안 선다**(팔레트 결정 6). 토큰이 없으면 문단마다 공허참으로 맞아 문서마다 줄이
/// 하나씩 더 선다. 빈 팔레트가 답하는 물음은 「나 어디로 갈까」 하나다.
fn text_hits(works_root: &Path, archive_root: &Path, tokens: &[String]) -> Result<Vec<SearchHit>> {
    if query_is_empty(tokens) {
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
        work_full(root, slug, title, created_at, pinned, "active");
    }

    /// 상태까지 못 박는 work. **빈 질의의 멤버십을 재는 검사만 쓴다** — 그 술어가 보는 것이
    /// 고정과 상태 둘이라, 갈래 넷(draft·active·review·done)을 실제로 놓을 수 있어야 한다.
    fn work_full(
        root: &Path,
        slug: &str,
        title: &str,
        created_at: &str,
        pinned: bool,
        status: &str,
    ) {
        let dir = root.join(slug);
        std::fs::create_dir_all(dir.join("spec")).unwrap();
        std::fs::write(
            dir.join("work.json"),
            format!(
                r#"{{"title":"{title}","status":"{status}","createdAt":"{created_at}","projects":[],"pinned":{pinned}}}"#
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

    /// 이력을 심는다. **연 순서 그대로** 부른다 — 마지막에 부른 것이 맨 앞이 된다.
    /// 파일을 손으로 적지 않고 진짜 쓰기 함수를 타는 것은, 이 검사들이 재는 순서가
    /// **그 함수가 남긴 모양**을 딛기 때문이다.
    fn opened(recent_root: &Path, slugs: &[&str]) {
        for slug in slugs {
            crate::recent::touch_recent_work(recent_root, slug).unwrap();
        }
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

    /// **등록부가 없는 세계에서는 프로젝트 층이 통째로 빈다** — 공부하다 ⇧⇧를 눌렀을 때
    /// `feat/spec-search`가 뜨면 판 01이 없애려던 누수가 검색에 그대로 남는다(US 49).
    ///
    /// 같은 코퍼스를 **두 세계에 똑같이 심고** 모드만 갈라 잰다: 「원래 안 뜨는 질의였다」로
    /// 초록이 되는 것을 막는 것이 요점이라, 프로젝트 줄만 빠지고 나머지 층은 한 줄도 안
    /// 달라져야 한다. 그리고 Maison 쪽이 씨를 `rooms/`에 뿌리므로, 이 검사는 **폴더 이름이
    /// 세계마다 다르다**는 것까지 함께 든다 — `works_in`이 모드를 잃으면 작업 줄과 문서
    /// 줄이 통째로 사라져 빨개진다.
    #[test]
    fn 등록부가_없는_세계는_프로젝트_층만_빈다() {
        let (_tmp, at) = roots();
        work(&at.works, "가", "빌링 작업");
        doc(&at.works, "가", "spec/overview.md", 100);
        project(&at.projects, "billing", "빌링");
        assert_eq!(
            lines(&search(&at.root, at.mode, "빌링", &[]).unwrap().hits),
            vec!["작업 가", "프로젝트 billing", "문서 가/overview.md"]
        );

        let (_tmp2, mai) = roots_for(Mode::Maison);
        work(&mai.works, "가", "빌링 작업");
        doc(&mai.works, "가", "spec/overview.md", 100);
        project(&mai.projects, "billing", "빌링");
        assert_eq!(
            lines(&search(&mai.root, mai.mode, "빌링", &[]).unwrap().hits),
            vec!["작업 가", "문서 가/overview.md"],
            "Maison 검색이 프로젝트 층을 걷었다"
        );
    }

    /// 검사 하나가 쓰는 임시 데이터 루트. **`search`에 넘기는 것은 `root` 하나이고**, 나머지
    /// 셋은 씨를 뿌릴 때만 쓴다 — 파생 규칙은 `paths.rs`가 들고, 여기서 그것을 그대로 흉내
    /// 내는 것이 「이 배치가 맞다」를 검사 쪽에서도 한 번 더 못박는 자리다.
    ///
    /// **루트가 임시 폴더 자신이다** — 코어가 데이터 루트를 스스로 부르지 않는 이유가 이 헬퍼
    /// 하나에 걸려 있다: 박아 두면 `cargo test`가 개발자의 진짜 `~/.atelier`를 읽고 쓴다.
    struct Roots {
        root: PathBuf,
        mode: Mode,
        works: PathBuf,
        archive: PathBuf,
        projects: PathBuf,
    }

    fn roots() -> (tempfile::TempDir, Roots) {
        roots_for(Mode::Atelier)
    }

    /// **모드를 함께 심는다** — 진행 중인 항목의 폴더 이름이 세계마다 달라서
    /// (`works`/`rooms`), 씨를 뿌리는 자리가 `search`가 걷는 자리와 어긋나면 검사가
    /// 「아무것도 못 찾았다」로 조용히 초록이 된다.
    fn roots_for(mode: Mode) -> (tempfile::TempDir, Roots) {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().to_path_buf();
        let at = Roots {
            works: root.join(match mode {
                Mode::Atelier => "works",
                Mode::Maison => "rooms",
            }),
            archive: root.join("archive"),
            projects: root.join("projects"),
            root,
            mode,
        };
        std::fs::create_dir_all(&at.works).unwrap();
        (tmp, at)
    }

    /// 팔레트 결정 23. 문서 층 안의 순서는 **고쳐진 때 내림차순**이다 — 좁힌 뒤에도 방금 고친
    /// 것이 위여야 「걔가 방금 뭐 썼지」가 짧아진다.
    ///
    /// **한때 빈 질의로 이것을 쟀다**(옛 결정 11). 빈 화면이 문서 층을 안 세우게 되면서
    /// (팔레트 결정 5) 재는 자리를 친 질의로 옮겼다 — 지운 것이 아니라 옮긴 것이고, 성질 자체는
    /// 그대로 산다. 아래 여러 검사가 같은 이유로 `"md"`를 친다: 놓은 문서가 전부 `.md`라
    /// **문서 층만** 서고, work 제목에도 목적지 라벨에도 그 토막이 없다.
    #[test]
    fn 최근_고쳐진_문서가_먼저_선다() {
        let (_tmp, at) = roots();
        work(&at.works, "가", "가 작업");
        doc(&at.works, "가", "spec/overview.md", 100);
        doc(&at.works, "가", "spec/01-판/spec.md", 300);
        doc(&at.works, "가", "spec/decisions.md", 200);

        let hits = search(&at.root, at.mode, "md", &[]).unwrap().hits;
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
        let (_tmp, at) = roots();
        work(&at.works, "가", "가 작업");
        doc(&at.works, "가", "spec/overview.md", 100);
        work(&at.archive, "옛일", "옛 작업");
        doc(&at.archive, "옛일", "record.md", 999);

        assert_eq!(
            rows(&search(&at.root, at.mode, "md", &[]).unwrap().hits),
            vec![("가", "overview.md", false), ("옛일", "record.md", true)]
        );
    }

    /// 팔레트 결정 24. 한 층이 스무 줄에서 잘린다 — 안 막으면 방향키로 훑는 것이 고르는 것보다
    /// 비싸진다. 흔한 토막 하나면 문서 층이 그만큼 나온다.
    ///
    /// **상한 그물이 이 검사와 바로 아래 검사 둘뿐이다.** 빈 질의로 재던 것을 친 질의로
    /// 옮기면서 이 둘을 안 옮겼다면 상한을 재는 자리가 통째로 사라졌을 것이다.
    #[test]
    fn 스무_줄에서_자른다() {
        let (_tmp, at) = roots();
        work(&at.works, "가", "가 작업");
        for n in 0..25 {
            doc(&at.works, "가", &format!("spec/{n:02}.md"), 1000 - n as u64);
        }
        // 아카이브에도 있지만 활성이 상한을 먹는다 — 층 안의 순서가 그렇게 정해져 있다.
        work(&at.archive, "옛일", "옛 작업");
        doc(&at.archive, "옛일", "record.md", 5000);

        let results = search(&at.root, at.mode, "md", &[]).unwrap();
        assert_eq!(results.hits.len(), LAYER_LIMIT);
        assert_eq!(rows(&results.hits)[0], ("가", "00.md", false));
        assert_eq!(rows(&results.hits)[LAYER_LIMIT - 1], ("가", "19.md", false));
        // 「더 보기」는 안 만든다(결정 24). 걸렸다는 것만 말하고, 좁히는 것은 사람이 한다.
    }

    /// 상한과 **같은 수**는 잘린 것이 아니다. 목록 길이만으로는 이 둘이 같은 모양이라,
    /// 「잘렸다」를 세는 자리가 코어 밖으로 나가면 여기서 조용히 거짓말을 하게 된다.
    #[test]
    fn 딱_스무_줄이면_스무_줄이_그대로_나간다() {
        let (_tmp, at) = roots();
        work(&at.works, "가", "가 작업");
        for n in 0..LAYER_LIMIT {
            doc(&at.works, "가", &format!("spec/{n:02}.md"), 1000 - n as u64);
        }

        let results = search(&at.root, at.mode, "md", &[]).unwrap();
        assert_eq!(results.hits.len(), LAYER_LIMIT);
    }

    /// 결정 28. `path`는 파일 시스템 경로가 아니라 **그 화면이 `?file=`로 읽는 값**이다 —
    /// 활성은 spec 루트 기준, 아카이브는 work 루트 기준이다.
    #[test]
    fn 경로가_그_화면의_file_값이다() {
        let (_tmp, at) = roots();
        work(&at.works, "가", "가 작업");
        doc(&at.works, "가", "spec/01-판/spec.md", 100);
        work(&at.archive, "옛일", "옛 작업");
        doc(&at.archive, "옛일", "record.md", 90);
        doc(&at.archive, "옛일", "spec/overview.md", 80);

        assert_eq!(
            rows(&search(&at.root, at.mode, "md", &[]).unwrap().hits),
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
        let (_tmp, at) = roots();
        work(&at.works, "가", "터미널 2판");
        doc(&at.works, "가", "spec/overview.md", 100);

        let hits = search(&at.root, at.mode, "md", &[]).unwrap().hits;
        let SearchHit::Doc { title, .. } = &hits[0] else { panic!("문서 줄이 아니다") };
        assert_eq!(title, "터미널 2판");
    }

    /// `list_works`와 같은 규칙 — AI가 망가뜨린 파일 하나가 목록을 통째로 막지 않는다.
    #[test]
    fn 망가진_work_json은_건너뛴다() {
        let (_tmp, at) = roots();
        work(&at.works, "성한것", "성한 작업");
        doc(&at.works, "성한것", "spec/overview.md", 100);
        let broken = at.works.join("망가진것");
        std::fs::create_dir_all(broken.join("spec")).unwrap();
        std::fs::write(broken.join("work.json"), "not json").unwrap();
        doc(&at.works, "망가진것", "spec/overview.md", 999);

        assert_eq!(rows(&search(&at.root, at.mode, "md", &[]).unwrap().hits), vec![("성한것", "overview.md", false)]);
    }

    /// 아카이브 폴더는 첫 아카이빙이, 프로젝트 폴더는 첫 등록이 만든다 — **검색은 만들지
    /// 않는다.** 목록 함수들은 없으면 만들지만(첫 실행이 그 자리를 지난다), 글자마다 부르는
    /// 자리가 폴더를 만들면 「읽기만 한다」가 거짓이 된다.
    #[test]
    fn 없는_폴더가_있어도_돌고_만들지도_않는다() {
        let (_tmp, at) = roots();
        work(&at.works, "가", "가 작업");
        doc(&at.works, "가", "spec/overview.md", 100);

        assert_eq!(rows(&search(&at.root, at.mode, "md", &[]).unwrap().hits), vec![("가", "overview.md", false)]);
        assert!(!at.archive.exists(), "조회가 아카이브 폴더를 만들었다");
        assert!(!at.projects.exists(), "조회가 프로젝트 폴더를 만들었다");
    }

    /// 문서가 하나도 없는 work은 **문서 층에** 줄을 안 낸다 — 그 work을 세우는 것은 작업
    /// 층의 일이다. 여기서 치는 `"md"`는 그 work의 제목에 없어서 작업 층도 안 선다.
    #[test]
    fn 문서가_없는_work은_문서_줄을_안_낸다() {
        let (_tmp, at) = roots();
        work(&at.works, "빈것", "빈 작업");

        assert!(search(&at.root, at.mode, "md", &[]).unwrap().hits.is_empty());
    }

    /// 갈래를 태그로 싣는다 — 프런트가 필드 유무로 종류를 되짚지 않게. 「잘렸다」가 줄이
    /// 아니라 **목록의 성질**로 실리는 것도 여기서 못 박는다.
    #[test]
    fn 문서_줄은_갈래를_달고_나간다() {
        let (_tmp, at) = roots();
        work(&at.works, "가", "가 작업");
        doc(&at.works, "가", "spec/overview.md", 100);

        let json = serde_json::to_value(search(&at.root, at.mode, "md", &[]).unwrap()).unwrap();
        let row = &json["hits"][0];
        assert_eq!(row["kind"], "doc");
        assert_eq!(row["slug"], "가");
        assert_eq!(row["title"], "가 작업");
        assert_eq!(row["path"], "overview.md");
        assert_eq!(row["archived"], false);
    }

    // ── 질의로 좁히는 규칙 (결정 9·12·22)

    /// **주 쓰임이 이 검사다**(결정 12): work 이름을 치면 그 work의 문서가 전부 뜬다
    /// (「A」→ a·b·c). 좁힌 안에서도 순서는 mtime 내림차순이다(팔레트 결정 23).
    #[test]
    fn work_이름을_치면_그_work의_문서가_전부_뜬다() {
        let (_tmp, at) = roots();
        work(&at.works, "가", "네비게이션 개편");
        doc(&at.works, "가", "spec/overview.md", 300);
        doc(&at.works, "가", "spec/decisions.md", 200);
        doc(&at.works, "가", "spec/01-첫판/spec.md", 100);
        work(&at.works, "나", "다른 작업");
        doc(&at.works, "나", "spec/overview.md", 400);

        // **work 줄이 그 문서들 위에 함께 선다**(결정 14) — 층 순서가 「작업 → 문서」다.
        assert_eq!(
            lines(&search(&at.root, at.mode, "네비게이션", &[]).unwrap().hits),
            vec![
                "작업 가",
                "문서 가/overview.md",
                "문서 가/decisions.md",
                "문서 가/01-첫판/spec.md",
            ]
        );
        // 넓히면 남의 것까지 도로 선다 — 가장 최근에 고쳐진 것이 맨 위다.
        assert_eq!(
            rows(&search(&at.root, at.mode, "md", &[]).unwrap().hits)[0],
            ("나", "overview.md", false)
        );
    }

    /// 결정 12. 한 단어를 더하면 **그 안에서** 좁혀진다. 맞추는 것이 「제목 / 판 폴더 / 파일명」을
    /// 이어 붙인 **한 문자열**이라, 토큰이 제목과 판 폴더에 걸쳐 있어도 맞는다.
    #[test]
    fn 단어를_더하면_그_안에서_좁혀진다() {
        let (_tmp, at) = roots();
        work(&at.works, "가", "네비게이션 개편");
        doc(&at.works, "가", "spec/01-첫판/spec.md", 200);
        doc(&at.works, "가", "spec/02-둘째판/spec.md", 100);

        assert_eq!(
            rows(&search(&at.root, at.mode, "네비게이션 둘째", &[]).unwrap().hits),
            vec![("가", "02-둘째판/spec.md", false)]
        );
    }

    /// 결정 22. **접두사가 아니다** — 이름의 가운데 토막으로도 맞는다. work 제목이 한글이라
    /// (「터미널 2판」) 앞 글자만으로는 못 좁히는 일이 많다.
    #[test]
    fn 이름의_가운데_토막으로도_맞는다() {
        let (_tmp, at) = roots();
        work(&at.works, "가", "터미널 2판");
        doc(&at.works, "가", "spec/overview.md", 100);

        assert_eq!(
            lines(&search(&at.root, at.mode, "미널", &[]).unwrap().hits),
            vec!["작업 가", "문서 가/overview.md"]
        );
    }

    /// 결정 9. 대소문자를 무시하고, **토큰이 하나라도 안 맞으면 안 뜬다**(AND).
    #[test]
    fn 대소문자를_무시하고_하나라도_안_맞으면_안_뜬다() {
        let (_tmp, at) = roots();
        work(&at.works, "가", "Cart 개편");
        doc(&at.works, "가", "spec/Overview.md", 100);

        assert_eq!(
            rows(&search(&at.root, at.mode, "cart OVERVIEW", &[]).unwrap().hits),
            vec![("가", "Overview.md", false)]
        );
        assert!(search(&at.root, at.mode, "cart 없는말", &[]).unwrap().hits.is_empty());
    }

    /// 결정 22. **최소 질의 길이가 없다** — 주 쓰임이 「한 글자를 치는 순간」이다.
    #[test]
    fn 한_글자로도_좁혀진다() {
        let (_tmp, at) = roots();
        work(&at.works, "가", "가 작업");
        doc(&at.works, "가", "spec/overview.md", 100);
        work(&at.works, "나", "나 작업");
        doc(&at.works, "나", "spec/overview.md", 200);

        assert_eq!(
            lines(&search(&at.root, at.mode, "나", &[]).unwrap().hits),
            vec!["작업 나", "문서 나/overview.md"]
        );
    }

    /// 결정 5·13. **좁힌 안에서도** 활성이 아카이브보다 위다.
    #[test]
    fn 좁힌_안에서도_활성이_아카이브보다_위다() {
        let (_tmp, at) = roots();
        work(&at.works, "가", "공통말 작업");
        doc(&at.works, "가", "spec/overview.md", 100);
        work(&at.archive, "옛일", "공통말 옛 작업");
        doc(&at.archive, "옛일", "record.md", 999);

        // **층마다 따로 갈린다** — 아카이브 work이 활성 work 아래이되, 그 work의 문서가
        // 활성 work의 문서보다 위로 올라오지는 않는다(결정 13).
        assert_eq!(
            lines(&search(&at.root, at.mode, "공통말", &[]).unwrap().hits),
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
        let (_tmp, at) = roots();
        work(&at.works, "가", "가 작업");
        doc_with(&at.works, "가", "spec/overview.md", 100, "빈자리인 것도 확인했다\n".as_bytes());

        let hits = search(&at.root, at.mode, "빈자리", &nav()).unwrap().hits;
        assert_eq!(lines(&hits), vec!["본문 가/overview.md"]);
        // 스니펫 한 줄이 **맞은 대목**을 보여 준다 — 열기 전에 왜 떴는지가 그 줄 안에서 설명된다.
        assert_eq!(snippets(&hits), vec!["빈자리인 것도 확인했다"]);
    }

    /// 결정 10. **AND의 범위는 문단이다** — 문서 전체를 단위로 삼으면 581줄짜리 문서가 흔한
    /// 단어 둘로 거의 항상 맞고, 스니펫이 모든 토큰을 못 보여줘 왜 떴는지를 설명 못 하게 된다.
    #[test]
    fn 토큰들이_한_문단에_있어야_맞는다() {
        let (_tmp, at) = roots();
        work(&at.works, "가", "가 작업");
        doc_with(
            &at.works,
            "가",
            "spec/흩어진.md",
            100,
            "앞 문단에 주소가 있다\n\n뒤 문단에 tab이 있다\n".as_bytes(),
        );
        doc_with(&at.works, "가", "spec/모인.md", 200, "한 문단에 주소와 tab이 함께 있다\n".as_bytes());

        let hits = search(&at.root, at.mode, "주소 tab", &nav()).unwrap().hits;
        assert_eq!(lines(&hits), vec!["본문 가/모인.md"]);
    }

    /// 결정 10. 실측: `decisions.md`는 581줄에 문단 201개, 평균 57자 — **한 문장이 손으로
    /// 접혀 여러 줄에 걸친다.** 줄을 단위로 삼으면 「주소 tab」이 **조용히** 안 잡힌다.
    #[test]
    fn 줄이_갈려_있어도_맞는다() {
        let (_tmp, at) = roots();
        work(&at.works, "가", "가 작업");
        doc_with(
            &at.works,
            "가",
            "spec/접힌.md",
            100,
            "주소가 위치의 정본이라 문서는 `?file=`,\n  탭은 `tab`으로 산다\n".as_bytes(),
        );

        let hits = search(&at.root, at.mode, "주소 tab", &nav()).unwrap().hits;
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
        let (_tmp, at) = roots();
        work(&at.works, "가", "가 작업");
        doc_with(
            &at.works,
            "가",
            "spec/여럿.md",
            100,
            "먼저 맞는 문단\n\n사이에 낀 문단\n\n나중에 맞는 문단\n".as_bytes(),
        );

        let hits = search(&at.root, at.mode, "맞는", &nav()).unwrap().hits;
        assert_eq!(lines(&hits), vec!["본문 가/여럿.md"]);
        assert_eq!(snippets(&hits), vec!["먼저 맞는 문단"]);
    }

    /// 결정 27. **확장자 목록으로 가르지 않는다** — 프런트에 이미 이미지 확장자 목록이 있어서
    /// 코어에 또 두면 판정이 갈리고, 새 이진 형식이 들어오면 둘 다 고쳐야 한다. **UTF-8로
    /// 읽히면 뒤지고 아니면 뺀다.** 그리고 **이름 층은 그대로 전부 낸다** — 그림도 앱이 열 수
    /// 있는 문서다.
    #[test]
    fn utf8로_안_읽히면_본문_층에서_빠지고_이름_층에는_선다() {
        let (_tmp, at) = roots();
        work(&at.works, "가", "가 작업");
        doc_with(&at.works, "가", "spec/cat.png", 100, b"\x89PNG\r\n\x1a\n\xff\xfe cat");
        doc_with(&at.works, "가", "spec/cat.md", 200, "cat 이야기\n".as_bytes());

        let hits = search(&at.root, at.mode, "cat", &nav()).unwrap().hits;
        assert_eq!(lines(&hits), vec!["문서 가/cat.md", "문서 가/cat.png", "본문 가/cat.md"]);
    }

    /// 결정 5·13. **본문 층은 맨 아래다** — 「이름을 안다」는 「내용이 들었다」보다 항상
    /// 정확하다. 활성과 아카이브는 **그 층 안에서** 갈리고 층을 가로질러 앞서지 않는다.
    #[test]
    fn 본문_층은_맨_아래이고_활성이_아카이브보다_위다() {
        let (_tmp, at) = roots();
        work(&at.works, "활성것", "가 작업");
        doc_with(&at.works, "활성것", "spec/메아리.md", 100, "다른 말\n".as_bytes());
        doc_with(&at.works, "활성것", "spec/본문것.md", 50, "메아리가 여기 있다\n".as_bytes());
        work(&at.archive, "옛것", "옛 작업");
        // **아카이브 본문이 활성 본문보다 최근이다** — mtime만 보면 위로 올라올 자리다.
        doc_with(&at.archive, "옛것", "record.md", 999, "메아리가 저기 있다\n".as_bytes());

        assert_eq!(
            lines(&search(&at.root, at.mode, "메아리", &nav()).unwrap().hits),
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
        let (_tmp, at) = roots();
        work(&at.works, "가", "가 작업");
        doc_with(&at.works, "가", "spec/메아리.md", 100, "메아리가 이름에도 본문에도 있다\n".as_bytes());

        assert_eq!(
            lines(&search(&at.root, at.mode, "메아리", &nav()).unwrap().hits),
            vec!["문서 가/메아리.md", "본문 가/메아리.md"]
        );
    }

    /// 결정 23. 본문 층도 **mtime 내림차순**이다 — 팔레트에 시간 규칙이 하나만 남는다.
    #[test]
    fn 본문도_mtime_내림차순이다() {
        let (_tmp, at) = roots();
        work(&at.works, "가", "가 작업");
        doc_with(&at.works, "가", "spec/먼저.md", 100, "메아리\n".as_bytes());
        doc_with(&at.works, "가", "spec/나중.md", 300, "메아리\n".as_bytes());
        doc_with(&at.works, "가", "spec/가운데.md", 200, "메아리\n".as_bytes());

        assert_eq!(
            lines(&search(&at.root, at.mode, "메아리", &nav()).unwrap().hits),
            vec!["본문 가/나중.md", "본문 가/가운데.md", "본문 가/먼저.md"]
        );
    }

    /// 결정 24. **상한은 층마다다.** 본문 층도 그 자리에서 잘리고, 잘렸다는 것을 답이 말한다.
    #[test]
    fn 본문도_스무_줄에서_자른다() {
        let (_tmp, at) = roots();
        work(&at.works, "가", "가 작업");
        for n in 0..LAYER_LIMIT + 5 {
            doc_with(&at.works, "가", &format!("spec/{n:02}.md"), 100 + n as u64, "메아리\n".as_bytes());
        }

        let results = search(&at.root, at.mode, "메아리", &nav()).unwrap();
        assert_eq!(results.hits.len(), LAYER_LIMIT);
    }

    /// **인덱스도 캐시도 없다** — 부를 때마다 디스크에서 읽는다. 이 앱에서 spec은 늘 밖에서
    /// 바뀌므로(세션이 병렬로 문서를 쓴다), 밖에서 고친 직후에 검색하면 새 내용이 잡혀야 한다.
    #[test]
    fn 밖에서_고친_내용이_바로_잡힌다() {
        let (_tmp, at) = roots();
        work(&at.works, "가", "가 작업");
        doc_with(&at.works, "가", "spec/overview.md", 100, "예전 말\n".as_bytes());
        assert!(search(&at.root, at.mode, "새말", &nav()).unwrap().hits.is_empty());

        doc_with(&at.works, "가", "spec/overview.md", 200, "새말이 들어왔다\n".as_bytes());

        let hits = search(&at.root, at.mode, "새말", &nav()).unwrap().hits;
        assert_eq!(snippets(&hits), vec!["새말이 들어왔다"]);
    }

    /// 팔레트 결정 6. 질의가 비면 **본문 층은 안 선다.** 토큰이 없으면 문단마다 공허참으로 맞아
    /// 문서마다 줄이 하나씩 더 선다.
    #[test]
    fn 질의가_비면_본문_층은_안_선다() {
        let (_tmp, at) = roots();
        work(&at.works, "가", "가 작업");
        doc(&at.works, "가", "spec/overview.md", 100);

        let hits = search(&at.root, at.mode, "", &nav()).unwrap().hits;
        assert!(
            !hits.iter().any(|hit| matches!(hit, SearchHit::Text { .. })),
            "빈 질의에 본문 줄이 섰다: {hits:?}"
        );
        // **같은 문서가 치면 본문으로 나온다** — 「놓은 것이 없어서 안 섰다」로 초록이 되지
        // 않게. 이 한 줄이 없으면 본문 층을 통째로 지워도 위 단언이 초록이다.
        let hits = search(&at.root, at.mode, "본문", &nav()).unwrap().hits;
        assert!(hits.iter().any(|hit| matches!(hit, SearchHit::Text { .. })));
    }

    /// 결정 31. **`heading`은 판 03이 더한다** — 그때까지 아무도 안 읽는 필드로 살면 틀려도
    /// 안 드러난다. 계약에 아직 없다는 것을 여기서 못 박는다.
    #[test]
    fn 본문_줄에_heading이_없다() {
        let (_tmp, at) = roots();
        work(&at.works, "가", "가 작업");
        doc_with(&at.works, "가", "spec/overview.md", 100, "메아리\n".as_bytes());

        let hits = search(&at.root, at.mode, "메아리", &nav()).unwrap().hits;
        let json = serde_json::to_value(&hits[0]).unwrap();
        let mut keys: Vec<&str> = json.as_object().unwrap().keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, vec!["archived", "kind", "path", "slug", "snippet", "title"]);
    }

    /// 결정 18. 범위는 **건네받은 루트들뿐**이다 — 저장소의 `CONTEXT.md`·`docs/`·소스는
    /// 결과가 아니다. 앱이 열 수 있는 것만 결과가 된다.
    #[test]
    fn 건네받은_루트_밖은_안_걷는다() {
        let (tmp, at) = roots();
        work(&at.works, "가", "가 작업");
        doc(&at.works, "가", "spec/overview.md", 100);
        std::fs::write(tmp.path().join("CONTEXT.md"), "말의 정본\n").unwrap();

        assert!(search(&at.root, at.mode, "context", &[]).unwrap().hits.is_empty());
    }

    // ── 「가는 곳」·작업·프로젝트 층 (결정 13·14·21·23·25)

    /// **주 쓰임이 이 검사다**: `Pro`를 치면 Projects 목적지가 **맨 위에** 뜬다.
    /// 층 순서가 「가는 곳 → 작업 → 문서」라 같은 말이 다른 층에도 맞을 때 목적지가 먼저 선다.
    #[test]
    fn 목적지가_맨_위에_선다() {
        let (_tmp, at) = roots();
        work(&at.works, "가", "Projects 흉내낸 작업");
        doc(&at.works, "가", "spec/overview.md", 100);

        assert_eq!(
            lines(&search(&at.root, at.mode, "Pro", &nav()).unwrap().hits),
            vec!["가는곳 projects", "작업 가", "문서 가/overview.md"]
        );
        // Terminal·Archive도 같다 — 셋이 같은 규칙 하나를 지난다.
        assert_eq!(
            lines(&search(&at.root, at.mode, "term", &nav()).unwrap().hits),
            vec!["가는곳 terminal"]
        );
        assert_eq!(
            lines(&search(&at.root, at.mode, "archi", &nav()).unwrap().hits),
            vec!["가는곳 archive"]
        );
    }

    /// 결정 21. **`key`만 돌아간다.** 라벨과 라우트를 되돌려 보내면 정본이 둘이 된다 —
    /// 프런트가 건넨 말을 코어가 다시 말해 주는 순간, 어긋나는 날 어느 쪽이 맞는지 모른다.
    #[test]
    fn 목적지_줄은_key만_싣는다() {
        let (_tmp, at) = roots();

        let answer = search(&at.root, at.mode, "Pro", &nav()).unwrap();
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
        let (_tmp, at) = roots();
        work(&at.works, "가", "Projects 흉내낸 작업");
        doc(&at.works, "가", "spec/overview.md", 100);

        assert_eq!(
            lines(&search(&at.root, at.mode, "Pro", &[]).unwrap().hits),
            vec!["작업 가", "문서 가/overview.md"]
        );
    }

    /// 팔레트 결정 5·6·9. **빈 질의에 서는 것은 가는 곳과 작업 둘뿐이다.** 팔레트를 열자마자
    /// 답하는 물음이 「나 어디로 갈까」 하나가 된다 — 프로젝트·문서·본문은 글자를 쳐야 나온다.
    ///
    /// **팔레트 결정 25를 개정한 결과다.** 그때는 정확히 반대였다(문서만 서고 나머지가 침묵).
    /// 뒤집은 근거는 실물로 그려 본 겹침이다: 빈 화면의 문서 줄 넷 중 셋이 **이미 위에 선
    /// work의 것**이었고, 정작 주 쓰임(Projects·Terminal·각 work을 오간다)에 대해 빈 화면이
    /// 아무 말도 안 했다.
    #[test]
    fn 빈_질의에_가는_곳과_작업만_선다() {
        let (_tmp, at) = roots();
        work(&at.works, "가", "가 작업");
        doc(&at.works, "가", "spec/overview.md", 100);
        project(&at.projects, "billing", "빌링");

        assert_eq!(
            lines(&search(&at.root, at.mode, "", &nav()).unwrap().hits),
            vec!["가는곳 projects", "가는곳 terminal", "가는곳 archive", "작업 가"]
        );
        // 공백만 친 것도 토큰 0개다 — 「비었다」의 판정이 한 자리다.
        assert_eq!(
            lines(&search(&at.root, at.mode, "   ", &nav()).unwrap().hits),
            lines(&search(&at.root, at.mode, "", &nav()).unwrap().hits)
        );
    }

    /// **프로젝트 줄도 따로 센다**(팔레트 결정 6). 빈 질의에 통째로 침묵하는 층이 셋인데
    /// (프로젝트·문서·본문) 한 갈래만 복합 검사에 얹혀 있으면, 고칠 때 그 갈래만 남은 채로
    /// 초록이 될 수 있다 — `query_is_empty`의 독이 경계하는 모양이 정확히 그것이다.
    #[test]
    fn 빈_질의에_프로젝트_줄이_하나도_안_선다() {
        let (_tmp, at) = roots();
        project(&at.projects, "billing", "빌링");

        let hits = search(&at.root, at.mode, "", &nav()).unwrap().hits;
        assert!(
            !hits.iter().any(|hit| matches!(hit, SearchHit::Project { .. })),
            "빈 질의에 프로젝트 줄이 섰다: {hits:?}"
        );
        // **치면 나온다** — 「놓은 것이 없어서 안 섰다」로 초록이 되지 않게.
        assert_eq!(
            lines(&search(&at.root, at.mode, "빌링", &[]).unwrap().hits),
            vec!["프로젝트 billing"]
        );
    }

    /// **문서 줄이 하나도 안 선다는 것을 따로 센다**(팔레트 결정 5). 위 검사는 층 구성을 통째로
    /// 재는데, 문서 층이 `query_is_empty`를 안 묻는 실수는 그 목록이 어차피 갈리므로 **다른 이유로**
    /// 빨개진다 — 고칠 때 문서 줄이 남은 채로 초록을 만들 수 있다. 그 한 갈래를 여기서 못박는다.
    #[test]
    fn 빈_질의에_문서_줄이_하나도_안_선다() {
        let (_tmp, at) = roots();
        work(&at.works, "가", "가 작업");
        for n in 0..3 {
            doc(&at.works, "가", &format!("spec/{n}.md"), 100 + n as u64);
        }

        let hits = search(&at.root, at.mode, "", &nav()).unwrap().hits;
        assert!(
            !hits.iter().any(|hit| matches!(hit, SearchHit::Doc { .. })),
            "빈 질의에 문서 줄이 섰다: {hits:?}"
        );
        // **그 문서들은 치면 나온다** — 「놓은 것이 없어서 안 섰다」로 초록이 되지 않게.
        assert_eq!(rows(&search(&at.root, at.mode, "md", &[]).unwrap().hits).len(), 3);
    }

    /// UI개선 결정 29. **고정 아닌 초안은 친 질의에도 선다** — 빈 질의 쪽은 아래
    /// `빈_질의에_상태와_무관하게_모든_작업이_선다`가 든다. 한때 이 검사는
    /// `고정_아닌_초안은_빈_질의에_안_선다`였고 그 뒤 반은 「치면 나온다」였다. 빈 질의 쪽을
    /// 뒤집으면서 그 반을 여기 남긴다: 상태로 거르는 무엇이 **친 갈래에만** 되살아나면 빈 질의
    /// 검사는 초록인 채로 남는다.
    #[test]
    fn 고정_아닌_초안도_친_질의에_선다() {
        let (_tmp, at) = roots();
        work_full(&at.works, "초안", "그냥 초안", "2026-08-02", false, "draft");
        work_full(&at.works, "도는것", "그냥 작업", "2026-08-01", false, "active");

        assert_eq!(
            lines(&search(&at.root, at.mode, "그냥", &[]).unwrap().hits),
            vec!["작업 초안", "작업 도는것"]
        );
    }

    /// **빈 질의에 거르는 상태가 없다** — 넷(Draft·Active·Review·Done)이 고정 여부와 무관하게
    /// 다 선다. 옛 술어(`pinned || status != Draft`)를 지키던 두 검사(`고정된_초안은…`·
    /// `review와_done도…`)는 술어가 사라지면서 뜻이 이 한 줄로 접혔다: 상태로 거르는 무엇이
    /// 되살아나면 그 갈래가 여기서 빠진다.
    #[test]
    fn 빈_질의에_상태와_무관하게_모든_작업이_선다() {
        let (_tmp, at) = roots();
        work_full(&at.works, "고정초안", "고정된 초안", "2026-08-05", true, "draft");
        work_full(&at.works, "초안", "그냥 초안", "2026-08-04", false, "draft");
        work_full(&at.works, "도는것", "도는 작업", "2026-08-03", false, "active");
        work_full(&at.works, "리뷰", "리뷰 중", "2026-08-02", false, "review");
        work_full(&at.works, "끝난것", "끝난 작업", "2026-08-01", false, "done");

        assert_eq!(
            lines(&search(&at.root, at.mode, "", &[]).unwrap().hits),
            vec!["작업 고정초안", "작업 초안", "작업 도는것", "작업 리뷰", "작업 끝난것"]
        );
    }

    /// 팔레트 결정 8. **빈 질의는 아카이브 목록을 아예 안 부른다.** 부르면 실측(2026-09-07) 활성 18 +
    /// 아카이브 29 = 47줄이 나와 상한 20에서 활성 18 + 아카이브 2로 잘린다 — 치운 것과 지금
    /// 것이 스무 번째 자리를 두고 다툰다.
    ///
    /// **상태 멤버십 검사에 묶지 않는다** — 하나가 다른 하나를 가린다.
    #[test]
    fn 빈_질의에_아카이브_work은_안_선다() {
        let (_tmp, at) = roots();
        work(&at.works, "가", "가 작업");
        work(&at.archive, "옛일", "옛 작업");

        assert_eq!(
            lines(&search(&at.root, at.mode, "", &[]).unwrap().hits),
            vec!["작업 가"]
        );
        // **치면 활성 아래에 선다**(팔레트 결정 8·13). 아카이브 본문까지 찾는 유일한 길이 그쪽이다.
        assert_eq!(
            lines(&search(&at.root, at.mode, "작업", &[]).unwrap().hits),
            vec!["작업 가", "작업 옛일 (아카이브)"]
        );
    }

    /// **팔레트 결정 10의 표제와 코드가 어긋난 채로 남는 자리다.** 결정문은 「작업 층에 상한을 두지
    /// 않는다」인데 코드는 여전히 `LAYER_LIMIT`에서 자른다. 결정문 자신이 「넘는 날 다시 볼
    /// 자리」로 넘겼지만 **넘는 날 아무도 안 알려주므로**, 최소한 기록으로 남긴다.
    ///
    /// 실측(2026-09-07) 빈 질의의 작업 층은 18줄이라 여유가 **2줄**이다.
    #[test]
    fn 빈_질의의_작업_층이_상한에_닿으면_잘린다() {
        let (_tmp, at) = roots();
        for n in 0..LAYER_LIMIT + 5 {
            work_at(&at.works, &format!("w{n:02}"), &format!("작업 {n:02}"), "2026-08-01", false);
        }

        let hits = search(&at.root, at.mode, "", &[]).unwrap().hits;
        assert_eq!(hits.len(), LAYER_LIMIT, "작업 층이 상한에서 잘린다 — 팔레트 결정 10을 다시 볼 자리다");
    }

    /// 결정 14. **문서만 결과가 되면 spec 문서가 0개인 work은 검색에 영영 안 뜬다** —
    /// 실측(2026-08-29) 활성 10개 중 3개가 그렇고, 방금 만든 것들이라 문서가 아직 없다.
    #[test]
    fn 문서가_0개인_work도_결과에_선다() {
        let (_tmp, at) = roots();
        work(&at.works, "방금만든것", "방금 만든 작업");

        assert_eq!(
            lines(&search(&at.root, at.mode, "방금", &[]).unwrap().hits),
            vec!["작업 방금만든것"]
        );
    }

    /// **이력이 비고 순서 파일도 없으면 만든 순 그대로다** — 고정 먼저, 그다음 만든 순 내림차순,
    /// 같은 날이면 slug 오름차순. 판 03의 첫 화면이 판 02와 똑같은 것이 이 성질이고, 쓰면서
    /// 갈라진다. **순서 파일이 있는 경우는 `이력이_비면_빈_질의의_작업_층이_순서_파일을_따른다`가
    /// 든다** — 이 검사는 파일을 안 심어 `order_works`의 fallback만 태운다.
    ///
    /// **한때 이 검사의 이름이 「작업 층은 목록 함수와 같은 순서다」였다**(옛 결정 23).
    /// 이제 그 문장은 거짓이다 — 팔레트는 MRU이고 사이드바는 아니다(팔레트 결정 11·16). 그런데
    /// **이 검사는 판 03 뒤에도 초록인 채로 남는다**: 이력도 순서 파일도 없으면 fallback이 만든 순이라
    /// 결과가 그대로다. 이름과 독을 안 고치면 fallback만 태우는 이 상태를 다음 사람이
    /// 「팔레트가 목록 함수와 같은 순서다」의 그물로 읽는다. **이력이 있는 경우는 바로
    /// 아래 검사가 든다** — 둘이 같은 자리에 있어야 짝이 보인다.
    #[test]
    fn 이력이_비면_만든_순_그대로다() {
        let (_tmp, at) = roots();
        work_at(&at.works, "old", "묶음 오래된것", "2026-08-01", false);
        work_at(&at.works, "new-b", "묶음 새것 나", "2026-08-05", false);
        work_at(&at.works, "new-a", "묶음 새것 가", "2026-08-05", false);
        // 고정된 것은 **가장 오래됐어도** 맨 위다.
        work_at(&at.works, "pinned", "묶음 고정", "2026-07-01", true);

        assert_eq!(
            lines(&search(&at.root, at.mode, "묶음", &[]).unwrap().hits),
            vec!["작업 pinned", "작업 new-a", "작업 new-b", "작업 old"]
        );
    }

    /// UI개선 결정 1·4. **이력이 비면 빈 질의의 작업 층이 순서 파일을 따른다** — 사이드바와 같은
    /// 순서다. 파일에 만든 순과 **반대로** 적어, 이 층이 `read_works`의 순서를 물려받는지 스스로
    /// 다시 세우는지를 가른다: 정렬 규칙이 `list_works`(바깥)에 들어가면 사이드바·MCP만 새 순서가
    /// 되고 여기는 만든 순으로 남아 빨개진다. 정렬이 `read_works` 한 자리에 있다는 것을 이것이 잰다.
    #[test]
    fn 이력이_비면_빈_질의의_작업_층이_순서_파일을_따른다() {
        let (_tmp, at) = roots();
        work_at(&at.works, "첫째", "첫째 작업", "2026-08-01", false);
        work_at(&at.works, "둘째", "둘째 작업", "2026-08-02", false);
        work_at(&at.works, "셋째", "셋째 작업", "2026-08-03", false);
        std::fs::write(at.works.join(".order.json"), r#"{"order":["첫째","둘째","셋째"]}"#)
            .unwrap();

        assert_eq!(
            lines(&search(&at.root, at.mode, "", &[]).unwrap().hits),
            vec!["작업 첫째", "작업 둘째", "작업 셋째"]
        );
    }

    /// 팔레트 결정 11·16. **이력이 있으면 마지막으로 연 순이다 — 친 질의에서도 그렇다.**
    ///
    /// 위 검사와 **같은 씨앗에 이력만 얹는다.** 좁힌 뒤에도 최근에 **연** 것이 최근에
    /// **만든** 것보다 위여야 한다(팔레트 결정 16) — 빈 질의와 친 질의의 순서에 갈래를 두면
    /// 디바운스가 없어 **첫 타자에 줄들이 서로 자리를 바꾼다.**
    #[test]
    fn 이력이_있으면_마지막으로_연_순이다() {
        let (_tmp, at) = roots();
        work_at(&at.works, "old", "묶음 오래된것", "2026-08-01", false);
        work_at(&at.works, "new-b", "묶음 새것 나", "2026-08-05", false);
        work_at(&at.works, "new-a", "묶음 새것 가", "2026-08-05", false);
        work_at(&at.works, "pinned", "묶음 고정", "2026-07-01", true);
        // 만든 순으로는 꼴찌인 것을 마지막에 연다.
        opened(&at.root, &["new-a", "old"]);

        // 고정은 그대로 맨 위다. 나머지는 연 순이 뒤집는다.
        assert_eq!(
            lines(&search(&at.root, at.mode, "묶음", &[]).unwrap().hits),
            vec!["작업 pinned", "작업 old", "작업 new-a", "작업 new-b"]
        );
        // 빈 질의도 같은 순서다 — 갈리는 것은 멤버십뿐이다.
        assert_eq!(
            lines(&search(&at.root, at.mode, "", &[]).unwrap().hits),
            vec!["작업 pinned", "작업 old", "작업 new-a", "작업 new-b"]
        );
    }

    /// 팔레트 결정 11. **고정이 이력을 이긴다.** 선언이 관찰에 지면 「이미 자주 여는 것을 고정했더니
    /// 아무것도 안 바뀌는」 날이 생기고, 그때 고정을 켜는 행위가 뜻을 잃는다.
    #[test]
    fn 고정이_이력을_이긴다() {
        let (_tmp, at) = roots();
        work_at(&at.works, "고정", "묶음 고정", "2026-07-01", true);
        work_at(&at.works, "그냥", "묶음 그냥", "2026-08-05", false);
        // 고정 아닌 것을 **가장 최근에** 열었다.
        opened(&at.root, &["고정", "그냥"]);

        assert_eq!(
            lines(&search(&at.root, at.mode, "묶음", &[]).unwrap().hits),
            vec!["작업 고정", "작업 그냥"]
        );
    }

    /// 팔레트 결정 11. **고정 무리 안에서도 최근에 연 것이 위다.** 고정을 셋 이상 둔 사람에게는
    /// 그 안의 순서가 곧 목록의 순서다 — 「고정이 이긴다」를 「고정은 안 움직인다」로 읽으면
    /// 그 무리가 통째로 만든 순에 얼어붙는다.
    #[test]
    fn 고정_무리_안에서도_최근에_연_것이_위다() {
        let (_tmp, at) = roots();
        work_at(&at.works, "핀가", "묶음 핀 가", "2026-08-05", true);
        work_at(&at.works, "핀나", "묶음 핀 나", "2026-08-03", true);
        work_at(&at.works, "핀다", "묶음 핀 다", "2026-08-01", true);
        opened(&at.root, &["핀다"]);

        assert_eq!(
            lines(&search(&at.root, at.mode, "묶음", &[]).unwrap().hits),
            vec!["작업 핀다", "작업 핀가", "작업 핀나"]
        );
    }

    /// 팔레트 결정 11. **이력에 없는 것은 무리 끝에 만든 순으로 붙는다** — 방금 만든 work이 목록
    /// 밑바닥으로 사라지지 않게. 여기서 재는 것은 그 「끝」이 **만든 순**이라는 것이다.
    #[test]
    fn 이력에_없는_것은_무리_끝에_만든_순으로_붙는다() {
        let (_tmp, at) = roots();
        work_at(&at.works, "연것", "묶음 연 것", "2026-07-01", false);
        work_at(&at.works, "새것", "묶음 새것", "2026-08-05", false);
        work_at(&at.works, "옛것", "묶음 옛것", "2026-08-01", false);
        opened(&at.root, &["연것"]);

        assert_eq!(
            lines(&search(&at.root, at.mode, "묶음", &[]).unwrap().hits),
            vec!["작업 연것", "작업 새것", "작업 옛것"]
        );
    }

    /// 팔레트 결정 15. **이력에 남은 죽은 slug는 목록에 안 선다** — 지우거나 아카이브한 work이다.
    /// 청소하는 자리를 따로 만들지 않는 근거가 이것이다: 목록 교집합에서 자연히 빠진다.
    #[test]
    fn 이력의_죽은_slug는_목록에_안_선다() {
        let (_tmp, at) = roots();
        work_at(&at.works, "산것", "묶음 산 것", "2026-08-01", false);
        opened(&at.root, &["산것", "지운것"]);

        assert_eq!(
            lines(&search(&at.root, at.mode, "묶음", &[]).unwrap().hits),
            vec!["작업 산것"]
        );
    }

    /// 팔레트 결정 8·11. **아카이브는 이 정렬 밖이다.** 친 질의에서만 서고, 활성 아래에
    /// `list_archive`가 주는 순서 그대로 붙는다 — 이력이 그 순서를 흔들지 않는다.
    #[test]
    fn 아카이브는_이_정렬_밖이다() {
        let (_tmp, at) = roots();
        work_at(&at.works, "산것", "묶음 산 것", "2026-08-01", false);
        work(&at.archive, "옛가", "묶음 옛 가");
        work(&at.archive, "옛나", "묶음 옛 나");
        // 아카이브 slug가 이력에 들어갈 길은 없지만(여는 문이 별도 화면이다), 들어가도
        // 이 층의 순서를 안 흔든다는 것을 여기서 못 박는다.
        opened(&at.root, &["옛나"]);

        let hits = search(&at.root, at.mode, "묶음", &[]).unwrap().hits;
        assert_eq!(lines(&hits)[0], "작업 산것");
        // **기대값을 그대로 적는다.** 한때 「이력이 빈 루트로 한 번 더 검색해 견주는」 모양이
        // 었는데, 루트가 하나가 되면서 그 비교 상대를 만들 자리가 없어졌다 — 그리고 그 모양은
        // 애초에 두 번 다 같은 버그를 타면 초록이었다. `archivedAt`이 없으니 `list_archive`의
        // 순서는 slug 사전순이고, MRU가 이 층으로 새면 「옛나」가 앞으로 온다.
        assert_eq!(lines(&hits)[1..], ["작업 옛가 (아카이브)", "작업 옛나 (아카이브)"]);
    }

    /// 결정 23. **프로젝트 층은 `list_projects`와 같은 이름 사전순이다**(대소문자 무시).
    #[test]
    fn 프로젝트_층은_이름_사전순이다() {
        let (_tmp, at) = roots();
        project(&at.projects, "b", "beta");
        project(&at.projects, "a", "Alpha");
        project(&at.projects, "g", "gamma");

        assert_eq!(
            lines(&search(&at.root, at.mode, "a", &[]).unwrap().hits),
            vec!["프로젝트 a", "프로젝트 b", "프로젝트 g"]
        );
    }

    /// 결정 5·13. **층 순서는 「가는 곳 → 작업 → 프로젝트 → 문서」이고, 활성과 아카이브는
    /// 각 층 안에서만 갈린다.** 아카이브 work 이름을 정확히 쳤는데 그 문서가 활성 work의
    /// 어설픈 매치보다 아래로 밀리면, 아카이브를 포함시킨 것이 오히려 방해가 된다.
    #[test]
    fn 층을_가로질러_앞서지_않는다() {
        let (_tmp, at) = roots();
        work(&at.works, "활성것", "arc 활성 작업");
        doc(&at.works, "활성것", "spec/overview.md", 100);
        work(&at.archive, "옛것", "옛 arc 작업");
        // **아카이브 문서가 활성 문서보다 최근이다** — mtime만 보면 위로 올라올 자리다.
        doc(&at.archive, "옛것", "record.md", 999);
        project(&at.projects, "argo", "argo");

        assert_eq!(
            lines(&search(&at.root, at.mode, "ar", &nav()).unwrap().hits),
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
        let (_tmp, at) = roots();
        for n in 0..LAYER_LIMIT + 5 {
            work(&at.works, &format!("묶음{n:02}"), &format!("묶음 {n:02}"));
        }
        work(&at.works, "문서집", "묶음 문서집");
        doc(&at.works, "문서집", "spec/overview.md", 100);

        let results = search(&at.root, at.mode, "묶음", &[]).unwrap();
        // 작업 층이 스무 줄에서 잘려도 **문서 층은 그대로 선다.**
        assert_eq!(results.hits.len(), LAYER_LIMIT + 1);
        assert_eq!(lines(&results.hits)[LAYER_LIMIT], "문서 문서집/overview.md");
    }
}
