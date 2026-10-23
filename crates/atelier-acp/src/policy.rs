//! 판정 — 권한 요청 하나에 허용 · 거절 · 물음 가운데 하나를 내는 순수 함수(v1 구현 스펙 §9 · S17 · S19, v1 티켓 22).
//!
//! **Atelier가 하나뿐인 판정자다(S17).** Thread의 Session에 온 권한 요청은 모두 [`judge`]를 지난다. `claude`는 기본 모드로만(「계획만」
//! 이면 계획 모드로) 돌아, Claude Code가 엔진에 묻지 않고 넘기는 것은 사용자 설정의 허용 규칙뿐이다. 입출력이 없다 — 받는 것은
//! 엔진이 읽어 넘기고(`host/thread/gate.rs`), 내는 것을 엔진이 권한 답과 `permission` 줄로 옮긴다.
//!
//! **판정 순서**(§9) — 처음 걸린 칸이 답한다.
//! 1. `forbid`에 걸리면 거절한다.
//! 2. 고치는 경로가 고칠 수 있는 자리(Work의 worktree · spec 폴더 · Thread 폴더) 밖이면 거절한다. 그 경로가 등록된 Project 안이면
//!    「Project 고치기 시작」 도구(v1 티켓 32)를 먼저 부르라고 글로 알린다.
//! 3. 쓰기 자리를 다른 Session이 쥐고 있으면 거절한다(§10 · v1 티켓 18).
//! 4. `ask_before`에 걸리면 묻는다.
//! 5. 「다시 묻지 않기」 허락에 걸리면 허용한다.
//! 6. 그 밖에는 물어보는 정도의 표([`by_level`])를 따른다.
//!
//! **규칙 이름은 S19 한 벌이다** — `forbid` · `ask_before` · 허락 · `tools.cli`가 같은 낱말을 쓴다: `edit`(편집 전부) · `shell`(명령
//! 전부) · `push` · `merge`, 그리고 명령 패턴 `Bash(…)`. Claude 변환기의 금지 규칙(`translator/agent_flags.rs`의 `FORBID`)과 같은
//! 명령을 막는다 — 한쪽만 고치면 claude가 막는 것과 판정이 막는 것이 갈린다. `schema`(마이그레이션 명령)는 고정 목록이 없다 — Host
//! 기본 파일이 명령 패턴으로 적는다(S19 · 결정.md 12).
//!
//! 명령은 `&&` · `||` · `;` · `|` · 줄바꿈으로 조각낸다. **막는 쪽(`forbid` · `ask_before`)은 조각 하나만 걸려도, 넘기는 쪽(허락 ·
//! `tools.cli`)은 모든 조각이 맞아야** 걸린다 — `gh pr view && git push`는 `push`에 걸리고, `tools.cli: [gh]`로 넘어가지 않는다.
//! 허락은 조각마다 준 허락 가운데 하나에 맞으면 된다 — 「다시 묻지 않기」가 `cd fe && pnpm test`에 `cd` · `pnpm test` 둘을 주기
//! 때문이다([`remembered`], v1 티켓 24).
//!
//! **「다시 묻지 않기」는 물어보는 정도가 물은 것에만 선다**(6번 칸) — 물음([`Verdict::Ask`])이 그때 줄 허락을 함께 낸다. `ask_before`가
//! 물은 것에는 없다: 허락은 5번 칸이라 4번(`ask_before`)을 넘기지 못한다 — 주어도 다음에 또 묻는다.

use std::path::{Path, PathBuf};

use atelier_core::Policy;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 물어보는 정도(스토리 84 · S18) — 입력창 칩이 고른다(v1 티켓 23). 저장 글자는 `always` · `edits` · `plan` · `auto`다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AskLevel {
    /// 매번 묻기 — 고치거나 실행하기 전에 묻는다.
    #[default]
    Always,
    /// 편집은 허용 — 파일은 알아서, 명령은 묻는다.
    Edits,
    /// 계획만 — `claude`가 계획 모드로 돈다. 읽기만 하고 계획을 세운다.
    Plan,
    /// 알아서 — Policy에 적힌 것만 묻는다.
    Auto,
}

impl AskLevel {
    /// 저장된 글자를 읽는다 — 없거나 모르는 글자면 매번 묻기다. 가장 많이 묻는 쪽으로 눕는다: 깨진 값이 묻지 않고 넘기는 길이 되지
    /// 않게.
    pub(crate) fn read(text: Option<&str>) -> Self {
        text.and_then(|text| serde_json::from_value(Value::String(text.to_owned())).ok()).unwrap_or_default()
    }

    /// 저장 글자.
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            AskLevel::Always => "always",
            AskLevel::Edits => "edits",
            AskLevel::Plan => "plan",
            AskLevel::Auto => "auto",
        }
    }

    /// 화면의 이름(캔버스 「물어보는 정도」 메뉴) — 물음의 Policy 이름과 자동 허용의 까닭이 이 글이다.
    pub(crate) fn name(self) -> &'static str {
        match self {
            AskLevel::Always => "매번 묻기",
            AskLevel::Edits => "편집은 허용",
            AskLevel::Plan => "계획만",
            AskLevel::Auto => "알아서",
        }
    }

    /// `claude`를 띄우는 권한 모드(S17) — 「계획만」이면 `plan`, 그 밖에는 `default`다. 사용자의 `defaultMode`(예 `acceptEdits`)를
    /// 물려받지 않는다 — 그러면 claude가 편집을 스스로 허용해 판정 · 쓰기 자리를 지나지 않는다.
    pub(crate) fn claude_mode(self) -> &'static str {
        match self {
            AskLevel::Plan => "plan",
            _ => "default",
        }
    }
}

/// 권한 요청이 하는 일 — ACP 도구 요지(`toolCall`)의 종류로 가른다(Runtime의 도구 이름으로 가르지 않는다).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Act {
    /// 파일 고치기(`edit` · `delete` · `move`) — 건드리는 경로들. 엔진이 절대 경로로 풀어 넘긴다.
    Edit(Vec<PathBuf>),
    /// 명령(`execute`) — 명령 글.
    Command(String),
    /// 계획 넘어가기(`switch_mode`) — 계획 모드의 `ExitPlanMode`.
    Plan,
    /// 그 밖의 도구(웹 · MCP · 질문 …) — 표(§9)에 칸이 없어 늘 묻는다.
    Other,
}

impl Act {
    /// ACP 도구 요지에서 읽는다. 편집의 경로는 `locations[].path`와 입력의 `file_path` · `notebook_path` · `path`다 — 상대 경로는
    /// 그대로 둔다(엔진이 Session의 작업 폴더에서 푼다). 명령은 입력의 `command`(글 또는 낱말 목록)다.
    pub(crate) fn of(tool_call: &Value) -> Self {
        let input = &tool_call["rawInput"];
        match tool_call["kind"].as_str() {
            Some("edit" | "delete" | "move") => {
                let located = tool_call["locations"].as_array().into_iter().flatten().map(|location| &location["path"]);
                let named = ["file_path", "notebook_path", "path"].into_iter().map(|key| &input[key]);
                let mut paths: Vec<PathBuf> = Vec::new();
                for path in located.chain(named).filter_map(Value::as_str).filter(|path| !path.is_empty()) {
                    if !paths.iter().any(|seen| seen == Path::new(path)) {
                        paths.push(path.into());
                    }
                }
                Act::Edit(paths)
            }
            Some("execute") => Act::Command(match &input["command"] {
                Value::Array(words) => words.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" "),
                command => command.as_str().unwrap_or_default().to_owned(),
            }),
            Some("switch_mode") => Act::Plan,
            _ => Act::Other,
        }
    }

    /// 물을 때 세울 카드 — 그 밖의 도구는 명령 카드다(카드는 셋이다, §9).
    pub(crate) fn card(&self) -> Card {
        match self {
            Act::Edit(_) => Card::Edit,
            Act::Plan => Card::Plan,
            Act::Command(_) | Act::Other => Card::Command,
        }
    }
}

/// 물을 때 세우는 카드의 종류(§9) — 명령 · 파일 고치기 · 계획 넘어가기, 그리고 Agent의 질문(v1 티켓 26). 물음 줄에 `card`로 남는다.
/// 질문은 판정이 내지 않는다 — 판정의 문이 물음이 실린 요청을 판정 앞에서 곧바로 묻는다(`host::thread::gate`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Card {
    Command,
    Edit,
    Plan,
    Question,
}

/// 판정이 받는 것(§9) — 엔진이 요청을 받은 그때 읽어 넘긴다.
pub(crate) struct Case<'a> {
    /// 요청이 하는 일.
    pub act: &'a Act,
    /// 그 Agent의 Policy — 정의 스냅숏의 `ask_before` · `forbid`.
    pub policy: &'a Policy,
    /// 그 Agent의 `tools.cli` — 묻지 않는 명령.
    pub cli: &'a [String],
    pub level: AskLevel,
    /// 「다시 묻지 않기」 허락 — 규칙 이름들(S19).
    pub grants: &'a [String],
    /// Work에 이은 Thread인가 — 허락의 까닭과 밖 편집의 글이 갈린다.
    pub in_work: bool,
    /// 고칠 수 있는 자리 — Work의 worktree들 · spec 폴더, 그리고 Thread 폴더. 절대 경로다.
    pub roots: &'a [PathBuf],
    /// 등록된 Project — (slug, 폴더).
    pub projects: &'a [(String, PathBuf)],
    /// 이 Work의 쓰기 자리를 다른 Session이 쥐었으면 돌려줄 글(§10).
    pub seat: Option<&'a str>,
}

/// 판정이 내는 것(§9).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Verdict {
    /// 묻지 않고 허용한다 — 「자동으로 허용함」 줄의 까닭과 함께.
    Allow { reason: String },
    /// 묻지 않고 거절한다 — Agent에게 돌려줄 글과 함께.
    Refuse { message: String },
    /// 사람에게 묻는다 — 카드 종류와 왜 묻는지(Policy 이름)와 함께. `grant`는 사람이 「다시 묻지 않기」를 고르면 줄 허락(규칙 이름들)이고,
    /// 비었으면 그 선택지가 서지 않는다(머리말).
    Ask { card: Card, policy: String, grant: Vec<String> },
}

/// 권한 요청 하나를 판정한다 — 머리말의 차례대로 처음 걸린 칸이 답한다.
pub(crate) fn judge(case: &Case) -> Verdict {
    let act = case.act;
    if let Some(name) = case.policy.forbid.iter().find(|name| hits(name, act)) {
        return Verdict::Refuse { message: format!("이 Agent의 Policy가 금지한 일이에요(forbid: {name}) — 하지 말고 다른 길을 찾으세요") };
    }
    if let Act::Edit(paths) = act {
        if let Some(outside) = paths.iter().find(|path| !case.roots.iter().any(|root| path.starts_with(root))) {
            return Verdict::Refuse { message: outside_message(outside, case) };
        }
        if let Some(busy) = case.seat {
            return Verdict::Refuse { message: busy.to_owned() };
        }
    }
    if let Some(name) = case.policy.ask_before.iter().find(|name| hits(name, act)) {
        return Verdict::Ask { card: act.card(), policy: ask_name(name), grant: Vec::new() };
    }
    if granted(case.grants, act) {
        let reason = if case.in_work { "이 Work에서는 다시 묻지 않기" } else { "이 Thread에서는 다시 묻지 않기" };
        return Verdict::Allow { reason: reason.to_owned() };
    }
    by_level(case)
}

/// 물어보는 정도의 표(§9).
///
/// | 물어보는 정도 | 파일 고치기 | 명령 | `tools.cli`에 맞는 명령 |
/// |---|---|---|---|
/// | 매번 묻기 | 물음 | 물음 | 허용 |
/// | 편집은 허용 | 허용 | 물음 | 허용 |
/// | 계획만 | 물음(계획 모드라 보통 오지 않는다) | 물음 | 허용 |
/// | 알아서 | 허용 | 허용 | 허용 |
///
/// 표 밖의 것 — 계획 넘어가기는 늘 묻는다(넘어갈 때는 사람이 정한다, 스토리 88). 그 밖의 도구도 늘 묻는다(표에 칸이 없다 — Agent의
/// 질문이 묻지 않고 넘어가지 않게, v1 티켓 26). 고치는 경로를 모르는 편집은 자리를 볼 수 없어 묻는다.
fn by_level(case: &Case) -> Verdict {
    let level = case.level;
    if let Some(entry) = case.cli.iter().find(|entry| cli_covers(entry, case.act)) {
        return Verdict::Allow { reason: format!("「{}」 명령은 묻지 않기", shown(entry)) };
    }
    let asked = Verdict::Ask { card: case.act.card(), policy: level.name().to_owned(), grant: remembered(case.act) };
    let allowed = Verdict::Allow { reason: level.name().to_owned() };
    match case.act {
        Act::Edit(paths) if paths.is_empty() => asked,
        Act::Edit(_) if matches!(level, AskLevel::Edits | AskLevel::Auto) => allowed,
        Act::Command(_) if level == AskLevel::Auto => allowed,
        _ => asked,
    }
}

/// 밖 편집의 글 — 등록된 Project 안이면 그 Project를 이 Work에 붙이는 도구를 가리킨다.
fn outside_message(path: &Path, case: &Case) -> String {
    let place = if case.in_work { "Work" } else { "Thread 폴더" };
    let head = format!("{place} 밖의 파일이라 고칠 수 없어요: {}", path.display());
    match case.projects.iter().find(|(_, folder)| path.starts_with(folder)) {
        Some((project, _)) => format!("{head} — `{project}` Project를 고치려면 먼저 「Project 고치기 시작」 도구를 부르세요"),
        None if case.in_work => format!("{head} — 이 Work의 worktree · spec 폴더 안에서만 고쳐요"),
        None => format!("{head} — Work가 없는 Thread는 이 Thread 폴더 안에서만 고쳐요"),
    }
}

/// S19 규칙 이름 하나가 가리키는 것.
enum Rule<'a> {
    /// 편집 전부.
    Edits,
    /// 명령 전부.
    Commands,
    /// 그 명령들 — 맨 명령과 인자가 붙은 것.
    Named(&'static [&'static str]),
    /// 명령 패턴 `Bash(…)` 의 안쪽.
    Pattern(&'a str),
    /// 옮길 규칙이 없다(`schema` · 모르는 이름) — 아무것에도 걸리지 않는다.
    Nothing,
}

/// 추상 이름이 막는 명령(S19) — 변환기의 `FORBID`와 같은 명령이다.
const NAMED: [(&str, &[&str]); 2] = [("push", &["git push"]), ("merge", &["gh pr merge", "git merge"])];

fn rule(name: &str) -> Rule<'_> {
    if let Some(pattern) = name.strip_prefix("Bash(").and_then(|rest| rest.strip_suffix(')')) {
        return Rule::Pattern(pattern);
    }
    match name {
        "edit" => Rule::Edits,
        "shell" => Rule::Commands,
        _ => NAMED.iter().find(|(named, _)| *named == name).map_or(Rule::Nothing, |(_, commands)| Rule::Named(commands)),
    }
}

/// 막는 쪽(`forbid` · `ask_before`)의 걸림 — 명령은 조각 하나만 걸려도 걸린다.
fn hits(name: &str, act: &Act) -> bool {
    match (rule(name), act) {
        (Rule::Edits, Act::Edit(_)) | (Rule::Commands, Act::Command(_)) => true,
        (Rule::Named(commands), Act::Command(text)) => pieces(text).any(|piece| commands.iter().any(|command| starts(piece, command))),
        (Rule::Pattern(pattern), Act::Command(text)) => pieces(text).any(|piece| pattern_matches(pattern, piece)),
        _ => false,
    }
}

/// 「다시 묻지 않기」 허락의 걸림(5번 칸) — 편집은 편집 허락 하나로, 명령은 모든 조각이 저마다 허락 하나에 맞아야 넘어간다.
fn granted(grants: &[String], act: &Act) -> bool {
    match act {
        Act::Command(text) => every_piece(text, |piece| grants.iter().any(|name| covers_piece(name, piece))),
        Act::Edit(_) => grants.iter().any(|name| matches!(rule(name), Rule::Edits)),
        Act::Plan | Act::Other => false,
    }
}

/// 넘기는 쪽의 걸림 — 명령 조각 하나가 그 규칙에 맞나.
fn covers_piece(name: &str, piece: &str) -> bool {
    match rule(name) {
        Rule::Commands => true,
        Rule::Named(commands) => commands.iter().any(|command| starts(piece, command)),
        Rule::Pattern(pattern) => pattern_matches(pattern, piece),
        Rule::Edits | Rule::Nothing => false,
    }
}

/// 「다시 묻지 않기」로 줄 허락(S18 · v1 티켓 24) — 같은 종류의 다음 요청을 5번 칸에서 넘기는 규칙 이름들. 편집이면 `edit`(편집
/// 전부 — 고칠 수 있는 자리 · 쓰기 자리는 그 앞 칸이 여전히 본다), 명령이면 조각마다 그 머리의 패턴 `Bash(<머리> *)`다. 계획
/// 넘어가기 · 그 밖의 도구는 S19에 이름이 없어 비었다.
///
/// **머리는 명령과 하위 명령, 두 낱말까지다**(`pnpm prisma migrate dev` → `pnpm prisma`, `git push origin` → `git push`, `python3 -c …`
/// → `python3`). 둘째 낱말은 하위 명령처럼 생겼을 때만 든다 — 영문자로 시작하고 영문자 · 숫자 · `-` · `_` · `:`뿐이다(`-c` ·
/// `script.py` · `../fe`는 인자다). 글자로만 가르므로 그렇게 생긴 인자는 하위 명령으로 읽힌다(`cd fe` → `cd fe`) — 허락이 좁아질
/// 뿐 넓어지지 않는다. 셋째 낱말부터는 하위 명령인지 인자인지 글자로 가를 수 없어 들지 않는다(`pnpm test refunds`).
pub(crate) fn remembered(act: &Act) -> Vec<String> {
    match act {
        Act::Edit(_) => vec!["edit".to_owned()],
        Act::Command(text) => {
            let mut rules: Vec<String> = Vec::new();
            for piece in pieces(text) {
                let mut words = piece.split_whitespace();
                let Some(first) = words.next() else { continue };
                let head = match words.next().filter(|word| subcommand(word)) {
                    Some(second) => format!("{first} {second}"),
                    None => first.to_owned(),
                };
                let rule = format!("Bash({head} *)");
                if !rules.contains(&rule) {
                    rules.push(rule);
                }
            }
            rules
        }
        Act::Plan | Act::Other => Vec::new(),
    }
}

/// 하위 명령처럼 생긴 낱말인가(`test` · `prisma` · `pr` · `run:dev`).
fn subcommand(word: &str) -> bool {
    word.starts_with(|c: char| c.is_ascii_alphabetic()) && word.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':'))
}

/// `tools.cli` 한 줄의 걸림 — 명령 이름(`gh` · `pnpm test`)이면 그것으로 시작하는 명령, `Bash(…)`면 그 패턴이다. 모든 조각이 맞아야
/// 한다.
fn cli_covers(entry: &str, act: &Act) -> bool {
    let Act::Command(text) = act else { return false };
    match rule(entry) {
        Rule::Pattern(pattern) => every_piece(text, |piece| pattern_matches(pattern, piece)),
        _ => every_piece(text, |piece| starts(piece, entry)),
    }
}

/// 물음의 Policy 이름 — `ask_before`의 규칙 이름을 사람이 읽는 글로.
fn ask_name(name: &str) -> String {
    match name {
        "edit" => "파일을 고치기 전에 묻기".to_owned(),
        "shell" => "명령을 실행하기 전에 묻기".to_owned(),
        "push" => "push하기 전에 묻기".to_owned(),
        "merge" => "merge하기 전에 묻기".to_owned(),
        _ => format!("「{}」 실행 전에 묻기", shown(name)),
    }
}

/// 규칙 · 명령 한 줄을 사람이 읽는 꼴로 — `Bash(…)`를 벗기고 앞뒤의 `*` · `:*`를 뗀다(`Bash(*prisma migrate *)` → `prisma migrate`).
fn shown(name: &str) -> &str {
    let inner = name.strip_prefix("Bash(").and_then(|rest| rest.strip_suffix(')')).unwrap_or(name);
    inner.trim_end_matches(":*").trim_matches(|c: char| c == '*' || c.is_whitespace())
}

/// 명령의 조각들 — `&&` · `||` · `;` · `|` · `&` · 줄바꿈으로 자르고, 앞의 환경 변수 놓기(`FOO=1 git push`)를 뗀다. **따옴표 안의
/// 구분자로는 자르지 않는다**(v1 티켓 24) — `python3 -c "import a; a.b()"`는 조각 하나다. 셸이 그 글을 한 인자로 넘기기 때문이고,
/// 거기서 자르면 「다시 묻지 않기」가 `Bash(a.b() *)` 같은 허락을 짓는다. 백슬래시 뒤의 한 글자는 따옴표 밖에서 글자 그대로다.
fn pieces(text: &str) -> impl Iterator<Item = &str> {
    let mut cut: Vec<&str> = Vec::new();
    let (mut start, mut quote, mut escaped) = (0, None::<char>, false);
    for (at, c) in text.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        match (quote, c) {
            (Some('\''), '\'') | (Some('"'), '"') => quote = None,
            (Some('\''), _) => {}
            (_, '\\') => escaped = true,
            (Some(_), _) => {}
            (None, '\'' | '"') => quote = Some(c),
            (None, ';' | '|' | '&' | '\n') => {
                cut.push(&text[start..at]);
                start = at + c.len_utf8();
            }
            (None, _) => {}
        }
    }
    cut.push(&text[start..]);
    cut.into_iter().map(str::trim).filter(|piece| !piece.is_empty()).map(|piece| {
        let mut rest = piece;
        while let Some((word, after)) = rest.split_once(char::is_whitespace) {
            if !assigns(word) {
                break;
            }
            rest = after.trim_start();
        }
        rest
    })
}

/// 환경 변수 놓기(`NAME=값`)인가.
fn assigns(word: &str) -> bool {
    word.split_once('=').is_some_and(|(name, _)| {
        name.starts_with(|c: char| c.is_ascii_alphabetic() || c == '_') && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
    })
}

/// 조각이 하나라도 있고 모두가 맞나.
fn every_piece(text: &str, fits: impl Fn(&str) -> bool) -> bool {
    let mut any = false;
    for piece in pieces(text) {
        if !fits(piece) {
            return false;
        }
        any = true;
    }
    any
}

/// 조각이 그 명령이거나, 그 명령 뒤에 인자가 붙었나 — `git push`는 `git push origin`에 걸리고 `git pushy`에는 걸리지 않는다.
fn starts(piece: &str, command: &str) -> bool {
    piece.strip_prefix(command).is_some_and(|rest| rest.is_empty() || rest.starts_with(char::is_whitespace))
}

/// 명령 패턴(Claude Code 규칙 글꼴) — `*`는 아무 글자나(빈 글도) 받는다. 끝의 ` *`와 옛 꼴 `:*`는 인자가 없는 맨 명령도 받는다
/// (`git push *`는 `git push`에 걸린다).
fn pattern_matches(pattern: &str, piece: &str) -> bool {
    let pattern = match pattern.strip_suffix(":*") {
        Some(head) => return pattern_matches(&format!("{head} *"), piece),
        None => pattern,
    };
    glob(pattern, piece) || pattern.strip_suffix(" *").is_some_and(|head| glob(head, piece))
}

/// `*` 하나만 아는 글자 맞추기.
fn glob(pattern: &str, text: &str) -> bool {
    let (pattern, text): (Vec<char>, Vec<char>) = (pattern.chars().collect(), text.chars().collect());
    // 뒤로 물러설 자리 — 마지막 `*`와 그때의 글자 자리.
    let (mut p, mut t, mut star, mut mark) = (0, 0, None, 0);
    while t < text.len() {
        if p < pattern.len() && pattern[p] == '*' {
            star = Some(p);
            mark = t;
            p += 1;
        } else if p < pattern.len() && pattern[p] == text[t] {
            p += 1;
            t += 1;
        } else if let Some(at) = star {
            p = at + 1;
            mark += 1;
            t = mark;
        } else {
            return false;
        }
    }
    pattern[p..].iter().all(|c| *c == '*')
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 판정의 입력 — 시험마다 한 칸씩 바꾼다. 기본은 Work에 이은 Thread에서 `worktree` · spec · Thread 폴더를 고칠 수 있고, 아무
    /// Policy도 허락도 없이 매번 묻는다.
    struct Given {
        act: Act,
        policy: Policy,
        cli: Vec<String>,
        level: AskLevel,
        grants: Vec<String>,
        in_work: bool,
        roots: Vec<PathBuf>,
        projects: Vec<(String, PathBuf)>,
        seat: Option<String>,
    }

    impl Given {
        fn act(act: Act) -> Self {
            Self {
                act,
                policy: Policy::default(),
                cli: Vec::new(),
                level: AskLevel::Always,
                grants: Vec::new(),
                in_work: true,
                roots: vec!["/w/cart/trees/fe".into(), "/w/cart/spec".into(), "/t/20261023-101010".into()],
                projects: vec![("fe".to_owned(), "/repos/fe".into())],
                seat: None,
            }
        }

        fn judged(&self) -> Verdict {
            judge(&Case {
                act: &self.act,
                policy: &self.policy,
                cli: &self.cli,
                level: self.level,
                grants: &self.grants,
                in_work: self.in_work,
                roots: &self.roots,
                projects: &self.projects,
                seat: self.seat.as_deref(),
            })
        }
    }

    fn names(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| (*name).to_owned()).collect()
    }

    fn edit(path: &str) -> Act {
        Act::Edit(vec![path.into()])
    }

    fn command(text: &str) -> Act {
        Act::Command(text.to_owned())
    }

    fn allow(reason: &str) -> Verdict {
        Verdict::Allow { reason: reason.to_owned() }
    }

    fn refuse(message: &str) -> Verdict {
        Verdict::Refuse { message: message.to_owned() }
    }

    /// `ask_before` · 계획 넘어가기 · 그 밖의 도구의 물음 — 「다시 묻지 않기」가 없다.
    fn ask(card: Card, policy: &str) -> Verdict {
        Verdict::Ask { card, policy: policy.to_owned(), grant: Vec::new() }
    }

    /// 물어보는 정도가 물은 것 — 「다시 묻지 않기」로 줄 허락과 함께.
    fn asked_with(card: Card, policy: &str, grant: &[&str]) -> Verdict {
        Verdict::Ask { card, policy: policy.to_owned(), grant: names(grant) }
    }

    const BUSY: &str = "@host가 이 Work를 고치는 중이에요 — 끝난 뒤 다시 하세요";

    #[test]
    fn 판정은_forbid_밖_편집_쓰기_자리_ask_before_허락_물어보는_정도의_차례로_처음_걸린_것을_낸다() {
        // 모든 칸에 걸리는 편집 하나에서 앞 칸을 하나씩 걷어 낸다 — 걷을 때마다 다음 칸이 답한다.
        let mut given = Given::act(edit("/repos/fe/src/cart.ts"));
        given.policy = Policy { ask_before: names(&["edit"]), forbid: names(&["edit"]) };
        given.seat = Some(BUSY.to_owned());
        given.grants = names(&["edit"]);
        given.level = AskLevel::Auto;
        assert_eq!(given.judged(), refuse("이 Agent의 Policy가 금지한 일이에요(forbid: edit) — 하지 말고 다른 길을 찾으세요"), "1. forbid");

        given.policy.forbid.clear();
        assert_eq!(
            given.judged(),
            refuse(
                "Work 밖의 파일이라 고칠 수 없어요: /repos/fe/src/cart.ts — `fe` Project를 고치려면 먼저 「Project 고치기 시작」 \
                 도구를 부르세요"
            ),
            "2. 밖 편집"
        );

        given.act = edit("/w/cart/trees/fe/src/cart.ts");
        assert_eq!(given.judged(), refuse(BUSY), "3. 쓰기 자리");

        given.seat = None;
        assert_eq!(given.judged(), ask(Card::Edit, "파일을 고치기 전에 묻기"), "4. ask_before");

        given.policy.ask_before.clear();
        assert_eq!(given.judged(), allow("이 Work에서는 다시 묻지 않기"), "5. 허락");

        given.grants.clear();
        assert_eq!(given.judged(), allow("알아서"), "6. 물어보는 정도");
    }

    #[test]
    fn 물어보는_정도의_표는_편집_명령_tools_cli_명령마다_묻거나_허용하고_계획_넘어가기와_그_밖의_도구는_늘_묻는다() {
        use AskLevel::*;
        let inside = || edit("/w/cart/trees/fe/src/cart.ts");
        let test = || command("gh pr view 12");
        let cli = "「gh」 명령은 묻지 않기";
        // (정도, 파일 고치기, 명령, `tools.cli`에 맞는 명령, 계획 넘어가기, 그 밖의 도구) — §9 표 그대로다. 물어보는 정도가 물은 편집 ·
        // 명령에는 「다시 묻지 않기」 허락이 함께 선다(v1 티켓 24).
        let edit_asked = |level: &str| asked_with(Card::Edit, level, &["edit"]);
        let command_asked = |level: &str| asked_with(Card::Command, level, &["Bash(gh pr *)"]);
        let table = [
            (Always, edit_asked("매번 묻기"), command_asked("매번 묻기"), allow(cli), ask(Card::Plan, "매번 묻기")),
            (Edits, allow("편집은 허용"), command_asked("편집은 허용"), allow(cli), ask(Card::Plan, "편집은 허용")),
            (Plan, edit_asked("계획만"), command_asked("계획만"), allow(cli), ask(Card::Plan, "계획만")),
            (Auto, allow("알아서"), allow("알아서"), allow(cli), ask(Card::Plan, "알아서")),
        ];
        for (level, edits, commands, listed, plan) in table {
            let judged = |act: Act, cli: &[&str]| {
                let mut given = Given::act(act);
                given.level = level;
                given.cli = names(cli);
                given.judged()
            };
            assert_eq!(judged(inside(), &["gh"]), edits, "{level:?} 파일 고치기 — tools.cli는 명령에만 쓴다");
            assert_eq!(judged(test(), &[]), commands, "{level:?} 명령");
            assert_eq!(judged(test(), &["gh"]), listed, "{level:?} tools.cli에 맞는 명령");
            assert_eq!(judged(Act::Plan, &["gh"]), plan, "{level:?} 계획 넘어가기");
            assert_eq!(judged(Act::Other, &["gh"]), ask(Card::Command, level.name()), "{level:?} 그 밖의 도구");
            assert_eq!(judged(Act::Edit(Vec::new()), &[]), edit_asked(level.name()), "{level:?} 경로를 모르는 편집");
        }
    }

    #[test]
    fn s19_규칙_이름은_편집_명령_push_merge와_명령_패턴이고_막는_쪽은_조각_하나만_걸려도_걸린다() {
        let forbids = |name: &str, act: Act| {
            let mut given = Given::act(act);
            given.policy.forbid = names(&[name]);
            matches!(given.judged(), Verdict::Refuse { .. })
        };
        // (규칙, 걸리는 것들, 걸리지 않는 것들)
        let table: [(&str, Vec<Act>, Vec<Act>); 7] = [
            ("edit", vec![edit("/w/cart/spec/a.md"), Act::Edit(Vec::new())], vec![command("rm a"), Act::Other, Act::Plan]),
            ("shell", vec![command("ls"), command("git push")], vec![edit("/w/cart/spec/a.md"), Act::Other]),
            (
                "push",
                vec![command("git push"), command("git push origin main"), command("cd fe && git push"), command("FOO=1 git push -f")],
                vec![
                    command("git pushy"),
                    command("git status"),
                    command("echo git push"),
                    command("git commit -m \"wip; git push later\""),
                    edit("/w/cart/spec/a.md"),
                ],
            ),
            (
                "merge",
                vec![command("gh pr merge 12 --squash"), command("git merge main"), command("git fetch; git merge origin/main")],
                vec![command("gh pr view 12"), command("git merge-base a b")],
            ),
            (
                "Bash(*prisma migrate *)",
                vec![command("pnpm prisma migrate dev --name x"), command("prisma migrate deploy"), command("cd api | npx prisma migrate")],
                vec![command("prisma generate"), command("pnpm test")],
            ),
            ("Bash(pnpm test:*)", vec![command("pnpm test"), command("pnpm test refunds")], vec![command("pnpm testing")]),
            ("schema", vec![], vec![command("pnpm prisma migrate dev"), edit("/w/cart/spec/a.md")]),
        ];
        for (name, hit, missed) in table {
            for act in hit {
                assert!(forbids(name, act.clone()), "{name}가 {act:?}에 걸린다");
            }
            for act in missed {
                assert!(!forbids(name, act.clone()), "{name}가 {act:?}에 걸리지 않는다");
            }
        }
    }

    #[test]
    fn 허락과_tools_cli는_명령의_모든_조각이_맞아야_넘기고_ask_before는_그_규칙의_이름으로_묻는다() {
        let judged = |act: Act, grants: &[&str], cli: &[&str]| {
            let mut given = Given::act(act);
            given.grants = names(grants);
            given.cli = names(cli);
            given.judged()
        };
        let granted = allow("이 Work에서는 다시 묻지 않기");
        assert_eq!(judged(command("pnpm test refunds"), &["Bash(pnpm test *)"], &[]), granted);
        let both = asked_with(Card::Command, "매번 묻기", &["Bash(pnpm test *)", "Bash(git push *)"]);
        assert_eq!(judged(command("pnpm test && git push"), &["Bash(pnpm test *)"], &[]), both);
        assert_eq!(judged(edit("/w/cart/spec/a.md"), &["edit"], &[]), granted);
        let edit_asked = asked_with(Card::Edit, "매번 묻기", &["edit"]);
        assert_eq!(judged(edit("/w/cart/spec/a.md"), &["shell"], &[]), edit_asked, "명령 허락은 편집을 넘기지 않는다");
        let gh_rm = asked_with(Card::Command, "매번 묻기", &["Bash(gh pr *)", "Bash(rm *)"]);
        assert_eq!(judged(command("gh pr view && rm -rf /"), &[], &["gh"]), gh_rm);
        let ghost = asked_with(Card::Command, "매번 묻기", &["Bash(ghost *)"]);
        assert_eq!(judged(command("ghost"), &[], &["gh"]), ghost, "이름은 낱말로 맞춘다");
        assert_eq!(judged(command("pnpm test x"), &[], &["Bash(pnpm test *)"]), allow("「pnpm test」 명령은 묻지 않기"));

        let mut given = Given::act(command("pnpm prisma migrate dev"));
        given.level = AskLevel::Auto;
        given.grants = names(&["shell"]);
        for (name, policy) in [
            ("edit", None),
            ("shell", Some("명령을 실행하기 전에 묻기")),
            ("Bash(*prisma migrate *)", Some("「prisma migrate」 실행 전에 묻기")),
            ("schema", None),
        ] {
            given.policy.ask_before = names(&[name]);
            let expected = policy.map_or_else(|| allow("이 Work에서는 다시 묻지 않기"), |policy| ask(Card::Command, policy));
            assert_eq!(given.judged(), expected, "ask_before: {name} — 허락 · 알아서보다 먼저 묻는다");
        }
        given.act = command("git push");
        for (name, policy) in [("push", "push하기 전에 묻기"), ("merge", "merge하기 전에 묻기")] {
            given.policy.ask_before = names(&[name]);
            given.act = command(if name == "push" { "git push" } else { "gh pr merge 1" });
            assert_eq!(given.judged(), ask(Card::Command, policy));
        }
    }

    #[test]
    fn 다시_묻지_않기는_물어보는_정도가_물은_편집_명령에만_서고_그_허락이_같은_종류의_다음_요청을_넘긴다() {
        let asked = |act: Act| Given::act(act).judged();
        // 물어보는 정도가 물은 것 — 편집은 편집 전부, 명령은 조각마다 머리(명령과 하위 명령, 두 낱말까지)의 패턴이다.
        let table: [(Act, &[&str]); 6] = [
            (edit("/w/cart/trees/fe/src/cart.ts"), &["edit"]),
            (Act::Edit(Vec::new()), &["edit"]),
            (command("pnpm prisma migrate dev --name partial_refund"), &["Bash(pnpm prisma *)"]),
            (command("python3 -c \"import time; print(1)\" && echo 'a | b'"), &["Bash(python3 *)", "Bash(echo *)"]),
            (command("cd ../fe && pnpm test refunds; cd .."), &["Bash(cd *)", "Bash(pnpm test *)"]),
            (command("FOO=1 ./scripts/run.sh --fast"), &["Bash(./scripts/run.sh *)"]),
        ];
        for (act, rules) in table {
            let Verdict::Ask { grant, .. } = asked(act.clone()) else { panic!("{act:?}는 묻는다") };
            assert_eq!(grant, names(rules), "{act:?}");
            // 그 허락을 주면 같은 요청이 5번 칸에서 넘어간다.
            let mut given = Given::act(act.clone());
            given.grants = grant;
            assert_eq!(given.judged(), allow("이 Work에서는 다시 묻지 않기"), "{act:?}");
            given.in_work = false;
            assert_eq!(given.judged(), allow("이 Thread에서는 다시 묻지 않기"), "{act:?} — Work 없는 Thread");
        }

        // 같은 종류 — 머리가 같으면 인자가 달라도 넘어가고, 조각 하나라도 허락 밖이면 묻는다.
        let mut given = Given::act(command("cd api && pnpm test cart --watch=false"));
        given.grants = names(&["Bash(cd *)", "Bash(pnpm test *)"]);
        assert_eq!(given.judged(), allow("이 Work에서는 다시 묻지 않기"));
        given.act = command("cd api && pnpm build");
        assert!(matches!(given.judged(), Verdict::Ask { .. }), "pnpm build는 pnpm test의 허락으로 넘어가지 않는다");

        // ask_before가 물은 것 · 계획 넘어가기 · 그 밖의 도구에는 없다 — 허락은 ask_before보다 뒤 칸이라 넘기지 못하고, 뒤의 둘은
        // S19에 이름이 없다.
        let mut given = Given::act(command("pnpm prisma migrate dev"));
        given.policy.ask_before = names(&["Bash(*prisma migrate *)"]);
        assert_eq!(given.judged(), ask(Card::Command, "「prisma migrate」 실행 전에 묻기"));
        assert_eq!(asked(Act::Plan), ask(Card::Plan, "매번 묻기"));
        assert_eq!(asked(Act::Other), ask(Card::Command, "매번 묻기"));
    }

    #[test]
    fn 고칠_수_있는_자리_밖의_편집은_거절하고_등록된_project_안이면_고치기_시작_도구를_가리킨다() {
        let judged = |path: &str, in_work: bool| {
            let mut given = Given::act(Act::Edit(vec!["/w/cart/spec/a.md".into(), path.into()]));
            given.in_work = in_work;
            given.level = AskLevel::Auto;
            given.judged()
        };
        assert_eq!(judged("/t/20261023-101010/notes.md", true), allow("알아서"), "Thread 폴더도 고칠 수 있는 자리다");
        assert_eq!(judged("/w/cart/trees/fe/a.ts", true), allow("알아서"));
        assert_eq!(
            judged("/w/cart/trees/fe-old/a.ts", true),
            refuse("Work 밖의 파일이라 고칠 수 없어요: /w/cart/trees/fe-old/a.ts — 이 Work의 worktree · spec 폴더 안에서만 고쳐요"),
            "경로는 낱말(폴더) 단위로 견준다 — 경로 하나라도 밖이면 거절이다"
        );
        assert_eq!(
            judged("/etc/hosts", false),
            refuse("Thread 폴더 밖의 파일이라 고칠 수 없어요: /etc/hosts — Work가 없는 Thread는 이 Thread 폴더 안에서만 고쳐요")
        );
        assert_eq!(
            judged("/repos/fe/a.ts", false),
            refuse(
                "Thread 폴더 밖의 파일이라 고칠 수 없어요: /repos/fe/a.ts — `fe` Project를 고치려면 먼저 「Project 고치기 시작」 도구를 \
                 부르세요"
            )
        );
    }

    #[test]
    fn 요청이_하는_일은_acp_도구_종류로_가르고_편집은_건드리는_경로를_모은다() {
        use serde_json::json;
        assert_eq!(
            Act::of(&json!({"kind": "edit", "rawInput": {"file_path": "/a/b.md", "content": "x"}, "locations": [{"path": "/a/b.md"}]})),
            edit("/a/b.md"),
            "같은 경로는 한 번이다"
        );
        assert_eq!(Act::of(&json!({"kind": "edit", "rawInput": {"notebook_path": "n.ipynb"}})), edit("n.ipynb"), "상대 경로는 그대로 둔다");
        let deleted = Act::of(&json!({"kind": "delete", "locations": [{"path": "/a"}, {"path": "/b"}]}));
        assert_eq!(deleted, Act::Edit(vec!["/a".into(), "/b".into()]));
        assert_eq!(Act::of(&json!({"kind": "move", "rawInput": {}})), Act::Edit(Vec::new()));
        assert_eq!(Act::of(&json!({"kind": "execute", "rawInput": {"command": "git push"}})), command("git push"));
        assert_eq!(Act::of(&json!({"kind": "execute", "rawInput": {"command": ["git", "push"]}})), command("git push"));
        assert_eq!(Act::of(&json!({"kind": "switch_mode", "rawInput": {"plan": "…"}})), Act::Plan);
        for kind in ["read", "fetch", "think", "other"] {
            assert_eq!(Act::of(&json!({"kind": kind})), Act::Other, "{kind}");
        }
        assert_eq!(Act::of(&json!({})), Act::Other);
    }

    #[test]
    fn 물어보는_정도는_저장_글자로_읽고_모르면_매번_묻기이며_계획만일_때만_claude를_계획_모드로_띄운다() {
        for level in [AskLevel::Always, AskLevel::Edits, AskLevel::Plan, AskLevel::Auto] {
            assert_eq!(AskLevel::read(Some(level.as_str())), level);
            assert_eq!(serde_json::to_value(level).unwrap(), level.as_str(), "저장 글자와 직렬화가 같다");
        }
        assert_eq!(AskLevel::read(None), AskLevel::Always);
        assert_eq!(AskLevel::read(Some("bypass")), AskLevel::Always);
        let modes: Vec<&str> = [AskLevel::Always, AskLevel::Edits, AskLevel::Plan, AskLevel::Auto].map(AskLevel::claude_mode).to_vec();
        assert_eq!(modes, ["default", "default", "plan", "default"]);
    }
}
