//! 판정 — 권한 요청 하나에 허용 · 거절 · 물음 가운데 하나를 내는 순수 함수(구현 스펙 「01a — 권한」, v1 티켓 22).
//!
//! **Atelier가 하나뿐인 판정자다(S17).** Thread의 Session에 온 권한 요청은 모두 [`judge`]를 지난다. `claude`는 기본 모드로만(「계획」
//! 이면 계획 모드로) 돌아, Claude Code가 엔진에 묻지 않고 넘기는 것은 사용자 설정의 허용 규칙과 claude가 스스로 읽기만으로 치는 일 —
//! 읽기 전용 명령(`echo` · `ls` · `cat` …)과 계획 모드에서 제 계획 파일(`~/.claude/plans/*.md`)을 쓰는 것 — 뿐이다(진짜 claude
//! 2.1.309, v1 티켓 27). 작업 자리의 `.claude/settings.json` 허용 규칙은 claude가 믿지 않은 폴더라 버린다. 입출력이 없다 — 받는 것은
//! 엔진이 읽어 넘기고(`host/thread/gate.rs`), 내는 것을 엔진이 권한 답과 `permission` 줄로 옮긴다.
//!
//! **판정 순서** — 처음 걸린 칸이 답한다.
//! 1. 앱 경계 — 앱에 온 요청에만 걸리고, 어떤 물어보는 정도에서도 허락이 있어도 같다.
//!    - 고치는 경로가 고칠 수 있는 자리(Work의 worktree · spec 폴더 · Thread 폴더) 밖이면 거절한다. 그 경로가 등록된 Project 안이면
//!      Thread 도구 「Project 고치기 시작」(`start_editing`, v1 티켓 32)을 먼저 부르라고 글로 알린다 — Work가 없으면 Work부터 만들라고.
//!    - Thread 폴더 안이어도 Atelier만 쓰는 파일(`thread.json` · `events.jsonl` · `.policy.json`)이면 거절한다(S7 · §19, 코드 리뷰 1차
//!      A2) — 그대로면 Runtime이 묻지 않고 제 물어보는 정도를 올리거나 허락을 넓힌다.
//!    - 고치는 경로를 읽을 수 없는 편집은 자리를 볼 수 없어 묻는다.
//!    - 명령 글에 그 파일이 나오면 묻는다(코드 리뷰 2차 A3 — 글자로만 본다, [`mentions_kept`]).
//! 2. 쓰기 자리를 다른 Session이 쥐고 있으면 거절한다(§10 · v1 티켓 18).
//! 3. 「다시 묻지 않기」 허락에 걸리면 허용한다.
//! 4. 그 밖에는 물어보는 정도의 표([`by_level`])를 따른다.
//!
//! **허락의 이름** — `edit`(편집 전부) · `shell`(명령 전부) · `push` · `merge`, 그리고 명령 패턴 `Bash(…)`다. 「다시 묻지 않기」가 적는 것은
//! `edit`과 `Bash(…)`이고, 나머지는 점 파일에 손으로 적어야 든다. `schema`와 모르는 이름은 아무것도 넘기지 않는다.
//!
//! 명령은 셸이 실행하는 명령마다 조각낸다(`&&` · `;` · `|` · 괄호 · 명령 치환 · `sh -c '…'`, `policy/shell.rs`). git은 전역 옵션을 건너
//! 하위 명령을 읽는다 — `git -C fe status`도 `status`다. **허락은 모든 조각이 맞아야** 넘어간다 — `pnpm test && git push`는
//! `Bash(pnpm test *)`로 넘어가지 않는다. 조각마다 준 허락 가운데 하나에 맞으면 된다 — 「다시 묻지 않기」가 `cd fe && pnpm test`에
//! `cd` · `pnpm test` 둘을 주기 때문이다([`remembered`], v1 티켓 24). 넘기는 쪽이라 좁게 본다(코드 리뷰 2차 A1) — 경로를 뗀 이름으로
//! 넘기지 않고, 셸이 실행할 것을 글에서 읽을 수 없는 조각(`… | sh` · `bash <<'EOF'` · `$(echo git) push` · `git $(echo push)`)에는
//! 허락을 짓지 않는다.
//!
//! **「다시 묻지 않기」는 물어보는 정도가 물은 것에만 선다**(4번 칸) — 물음([`Verdict::Ask`])이 그때 줄 허락을 함께 낸다. 앱 경계가
//! 물은 것에는 없다: 허락은 3번 칸이라 1번을 넘기지 못한다 — 주어도 다음에 또 묻는다.

mod shell;

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::thread_tools::app_tool;
use shell::{pieces, Piece};

/// 물어보는 정도(스토리 84 · S18) — 입력창 칩이 고른다(v1 티켓 23). 저장 글자는 `always` · `edits` · `plan` · `auto`다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AskLevel {
    /// 매번 묻기 — 편집과 명령마다 묻는다. 저장 값의 기본이다: 없거나 깨진 값이 허용으로 눕지 않게.
    #[default]
    Always,
    /// 편집 자동 — 파일 편집은 묻지 않고, 명령은 묻는다.
    Edits,
    /// 계획 — `claude`가 계획 모드로 돈다. 고치지 않고 계획만 세운다.
    Plan,
    /// 묻지 않음 — 모두 허용한다. 앱 경계와 사람이 정할 일(질문 · 계획 넘어가기)만 남는다.
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

    /// 화면의 이름(캔버스 「물어보는 정도」 메뉴) — 물음의 까닭과 자동 허용의 까닭이 이 글이다.
    pub(crate) fn name(self) -> &'static str {
        match self {
            AskLevel::Always => "매번 묻기",
            AskLevel::Edits => "편집 자동",
            AskLevel::Plan => "계획",
            AskLevel::Auto => "묻지 않음",
        }
    }

    /// `claude`를 띄우는 권한 모드(S17) — 「계획」이면 `plan`, 그 밖에는 `default`다. 사용자의 `defaultMode`(예 `acceptEdits`)를
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
    /// 앱 기능 도구 — 앱이 붙인 Thread 도구 서버의 도구다. 카드가 필요한 도구는 스스로 카드를 세우므로 판정이 묻지 않는다.
    App,
    /// 그 밖의 도구(웹 · 다른 MCP · 읽기 …).
    Other,
}

impl Act {
    /// ACP 도구 요지에서 읽는다. 편집의 경로는 `locations[].path`와 입력의 `file_path` · `notebook_path` · `path`다 — 상대 경로는
    /// 그대로 둔다(엔진이 Session의 작업 폴더에서 푼다). 명령은 입력의 `command`(글 또는 낱말 목록)다. 앱 기능 도구는 종류가 없어
    /// Claude 변환기가 실은 도구 이름으로 가른다 — 제목은 보지 않는다. `Task`의 제목은 모델이 쓴 글이다.
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
            _ if tool_call["_meta"]["claudeCode"]["toolName"].as_str().and_then(app_tool).is_some() => Act::App,
            _ => Act::Other,
        }
    }

    /// 물을 때 세울 카드 — 그 밖의 도구는 명령 카드다(카드는 셋이다, §9).
    pub(crate) fn card(&self) -> Card {
        match self {
            Act::Edit(_) => Card::Edit,
            Act::Plan => Card::Plan,
            Act::Command(_) | Act::App | Act::Other => Card::Command,
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
    pub level: AskLevel,
    /// 「다시 묻지 않기」 허락 — 허락의 이름들.
    pub grants: &'a [String],
    /// Work에 이은 Thread인가 — 허락의 까닭과 밖 편집의 글이 갈린다.
    pub in_work: bool,
    /// 고칠 수 있는 자리 — Work의 worktree들 · spec 폴더, 그리고 Thread 폴더. 절대 경로다.
    pub roots: &'a [PathBuf],
    /// 고칠 수 있는 자리 안이어도 고칠 수 없는 자리 — Atelier만 쓰는 Thread 폴더의 파일 · 폴더다. 그 안이나 그것을 품은 폴더를
    /// 고치면 거절하고, 명령 글에 나오면 묻는다.
    pub kept: &'a [PathBuf],
    /// 이 Session의 작업 폴더(링크를 푼 꼴) — 명령 글의 맨 이름(`thread.json`)이 어느 폴더의 것인지 가른다.
    pub cwd: &'a Path,
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
    /// 묻지 않고 거절한다 — Runtime에게 돌려줄 글과 함께.
    Refuse { message: String },
    /// 사람에게 묻는다 — 카드 종류와 왜 묻는지와 함께. `grant`는 사람이 「다시 묻지 않기」를 고르면 줄 허락(허락의 이름들)이고, 비었으면
    /// 그 선택지가 서지 않는다(머리말).
    Ask { card: Card, policy: String, grant: Vec<String> },
}

/// 권한 요청 하나를 판정한다 — 머리말의 차례대로 처음 걸린 칸이 답한다.
pub(crate) fn judge(case: &Case) -> Verdict {
    if let Some(bounded) = app_boundary(case) {
        return bounded;
    }
    if let (Act::Edit(_), Some(busy)) = (case.act, case.seat) {
        return Verdict::Refuse { message: busy.to_owned() };
    }
    if granted(case.grants, case.act) {
        let reason = if case.in_work { "이 Work에서는 다시 묻지 않기" } else { "이 Thread에서는 다시 묻지 않기" };
        return Verdict::Allow { reason: reason.to_owned() };
    }
    by_level(case)
}

/// 앱 경계(스펙 「01a — 권한」의 둘째 표) — 앱에 온 요청에만 걸린다. 허락이 넘기지 못하므로 물음에 줄 허락이 없다.
///
/// | 앱에 온 요청 | 판정 |
/// |---|---|
/// | 작업공간 밖 경로의 편집 | 거절 |
/// | 앱 기록 파일의 편집 | 거절 |
/// | 경로를 읽을 수 없는 편집 | 묻기 |
/// | 앱 기록 파일을 언급한 명령 | 묻기 |
fn app_boundary(case: &Case) -> Option<Verdict> {
    let ask = |card, why: &str| Some(Verdict::Ask { card, policy: why.to_owned(), grant: Vec::new() });
    match case.act {
        Act::Edit(paths) if paths.is_empty() => ask(Card::Edit, "경로를 읽을 수 없는 편집이라 묻기"),
        Act::Edit(paths) => {
            if let Some(outside) = paths.iter().find(|path| !case.roots.iter().any(|root| path.starts_with(root))) {
                return Some(Verdict::Refuse { message: outside_message(outside, case) });
            }
            let kept = paths.iter().find(|path| case.kept.iter().any(|kept| path.starts_with(kept) || kept.starts_with(path)));
            kept.map(|kept| Verdict::Refuse { message: kept_message(kept) })
        }
        Act::Command(text) if mentions_kept(text, case.kept, case.cwd) => ask(Card::Command, "채팅 기록을 건드리기 전에 묻기"),
        _ => None,
    }
}

/// 물어보는 정도의 표(스펙 「01a — 권한」).
///
/// | 물어보는 정도 | 파일 고치기 | 명령 | 웹 · MCP |
/// |---|---|---|---|
/// | 매번 묻기 | 물음 | 물음 | 물음 |
/// | 편집 자동 | 허용 | 물음 | 물음 |
/// | 계획 | 물음(계획 모드라 보통 오지 않는다) | 물음 | 물음 |
/// | 묻지 않음 | 허용 | 허용 | 허용 |
///
/// 표 밖의 것 — 계획 넘어가기는 늘 묻는다(넘어갈 때는 사람이 정한다, 스토리 20). 앱 기능 도구는 늘 지나간다(스토리 10). 질문은 판정이
/// 받지 않는다 — 판정의 문이 판정 앞에서 곧바로 묻는다(`host::thread::gate`).
fn by_level(case: &Case) -> Verdict {
    let level = case.level;
    let asked = Verdict::Ask { card: case.act.card(), policy: level.name().to_owned(), grant: remembered(case.act) };
    let allowed = Verdict::Allow { reason: level.name().to_owned() };
    match case.act {
        Act::App => Verdict::Allow { reason: "앱 기능 도구".to_owned() },
        Act::Plan => asked,
        Act::Edit(_) if level == AskLevel::Edits => allowed,
        _ if level == AskLevel::Auto => allowed,
        _ => asked,
    }
}

/// 밖 편집의 글 — 등록된 Project 안이면 그 Project의 worktree를 세우는(Work에 없으면 붙일지 묻는) Thread 도구를 가리킨다. Work가
/// 없는 Thread면 붙일 Work가 없으므로 Work 만들기 제안부터다.
fn outside_message(path: &Path, case: &Case) -> String {
    let place = if case.in_work { "작업공간" } else { "채팅 폴더" };
    let head = format!("{place} 밖의 파일이라 고칠 수 없어요: {}", path.display());
    let start = crate::thread_tools::START_EDITING;
    match case.projects.iter().find(|(_, folder)| path.starts_with(folder)) {
        Some((project, _)) if case.in_work => {
            format!("{head} — `{project}` Project를 고치려면 먼저 채팅 도구 `{start}`(Project 고치기 시작)을 부르세요")
        }
        Some((project, _)) => format!(
            "{head} — `{project}` Project를 고치려면 먼저 채팅 도구 `{}`로 그 Project를 넣은 작업공간을 만든 뒤 `{start}`을 부르세요",
            crate::thread_tools::PROPOSE_WORK
        ),
        None if case.in_work => format!("{head} — 이 작업공간의 worktree · spec 폴더 안에서만 고쳐요"),
        None => format!("{head} — 작업공간이 없는 채팅은 이 채팅 폴더 안에서만 고쳐요"),
    }
}

/// Atelier만 쓰는 파일의 글 — Work 밖 거절과 같은 꼴이다.
fn kept_message(path: &Path) -> String {
    format!(
        "채팅 기록이라 고칠 수 없어요: {} — 채팅 폴더의 `thread.json` · `events.jsonl` · `.policy.json`은 Atelier만 써요",
        path.display()
    )
}

/// 명령 글에 Atelier만 쓰는 Thread 파일이 나오나(코드 리뷰 2차 A3) — 글자로만 본다. 경로 낱말의 마디에 `<Thread 폴더>/<그 파일>`이
/// 있거나(절대 경로 · `~/…` · `../threads/…`), 작업 폴더가 그 Thread 폴더이거나 글이 그 폴더를 가리키면(`cd …/<Thread> && …`) 그
/// 파일 이름으로 시작하는 낱말(`thread.json` · `./.policy.json` · `../events.jsonl`)이다. 변수 · 스크립트 속의 경로는 보지
/// 못한다(결정.md 「코드 리뷰 2차」 A3의 남은 위험).
fn mentions_kept(text: &str, kept: &[PathBuf], cwd: &Path) -> bool {
    let words: Vec<Vec<&str>> = text
        .split(|c: char| c.is_whitespace() || ";|&<>()'\"=`".contains(c))
        .map(|word| word.split('/').filter(|part| !part.is_empty()).collect())
        .collect();
    kept.iter().any(|path| {
        let (Some(dir), Some(name)) = (path.parent(), path.file_name().and_then(|name| name.to_str())) else { return false };
        let Some(folder) = dir.file_name().and_then(|folder| folder.to_str()) else { return false };
        let inside = dir == cwd || words.iter().flatten().any(|part| *part == folder);
        words.iter().any(|parts| {
            parts.windows(2).any(|pair| pair == [folder, name])
                || (inside && parts.iter().find(|part| !matches!(**part, "." | "..")) == Some(&name))
        })
    })
}

/// 허락의 이름 하나가 가리키는 것.
enum Rule<'a> {
    /// 편집 전부.
    Edits,
    /// 명령 전부.
    Commands,
    /// 그 명령들 — 맨 명령과 인자가 붙은 것.
    Named(&'static [&'static str]),
    /// 명령 패턴 `Bash(…)` 의 안쪽.
    Pattern(&'a str),
    /// 옮길 것이 없다(`schema` · 모르는 이름) — 아무것도 넘기지 않는다.
    Nothing,
}

/// 추상 이름이 가리키는 명령.
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

/// 「다시 묻지 않기」 허락의 걸림(3번 칸) — 편집은 편집 허락 하나로, 명령은 모든 조각이 저마다 허락 하나에 맞아야 넘어간다.
fn granted(grants: &[String], act: &Act) -> bool {
    match act {
        Act::Command(text) => every_piece(text, |piece| grants.iter().any(|name| covers_piece(name, piece))),
        Act::Edit(_) => grants.iter().any(|name| matches!(rule(name), Rule::Edits)),
        Act::Plan | Act::App | Act::Other => false,
    }
}

/// 허락의 걸림 — 명령 조각 하나가 그 규칙에 맞나.
fn covers_piece(name: &str, piece: &Piece) -> bool {
    match rule(name) {
        Rule::Commands => true,
        Rule::Named(commands) => passes(piece, |form| commands.iter().any(|command| starts(form, command))),
        Rule::Pattern(pattern) => passes(piece, |form| pattern_matches(pattern, form)),
        Rule::Edits | Rule::Nothing => false,
    }
}

/// 허락이 조각 하나를 보는 법 — 쓰인 그대로가 맞거나, git이 실행할 것을 바꾸는 전역 옵션이 없을 때 푼 글이 맞으면 넘긴다.
/// `git -C ../api status`는 `Bash(git status *)`로 넘어가고 `git -c core.pager=… status`는 넘어가지 않는다.
fn passes(piece: &Piece, fit: impl Fn(&str) -> bool) -> bool {
    fit(&piece.said) || (!piece.reconfigured && fit(&piece.run))
}

/// 「다시 묻지 않기」로 줄 허락(S18 · v1 티켓 24) — 같은 종류의 다음 요청을 3번 칸에서 넘기는 허락의 이름들. 편집이면 `edit`(편집
/// 전부 — 고칠 수 있는 자리 · 쓰기 자리는 그 앞 칸이 여전히 본다), 명령이면 조각마다 그 머리의 패턴 `Bash(<머리> *)`다. 계획
/// 넘어가기 · 그 밖의 도구는 허락의 이름이 없어 비었다.
///
/// **머리는 명령과 하위 명령, 두 낱말까지다**(`pnpm prisma migrate dev` → `pnpm prisma`, `git push origin` → `git push`, `python3 -c …`
/// → `python3`). 조각의 푼 글에서 읽는다 — git 전역 옵션을 건너 `git -C ../api status` → `git status`다(코드 리뷰 1차 A1).
/// 둘째 낱말은 하위 명령처럼 생겼을 때만 든다 — 영문자로 시작하고 영문자 · 숫자 · `-` · `_` · `:`뿐이다(`-c` · `script.py` ·
/// `../fe`는 인자다). 글자로만 가르므로 그렇게 생긴 인자는 하위 명령으로 읽힌다(`cd fe` → `cd fe`) — 허락이 좁아질 뿐 넓어지지
/// 않는다. 셋째 낱말부터는 하위 명령인지 인자인지 글자로 가를 수 없어 들지 않는다(`pnpm test refunds`).
///
/// **넘길 허락을 지을 수 없는 명령이면 비운다** — 그 선택지가 서지 않는다. git이 실행할 것을 바꾸는 전역 옵션(`-c …`)이 든 조각과
/// 볼 수 없는 조각(`$X …` · `… | sh` · `git $(…)`)이다. 앞의 것은 [`passes`]가 푼 글로 넘기지 않고, 뒤의 것은 `Bash($X *)` ·
/// `Bash(sh *)` · `Bash(git *)`가 무엇이든 넘긴다(코드 리뷰 2차 A1).
pub(crate) fn remembered(act: &Act) -> Vec<String> {
    match act {
        Act::Edit(_) => vec!["edit".to_owned()],
        Act::Command(text) => {
            let mut rules: Vec<String> = Vec::new();
            for piece in pieces(text) {
                let mut words = piece.words.iter();
                let Some(first) = words.next() else { continue };
                if piece.reconfigured || piece.opaque {
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
        Act::Plan | Act::App | Act::Other => Vec::new(),
    }
}

/// 하위 명령처럼 생긴 낱말인가(`test` · `prisma` · `pr` · `run:dev`).
fn subcommand(word: &str) -> bool {
    word.starts_with(|c: char| c.is_ascii_alphabetic()) && word.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':'))
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
    /// 허락도 없이 매번 묻는다.
    struct Given {
        act: Act,
        level: AskLevel,
        grants: Vec<String>,
        in_work: bool,
        roots: Vec<PathBuf>,
        kept: Vec<PathBuf>,
        cwd: PathBuf,
        projects: Vec<(String, PathBuf)>,
        seat: Option<String>,
    }

    impl Given {
        fn act(act: Act) -> Self {
            Self {
                act,
                level: AskLevel::Always,
                grants: Vec::new(),
                in_work: true,
                roots: vec!["/w/cart/trees/fe".into(), "/w/cart/spec".into(), "/t/20261023-101010".into()],
                kept: ["thread.json", "events.jsonl", ".policy.json"].map(|name| Path::new("/t/20261023-101010").join(name)).to_vec(),
                cwd: "/w/cart/trees/fe".into(),
                projects: vec![("fe".to_owned(), "/repos/fe".into())],
                seat: None,
            }
        }

        fn judged(&self) -> Verdict {
            judge(&Case {
                act: &self.act,
                level: self.level,
                grants: &self.grants,
                in_work: self.in_work,
                roots: &self.roots,
                kept: &self.kept,
                cwd: &self.cwd,
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

    /// 앱 경계 · 계획 넘어가기 · 그 밖의 도구의 물음 — 「다시 묻지 않기」가 없다.
    fn ask(card: Card, policy: &str) -> Verdict {
        Verdict::Ask { card, policy: policy.to_owned(), grant: Vec::new() }
    }

    /// 물어보는 정도가 물은 것 — 「다시 묻지 않기」로 줄 허락과 함께.
    fn asked_with(card: Card, policy: &str, grant: &[&str]) -> Verdict {
        Verdict::Ask { card, policy: policy.to_owned(), grant: names(grant) }
    }

    const BUSY: &str = "「장바구니」 채팅이 이 작업공간을 고치는 중이에요 — 끝난 뒤 다시 하세요";

    /// 물어보는 정도 넷 — 표를 도는 시험이 쓴다.
    const LEVELS: [AskLevel; 4] = [AskLevel::Always, AskLevel::Edits, AskLevel::Plan, AskLevel::Auto];

    /// Claude 변환기가 내는 도구 요지 — 웹이든 MCP든 종류와 도구 이름으로 온다.
    fn tool(kind: &str, name: &str) -> Act {
        Act::of(&serde_json::json!({"kind": kind, "title": name, "_meta": {"claudeCode": {"toolName": name}}}))
    }

    const APP_TOOL: &str = "mcp__atelier-thread__get_work";

    #[test]
    fn 물어보는_정도의_표대로_편집_명령_웹_mcp를_묻거나_허용하고_묻지_않음은_모두_허용한다() {
        use AskLevel::*;
        let inside = || edit("/w/cart/trees/fe/src/cart.ts");
        let push = || command("git push origin main");
        // (정도, 이름, 파일 편집을 허용하나, 명령을 허용하나, 웹 · MCP를 허용하나) — 스펙 「01a — 권한」의 표 그대로다.
        let table = [
            (Always, "매번 묻기", false, false, false),
            (Edits, "편집 자동", true, false, false),
            (Plan, "계획", false, false, false),
            (Auto, "묻지 않음", true, true, true),
        ];
        for (level, name, edits, commands, others) in table {
            let judged = |act: Act| {
                let mut given = Given::act(act);
                given.level = level;
                given.judged()
            };
            assert_eq!(judged(inside()), if edits { allow(name) } else { asked_with(Card::Edit, name, &["edit"]) }, "{name} 편집");
            let command_asked = asked_with(Card::Command, name, &["Bash(git push *)"]);
            assert_eq!(judged(push()), if commands { allow(name) } else { command_asked }, "{name} 명령");
            for (kind, tool_name) in [("fetch", "WebFetch"), ("fetch", "WebSearch"), ("other", "mcp__plain__search")] {
                let shown = if others { allow(name) } else { ask(Card::Command, name) };
                assert_eq!(judged(tool(kind, tool_name)), shown, "{name} {tool_name}");
            }
            assert_eq!(judged(Act::Plan), ask(Card::Plan, name), "{name} 계획 넘어가기는 늘 묻는다");
        }
    }

    #[test]
    fn 앱_기능_도구는_어떤_모드에서도_승인_카드_없이_지나가고_다른_mcp는_앱_기능_도구가_아니다() {
        for level in LEVELS {
            let mut given = Given::act(tool("other", APP_TOOL));
            given.level = level;
            assert_eq!(given.judged(), allow("앱 기능 도구"), "{level:?}");
        }
        for name in ["mcp__atelier__get_work", "mcp__atelier-thread-2__get_work", "mcp__plain__atelier-thread__get_work", "mcp__atelier-thread"] {
            assert_eq!(tool("other", name), Act::Other, "{name}");
        }
        // Task의 제목은 맡긴 일의 설명이다 — 모델이 쓴 글이 앱 기능 도구를 흉내 내도 도구 이름으로 가른다.
        let task = serde_json::json!({"kind": "think", "title": APP_TOOL, "_meta": {"claudeCode": {"toolName": "Task"}}});
        assert_eq!(Act::of(&task), Act::Other);
        let edit_named = serde_json::json!({"kind": "edit", "_meta": {"claudeCode": {"toolName": APP_TOOL}}});
        assert_eq!(Act::of(&edit_named), Act::Edit(Vec::new()), "편집 종류는 도구 이름과 상관없이 편집이다");
    }

    #[test]
    fn 앱_경계는_어떤_모드에서도_허락이_있어도_쓰기_자리보다_먼저_판정한다() {
        let judged = |act: Act, level: AskLevel| {
            let mut given = Given::act(act);
            given.level = level;
            given.grants = names(&["edit", "Bash(cat *)"]);
            given.seat = Some(BUSY.to_owned());
            given.cwd = "/t/20261023-101010".into();
            given.judged()
        };
        for level in LEVELS {
            assert!(matches!(judged(edit("/etc/hosts"), level), Verdict::Refuse { message } if message.contains("밖의 파일")), "{level:?} 밖 편집");
            let kept = judged(edit("/t/20261023-101010/events.jsonl"), level);
            assert!(matches!(kept, Verdict::Refuse { message } if message.starts_with("채팅 기록이라")), "{level:?} 기록 파일 편집");
            assert_eq!(
                judged(Act::Edit(Vec::new()), level),
                ask(Card::Edit, "경로를 읽을 수 없는 편집이라 묻기"),
                "{level:?} 경로를 읽을 수 없는 편집 — 허락이 넘기지 못해 「다시 묻지 않기」가 서지 않는다"
            );
            assert_eq!(
                judged(command("cat events.jsonl"), level),
                ask(Card::Command, "채팅 기록을 건드리기 전에 묻기"),
                "{level:?} 기록 파일을 언급한 명령"
            );
        }
    }

    #[test]
    fn 판정은_앱_경계_쓰기_자리_허락_물어보는_정도의_차례로_처음_걸린_것을_낸다() {
        // 모든 칸에 걸리는 편집 하나에서 앞 칸을 하나씩 걷어 낸다 — 걷을 때마다 다음 칸이 답한다.
        let mut given = Given::act(edit("/repos/fe/src/cart.ts"));
        given.seat = Some(BUSY.to_owned());
        given.grants = names(&["edit"]);
        given.level = AskLevel::Auto;
        assert_eq!(
            given.judged(),
            refuse(
                "작업공간 밖의 파일이라 고칠 수 없어요: /repos/fe/src/cart.ts — `fe` Project를 고치려면 먼저 채팅 도구 \
                 `start_editing`(Project 고치기 시작)을 부르세요"
            ),
            "1. 앱 경계"
        );

        given.act = edit("/w/cart/trees/fe/src/cart.ts");
        assert_eq!(given.judged(), refuse(BUSY), "2. 쓰기 자리");

        given.seat = None;
        assert_eq!(given.judged(), allow("이 Work에서는 다시 묻지 않기"), "3. 허락");

        given.grants.clear();
        assert_eq!(given.judged(), allow("묻지 않음"), "4. 물어보는 정도");
    }

    /// 그 명령을 물을 때 내미는 허락.
    fn grant_of(text: &str) -> Vec<String> {
        let Verdict::Ask { grant, .. } = Given::act(command(text)).judged() else { panic!("{text:?}는 묻는다") };
        grant
    }

    #[test]
    fn 허락의_이름은_편집_명령_push_merge와_명령_패턴이고_명령은_모든_조각이_맞아야_넘어간다() {
        let passes = |name: &str, act: Act| {
            let mut given = Given::act(act);
            given.grants = names(&[name]);
            matches!(given.judged(), Verdict::Allow { .. })
        };
        // (이름, 넘어가는 것들, 넘어가지 않는 것들)
        let table: [(&str, Vec<Act>, Vec<Act>); 7] = [
            ("edit", vec![edit("/w/cart/spec/a.md")], vec![command("rm a"), Act::Other, Act::Plan]),
            ("shell", vec![command("ls"), command("git push")], vec![edit("/w/cart/spec/a.md"), Act::Other]),
            (
                "push",
                vec![command("git push"), command("git push origin main"), command("FOO=1 git push -f")],
                vec![command("git pushy"), command("git status"), command("cd fe && git push"), edit("/w/cart/spec/a.md")],
            ),
            (
                "merge",
                vec![command("gh pr merge 12 --squash"), command("git merge main"), command("gh pr -R o/r merge 1")],
                vec![command("gh pr view 12"), command("git merge-base a b"), command("git fetch; git merge origin/main")],
            ),
            (
                "Bash(*prisma migrate *)",
                vec![command("pnpm prisma migrate dev --name x"), command("prisma migrate deploy")],
                vec![command("prisma generate"), command("pnpm test"), command("cd api | npx prisma migrate")],
            ),
            ("Bash(pnpm test:*)", vec![command("pnpm test"), command("pnpm test refunds")], vec![command("pnpm testing")]),
            ("schema", vec![], vec![command("pnpm prisma migrate dev"), edit("/w/cart/spec/a.md")]),
        ];
        for (name, passed, held) in table {
            for act in passed {
                assert!(passes(name, act.clone()), "{name}가 {act:?}를 넘긴다");
            }
            for act in held {
                assert!(!passes(name, act.clone()), "{name}가 {act:?}를 넘기지 않는다");
            }
        }

        let judged = |act: Act, grants: &[&str]| {
            let mut given = Given::act(act);
            given.grants = names(grants);
            given.judged()
        };
        let granted = allow("이 Work에서는 다시 묻지 않기");
        assert_eq!(judged(command("pnpm test refunds"), &["Bash(pnpm test *)"]), granted);
        let both = asked_with(Card::Command, "매번 묻기", &["Bash(pnpm test *)", "Bash(git push *)"]);
        assert_eq!(judged(command("pnpm test && git push"), &["Bash(pnpm test *)"]), both);
        assert_eq!(judged(edit("/w/cart/spec/a.md"), &["edit"]), granted);
        let edit_asked = asked_with(Card::Edit, "매번 묻기", &["edit"]);
        assert_eq!(judged(edit("/w/cart/spec/a.md"), &["shell"]), edit_asked, "명령 허락은 편집을 넘기지 않는다");
    }

    #[test]
    fn 허락은_git_전역_옵션을_건너_하위_명령을_읽고_괄호_명령_치환_sh_c의_안쪽_명령도_조각으로_본다() {
        // 코드 리뷰 1차 A1 — 앞머리만 보면 안쪽의 `git push`가 바깥 명령의 허락으로 지나간다. 안쪽 조각은 저마다 허락이 있어야 한다.
        let push = "Bash(git push *)".to_owned();
        for text in [
            "git -C /w/cart/trees/fe push origin main",
            "git --no-pager push",
            "git --git-dir=/w/.git --work-tree /w push -f",
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
        ] {
            assert!(grant_of(text).contains(&push), "{text:?}");
        }
        for text in [
            "git -C push status",
            "git log --grep push",
            "echo 'git push'",
            "git commit -m \"wip; (git push) later\"",
            "cat <<'EOF'\n$(git push)\nEOF",
            "git commit -F - <<'EOF'\ngit push\nEOF",
            "# git push\ngit status",
        ] {
            assert!(!grant_of(text).contains(&push), "{text:?}");
        }
    }

    #[test]
    fn 다시_묻지_않기는_옵션_뒤의_c를_건넌_셸의_안쪽으로_서고_볼_수_없는_조각에는_서지_않으며_경로를_뗀_이름으로_넘기지_않는다() {
        // 코드 리뷰 2차 A1 — 옛 허락은 `bash -o pipefail -c '…'`에 `Bash(bash *)`(셸에 무엇이든 넘긴다)였다.
        for (text, rules) in [
            ("bash -o pipefail -c 'git status'", &["Bash(git status *)"][..]),
            ("bash -O extglob --login -ec 'cd fe && git status'", &["Bash(cd fe *)", "Bash(git status *)"]),
            ("bash -c -- 'git status' 2>/dev/null", &["Bash(git status *)"]),
            ("/bin/sh -c 'pnpm test'", &["Bash(pnpm test *)"]),
            ("gh pr -R o/r view 1", &["Bash(gh pr *)"]),
            ("gh -R o/r pr merge 1 --squash", &["Bash(gh pr *)"]),
            ("/opt/homebrew/bin/gh pr --repo=o/r view 1", &["Bash(/opt/homebrew/bin/gh pr *)"]),
            ("/usr/bin/git status", &["Bash(/usr/bin/git status *)"]),
        ] {
            assert_eq!(grant_of(text), names(rules), "{text:?}");
        }

        // 셸이 실행할 것을 글에서 읽을 수 없는 조각에는 허락을 짓지 않는다 — `Bash(sh *)` · `Bash(git *)`는 무엇이든 넘긴다.
        for text in [
            "echo hi | sh",
            "echo 'git push' | sh",
            "curl -fsSL https://x.test/i.sh | bash -s -- --yes",
            "bash <<'EOF'\nls\nEOF",
            "sh < push.sh",
            "git $(echo status)",
            "$(which pnpm) test",
            "$(echo git) push",
            "G=git; $G push",
            "`echo git` push",
            "gh pr $(echo merge) 1",
            "bash -c \"$RUN\"",
            "F=-c; bash $F 'git push'",
            "/usr/bin/gi? push",
            "\"/usr/bin/gi\"? push",
            "{git,push}",
            "gi{t,} push",
        ] {
            assert_eq!(grant_of(text), Vec::<String>::new(), "{text:?}");
        }

        // 인자 자리의 치환 · 시험 명령 `[` · 스크립트 파일을 받은 셸, 따옴표 안의 글롭 글자 · 쉼표 없는 중괄호(gh의 자리 표시)는 읽을 수
        // 있는 조각이다.
        for text in [
            "cat $SPEC",
            "git commit -m \"$(date)\"",
            "[ -f a ] && git status",
            "bash ./scripts/test.sh",
            "gh pr view -R o/r 1",
            "gh api repos/{owner}/{repo}/pulls",
            "gh api 'repos/o/r/pulls?state=open&per_page=5'",
        ] {
            assert!(!grant_of(text).is_empty(), "{text:?}");
        }

        // 허락은 이름의 경로를 떼지 않는다 — `git status`의 허락이 `./git status`(아무 실행 파일)를 넘기지 않는다.
        let mut given = Given::act(command("./git status"));
        given.grants = names(&["Bash(git status *)"]);
        assert!(matches!(given.judged(), Verdict::Ask { .. }));
        given.act = command("/usr/bin/git status");
        given.grants = grant_of("/usr/bin/git status");
        assert_eq!(given.judged(), allow("이 Work에서는 다시 묻지 않기"));
    }

    #[test]
    fn 다시_묻지_않기는_물어보는_정도가_물은_편집_명령에만_서고_그_허락이_같은_종류의_다음_요청을_넘긴다() {
        let asked = |act: Act| Given::act(act).judged();
        // 물어보는 정도가 물은 것 — 편집은 편집 전부, 명령은 조각마다 머리(명령과 하위 명령, 두 낱말까지)의 패턴이다.
        let table: [(Act, &[&str]); 5] = [
            (edit("/w/cart/trees/fe/src/cart.ts"), &["edit"]),
            (command("pnpm prisma migrate dev --name partial_refund"), &["Bash(pnpm prisma *)"]),
            (command("python3 -c \"import time; print(1)\" && echo 'a | b'"), &["Bash(python3 *)", "Bash(echo *)"]),
            (command("cd ../fe && pnpm test refunds; cd .."), &["Bash(cd *)", "Bash(pnpm test *)"]),
            (command("FOO=1 ./scripts/run.sh --fast"), &["Bash(./scripts/run.sh *)"]),
        ];
        for (act, rules) in table {
            let Verdict::Ask { grant, .. } = asked(act.clone()) else { panic!("{act:?}는 묻는다") };
            assert_eq!(grant, names(rules), "{act:?}");
            // 그 허락을 주면 같은 요청이 3번 칸에서 넘어간다.
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

        // 계획 넘어가기 · 그 밖의 도구에는 없다 — 허락의 이름이 없다.
        assert_eq!(asked(Act::Plan), ask(Card::Plan, "매번 묻기"));
        assert_eq!(asked(Act::Other), ask(Card::Command, "매번 묻기"));
    }

    #[test]
    fn 다시_묻지_않기의_허락은_git_전역_옵션_heredoc_본문_재지정_괄호_변수_놓기를_명령_머리로_읽지_않는다() {
        // 코드 리뷰 1차 A1 · 끝-점검-PR4 (d) — 옛 허락은 `Bash(git *)` · `Bash(EOF *)` · `Bash(1 *)` · `Bash((cd *)` · `Bash(SPEC=… *)`였다.
        let table: [(&str, &[&str]); 9] = [
            ("git -C /w/cart/trees/fe status --short", &["Bash(git status *)"]),
            ("git --no-pager log -3", &["Bash(git log *)"]),
            ("git commit -F - <<'EOF'\n부분 환불 (#31)\n\n홍길동\nEOF", &["Bash(git commit *)"]),
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
    }

    #[test]
    fn 고칠_수_있는_자리_밖의_편집은_거절하고_등록된_project_안이면_고치기_시작_도구를_가리킨다() {
        let judged = |path: &str, in_work: bool| {
            let mut given = Given::act(Act::Edit(vec!["/w/cart/spec/a.md".into(), path.into()]));
            given.in_work = in_work;
            given.level = AskLevel::Auto;
            given.judged()
        };
        assert_eq!(judged("/t/20261023-101010/notes.md", true), allow("묻지 않음"), "Thread 폴더도 고칠 수 있는 자리다");
        assert_eq!(judged("/w/cart/trees/fe/a.ts", true), allow("묻지 않음"));
        assert_eq!(
            judged("/w/cart/trees/fe-old/a.ts", true),
            refuse("작업공간 밖의 파일이라 고칠 수 없어요: /w/cart/trees/fe-old/a.ts — 이 작업공간의 worktree · spec 폴더 안에서만 고쳐요"),
            "경로는 낱말(폴더) 단위로 견준다 — 경로 하나라도 밖이면 거절이다"
        );
        assert_eq!(
            judged("/etc/hosts", false),
            refuse("채팅 폴더 밖의 파일이라 고칠 수 없어요: /etc/hosts — 작업공간이 없는 채팅은 이 채팅 폴더 안에서만 고쳐요")
        );
        assert_eq!(
            judged("/repos/fe/a.ts", false),
            refuse(
                "채팅 폴더 밖의 파일이라 고칠 수 없어요: /repos/fe/a.ts — `fe` Project를 고치려면 먼저 채팅 도구 `propose_work`로 \
                 그 Project를 넣은 작업공간을 만든 뒤 `start_editing`을 부르세요"
            )
        );
    }

    #[test]
    fn thread_폴더의_기록_파일은_고칠_수_있는_자리_안이어도_묻지_않고_거절한다() {
        // 코드 리뷰 1차 A2 — Thread 폴더는 Atelier만 쓴다(S7 · §19). 묻지 않음 · 편집 허락이 있어도 거절이다.
        let judged = |path: &str| {
            let mut given = Given::act(edit(path));
            given.level = AskLevel::Auto;
            given.grants = names(&["edit"]);
            given.in_work = false;
            given.judged()
        };
        let refused = |path: &str| {
            refuse(&format!(
                "채팅 기록이라 고칠 수 없어요: {path} — 채팅 폴더의 `thread.json` · `events.jsonl` · `.policy.json`은 Atelier만 써요"
            ))
        };
        for path in [
            "/t/20261023-101010/thread.json",
            "/t/20261023-101010/events.jsonl",
            "/t/20261023-101010/.policy.json",
            "/t/20261023-101010",
        ] {
            assert_eq!(judged(path), refused(path), "{path}");
        }
        assert_eq!(judged("/t/20261023-101010/notes.md"), allow("이 Thread에서는 다시 묻지 않기"), "나머지 Thread 폴더는 그대로다");
        assert_eq!(judged("/t/20261023-101010/thread.json.md"), allow("이 Thread에서는 다시 묻지 않기"), "경로는 마디 단위로 견준다");
        assert_eq!(judged("/t/20261023-101010/agents/a.md"), allow("이 Thread에서는 다시 묻지 않기"), "`agents/`는 앱의 자리가 아니다");
    }

    #[test]
    fn 명령_글에_그_thread_기록이_나오면_묻지_않음이어도_허락이_있어도_묻는다() {
        // 코드 리뷰 2차 A3 — 편집 도구는 Thread 기록을 거절하지만(1차 A2) 명령은 그 자리를 보지 않았다. `echo > thread.json` ·
        // `sed -i … .policy.json`이 「묻지 않음」에서 묻지 않고 지났다. 글자로만 본다.
        let judged = |text: &str, cwd: &str| {
            let mut given = Given::act(command(text));
            given.level = AskLevel::Auto;
            given.grants = names(&["shell"]);
            given.cwd = cwd.into();
            given.judged()
        };
        let (tree, thread) = ("/w/cart/trees/fe", "/t/20261023-101010");
        for (text, cwd) in [
            ("echo '{}' > /t/20261023-101010/thread.json", tree),
            ("sed -i '' 's/push//' ~/.atelier/threads/20261023-101010/.policy.json", tree),
            ("rm ../../threads/20261023-101010/events.jsonl", tree),
            ("cd ~/.atelier/threads/20261023-101010 && echo '{}' > .policy.json", tree),
            ("echo '{}' > thread.json", thread),
            ("rm -f events.jsonl", thread),
            ("cp x ./.policy.json", thread),
            ("python3 x.py --out=../events.jsonl", thread),
        ] {
            assert_eq!(judged(text, cwd), ask(Card::Command, "채팅 기록을 건드리기 전에 묻기"), "{text:?} ({cwd})");
        }
        // worktree의 같은 이름 · Thread 폴더의 다른 파일은 그대로다.
        for (text, cwd) in [
            ("cat src/agents/a.ts", tree),
            ("echo x > thread.json", tree),
            ("ls src/agents", thread),
            ("echo x > notes.md", thread),
            ("cat /t/20261023-101010/notes.md", tree),
        ] {
            assert_eq!(judged(text, cwd), allow("이 Work에서는 다시 묻지 않기"), "{text:?} ({cwd})");
        }
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
    fn 물어보는_정도는_저장_글자로_읽고_모르면_매번_묻기이며_계획일_때만_claude를_계획_모드로_띄운다() {
        for level in LEVELS {
            assert_eq!(AskLevel::read(Some(level.as_str())), level);
            assert_eq!(serde_json::to_value(level).unwrap(), level.as_str(), "저장 글자와 직렬화가 같다");
        }
        assert_eq!(AskLevel::read(None), AskLevel::Always);
        assert_eq!(AskLevel::read(Some("bypass")), AskLevel::Always);
        let modes: Vec<&str> = LEVELS.map(AskLevel::claude_mode).to_vec();
        assert_eq!(modes, ["default", "default", "plan", "default"]);
    }
}
