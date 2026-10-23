//! 판정 — 권한 요청 하나에 허용 · 거절 · 물음 가운데 하나를 내는 순수 함수(v1 구현 스펙 §9 · S17 · S19, v1 티켓 22).
//!
//! **Atelier가 하나뿐인 판정자다(S17).** Thread의 Session에 온 권한 요청은 모두 [`judge`]를 지난다. `claude`는 기본 모드로만(「계획만」
//! 이면 계획 모드로) 돌아, Claude Code가 엔진에 묻지 않고 넘기는 것은 사용자 설정의 허용 규칙과 claude가 스스로 읽기만으로 치는 일 —
//! 읽기 전용 명령(`echo` · `ls` · `cat` …)과 계획 모드에서 제 계획 파일(`~/.claude/plans/*.md`)을 쓰는 것 — 뿐이다(진짜 claude
//! 2.1.309, v1 티켓 27). 작업 자리의 `.claude/settings.json` 허용 규칙은 claude가 믿지 않은 폴더라 버린다. Agent의 `forbid`는
//! 변환기가 `--disallowedTools`로도 넘겨 claude가 먼저 막는다 — 1번 칸은 그 밖으로 새는 명령의 그물이다. 입출력이 없다 — 받는 것은
//! 엔진이 읽어 넘기고(`host/thread/gate.rs`), 내는 것을 엔진이 권한 답과 `permission` 줄로 옮긴다.
//!
//! **판정 순서**(§9) — 처음 걸린 칸이 답한다.
//! 1. `forbid`에 걸리면 거절한다.
//! 2. 고치는 경로가 고칠 수 있는 자리(Work의 worktree · spec 폴더 · Thread 폴더) 밖이면 거절한다. 그 경로가 등록된 Project 안이면
//!    Thread 도구 「Project 고치기 시작」(`start_editing`, v1 티켓 32)을 먼저 부르라고 글로 알린다 — Work가 없으면 Work부터 만들라고.
//!    Thread 폴더 안이어도 Atelier만 쓰는 파일(`thread.json` · `events.jsonl` · `.policy.json` · `agents/` 스냅숏)이면 거절한다(S7 ·
//!    §19, 코드 리뷰 1차 A2) — 그대로면 Agent가 묻지 않고 제 물어보는 정도를 올리거나 허락을 넓히거나 스냅숏의 Policy를 지운다.
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
//! 명령은 셸이 실행하는 명령마다 조각낸다(`&&` · `;` · `|` · 괄호 · 명령 치환 · `sh -c '…'`, [`pieces`]). git은 전역 옵션을 건너
//! 하위 명령을 읽는다 — `git -C fe push`도 `push`다. **막는 쪽(`forbid` · `ask_before`)은 조각 하나만 걸려도, 넘기는 쪽(허락 ·
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
    /// 고칠 수 있는 자리 안이어도 고칠 수 없는 자리 — Atelier만 쓰는 Thread 폴더의 파일 · 폴더다. 그 안이나 그것을 품은 폴더를
    /// 고치면 거절한다.
    pub kept: &'a [PathBuf],
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
        if let Some(kept) = paths.iter().find(|path| case.kept.iter().any(|kept| path.starts_with(kept) || kept.starts_with(path))) {
            return Verdict::Refuse { message: kept_message(kept) };
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

/// 밖 편집의 글 — 등록된 Project 안이면 그 Project의 worktree를 세우는(Work에 없으면 붙일지 묻는) Thread 도구를 가리킨다. Work가
/// 없는 Thread면 붙일 Work가 없으므로 Work 만들기 제안부터다.
fn outside_message(path: &Path, case: &Case) -> String {
    let place = if case.in_work { "Work" } else { "Thread 폴더" };
    let head = format!("{place} 밖의 파일이라 고칠 수 없어요: {}", path.display());
    let start = crate::thread_tools::START_EDITING;
    match case.projects.iter().find(|(_, folder)| path.starts_with(folder)) {
        Some((project, _)) if case.in_work => {
            format!("{head} — `{project}` Project를 고치려면 먼저 Thread 도구 `{start}`(Project 고치기 시작)을 부르세요")
        }
        Some((project, _)) => format!(
            "{head} — `{project}` Project를 고치려면 먼저 Thread 도구 `{}`로 그 Project를 넣은 Work를 만든 뒤 `{start}`을 부르세요",
            crate::thread_tools::PROPOSE_WORK
        ),
        None if case.in_work => format!("{head} — 이 Work의 worktree · spec 폴더 안에서만 고쳐요"),
        None => format!("{head} — Work가 없는 Thread는 이 Thread 폴더 안에서만 고쳐요"),
    }
}

/// Atelier만 쓰는 파일의 글 — Work 밖 거절과 같은 꼴이다.
fn kept_message(path: &Path) -> String {
    format!(
        "Thread 기록이라 고칠 수 없어요: {} — Thread 폴더의 `thread.json` · `events.jsonl` · `.policy.json` · `agents/`는 Atelier만 써요",
        path.display()
    )
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

/// 막는 쪽(`forbid` · `ask_before`)의 걸림 — 명령은 조각 하나만 걸려도 걸린다. 조각은 쓰인 그대로와 푼 글(git 전역 옵션을 걷은
/// 글) 가운데 하나만 맞아도 걸린다.
fn hits(name: &str, act: &Act) -> bool {
    let Act::Command(text) = act else {
        return matches!((rule(name), act), (Rule::Edits, Act::Edit(_)));
    };
    let fits = |piece: &Piece, fit: &dyn Fn(&str) -> bool| fit(&piece.said) || fit(&piece.run);
    match rule(name) {
        Rule::Commands => true,
        Rule::Named(commands) => pieces(text).iter().any(|piece| fits(piece, &|form| commands.iter().any(|command| starts(form, command)))),
        Rule::Pattern(pattern) => pieces(text).iter().any(|piece| fits(piece, &|form| pattern_matches(pattern, form))),
        Rule::Edits | Rule::Nothing => false,
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
fn covers_piece(name: &str, piece: &Piece) -> bool {
    match rule(name) {
        Rule::Commands => true,
        Rule::Named(commands) => passes(piece, |form| commands.iter().any(|command| starts(form, command))),
        Rule::Pattern(pattern) => passes(piece, |form| pattern_matches(pattern, form)),
        Rule::Edits | Rule::Nothing => false,
    }
}

/// 넘기는 쪽이 조각 하나를 보는 법 — 쓰인 그대로가 맞거나, git이 실행할 것을 바꾸는 전역 옵션이 없을 때 푼 글이 맞으면 넘긴다.
/// `git -C ../api status`는 `Bash(git status *)`로 넘어가고 `git -c core.pager=… status`는 넘어가지 않는다.
fn passes(piece: &Piece, fit: impl Fn(&str) -> bool) -> bool {
    fit(&piece.said) || (!piece.reconfigured && fit(&piece.run))
}

/// 「다시 묻지 않기」로 줄 허락(S18 · v1 티켓 24) — 같은 종류의 다음 요청을 5번 칸에서 넘기는 규칙 이름들. 편집이면 `edit`(편집
/// 전부 — 고칠 수 있는 자리 · 쓰기 자리는 그 앞 칸이 여전히 본다), 명령이면 조각마다 그 머리의 패턴 `Bash(<머리> *)`다. 계획
/// 넘어가기 · 그 밖의 도구는 S19에 이름이 없어 비었다.
///
/// **머리는 명령과 하위 명령, 두 낱말까지다**(`pnpm prisma migrate dev` → `pnpm prisma`, `git push origin` → `git push`, `python3 -c …`
/// → `python3`). 조각의 푼 글에서 읽는다 — git 전역 옵션을 건너 `git -C ../api status` → `git status`다(코드 리뷰 1차 A1).
/// 둘째 낱말은 하위 명령처럼 생겼을 때만 든다 — 영문자로 시작하고 영문자 · 숫자 · `-` · `_` · `:`뿐이다(`-c` · `script.py` ·
/// `../fe`는 인자다). 글자로만 가르므로 그렇게 생긴 인자는 하위 명령으로 읽힌다(`cd fe` → `cd fe`) — 허락이 좁아질 뿐 넓어지지
/// 않는다. 셋째 낱말부터는 하위 명령인지 인자인지 글자로 가를 수 없어 들지 않는다(`pnpm test refunds`).
///
/// **넘길 허락을 지을 수 없는 명령이면 비운다** — 그 선택지가 서지 않는다. git이 실행할 것을 바꾸는 전역 옵션(`-c …`)이 든 조각과
/// 명령 이름이 치환인 조각(`$X …`)이다. 앞의 것은 [`passes`]가 푼 글로 넘기지 않고, 뒤의 것은 `Bash($X *)`가 무엇이든 넘긴다.
pub(crate) fn remembered(act: &Act) -> Vec<String> {
    match act {
        Act::Edit(_) => vec!["edit".to_owned()],
        Act::Command(text) => {
            let mut rules: Vec<String> = Vec::new();
            for piece in pieces(text) {
                let mut words = piece.words.iter();
                let Some(first) = words.next() else { continue };
                if piece.reconfigured || first.contains(['$', '`']) {
                    return Vec::new();
                }
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
        Rule::Pattern(pattern) => every_piece(text, |piece| passes(piece, |form| pattern_matches(pattern, form))),
        _ => every_piece(text, |piece| passes(piece, |form| starts(form, entry))),
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

/// 명령 조각 하나 — 셸이 실행하는 명령 하나다. 걸림은 두 꼴을 함께 본다.
struct Piece {
    /// 쓰인 그대로의 낱말을 빈칸 하나로 이은 글 — 앞의 변수 놓기 · 셸 문법 낱말(`if` · `then` · `{` …) · 재지정은 뗐다.
    said: String,
    /// 셸이 푼 낱말(따옴표를 벗긴 글)들. git이면 전역 옵션(`-C <dir>` · `--no-pager` …)을 걷어 `git <하위 명령> …`이다.
    words: Vec<String>,
    /// `words`를 빈칸 하나로 이은 글.
    run: String,
    /// 걷은 git 전역 옵션이 git이 실행할 것을 바꾸나(`-c` · `--config-env` · `--exec-path` — `-c core.pager=…`는 아무 명령이나
    /// 띄운다). 넘기는 쪽은 그때 `run`을 믿지 않는다.
    reconfigured: bool,
}

/// 명령의 조각들(코드 리뷰 1차 A1 · 끝-점검-PR4 (d)) — 셸이 명령 하나로 실행하는 단위마다 하나다.
///
/// - `&&` · `||` · `;` · `|` · `&` · 줄바꿈 · 괄호(subshell)로 자른다. 재지정의 `&`(`2>&1` · `&>`)로는 자르지 않는다. **따옴표
///   안의 구분자로도 자르지 않는다**(v1 티켓 24) — `python3 -c "import a; a.b()"`는 조각 하나다. 셸이 그 글을 한 인자로 넘기기
///   때문이고, 거기서 자르면 「다시 묻지 않기」가 `Bash(a.b() *)` 같은 허락을 짓는다.
/// - 실행되는 안쪽도 조각이다 — 명령 치환(`$(…)` · `` `…` ``, 큰따옴표 안에서도) · 프로세스 치환(`<(…)`), `sh -c '…'` ·
///   `bash -lc "…"` · `eval '…'`의 글. 셸 · `eval` 조각은 제 자리를 안쪽 조각들에 내준다 — 그 셸이 실행하는 것이 안쪽이다.
/// - heredoc 본문은 명령이 아니다 — 따옴표 친 끝말(`<<'EOF'`)이면 글 그대로, 아니면 그 안의 명령 치환만 조각이다. 주석(`# …`)도
///   뺀다.
/// - 앞의 변수 놓기(`FOO=1 git push`) · 셸 문법 낱말 · 재지정을 떼고, 그것만인 조각 · 닫는 낱말(`}` · `fi` …)만인 조각은 버린다.
///
/// 글자로 읽는 그물이다 — 별칭(`git config alias.ship push` 뒤 `git ship`) · 스크립트 파일 · `xargs` · `find -exec` 같은 길로
/// 실행되는 명령은 보지 못한다(결정.md 「코드 리뷰 1차」).
fn pieces(text: &str) -> Vec<Piece> {
    let chars: Vec<char> = text.chars().collect();
    let mut lexed = Vec::new();
    Lexer { chars: &chars, at: 0 }.lex(None, &mut lexed);
    let mut pieces = Vec::new();
    for words in lexed {
        settle(&words, &mut pieces);
    }
    pieces
}

/// 셸 낱말 하나 — 쓰인 그대로와 셸이 푼 글(따옴표 · 백슬래시를 벗겼다. 치환은 쓰인 그대로 둔다).
#[derive(Default)]
struct Word {
    raw: String,
    text: String,
}

/// 떼는 셸 문법 낱말 — 명령이 아니라 그 앞에 붙는 말이다.
const OPENERS: [&str; 9] = ["!", "{", "if", "then", "elif", "else", "while", "until", "do"];
/// 닫는 셸 문법 낱말 — 이것만인 조각은 명령이 아니다.
const CLOSERS: [&str; 4] = ["}", "fi", "done", "esac"];
/// `-c`로 받은 글을 명령으로 실행하는 셸.
const SHELLS: [&str; 5] = ["sh", "bash", "zsh", "dash", "ksh"];

/// 낱말 목록 하나를 조각으로 — 앞말(변수 놓기 · 셸 문법 낱말 · 재지정)을 떼고, 셸 · `eval`이면 안쪽 글을 다시 조각낸다.
fn settle(words: &[Word], pieces: &mut Vec<Piece>) {
    let mut skip = 0;
    while let Some(word) = words.get(skip) {
        skip += match redirection(&word.raw) {
            Some(true) => 2,
            Some(false) => 1,
            None if assigns(&word.text) || OPENERS.contains(&word.raw.as_str()) => 1,
            None => break,
        };
    }
    let words = words.get(skip..).unwrap_or_default();
    let Some(first) = words.first() else { return };
    if words.iter().all(|word| CLOSERS.contains(&word.raw.as_str())) {
        return;
    }
    if SHELLS.contains(&first.text.as_str()) {
        let options = words[1..].iter().take_while(|word| word.text.starts_with('-')).count();
        let commands = words[1..=options].iter().any(|word| !word.text.starts_with("--") && word.text[1..].contains('c'));
        if let Some(code) = words.get(options + 1).filter(|_| commands) {
            pieces.extend(self::pieces(&code.text));
            return;
        }
    }
    if first.text == "eval" && words.len() > 1 {
        pieces.extend(self::pieces(&joined(&words[1..], |word| &word.text)));
        return;
    }
    let said = joined(words, |word| &word.raw);
    let (run, reconfigured) = match first.text.as_str() {
        "git" => git_run(words),
        _ => (words.iter().map(|word| word.text.clone()).collect::<Vec<_>>(), false),
    };
    pieces.push(Piece { said, run: run.join(" "), words: run, reconfigured });
}

fn joined<'w>(words: &'w [Word], part: impl Fn(&'w Word) -> &'w str) -> String {
    words.iter().map(part).collect::<Vec<_>>().join(" ")
}

/// git의 전역 옵션(`git [옵션…] <하위 명령>`)을 걷은 낱말들 — 값을 따로 받는 옵션은 그 값까지 걷는다. 걷은 것 가운데 git이
/// 실행할 것을 바꾸는 옵션이 있었는지와 함께.
fn git_run(words: &[Word]) -> (Vec<String>, bool) {
    const VALUED: [&str; 8] = ["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env", "--super-prefix", "--attr-source"];
    const RECONFIGURING: [&str; 3] = ["-c", "--config-env", "--exec-path"];
    let (mut at, mut reconfigured) = (1, false);
    while let Some(word) = words.get(at).filter(|word| word.text.starts_with('-')) {
        let name = word.text.split_once('=').map_or(word.text.as_str(), |(name, _)| name);
        reconfigured |= RECONFIGURING.contains(&name);
        at += if VALUED.contains(&word.text.as_str()) { 2 } else { 1 };
    }
    let rest = words.get(at..).unwrap_or_default();
    (["git".to_owned()].into_iter().chain(rest.iter().map(|word| word.text.clone())).collect(), reconfigured)
}

/// 따옴표 · 치환 · heredoc을 아는 작은 셸 낱말 읽기 — 조각마다 낱말 목록을 낸다. 치환의 안쪽 조각은 그 바깥 조각 뒤에 선다.
struct Lexer<'a> {
    chars: &'a [char],
    at: usize,
}

/// 읽는 중인 조각 — 낱말들 · 읽는 중인 낱말 · 이 조각 안에서 만난 치환의 조각들 · 줄이 끝나면 건너뛸 heredoc 본문들.
#[derive(Default)]
struct Open {
    words: Vec<Word>,
    word: Option<Word>,
    nested: Vec<Vec<Word>>,
    heredocs: Vec<Heredoc>,
}

struct Heredoc {
    end: String,
    /// 따옴표 없는 끝말이면 본문의 명령 치환이 실행된다.
    expands: bool,
    /// `<<-` — 끝말 줄 앞의 탭을 뗀다.
    tabs: bool,
}

impl Open {
    fn word(&mut self) -> &mut Word {
        self.word.get_or_insert_with(Word::default)
    }

    fn push(&mut self, c: char) {
        let word = self.word();
        word.raw.push(c);
        word.text.push(c);
    }

    fn end_word(&mut self) {
        if let Some(word) = self.word.take() {
            self.words.push(word);
        }
    }

    fn end_piece(&mut self, out: &mut Vec<Vec<Word>>) {
        self.end_word();
        if !self.words.is_empty() {
            out.push(std::mem::take(&mut self.words));
        }
        out.append(&mut self.nested);
    }
}

impl Lexer<'_> {
    fn peek(&self, ahead: usize) -> Option<char> {
        self.chars.get(self.at + ahead).copied()
    }

    /// 글 끝까지, `close`가 있으면 짝이 맞는 그 글자(`)` · `` ` ``)까지 읽는다 — 치환의 안쪽이다.
    fn lex(&mut self, close: Option<char>, out: &mut Vec<Vec<Word>>) {
        let mut open = Open::default();
        let mut depth = 0usize;
        while let Some(c) = self.peek(0) {
            match c {
                ' ' | '\t' => {
                    open.end_word();
                    self.at += 1;
                }
                '\\' if self.peek(1) == Some('\n') => self.at += 2,
                '\\' => {
                    let word = open.word();
                    word.raw.push('\\');
                    if let Some(next) = self.peek(1) {
                        word.raw.push(next);
                        word.text.push(next);
                    }
                    self.skip(2);
                }
                '\'' => {
                    let start = self.at;
                    self.at += 1;
                    while let Some(quoted) = self.peek(0).filter(|quoted| *quoted != '\'') {
                        open.word().text.push(quoted);
                        self.at += 1;
                    }
                    self.skip(1);
                    self.raw(&mut open, start);
                }
                '"' => self.double(&mut open),
                '`' if close == Some('`') => {
                    self.at += 1;
                    break;
                }
                '`' => self.substitution(&mut open, 1, '`'),
                '$' | '<' | '>' if self.peek(1) == Some('(') && (c == '$' || open.word.is_none()) => self.substitution(&mut open, 2, ')'),
                '<' if self.peek(1) == Some('<') && self.peek(2) != Some('<') => self.heredoc(&mut open),
                '#' if open.word.is_none() => {
                    while self.peek(0).is_some_and(|c| c != '\n') {
                        self.at += 1;
                    }
                }
                '(' => {
                    open.end_piece(out);
                    depth += 1;
                    self.at += 1;
                }
                ')' => {
                    open.end_piece(out);
                    self.at += 1;
                    if depth == 0 && close == Some(')') {
                        return;
                    }
                    depth = depth.saturating_sub(1);
                }
                '&' if self.peek(1) == Some('>') || open.word.as_ref().is_some_and(|word| word.raw.ends_with(['>', '<'])) => {
                    open.push(c);
                    self.at += 1;
                }
                ';' | '|' | '&' => {
                    open.end_piece(out);
                    self.at += 1;
                }
                '\n' => {
                    open.end_piece(out);
                    self.at += 1;
                    self.bodies(&mut open);
                    out.append(&mut open.nested);
                }
                _ => {
                    open.push(c);
                    self.at += 1;
                }
            }
        }
        open.end_piece(out);
    }

    /// 글 끝을 넘지 않게 건너뛴다 — 닫히지 않은 따옴표 · 끝의 백슬래시.
    fn skip(&mut self, count: usize) {
        self.at = (self.at + count).min(self.chars.len());
    }

    /// `start`부터 읽은 글.
    fn taken(&self, start: usize) -> &[char] {
        &self.chars[start..self.at]
    }

    /// `start`부터 읽은 글을 낱말의 쓰인 그대로에 더한다.
    fn raw(&self, open: &mut Open, start: usize) {
        open.word().raw.extend(self.taken(start));
    }

    /// 큰따옴표 — 백슬래시는 `"` · `\` · `$` · `` ` `` 앞에서만 푼다. 안의 명령 치환은 실행된다.
    fn double(&mut self, open: &mut Open) {
        let start = self.at;
        self.at += 1;
        while let Some(c) = self.peek(0) {
            match c {
                '"' => {
                    self.at += 1;
                    break;
                }
                '\\' if self.peek(1).is_some_and(|next| matches!(next, '"' | '\\' | '$' | '`' | '\n')) => {
                    open.word().text.extend(self.peek(1));
                    self.at += 2;
                }
                '$' if self.peek(1) == Some('(') => {
                    let inner = self.at;
                    self.at += 2;
                    self.lex(Some(')'), &mut open.nested);
                    open.word().text.extend(self.taken(inner));
                }
                '`' => {
                    let inner = self.at;
                    self.at += 1;
                    self.lex(Some('`'), &mut open.nested);
                    open.word().text.extend(self.taken(inner));
                }
                _ => {
                    open.word().text.push(c);
                    self.at += 1;
                }
            }
        }
        self.raw(open, start);
    }

    /// 치환(`$(` · `<(` · `` ` ``) — 안쪽을 조각으로 읽고, 낱말에는 쓰인 그대로 남긴다.
    fn substitution(&mut self, open: &mut Open, head: usize, close: char) {
        let start = self.at;
        self.at += head;
        self.lex(Some(close), &mut open.nested);
        let raw: String = self.taken(start).iter().collect();
        let word = open.word();
        word.raw.push_str(&raw);
        word.text.push_str(&raw);
    }

    /// heredoc 여는 말(`<<EOF` · `<<-'EOF'` · `<< "EOF"`) — 본문은 이 줄이 끝난 뒤에 건너뛴다.
    fn heredoc(&mut self, open: &mut Open) {
        open.end_word();
        let start = self.at;
        self.at += 2;
        let tabs = self.peek(0) == Some('-');
        if tabs {
            self.at += 1;
        }
        while matches!(self.peek(0), Some(' ' | '\t')) {
            self.at += 1;
        }
        let (mut end, mut quoted) = (String::new(), false);
        while let Some(c) = self.peek(0).filter(|c| !c.is_whitespace() && !matches!(c, ';' | '|' | '&' | '<' | '>' | '(' | ')')) {
            match c {
                '\'' | '"' => {
                    quoted = true;
                    self.at += 1;
                    while let Some(inner) = self.peek(0).filter(|inner| *inner != c) {
                        end.push(inner);
                        self.at += 1;
                    }
                }
                '\\' => {
                    quoted = true;
                    end.extend(self.peek(1));
                    self.at += 1;
                }
                _ => end.push(c),
            }
            self.skip(1);
        }
        self.raw(open, start);
        open.end_word();
        open.heredocs.push(Heredoc { end, expands: !quoted, tabs });
    }

    /// 줄이 끝난 뒤 — 그 줄에서 연 heredoc의 본문을 차례로 건너뛴다. 따옴표 없는 끝말의 본문에서는 명령 치환만 읽는다.
    fn bodies(&mut self, open: &mut Open) {
        let chars = self.chars;
        for doc in std::mem::take(&mut open.heredocs) {
            while self.at < chars.len() {
                let start = self.at;
                let end = chars[start..].iter().position(|c| *c == '\n').map_or(chars.len(), |at| start + at);
                let line: String = chars[start..end].iter().collect();
                self.at = (end + 1).min(chars.len());
                let line = if doc.tabs { line.trim_start_matches('\t') } else { line.as_str() };
                if line == doc.end {
                    break;
                }
                if doc.expands {
                    let mut inner = Lexer { chars: &chars[start..end], at: 0 };
                    while let Some(c) = inner.peek(0) {
                        match c {
                            '\\' => inner.skip(2),
                            '$' if inner.peek(1) == Some('(') => inner.substitution(open, 2, ')'),
                            '`' => inner.substitution(open, 1, '`'),
                            _ => inner.at += 1,
                        }
                    }
                    open.word = None;
                }
            }
        }
    }
}

/// 재지정 낱말(`>out` · `2>&1` · `&>` · `<in`)인가 — 그렇다면 대상이 다음 낱말인지(연산자만인지)와 함께.
fn redirection(raw: &str) -> Option<bool> {
    let rest = raw.trim_start_matches(|c: char| c.is_ascii_digit());
    let operator = ["&>>", "&>", ">>", ">&", "<&", ">|", "<>", "<<", ">", "<"].into_iter().find(|operator| rest.starts_with(operator))?;
    Some(rest.len() == operator.len())
}

/// 환경 변수 놓기(`NAME=값`)인가.
fn assigns(word: &str) -> bool {
    word.split_once('=').is_some_and(|(name, _)| {
        name.starts_with(|c: char| c.is_ascii_alphabetic() || c == '_') && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
    })
}

/// 조각이 하나라도 있고 모두가 맞나.
fn every_piece(text: &str, fits: impl Fn(&Piece) -> bool) -> bool {
    let pieces = pieces(text);
    !pieces.is_empty() && pieces.iter().all(fits)
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
        kept: Vec<PathBuf>,
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
                kept: ["thread.json", "events.jsonl", ".policy.json", "agents"].map(|name| Path::new("/t/20261023-101010").join(name)).to_vec(),
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
                kept: &self.kept,
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
                "Work 밖의 파일이라 고칠 수 없어요: /repos/fe/src/cart.ts — `fe` Project를 고치려면 먼저 Thread 도구 \
                 `start_editing`(Project 고치기 시작)을 부르세요"
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
    fn 막는_쪽은_git_전역_옵션을_건너_하위_명령을_읽고_괄호_명령_치환_sh_c의_안쪽_명령도_본다() {
        // 코드 리뷰 1차 A1 — 앞머리만 보면 `git -C <dir> push` · `(git push)` · `sh -c 'git push'`가 push 전에 묻기를 빠져나간다.
        let judged = |rule: &str, text: &str| {
            let mut given = Given::act(command(text));
            given.level = AskLevel::Auto;
            given.policy.ask_before = names(&[rule]);
            given.judged()
        };
        let pushes = [
            "git -C /w/cart/trees/fe push origin main",
            "git --no-pager push",
            "git -c http.extraHeader=x --git-dir=/w/.git --work-tree /w push -f",
            "git -C fe -C . push",
            "(git push)",
            "(cd fe && git push)",
            "{ git push; }",
            "if true; then git push; fi",
            "sh -c 'git push'",
            "bash -lc \"cd fe && git -C . push\"",
            "eval 'git push'",
            "echo \"$(git push 2>&1)\"",
            "echo `git push`",
            "cat <(git push)",
            "git status &&\\\n  git push",
            "cat <<EOF\n$(git push)\nEOF",
        ];
        for text in pushes {
            assert_eq!(judged("push", text), ask(Card::Command, "push하기 전에 묻기"), "{text:?}");
            assert_eq!(judged("Bash(git push *)", text), ask(Card::Command, "「git push」 실행 전에 묻기"), "{text:?}");
        }
        assert_eq!(judged("merge", "git -C fe merge main"), ask(Card::Command, "merge하기 전에 묻기"));
        let not_pushes = [
            "git -C push status",
            "git log --grep push",
            "echo 'git push'",
            "git commit -m \"wip; (git push) later\"",
            "cat <<'EOF'\n$(git push)\nEOF",
            "git commit -F - <<'EOF'\ngit push\nEOF",
            "# git push\ngit status",
        ];
        for text in not_pushes {
            assert_eq!(judged("push", text), allow("알아서"), "{text:?}");
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
    fn 다시_묻지_않기의_허락은_git_전역_옵션_heredoc_본문_재지정_괄호_변수_놓기를_명령_머리로_읽지_않는다() {
        // 코드 리뷰 1차 A1 · 끝-점검-PR4 (d) — 옛 허락은 `Bash(git *)` · `Bash(EOF *)` · `Bash(1 *)` · `Bash((cd *)` · `Bash(SPEC=… *)`였다.
        let table: [(&str, &[&str]); 9] = [
            ("git -C /w/cart/trees/fe status --short", &["Bash(git status *)"]),
            ("git --no-pager log -3", &["Bash(git log *)"]),
            ("git commit -F - <<'EOF'\n부분 환불 (#31)\n\nKimHyoYeon\nEOF", &["Bash(git commit *)"]),
            ("git commit -m \"$(cat <<'EOF'\n고친다 (#501) — don't\nEOF\n)\" && git log -1", &["Bash(git commit *)", "Bash(cat *)", "Bash(git log *)"]),
            ("pnpm test 2>&1 | tail -3", &["Bash(pnpm test *)", "Bash(tail *)"]),
            ("(cd ../fe && pnpm test) &> out.log", &["Bash(cd *)", "Bash(pnpm test *)"]),
            ("SPEC=/a/b/pr.md; cat $SPEC", &["Bash(cat *)"]),
            ("bash -c 'git status && git diff'", &["Bash(git status *)", "Bash(git diff *)"]),
            ("if git diff --quiet; then echo same; fi", &["Bash(git diff *)", "Bash(echo same *)"]),
        ];
        for (text, rules) in table {
            let Verdict::Ask { grant, .. } = Given::act(command(text)).judged() else { panic!("{text:?}는 묻는다") };
            assert_eq!(grant, names(rules), "{text:?}");
            let mut given = Given::act(command(text));
            given.grants = grant;
            assert_eq!(given.judged(), allow("이 Work에서는 다시 묻지 않기"), "{text:?} — 그 허락이 같은 요청을 넘긴다");
        }

        // 넘길 허락을 지을 수 없으면 그 선택지가 서지 않는다.
        for text in ["git -c core.pager=less log", "cd fe && $RUN --fast"] {
            let Verdict::Ask { grant, .. } = Given::act(command(text)).judged() else { panic!("{text:?}는 묻는다") };
            assert_eq!(grant, Vec::<String>::new(), "{text:?}");
        }

        // `git status`의 허락은 다른 자리의 `git status`를 넘기고, push와 git이 실행할 것을 바꾼 status는 넘기지 않는다.
        let judged = |text: &str| {
            let mut given = Given::act(command(text));
            given.grants = names(&["Bash(git status *)"]);
            given.judged()
        };
        assert_eq!(judged("git -C ../api status"), allow("이 Work에서는 다시 묻지 않기"));
        assert!(matches!(judged("git -C ../api push"), Verdict::Ask { .. }));
        assert!(matches!(judged("git -c core.fsmonitor=./x status"), Verdict::Ask { .. }));
        let mut given = Given::act(command("git -C ../api status"));
        given.cli = names(&["git status"]);
        assert_eq!(given.judged(), allow("「git status」 명령은 묻지 않기"), "tools.cli도 같은 글을 본다");
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
                "Thread 폴더 밖의 파일이라 고칠 수 없어요: /repos/fe/a.ts — `fe` Project를 고치려면 먼저 Thread 도구 `propose_work`로 \
                 그 Project를 넣은 Work를 만든 뒤 `start_editing`을 부르세요"
            )
        );
    }

    #[test]
    fn thread_폴더의_기록_파일과_정의_스냅숏은_고칠_수_있는_자리_안이어도_묻지_않고_거절한다() {
        // 코드 리뷰 1차 A2 — Thread 폴더는 Atelier만 쓴다(S7 · §19). 알아서 · 편집 허락이 있어도 거절이다.
        let judged = |path: &str| {
            let mut given = Given::act(edit(path));
            given.level = AskLevel::Auto;
            given.grants = names(&["edit"]);
            given.in_work = false;
            given.judged()
        };
        let refused = |path: &str| {
            refuse(&format!(
                "Thread 기록이라 고칠 수 없어요: {path} — Thread 폴더의 `thread.json` · `events.jsonl` · `.policy.json` · `agents/`는 \
                 Atelier만 써요"
            ))
        };
        for path in [
            "/t/20261023-101010/thread.json",
            "/t/20261023-101010/events.jsonl",
            "/t/20261023-101010/.policy.json",
            "/t/20261023-101010/agents/host.md",
            "/t/20261023-101010/agents",
            "/t/20261023-101010",
        ] {
            assert_eq!(judged(path), refused(path), "{path}");
        }
        assert_eq!(judged("/t/20261023-101010/notes.md"), allow("이 Thread에서는 다시 묻지 않기"), "나머지 Thread 폴더는 그대로다");
        assert_eq!(judged("/t/20261023-101010/agents-notes/a.md"), allow("이 Thread에서는 다시 묻지 않기"), "경로는 폴더 단위로 견준다");
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
