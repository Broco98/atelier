//! 「마지막으로 연 work」 이력 한 장 — `~/.atelier/recent.json` (팔레트 결정 13).
//!
//! **코어가 소유한다.** 이 값을 읽어 순서를 정하는 것이 검색이고(팔레트 결정 11), 순서 규칙은
//! 코어 밖으로 안 나간다 — 프런트가 정렬된 slug 배열을 건네게 되는 순간 정책이 바깥으로
//! 샌다. `localStorage`가 아니라 파일인 것도 같은 줄기다: MCP·CLI로 붙는 에이전트가
//! 언젠가 「마지막으로 보던 work」을 물을 수 있어야 한다(팔레트 결정 13).
//!
//! 여기 `팔레트 결정 N`은 `palette-key-and-home`(이슈 #176)의 결정문을 가리킨다 — 이웃한
//! `search.rs`가 `spec-search`(이슈 #149)의 번호를 맨 `결정 N`으로 이미 쓰고 있어, 같은
//! 크레이트 안에서 두 벌이 안 섞이도록 수식을 붙인다.
//!
//! **여기 사는 것은 파일 한 장의 읽기·쓰기뿐이다.** 무엇을 「열었다」로 셀지는 화면이 알고
//! (팔레트 결정 14), 그 순서로 목록을 세우는 것은 검색이 한다.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::Result;

/// 파일 이름. 상수인 것은 tmp 이름이 이것에서 나오기 때문이다 — 둘이 갈리면 감시자가
/// 무시하는 dotfile 규약(`.` 접두사)이 한쪽에서만 지켜진다.
const RECENT_FILE: &str = "recent.json";

/// 이력 파일 전체. **`works`가 유일한 칸이고 앞이 가장 최근이다.**
///
/// 모르는 최상위 키는 `extra`에 담아 그대로 되쓴다 — `work.json`·`settings.json`과 같은
/// 규약이다. 다만 **파싱에 성공했을 때만** 보존된다: 깨진 파일은 빈 이력으로 눕고(아래
/// `read_recent`), 그때는 보존할 값이 애초에 없다.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub(crate) struct RecentWorks {
    #[serde(default)]
    pub(crate) works: Vec<RecentWork>,
    #[serde(flatten)]
    pub(crate) extra: serde_json::Map<String, serde_json::Value>,
}

/// 이력 한 줄. **문자열이 아니라 객체다**(팔레트 결정 25).
///
/// 최상위 `extra`는 최상위에만 붙는데, 앞으로 늘 값(frecency — 횟수 가중·시간 감쇠)은
/// **항목마다** 붙는 값이라 문자열 배열로는 못 자란다. 이 저장소의 선례가 그 모양이다
/// (`work.json`의 `pinned`가 마이그레이션 없이 늘어난 자리).
///
/// **항목의 모르는 칸은 지금 보존하지 않는다 — 일부러다.** 팔레트 결정 25가 요구한 것은
/// 「자랄 수 있는 모양」까지이고, 보존이 실제로 값을 갖는 것은 **판이 갈린 두 바이너리가
/// 같은 파일을 번갈아 쓸 때**뿐이다(아직 없는 상황이다). frecency를 들이는 판이 그 칸과
/// 함께 보존도 들이면 된다 — 그 자리가 여기 한 줄이다. 지금 넣어 두면 아무도 안 읽는
/// 계약이 하나 늘고, 그것이 이 크레이트가 `truncated`를 걷을 때 든 근거다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct RecentWork {
    pub(crate) slug: String,
}

fn recent_path(root: &Path) -> PathBuf {
    root.join(RECENT_FILE)
}

/// 이력을 읽는다. **실패하지 않는다 — 못 읽으면 빈 이력이다.**
///
/// **설정 파일과 반대로 간다.** 그쪽은 「실패로 말하고 파일은 그대로 둔다」인데, 갈리는 축은
/// **「사람이 손으로 고치는 값인가」**다. 설정은 손으로 고치는 파일이라 조용히 기본값으로
/// 넘어가면 다음 저장이 그 손질을 덮어쓴다. 이력은 **관찰의 부산물**이고, 검색이 글자마다
/// 부르는 자리라 파일 한 장 때문에 팔레트가 통째로 못 뜨면 안 된다.
///
/// **파일은 안 지운다.** 눕는 것은 이 판정 하나이고, 다음 쓰기가 정상 모양으로 덮는다.
/// 무슨 일이 있었는지는 **한 줄로 남긴다** — 조용히 비면 「이력이 왜 초기화됐지」에 답할
/// 자리가 아무 데도 없다.
///
/// **이 크레이트에서 stderr로 나가는 자리는 둘이다 — 이것과 진행 중 루트의 순서 파일
/// 읽기(`order.rs`의 `read_order`) — 알고 그렇게 뒀다.** 둘이 같은 판단을 진다. 나머지 진단은 전부
/// 호스트(`src-tauri`·CLI)의 몫이고, 층으로 보면 「어떻게 알리나」는 기전이라 바깥의 것이 맞다.
/// 그런데 이 함수는 **오류를 안 돌려준다**(그것이 위 결정의 전부다) — 알릴 것을 밖으로
/// 내보내려면 반환 모양을 바꾸거나 검색 전체에 진단 채널을 하나 꿰야 하고, 그 값은 셋뿐인
/// 호스트가 전부 stderr를 진단 채널로 쓰고 있어서 0이다(MCP는 stdout이 프로토콜이라 특히
/// 그렇다). 진단 채널이 생기는 날 두 자리의 줄들이 함께 그리로 간다.
///
/// **파일도 폴더도 만들지 않는다.** 글자마다 부르는 자리가 무엇을 만들면 「읽기만 한다」가
/// 거짓이 된다 — 검색의 다른 층들이 이미 같은 규칙을 진다.
pub(crate) fn read_recent(root: &Path) -> RecentWorks {
    let path = recent_path(root);
    let content = match std::fs::read_to_string(&path) {
        Ok(content) => content,
        // 없는 것은 정상이다 — 첫 실행이 그 자리다.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return RecentWorks::default(),
        Err(e) => {
            eprintln!("atelier: recent read failed ({}): {e}", path.display());
            return RecentWorks::default();
        }
    };
    match serde_json::from_str(&content) {
        Ok(recent) => recent,
        Err(e) => {
            eprintln!("atelier: recent parse failed ({}): {e}", path.display());
            RecentWorks::default()
        }
    }
}

/// 그 work을 **맨 앞으로** 옮긴다. 이미 있으면 지우고 다시 넣는 대신 **그 항목을 통째로
/// 들어 옮긴다** — 지금 `RecentWork`에 든 것은 `slug`뿐이라 두 길의 결과가 같지만, frecency
/// 값이 붙는 날 자리를 옮기는 것이 값을 초기화하는 일이 되면 안 된다. 여기서 보장하는 것은
/// **이 함수가 항목을 새로 만들지 않는다**까지다: 위 `RecentWork`가 적어 둔 대로 항목의
/// 모르는 칸은 파싱에서 이미 떨어지므로, 「파일에 있던 값이 살아남는다」는 아직 참이 아니다.
///
/// **길이에 상한을 두지 않는다**(팔레트 결정 15). 줄 하나가 slug 하나라 파일이 커질 일이 없고,
/// 없는 slug는 목록 교집합에서 자연히 빠진다 — 청소하는 자리를 만들면 「지운 work이
/// 언제 이력에서도 사라지는가」라는 새 규칙이 하나 생긴다.
///
/// **읽고-고쳐-쓰는 사이에 잠그지 않는다 — 알고 두는 것이다.** 두 부름이 겹치면 나중 쓰기가
/// 이긴다: 서로 다른 slug였다면 앞의 것이 목록에서 빠질 수 있다. 대가가 「방금 연 work이
/// 이력에 안 들어간 채로 남는다」 하나이고 다음 부름이 그것을 고치는 반면, 잠금은 이 크레이트에
/// 없는 기전(락 파일·전역 뮤텍스)을 하나 들이고 그 수명이 앱·MCP·CLI 세 프로세스에 걸친다.
/// 겹친 쓰기가 **반쯤 쓰인 파일**을 남기는 것은 다른 얘기이고, 그쪽은 `atomic.rs`의 tmp 이름이 막는다.
pub fn touch_recent_work(root: &Path, slug: &str) -> Result<()> {
    let mut recent = read_recent(root);
    let entry = match recent.works.iter().position(|work| work.slug == slug) {
        Some(at) => recent.works.remove(at),
        None => RecentWork { slug: slug.to_string() },
    };
    recent.works.insert(0, entry);
    write_recent(root, &recent)
}

/// 원자적으로 쓴다 — 규칙과 tmp 이름의 이유는 `atomic.rs`에 있다(진행 중 루트의 순서 파일과
/// 같은 자리를 딛는다).
fn write_recent(root: &Path, recent: &RecentWorks) -> Result<()> {
    let mut json = serde_json::to_string_pretty(recent)
        .map_err(|e| crate::Error::Validation(format!("이력을 옮겨 적지 못했습니다: {e}")))?;
    json.push('\n');
    crate::atomic::write_atomically(root, RECENT_FILE, &json)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    fn slugs(recent: &RecentWorks) -> Vec<&str> {
        recent.works.iter().map(|work| work.slug.as_str()).collect()
    }

    /// 쓴 것이 그대로 읽힌다. **앞이 가장 최근이다** — 순위 비교자가 이 인덱스를 그대로 쓴다.
    #[test]
    fn 표시한_것이_맨_앞으로_온다() {
        let tmp = root();
        touch_recent_work(tmp.path(), "가").unwrap();
        touch_recent_work(tmp.path(), "나").unwrap();

        assert_eq!(slugs(&read_recent(tmp.path())), vec!["나", "가"]);

        touch_recent_work(tmp.path(), "가").unwrap();
        assert_eq!(slugs(&read_recent(tmp.path())), vec!["가", "나"]);
    }

    /// 같은 slug를 잇달아 두 번 표시해도 **파일이 온전하고 중복이 없다.** 자리를 옮기는
    /// 것이지 더하는 것이 아니다.
    #[test]
    fn 같은_slug를_두_번_표시해도_중복이_없다() {
        let tmp = root();
        touch_recent_work(tmp.path(), "가").unwrap();
        touch_recent_work(tmp.path(), "가").unwrap();

        assert_eq!(slugs(&read_recent(tmp.path())), vec!["가"]);
    }

    /// 팔레트 결정 25. **항목이 객체다** — 문자열 배열이면 앞으로 붙을 frecency 값이 못 자란다.
    /// 파일 모양 자체를 못 박는 것은 이 값을 읽는 쪽이 코어 밖에도 생길 수 있어서다.
    #[test]
    fn 파일_모양이_객체_배열이다() {
        let tmp = root();
        touch_recent_work(tmp.path(), "가").unwrap();

        let raw = std::fs::read_to_string(tmp.path().join("recent.json")).unwrap();
        let json: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(json, serde_json::json!({ "works": [{ "slug": "가" }] }));
    }

    /// 모르는 **최상위** 칸은 그대로 되쓴다 — `work.json`·`settings.json`과 같은 규약이다.
    ///
    /// **항목의 모르는 칸은 안 지킨다.** 아래 둘째 단언이 그 한계를 눈에 보이게 못 박는다 —
    /// 빠뜨린 것이 아니라 범위 밖으로 둔 것이고(위 `RecentWork` 독), frecency를 들이는 판이
    /// 그 칸과 함께 보존도 들인다. 안 적으면 다음 사람이 항목에 값을 얹어 두고 그것이 조용히
    /// 지워지는 것을 나중에야 만난다.
    #[test]
    fn 모르는_최상위_칸만_그대로_되쓴다() {
        let tmp = root();
        std::fs::write(
            tmp.path().join("recent.json"),
            r#"{"works":[{"slug":"가","count":7}],"version":2}"#,
        )
        .unwrap();

        touch_recent_work(tmp.path(), "나").unwrap();

        let raw = std::fs::read_to_string(tmp.path().join("recent.json")).unwrap();
        let json: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(json["version"], 2);
        assert_eq!(json["works"][1], serde_json::json!({ "slug": "가" }));
    }

    /// 팔레트 결정 24. 깨진 파일은 **빈 이력으로 눕는다** — 검색이 글자마다 부르는 자리라 파일
    /// 한 장 때문에 팔레트가 통째로 못 뜨면 안 된다. 설정 파일과 반대편인 이유는 갈리는 축
    /// 하나다: 이력은 사람이 손으로 고치는 값이 아니다.
    ///
    /// **파일은 안 지운다.** 눕는 것은 판정 하나다.
    #[test]
    fn 깨진_파일은_빈_이력이고_파일은_그대로다() {
        let tmp = root();
        let path = tmp.path().join("recent.json");
        std::fs::write(&path, "not json").unwrap();

        assert_eq!(read_recent(tmp.path()), RecentWorks::default());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "not json");
    }

    /// 깨졌을 때는 보존할 `extra`가 애초에 없다 — **파싱에 성공했을 때만** 보존된다는 것을
    /// 여기서 함께 못 박는다. 안 적으면 「깨져도 모르는 칸은 지킨다」로 읽힌다.
    #[test]
    fn 깨진_파일의_모르는_칸은_안_지켜진다() {
        let tmp = root();
        std::fs::write(tmp.path().join("recent.json"), r#"{"version":2,"#).unwrap();

        touch_recent_work(tmp.path(), "가").unwrap();

        let raw = std::fs::read_to_string(tmp.path().join("recent.json")).unwrap();
        let json: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(json, serde_json::json!({ "works": [{ "slug": "가" }] }));
    }

    /// **읽기가 파일도 폴더도 안 만든다.** 없는 폴더를 그대로 돈다 — 글자마다 부르는 자리가
    /// 무엇을 만들면 「읽기만 한다」가 거짓이 된다.
    #[test]
    fn 읽기가_아무것도_안_만든다() {
        let tmp = root();
        let missing = tmp.path().join("없는곳");

        assert_eq!(read_recent(&missing), RecentWorks::default());

        assert!(!missing.exists(), "읽기가 폴더를 만들었다");
        assert!(!tmp.path().join("recent.json").exists(), "읽기가 파일을 만들었다");
    }

    /// 쓰고 나면 **찌꺼기가 없다.** 고유 이름을 붙였으므로 지우는 자리가 확실해야 한다 —
    /// 남으면 dotfile이라 화면에도 안 뜬 채 쌓인다.
    #[test]
    fn 쓰고_나면_tmp가_안_남는다() {
        let tmp = root();
        touch_recent_work(tmp.path(), "가").unwrap();
        touch_recent_work(tmp.path(), "나").unwrap();

        let leftovers: Vec<String> = std::fs::read_dir(tmp.path())
            .unwrap()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "tmp가 남았다: {leftovers:?}");
    }
}
