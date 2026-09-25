//! 코드 내장본 둘 — `atelier`와 `maison`.
//!
//! **내용은 이 기능 전의 안내문 그대로다**(결정 8). 그때 `atelier_get_work`가 싣던 고정 문자열의
//! 다섯 이름과 그 뜻을 데이터로 옮겼다. 달라진 것은 표기뿐이다 — `NN-<name>/`이 `{n}-{name}/`이
//! 되고, 「normally inside its NN- folder」는 들여쓰기가 대신 말한다(구현 스펙 7절 허용 차이 1).
//!
//! 두 벌은 이번에는 **id만 다르고 내용이 같다.** Maison에 맞는 모양은 사용자가 설정에서 직접
//! 만든다 — 그래서 벌을 하나로 합치지 않고 모드마다 따로 낸다. 합쳐 두면 한쪽을 고치는 날 둘이
//! 함께 바뀐다.
//!
//! 내장본에는 템플릿이 없다. 템플릿은 경로로 건네므로 디스크에 있어야 한다(결정 5·7).

use super::model::{EntryKind, LayoutEntry, SpecLayout};
use crate::Mode;

/// 그 모드의 코드 내장본. 레이아웃 폴더가 없거나, 있어도 읽지 못할 때 도착하는 곳이다.
pub fn builtin_layout(mode: Mode) -> SpecLayout {
    match mode {
        Mode::Atelier | Mode::Maison => five_names(),
    }
}

/// 방침 문단 — 이 기능 전 안내문의 첫 문단(「Five folder names …」 한 문장을 뺀 나머지)과
/// 마지막 문단이다. 「나열되지 않은 것은 자유」·「건너뛰어도 안 깨진다」는 방침이라 코드 틀이
/// 아니라 여기 산다(결정 10).
const POLICY: &str = "\
Nothing else is fixed — file names are free, and a folder that fits none of these is kept and \
shown just the same.

Atelier never creates these folders and nothing breaks if you skip them. You create them with \
your own file tools; the desktop app just recognises the names.";

fn five_names() -> SpecLayout {
    SpecLayout {
        root: LayoutEntry {
            description: POLICY.to_string(),
            children: vec![
                entry(
                    "overview.md",
                    EntryKind::File,
                    "compass",
                    "the work's standing summary; write this first",
                    vec![],
                ),
                // 두 자리로 쓰는 관습(`01-`·`02-`)은 틀이 아니라 설명이 든다 — `{n}`은 자릿수를
                // 가리지 않는다.
                entry(
                    "{n}-{name}",
                    EntryKind::Folder,
                    "layers",
                    "one iteration, with its plan, tickets, verification and handoff inside. \
                     Create `01-...` when you first plan, `02-...` for the next round.",
                    vec![entry(
                        "tickets",
                        EntryKind::Folder,
                        "list-checks",
                        "that iteration's tickets",
                        vec![],
                    )],
                ),
                entry(
                    "research",
                    EntryKind::Folder,
                    "search",
                    "findings that outlive any single iteration",
                    vec![],
                ),
                entry(
                    "explanation",
                    EntryKind::Folder,
                    "book-open",
                    "understanding worth keeping: why it ended up like this",
                    vec![],
                ),
            ],
            ..LayoutEntry::default()
        },
        extra: Default::default(),
    }
}

fn entry(
    pattern: &str,
    kind: EntryKind,
    icon: &str,
    description: &str,
    children: Vec<LayoutEntry>,
) -> LayoutEntry {
    LayoutEntry {
        pattern: Some(pattern.to_string()),
        kind: Some(kind),
        description: description.to_string(),
        icon: Some(icon.to_string()),
        children,
        ..LayoutEntry::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::render::render_layout;

    /// 내장본이 에이전트에게 나가는 글 전문. 템플릿 판정도 물러서기도 없다 — 내장본에는 둘 다
    /// 생길 수 없다.
    fn rendered(mode: Mode) -> String {
        render_layout(&builtin_layout(mode), None, None).text
    }

    /// **기대값 파일이 스냅샷이다** — 이 저장소에는 스냅샷 크레이트가 없고 새 의존성을 들이지
    /// 않는다. 파일은 손으로 적었다: 설명 열은 가장 긴 「들여쓰기 + 이름」(`  explanation/`,
    /// 14칸)에 두 칸을 더한 16이다. 파일이 줄바꿈으로 끝나는 것은 편집기 관습이라 여기서 맞춘다.
    ///
    /// 바뀌면 빨개지는 것이 요점이다. 기대값을 다시 적을 때 뜻을 잃지 않았는지는 아래
    /// `the_builtins_still_say_everything_the_fixed_guidance_said`가 따로 본다.
    #[test]
    fn each_builtin_renders_exactly_its_expected_file() {
        for (mode, expected) in [
            (Mode::Atelier, include_str!("expected/atelier.txt")),
            (Mode::Maison, include_str!("expected/maison.txt")),
        ] {
            assert_eq!(format!("{}\n", rendered(mode)), expected, "{mode} 내장본의 안내문이 바뀌었다");
        }
    }

    /// 이 기능 전의 고정 안내문을 **문장마다** 나눠, 문장마다 뜻을 대표하는 구절 하나. 표기가
    /// 바뀐 것(`NN-<name>/` → `{n}-{name}/`)은 바뀐 모양으로 적었다.
    ///
    /// **기대값 파일과 따로 둔다.** 기대값은 누가 다시 적으면 그대로 초록이 된다 — 다시 적는
    /// 사람이 뜻을 떨어뜨리지 않았는지는 이 표가 붙든다(결정 8).
    const MEANING: [(&str, &str); 8] = [
        // "Five folder names carry meaning inside `specDir`." — 개수는 이제 레이아웃마다 다르다
        ("머리 — 어디의 배치인가", "inside `specDir`"),
        // "Nothing else is fixed — file names are free, and a folder that fits none of these is kept
        //  and shown just the same."
        ("나열되지 않은 것은 자유", "Nothing else is fixed"),
        ("파일 이름은 자유", "file names are free"),
        ("맞지 않는 폴더도 그대로 보인다", "is kept and shown just the same"),
        // 판 줄의 둘째 문장 — 두 자리로 쓰는 관습은 틀이 아니라 설명이 든다
        ("01/02 관습", "Create `01-...` when you first plan, `02-...` for the next round."),
        // "Atelier never creates these folders and nothing breaks if you skip them."
        ("폴더를 만드는 것은 에이전트", "Atelier never creates these folders"),
        ("건너뛰어도 안 깨진다", "nothing breaks if you skip them"),
        // "You create them with your own file tools; the desktop app just recognises the names."
        ("자기 파일 도구로", "You create them with your own file tools"),
    ];

    /// 다섯 이름 줄 — 「들여쓰기 + 이름」으로 시작하는 줄이 그 이름의 뜻을 싣는다. 설명 열이
    /// 몇 칸인지는 보지 않는다(그것은 기대값 파일이 본다).
    ///
    /// `tickets/`가 네 칸인 것이 「normally inside its NN- folder」의 새 모양이다 — 구조가 그 뜻을
    /// 대신 말한다(구현 스펙 7절 허용 차이 1). 그래서 판 줄 **바로 다음 줄**이어야 한다.
    const NAMES: [(&str, &str); 5] = [
        ("  overview.md ", "the work's standing summary; write this first"),
        ("  {n}-{name}/ ", "one iteration, with its plan, tickets, verification and handoff inside."),
        ("    tickets/ ", "that iteration's tickets"),
        ("  research/ ", "findings that outlive any single iteration"),
        ("  explanation/ ", "understanding worth keeping: why it ended up like this"),
    ];

    #[test]
    fn the_builtins_still_say_everything_the_fixed_guidance_said() {
        for mode in [Mode::Atelier, Mode::Maison] {
            let text = rendered(mode);
            for (what, phrase) in MEANING {
                assert!(text.contains(phrase), "{mode} 내장본이 뜻을 잃었다 ({what}): {phrase}\n{text}");
            }
            let lines: Vec<&str> = text.lines().collect();
            for (head, meaning) in NAMES {
                let line = lines
                    .iter()
                    .find(|line| line.starts_with(head))
                    .unwrap_or_else(|| panic!("{mode} 내장본이 이름을 잃었다: {head:?}\n{text}"));
                assert!(line.contains(meaning), "{mode} 내장본의 {head:?} 줄이 뜻을 잃었다: {line}");
            }
            let iteration = lines.iter().position(|line| line.starts_with("  {n}-{name}/ "));
            let tickets = lines.iter().position(|line| line.starts_with("    tickets/ "));
            assert_eq!(
                tickets,
                iteration.map(|i| i + 1),
                "{mode} 내장본에서 tickets/가 판 안에 서지 않는다:\n{text}"
            );
        }
    }

    /// **한 안내문에 두 표기가 섞이지 않는다.** 판을 `NN-`으로도 `{n}`으로도 말하면 에이전트는
    /// 둘이 다른 것인 줄 안다.
    #[test]
    fn the_builtins_name_the_iteration_one_way_only() {
        for mode in [Mode::Atelier, Mode::Maison] {
            let text = rendered(mode);
            assert!(text.contains("{n}-{name}/"), "{mode} 내장본이 판을 안 말한다: {text}");
            assert!(!text.contains("NN-"), "{mode} 내장본에 옛 표기가 남았다: {text}");
        }
    }
}
