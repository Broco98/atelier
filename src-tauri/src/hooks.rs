//! 에이전트 훅 설치 — 사용자의 claude·codex 설정에 우리 훅을 **병합해** 넣고 걷어낸다. 이미 깐 사람의 훅은 앱이 뜰 때 지금
//! 목록으로 맞춘다(`sync`, 프로세스 결정 15 · 티켓 21).

use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};

/// 에이전트의 이름. **훅 명령줄에 박히는 그 글자이자 화면·상태 파일의 `agent`다** —
/// 훅 스크립트가 argv로 받아 상태 파일에 그대로 적고, 프런트의 어댑터 표(`agents/index.ts`)가
/// 같은 글자로 고른다. 한때 명령을 짓는 자리와 `AGENTS` 표가 이 글자를 각각 적고 있었다:
/// 세 벌이면 한쪽만 고치는 날 **훅은 정상으로 돌고 파일도 정상으로 쓰이는데 어댑터만 못
/// 알아본다**(어느 층도 안 빨개지는 그 모양이다).
pub const CLAUDE: &str = "claude";
/// 위와 같다.
pub const CODEX: &str = "codex";

/// Claude에 거는 이벤트 — **전체 목록 하나**다. 구현 결정 8의 다섯에 프로세스 결정 14가 여섯을 더했다: 도구 셋
/// (`PreToolUse` · `PostToolUse` · `PostToolUseFailure`), 오류로 끝난 턴(`StopFailure`), 서브에이전트 둘.
///
/// **문자열 리터럴 배열 그대로 둔다.** 프런트 검사(`shell-attention.test.ts`의 「훅이 나르는 어휘」)가 이 선언 하나를
/// 정규식으로 읽어 어댑터의 갈래 이름과 양방향으로 견준다 — 두 목록을 이어 붙여 만들면 그 정규식이 못 뽑고, 배열
/// 안에 따옴표 든 주석을 두면 그것까지 이름으로 읽힌다. `async` 대상은 그래서 아래 다른 이름의 상수로 따로 둔다.
pub const CLAUDE_EVENTS: &[&str] = &[
    "UserPromptSubmit",
    "PermissionRequest",
    "Elicitation",
    "Stop",
    "SessionEnd",
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "StopFailure",
    "SubagentStart",
    "SubagentStop",
];

/// 그중 **`async: true`로 거는 것** — 도구 사건 셋(프로세스 결정 14 · S25). 도구마다 두 번 불리는 훅이 동기면
/// claude가 그때마다 처리기가 끝나길 기다린다. 비동기라 순서가 뒤집힐 수 있는 것은 처리기의 순서 가드가 받는다
/// (S27 — 늦게 끝난 `PostToolUse`가 `Stop`을 못 덮는다).
///
/// **알려진 경계**: 비동기 `PreToolUse`의 처리기가 곧이어 오는 `PermissionRequest`의 처리기보다 **늦게** 뜨면(티켓 18
/// 실측으로 둘 사이가 1.8~14.8ms) 가드가 `PreToolUse`를 새 사건으로 보고 기다림을 덮는다 — 그 승인 요청은 띠에도
/// 알림에도 안 선다. 결정 14 그대로 두고 구현 기록 「## 20」에 적었다.
const CLAUDE_ASYNC_EVENTS: &[&str] = &["PreToolUse", "PostToolUse", "PostToolUseFailure"];

/// 설치 목록의 **판**(프로세스 스펙 P5 · 티켓 21). 우리 명령줄의 맨 끝 낱말로 싣는다(`list-2`).
///
/// **두 빌드가 같은 사용자 설정을 저마다 「지금 목록」으로 맞춘다** — 설치본과 `pnpm tauri dev`는 같은 홈을 보고, 둘 다 앱이 뜰 때
/// 맞춘다(`sync`). 목록이 다르면 켤 때마다 서로의 것으로 되쓰고 토스트가 선다. 그래서 파일에 적힌 판이 이 빌드의 것보다
/// 새로우면 맞추지 않고(설치 버튼도 되돌리지 않는다) 「전부」로 읽는다(`Installed`).
///
/// **목록을 바꾸는 장은 이 판을 올린다** — `CLAUDE_EVENTS` · `CODEX_EVENTS` · `CLAUDE_ASYNC_EVENTS` · 등록 모양 어느 것이든. 판이
/// 그대로면 위의 되쓰기가 그대로 난다. 검사 `the_installer_lists_are_decision_fourteen`이 목록과 판을 함께 못박는다.
pub const LIST_VERSION: u32 = 2;

/// 판을 싣기 전의 명령줄 — 옛 python 처리기를 부르던 셸 꼴(구현 결정 8의 다섯, 프로세스 결정 14가 더한 여섯) — 은 이 판으로
/// 읽는다.
const UNLISTED_VERSION: u32 = 1;

/// 판을 싣는 낱말의 머리. 처리기는 셋째 인자부터 안 읽어(구현 기록 19절) 이 낱말이 붙어도 그대로 돈다 — 검사
/// `the_installed_lines_run_the_handler`가 적어 넣은 줄을 에이전트처럼 실제로 돌려 본다.
const LIST_MARK: &str = "list-";

/// 이 빌드의 판 낱말 — `list-2`.
fn list_word() -> String {
    format!("{LIST_MARK}{LIST_VERSION}")
}

/// 우리 명령 하나에 실린 판 — 맨 끝 낱말이 `list-<수>`면 그 수, 아니면 판을 싣기 전의 것이다. 맨 끝만 보는 것은 판이 늘
/// 거기 붙기 때문이다 — 앞쪽의 경로에 같은 글자가 섞여도 판으로 안 읽힌다.
fn version_in(last_word: Option<&str>) -> u32 {
    last_word
        .and_then(|word| word.strip_prefix(LIST_MARK))
        .and_then(|number| number.parse().ok())
        .unwrap_or(UNLISTED_VERSION)
}

/// 셸 꼴 명령줄 한 줄. 스크립트 경로를 따옴표로 감싸는 것은 홈 경로에 공백이 있을 수 있어서다. codex의 줄이 이 꼴이고
/// (`codex_command`), 판을 싣기 전 옛 python 처리기의 줄이 두 에이전트 모두 이 꼴이었다.
pub fn command_line(script: &Path, agent: &str, event: &str) -> String {
    let quoted = script.to_string_lossy().replace('\'', r"'\''");
    format!("'{quoted}' {agent} {event}")
}

/// 우리 훅을 알아보는 표식. **명령 문자열로 식별한다**(구현 결정 8) — 앱이 따로
/// 기억하는 것이 없으므로, 파일에 적힌 글자가 유일한 근거다.
///
/// **옛 이름과 새 이름을 둘 다 본다**(프로세스 스펙 S28). 옛 python 처리기를 부르는 줄도 우리 것이라야 갱신이 그것을 걷고 새
/// 줄로 갈아 끼운다 — 못 알아보면 옛 줄 곁에 새 줄이 붙어 사건마다 처리기가 두 번 돈다. `args` 꼴의 claude 훅도 `command` 칸이
/// 처리기 경로라 같은 잣대로 알아본다.
fn is_ours(command: &str) -> bool {
    command.contains(crate::shells::SCRIPT_NAME) || command.contains(crate::shells::HANDLER_NAME)
}

/// 우리가 claude에 거는 훅 하나 — **처리기를 셸 없이 곧바로 부르는 `args` 꼴**이다(구현 기록 19절). claude는 `args`가 있으면
/// `command`를 실행 파일로 띄우고, 없으면 `/bin/sh -c`로 훅마다 셸 한 벌을 더한다. 셸이 없으니 경로를 따옴표로 감싸지 않는다 —
/// 감싸면 따옴표가 글자 그대로 파일 이름이 된다. 인자는 에이전트 · 사건 · 목록의 판이다. 도구 사건이면 `async: true`가 붙는다
/// (`CLAUDE_ASYNC_EVENTS`); 나머지에는 그 칸이 아예 없다.
fn claude_hook(handler: &Path, event: &str) -> Value {
    let mut hook = json!({
        "type": "command",
        "command": handler.to_string_lossy(),
        "args": [CLAUDE, event, list_word()],
    });
    if CLAUDE_ASYNC_EVENTS.contains(&event) {
        hook["async"] = Value::Bool(true);
    }
    hook
}

/// 우리가 이벤트 배열에 넣는 항목 하나 — matcher 없는 그룹 안에 우리 훅 하나. **matcher가 없어야 모든 도구가
/// 온다** — `AskUserQuestion`도 `PreToolUse`로 와서 기다림이 된다.
fn claude_group(handler: &Path, event: &str) -> Value {
    json!({ "hooks": [claude_hook(handler, event)] })
}

/// 이 그룹이 우리 것인가 — 안쪽 훅 중 하나라도 우리 명령이면 그렇다.
fn claude_group_is_ours(group: &Value) -> bool {
    group["hooks"]
        .as_array()
        .is_some_and(|inner| inner.iter().any(|h| h["command"].as_str().is_some_and(is_ours)))
}

/// 이 claude 설정에 앉은 우리 훅 전부 — `(이벤트, 훅)`. **목록 밖 이벤트의 것도 든다** — 판정도 갱신도 그것을 본다(지난 판이
/// 깔고 이 판이 뺀 이벤트의 줄은 안 걷으면 영영 돈다).
fn claude_ours(hooks: &Map<String, Value>) -> Vec<(&str, &Value)> {
    hooks
        .iter()
        .filter_map(|(event, list)| list.as_array().map(|groups| (event.as_str(), groups)))
        .flat_map(|(event, groups)| {
            groups
                .iter()
                .filter_map(|group| group.get("hooks").and_then(Value::as_array))
                .flatten()
                .filter(|hook| hook["command"].as_str().is_some_and(is_ours))
                .map(move |hook| (event, hook))
        })
        .collect()
}

/// claude 훅 하나에 실린 판. `args` 꼴이면 마지막 인자, 셸 꼴이면 명령줄의 마지막 낱말이다.
fn claude_version(hook: &Value) -> u32 {
    match hook.get("args").and_then(Value::as_array) {
        Some(args) => version_in(args.last().and_then(Value::as_str)),
        None => version_in(hook["command"].as_str().and_then(|command| command.split_whitespace().last())),
    }
}

/// 우리 줄 가운데 **이 빌드보다 새로운 판**이 있는가(P5). 있으면 그 파일은 새 빌드가 맞춘 것이다.
fn claude_is_newer(ours: &[(&str, &Value)]) -> bool {
    ours.iter().any(|(_, hook)| claude_version(hook) > LIST_VERSION)
}

/// 이 이벤트가 **지금 모양 그대로**인가 — 우리 그룹이 꼭 하나이고 그것이 지금 넣을 그룹과 같다. 남의 그룹은 몇 개가 어디에
/// 있든 상관없다. 같음은 값으로 잰다 — 사람이 키 차례를 바꿔 적어 둔 것은 같은 줄이다.
fn claude_event_is_current(list: &[Value], want: &Value) -> bool {
    let mut ours = list.iter().filter(|group| claude_group_is_ours(group));
    ours.next() == Some(want) && ours.next().is_none()
}

/// 이벤트 하나의 배열에서 우리 훅을 걷는다 — 남의 훅과 그 차례는 그대로다. 걷은 것이 있으면 참이다.
///
/// **이번에 비운 그룹만** 함께 걷는다 — 「지금 비어 있는 것」이 아니다. 사람이 손으로 적어 둔 빈 그룹은 우리가 만든 껍데기가
/// 아니라 그 사람의 내용이라, 걷으면 「우리 항목만 걷어낸다」가 깨진다.
fn strip_claude_ours(list: &mut Vec<Value>) -> bool {
    let mut removed = false;
    // 이번에 **비운** 그룹의 자리. 처음부터 비어 있던 그룹은 여기 안 든다.
    let mut emptied: Vec<usize> = Vec::new();
    for (at, group) in list.iter_mut().enumerate() {
        // **`group["hooks"]`(IndexMut)를 안 쓴다.** serde_json의 그 구현은 없는 키를
        // `null`로 심고(남의 그룹에 우리가 키를 남긴다), 객체가 아닌 원소에서는
        // **패닉한다** — 거부가 아니라 폭발이라, 사람이 보는 것은 「제거를 눌렀더니
        // 앱이 이상해졌다」이고 그 명령의 프로미스가 안 끝나 버튼 둘이 잠긴다.
        let Some(inner) = group.get_mut("hooks").and_then(Value::as_array_mut) else {
            continue;
        };
        let before = inner.len();
        inner.retain(|h| !h["command"].as_str().is_some_and(is_ours));
        if inner.len() < before {
            removed = true;
            if inner.is_empty() {
                emptied.push(at);
            }
        }
    }
    let mut at = 0;
    list.retain(|_| {
        let keep = !emptied.contains(&at);
        at += 1;
        keep
    });
    removed
}

/// 사용자의 `~/.claude/settings.json` 내용을 **지금 목록으로 맞춘** 새 내용 — 처음 까는 것도, 이미 깐 것을 고치는 것(갱신
/// 모드, 프로세스 결정 15)도 이 함수다. 설치 버튼과 앱이 뜰 때의 맞춤(`sync`)이 같은 병합을 쓴다.
///
/// **순수 함수다** — 파일 내용 문자열을 받아 새 내용 문자열을 낸다. 디스크를 아는 것은
/// 이 아래 쓰기 층뿐이라, 「남의 훅이 살아남는가」를 실물 홈 없이 표로 잴 수 있다.
///
/// **파싱 후 재직렬화하되 우리 키 밖은 그대로 싣는다**(`settings.rs`의 왕복 보존이 선례).
/// 텍스트로 끼워 넣지 않는 이유는 JSON에 「파일 끝에 덧붙인다」가 없어서다.
///
/// 이벤트마다 우리 그룹이 지금 모양 그대로 하나면 그 자리에 둔다. 아니면 **우리 훅을 걷고 지금 그룹을 그 이벤트의 맨 뒤에 다시
/// 넣는다** — 옛 python 줄 · `async`가 어긋난 줄 · 판이 옛 줄 · 겹친 줄이 모두 이 길로 지금 줄 하나가 된다. 목록 밖 이벤트에
/// 앉은 우리 줄은 걷는다. 남의 항목과 그 차례는 그대로다. 옛 「우리 것이 있으면 건너뛴다」는 여기서 끝났다 — 그 규칙으로는
/// 이미 깐 사람의 명령줄도 `async`도 고칠 길이 없었다.
///
/// **바뀐 것이 없으면 원문을 글자 그대로 돌려준다** — 그래야 `apply`가 아무것도 안 쓴다. 다시 적으면 사람이 4칸 들여쓰기로
/// 둔 파일이 우리 것이 다 지금 모양인데도 통째로 다시 쓰이고 `.bak`이 덮인다(`unmerge_claude`의 같은 규칙).
///
/// **파일에 이 빌드보다 새로운 판의 줄이 있으면 손대지 않는다**(P5) — 새 빌드가 맞춘 것을 옛 목록으로 되돌리지 않는다.
pub fn merge_claude(source: &str, handler: &Path) -> Result<String, String> {
    let mut root = parse_claude(source)?;
    if root.get("hooks").and_then(Value::as_object).is_some_and(|hooks| claude_is_newer(&claude_ours(hooks))) {
        return Ok(source.to_string());
    }

    let hooks = root.entry("hooks").or_insert_with(|| json!({}));
    let hooks = hooks
        .as_object_mut()
        .ok_or_else(|| "`hooks`가 객체가 아닙니다 — 손대지 않았습니다".to_string())?;
    let mut changed = false;

    // 목록 밖 이벤트의 우리 줄을 걷는다. 그 이벤트를 우리가 비웠으면 키째 걷는다 — 차례를 지키는 `shift_remove`다(`remove`는
    // 끝 키를 그 자리로 옮겨 사람의 이벤트 차례를 흩는다).
    let mut emptied_events: Vec<String> = Vec::new();
    for (event, list) in hooks.iter_mut() {
        if CLAUDE_EVENTS.contains(&event.as_str()) {
            continue;
        }
        let Some(list) = list.as_array_mut() else { continue };
        if strip_claude_ours(list) {
            changed = true;
            if list.is_empty() {
                emptied_events.push(event.clone());
            }
        }
    }
    for event in &emptied_events {
        hooks.shift_remove(event);
    }

    for event in CLAUDE_EVENTS {
        let want = claude_group(handler, event);
        let list = hooks.entry(*event).or_insert_with(|| json!([]));
        let list = list
            .as_array_mut()
            .ok_or_else(|| format!("`hooks.{event}`가 배열이 아닙니다 — 손대지 않았습니다"))?;
        // 이미 지금 모양 하나면 그 자리에 둔다 — 버튼을 두 번 눌러도, 앱을 두 번 켜도 설정이 더러워지지 않는다(스토리 72).
        if claude_event_is_current(list, &want) {
            continue;
        }
        strip_claude_ours(list);
        list.push(want);
        changed = true;
    }

    if !changed {
        return Ok(source.to_string());
    }
    let mut out = serde_json::to_string_pretty(&Value::Object(root))
        .map_err(|e| format!("설정을 옮겨 적지 못했습니다: {e}"))?;
    out.push('\n');
    Ok(out)
}

/// Codex에 거는 이벤트. 구현 결정 8의 다섯(Claude와 넷이 겹치고 `Elicitation` 대신 `Interrupt`다 — Codex 훅 목록에
/// `Elicitation`이 없고, 끊은 턴을 잡는 것이 그쪽이다)에 프로세스 결정 14가 넷(도구 둘 · 서브에이전트 둘)을 더했다.
/// codex 쪽은 **모두 동기**다 — 스펙이 `async`를 claude 도구 사건에만 걸었다. 글자 제약은 `CLAUDE_EVENTS`와 같다.
pub const CODEX_EVENTS: &[&str] = &[
    "UserPromptSubmit",
    "PermissionRequest",
    "Stop",
    "Interrupt",
    "SessionEnd",
    "PreToolUse",
    "PostToolUse",
    "SubagentStart",
    "SubagentStop",
];

/// 우리가 `~/.codex/config.toml` 끝에 덧붙이는 구획의 울타리.
///
/// **제거가 이 두 줄만 보고 잘라낸다.** TOML을 파싱해 다시 쓰면 488줄짜리 실물의 주석과
/// 순서가 통째로 갈리므로, 넣는 것도 걷는 것도 텍스트로 한다 — 그러려면 어디부터
/// 어디까지가 우리 것인지 파일 안에 적혀 있어야 한다.
const CODEX_BEGIN: &str = "# >>> atelier 셸 신호 훅 — 아틀리에 설정 화면이 넣었습니다 >>>";
const CODEX_END: &str = "# <<< atelier 셸 신호 훅 <<<";

/// 파일 끝에 덧붙는 글자 그대로. **미리보기도 이 함수가 낸다** — 화면이 따로 적으면
/// 「무엇이 들어가는지 보여 준다」는 약속이 실제로 들어가는 것과 갈릴 수 있다.
pub fn codex_block(handler: &Path) -> String {
    codex_block_for(handler, CODEX_EVENTS)
}

/// 이벤트 몇 개짜리 구획. **전부가 아닐 수 있는 이유:** 사람이 울타리 밖에 손으로 적어 둔
/// 우리 명령이 있으면 그 이벤트는 다시 안 붙인다(`merge_codex`) — 붙이면 두 벌이 된다.
fn codex_block_for(handler: &Path, events: &[&str]) -> String {
    let mut out = String::from(CODEX_BEGIN);
    out.push('\n');
    for event in events {
        // **두 블록이 짝이다**(구현 결정 8). `[[hooks.<Event>]]`가 matcher 그룹이고
        // `[[hooks.<Event>.hooks]]`가 그 안의 명령이다 — 앞의 것 없이 뒤의 것만 적으면
        // 붙일 그룹이 없어 TOML이 거부한다. matcher는 안 적는다: 도구 이름으로 거르는
        // 자리가 아니라 이벤트 전부를 받는다.
        out.push_str(&format!(
            "\n[[hooks.{event}]]\n\n[[hooks.{event}.hooks]]\ntype = \"command\"\ncommand = {}\n",
            toml_basic_string(&codex_command(handler, event))
        ));
    }
    out.push_str(CODEX_END);
    out.push('\n');
    out
}

/// 우리가 codex에 거는 명령줄 한 줄 — 셸 꼴에 목록의 판을 맨 끝 낱말로 단다(`'<처리기>' codex Stop list-2`).
///
/// **codex에는 `args`가 없다**(구현 기록 19절 — 바이너리의 훅 설정 칸은 `type` · `command` · `commandWindows` · `timeout` ·
/// `async` · `statusMessage`뿐이다). codex는 이 줄을 제 환경의 셸 `-c`로 돌린다 — 홑따옴표로 감싼 경로는 sh · bash · zsh가
/// 같게 읽는다.
fn codex_command(handler: &Path, event: &str) -> String {
    format!("{} {}", command_line(handler, CODEX, event), list_word())
}

/// TOML 기본 문자열 한 개. 경로에 `"`나 `\`가 섞여도 파일이 안 깨진다.
fn toml_basic_string(value: &str) -> String {
    let escaped = value.replace('\\', r"\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

/// 사용자의 `~/.codex/config.toml` 내용을 **지금 목록으로 맞춘** 새 내용 — 처음 까는 것도, 이미 깐 것을 고치는 것도 이 함수다.
///
/// **파일 끝에 덧붙인다**(구현 결정 8). TOML을 파싱해 다시 쓰지 않는 이유는 실물이
/// 488줄이고 주석과 순서가 사람의 것이기 때문이다 — 덧붙이기는 그 전부를 안 건드린다.
/// 대가는 **우리 블록 뒤에 사용자가 최상위 키를 못 적게 되는 것**이다(TOML은 최상위 키가
/// 모든 테이블 헤더보다 앞에 와야 한다). 감수한다.
///
/// **먼저 우리 구획을 통째로 걷고 새것을 다시 붙인다**(프로세스 결정 15의 갱신 — codex는 구획 단위다). 그래야 두 번 눌러도
/// 한 번이고, 옛 python 줄 · 판이 옛 줄 · 빠진 이벤트가 모두 새 구획 하나로 바뀌며, 홈이 옮겨져 경로가 낡았을 때도 그것을
/// 고친다.
///
/// **파일에 이 빌드보다 새로운 판의 줄이 있으면 손대지 않는다**(P5) — 새 빌드가 맞춘 것을 옛 목록으로 되돌리지 않는다.
pub fn merge_codex(source: &str, handler: &Path) -> Result<String, String> {
    if codex_is_newer(&codex_ours(&parse_codex(source)?)) {
        return Ok(source.to_string());
    }

    let mut out = strip_codex_block(source);

    // **울타리 밖에 이미 우리 명령이 있으면 그 이벤트는 안 붙인다.** 사람이 손으로 적어 둔
    // 훅 위에 우리 구획을 그대로 얹으면 같은 명령이 두 벌이 되어 이벤트마다 훅이 두 번
    // 돈다 — claude 쪽이 `claude_group_is_ours`로 막는 그 자리(스토리 72)의 codex 판이다.
    // 그 줄이 옛 줄이어도 갈아 끼우지 않는다: 울타리 밖은 사람의 글이라 텍스트로 잘라 내지 않는다(구현 결정 8) — 판정은
    // 그 이벤트를 「일부」로 남기고, 사람이 그 줄을 지우면 다음 맞춤이 채운다.
    let present = codex_ours(&parse_codex(&out)?).into_iter().map(|(event, _)| event.to_string()).collect::<Vec<_>>();
    let missing: Vec<&str> =
        CODEX_EVENTS.iter().copied().filter(|event| !present.iter().any(|on| on == event)).collect();
    if missing.is_empty() {
        return Ok(out);
    }

    if !out.is_empty() {
        // **파일 끝 개행 유무를 본다.** 없는데 그냥 이으면 사용자의 마지막 키와 우리
        // 주석이 한 줄에 붙어 파일이 통째로 깨진다.
        if !out.ends_with('\n') {
            out.push('\n');
        }
        out.push('\n');
    }
    out.push_str(&codex_block_for(handler, &missing));
    Ok(out)
}

/// 우리 구획만 잘라낸 새 내용.
///
/// **파일 끝 개행을 하나로 고른다.** 잘라낸 자리 앞에 우리가 넣었던 빈 줄이 남으면
/// 설치·제거를 되풀이할 때마다 파일 끝에 빈 줄이 쌓인다.
pub fn unmerge_codex(source: &str) -> Result<String, String> {
    parse_codex(source)?;
    Ok(strip_codex_block(source))
}

/// 얼마나 깔렸나 — **파일을 읽어, 우리 명령 문자열로 판정한다**(구현 결정 8 · claude 쪽과 같은
/// 잣대). 셋의 뜻은 `Installed`에 있다: 목록(`CODEX_EVENTS`)의 이벤트마다 우리 줄이 꼭 하나이고 그것이 지금 줄(`codex_command`)과
/// 글자까지 같고, 목록 밖에 우리 줄이 없어야 「전부」다.
///
/// **울타리를 세지 않는다.** 헤더 줄만 보면 사람이 `command` 줄을 지운 파일이 「전부」가
/// 되어 고칠 까닭이 화면에서 사라지고, 손으로 적어 둔 훅은 「없음」이 되어 그 위에 사본이 하나 더 붙는다.
pub fn codex_installed(source: &str, handler: &Path) -> Result<Installed, String> {
    let table = parse_codex(source)?;
    let ours = codex_ours(&table);
    Ok(Installed::judge(ours.is_empty(), codex_is_newer(&ours), || {
        CODEX_EVENTS.iter().all(|event| {
            let mut on = ours.iter().filter(|(at, _)| at == event);
            on.next().is_some_and(|(_, command)| *command == codex_command(handler, event)) && on.next().is_none()
        }) && ours.iter().all(|(event, _)| CODEX_EVENTS.contains(event))
    }))
}

/// 이 내용에 우리 명령이 **하나라도** 남아 있나 — 걷고 난 뒤에 재는 물음(`leftover`).
/// 깨진 파일에서는 거짓이다: 그때 사람이 먼저 볼 것은 `error` 칸의 「손대지 않았습니다」다.
fn codex_remains(source: &str) -> bool {
    parse_codex(source).is_ok_and(|table| !codex_ours(&table).is_empty())
}

/// 이 내용에 앉은 **우리 명령 전부** — `(이벤트, 명령줄)`. 울타리 안인지 밖인지는 안 본다 — 근거는 파일에 적힌 명령 문자열
/// 하나다. 목록 밖 이벤트의 것도 든다(판정이 그것을 「일부」로 읽는다).
fn codex_ours(table: &toml::Table) -> Vec<(&str, &str)> {
    let Some(hooks) = table.get("hooks").and_then(toml::Value::as_table) else {
        return Vec::new();
    };
    hooks
        .iter()
        .filter_map(|(event, groups)| groups.as_array().map(|groups| (event.as_str(), groups)))
        .flat_map(|(event, groups)| {
            groups
                .iter()
                .filter_map(|group| group.get("hooks").and_then(toml::Value::as_array))
                .flatten()
                .filter_map(|hook| hook.get("command").and_then(toml::Value::as_str))
                .filter(|command| is_ours(command))
                .map(move |command| (event, command))
        })
        .collect()
}

/// 우리 줄 가운데 **이 빌드보다 새로운 판**이 있는가(P5). codex의 줄은 셸 꼴이라 판이 명령줄의 마지막 낱말이다.
fn codex_is_newer(ours: &[(&str, &str)]) -> bool {
    ours.iter().any(|(_, command)| version_in(command.split_whitespace().last()) > LIST_VERSION)
}

/// 우리 구획이 앉은 자리 — 울타리 두 줄을 포함한 바이트 범위.
///
/// **줄 단위로 견준다.** 파일 어딘가에 이 문구가 든 다른 줄이 있어도 걸리지 않게, 그리고
/// 여는 울타리보다 뒤에 있는 닫는 울타리만 짝으로 친다.
fn codex_block_span(source: &str) -> Option<(usize, usize)> {
    let line_start = |needle: &str| {
        source.match_indices(needle).find_map(|(at, _)| {
            let starts_line = at == 0 || source.as_bytes()[at - 1] == b'\n';
            let rest = &source[at + needle.len()..];
            let ends_line = rest.is_empty() || rest.starts_with('\n');
            (starts_line && ends_line).then_some(at)
        })
    };
    let from = line_start(CODEX_BEGIN)?;
    let end = line_start(CODEX_END)?;
    if end < from {
        return None;
    }
    let after = end + CODEX_END.len();
    let after = if source[after..].starts_with('\n') { after + 1 } else { after };
    Some((from, after))
}

fn strip_codex_block(source: &str) -> String {
    let Some((from, to)) = codex_block_span(source) else {
        return source.to_string();
    };
    let mut out = String::with_capacity(source.len());
    out.push_str(&source[..from]);
    out.push_str(&source[to..]);
    let mut out = out.trim_end_matches('\n').to_string();
    if !out.is_empty() {
        out.push('\n');
    }
    out
}

/// 사용자의 Claude 설정 한 장.
pub fn claude_settings_path(home: &Path) -> PathBuf {
    home.join(".claude").join("settings.json")
}

/// 사용자의 Codex 설정 한 장.
pub fn codex_config_path(home: &Path) -> PathBuf {
    home.join(".codex").join("config.toml")
}

/// 병합 결과를 파일에 넣는다 — **쓰기 전 `.bak` 한 벌, 그리고 원자적 쓰기**(구현 결정 8).
///
/// 순서가 뜻이다. 병합이 실패하면 파일에도 `.bak`에도 손이 안 간다(깨진 입력은 거부하고
/// 손대지 않는다). 바뀔 것이 없으면 아무것도 안 쓴다 — 두 번째 설치가 `.bak`을 「우리
/// 훅이 이미 든 내용」으로 덮으면 되돌릴 벌이 사라진다.
///
/// **원자성이 필요한 이유:** 반쯤 쓰인 `settings.json`은 claude가 **아예 안 뜨는** 상태다.
/// 같은 폴더의 tmp에 다 쓰고 rename하면 파일이 반쯤인 순간이 없다(`settings.rs`의 같은 규칙 —
/// tmp를 다른 폴더에 두면 경계를 넘어 복사-삭제가 되어 그 보장이 깨진다).
///
/// **원자적 교체의 대가 둘을 여기서 물어낸다** — 그리고 그 둘은 `settings.rs`의 같은
/// 관용구에는 없던 값이다. 그쪽이 쓰는 것은 우리 파일(`~/.atelier/settings.json`)이고,
/// 이 판이 같은 길을 **남의 홈**으로 옮기면서 새로 생긴 노출이다.
///
/// 1. **모드.** 새로 만든 tmp의 모드는 `0666 & !umask`(보통 0644)이고 rename은 그것을
///    목적지로 그대로 옮긴다 — 원본이 어떤 모드였는지는 아무 데서도 안 읽는다. 실물 둘 다
///    0600이고 `env` 구획이 앉아 있어 사람이 일부러 좁혀 둔 파일이다. `.bak`은
///    `std::fs::copy`라 모드가 따라가므로, 안 고치면 **백업만 좁고 살아 있는 설정이 넓어지는**
///    뒤집힌 모양이 된다. 그래서 원본이 있으면 그 모드를 tmp에 얹고 나서 rename한다.
/// 2. **심링크.** dotfiles 저장소에서 이 파일을 심링크로 걸어 둔 사람은 설치 한 번에 그것이
///    보통 파일로 갈리고, 그 뒤 저장소를 고쳐도 에이전트에 안 닿는다 — 조용하고 되돌리기
///    어렵다. 그래서 rename의 목적지를 `canonicalize`한 **실물**로 고른다. 벌은 사람이 찾는
///    자리(원래 경로 옆)에 그대로 뜬다.
fn apply(path: &Path, transform: impl Fn(&str) -> Result<String, String>) -> Result<bool, String> {
    let before = read_or_empty(path)?;
    let after = transform(&before)?;
    if after == before {
        return Ok(false);
    }

    // 없던 파일을 새로 만드는 길에서는 `canonicalize`가 실패한다 — 그때는 경로가 곧 실물이다.
    let target = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());

    let dir = target.parent().unwrap_or(Path::new(".")).to_path_buf();
    std::fs::create_dir_all(&dir).map_err(|e| format!("설정 폴더를 만들지 못했습니다: {e}"))?;

    // 벌은 **원문이 있을 때만** 뜬다. 없던 파일을 새로 만드는 길에는 되돌릴 것이 없다.
    if path.exists() {
        let backup = backup_path(path);
        std::fs::copy(path, &backup)
            .map_err(|e| format!("설정을 백업하지 못했습니다 ({}): {e}", backup.display()))?;
    }

    // 원본의 권한. `Permissions`째로 나르므로 `cfg`가 안 든다 — CI 게이트가 리눅스라
    // macOS 전용 심벌을 여기 들이면 그쪽에서만 안 선다.
    let mode = std::fs::metadata(&target).ok().map(|m| m.permissions());

    let name = target.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let tmp = dir.join(format!(".{name}.atelier.tmp"));
    std::fs::write(&tmp, after).map_err(|e| format!("설정을 쓰지 못했습니다: {e}"))?;
    if let Some(mode) = mode {
        std::fs::set_permissions(&tmp, mode)
            .map_err(|e| format!("설정의 권한을 그대로 두지 못했습니다: {e}"))?;
    }
    std::fs::rename(&tmp, &target).map_err(|e| format!("설정을 바꿔 넣지 못했습니다: {e}"))?;
    Ok(true)
}

/// `settings.json` → `settings.json.bak`. **확장자를 갈아 끼우지 않는다** — `with_extension`은
/// 원래 확장자를 지워 `settings.bak`이 되고, 그러면 되돌릴 때 무슨 파일이었는지가 흐려진다.
fn backup_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(".bak");
    PathBuf::from(name)
}

/// 에이전트 하나에 우리 훅이 **얼마나** 깔렸나(프로세스 결정 15 · 프로세스 스펙 S35). 화면은 셋을 「설치 안 됨」 · 「업데이트
/// 필요」 · 「설치됨」으로 적는다(`SettingsPage.tsx`의 `hookStateLabel`). 전에는 참 · 거짓뿐이라, 목록이 는 판에서 옛 훅만 깐
/// 사람이 「설치 안 됨」으로 읽혔다.
///
/// **「전부」는 지금 목록 전부가 지금 모양으로 있을 때만이다** — 이벤트마다 우리 줄이 꼭 하나이고 그것이 지금 넣을 줄과 같고,
/// 목록 밖 이벤트에 우리 줄이 없다. 곧 「맞춰도 바뀔 것이 없다」와 같은 말이다. 옛 명령줄이 하나 남은 것도, 도구 사건의
/// `async`가 빠진 것도 「일부」다 — 앱이 뜰 때 맞추거나(`sync`) 설치 버튼이 고칠 것이 남았다.
///
/// **파일의 목록 판이 이 빌드보다 새로우면 「전부」다**(티켓 21이 S35에 더한 것). 옛 빌드가 새 빌드가 쓴 파일을 읽으면 모양이
/// 달라 「일부」로 보이는데, 그 화면의 설치 버튼을 누르면 새 목록을 옛 목록으로 되쓴다(P5와 S35가 만나는 빈 곳). 병합도 그
/// 파일에는 손대지 않는다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Installed {
    /// 우리 훅이 하나도 없다. 앱이 뜰 때 맞추지 않는다 — 설치 자체가 동의다.
    None,
    /// 우리 훅이 있는데 지금 목록 · 모양과 다르다.
    Partial,
    /// 지금 목록 전부가 지금 모양으로 있다. 또는 이 빌드보다 새로운 판이다.
    Full,
}

impl Installed {
    /// 셋 가르기 — 우리 줄이 없는가, 새로운 판인가, 지금 모양 그대로인가. 마지막 물음은 앞 둘이 답하지 않을 때만 잰다.
    fn judge(none: bool, newer: bool, current: impl FnOnce() -> bool) -> Self {
        if none {
            Self::None
        } else if newer || current() {
            Self::Full
        } else {
            Self::Partial
        }
    }
}

/// 사용자의 홈 — `~/.claude` · `~/.codex`가 여기 산다.
///
/// **데이터 루트와 다른 홈이다.** 훅 처리기가 사는 곳은 `atelier_core::data_root()`(테스트가 `ATELIER_HOME`으로 옮기는 우리
/// 폴더)이고, 고칠 설정이 사는 곳은 진짜 홈이다 — `~/.claude` · `~/.codex`는 우리 것이 아니라서 그 오버라이드가 걸리면 안 된다.
/// 그래서 `ATELIER_HOME`으로 뜬 앱의 설치 버튼은 진짜 설정에 그 루트의 처리기를 건다 — 사람이 누른 것이다. 앱이 뜰 때의
/// 맞춤은 그 실행에서 돌지 않는다(`startup::sync_hooks` — 루트가 이 홈의 기본 자리일 때만).
pub fn agent_home() -> PathBuf {
    atelier_core::expand_home("~/")
}

/// **이미 깐 훅을 앱이 뜰 때 지금 목록으로 맞춘다**(프로세스 결정 15 · 티켓 21). 에이전트마다 설정 파일을 읽어, 판정이
/// 「일부」일 때만 병합을 쓴다. 우리 훅이 하나도 없으면(「없음」) 안 건드린다 — 설치 자체가 동의이고, 한 번도 안 깐 사람의
/// 설정을 앱을 켰다고 고칠 까닭이 없다. 「전부」(새로운 판 포함, P5)면 바꿀 것이 없다.
///
/// 돌려주는 것은 **실제로 쓴** 에이전트다 — 시작 보고의 훅 칸이고, 비어 있지 않으면 프런트가 토스트를 한 번 띄운다(S36).
///
/// 쓰기 규칙은 설치 버튼과 같은 `apply`다 — `.bak`, 모드와 심링크, 바뀐 게 없으면 안 씀, 깨진 파일은 안 건드림. 판정과 병합은
/// 한 번 읽은 내용 위에서 한다(`apply`의 변환 안) — 따로 읽으면 그 사이에 사람이 우리 훅을 걷은 파일에 옛 판정으로 다시 깔 수
/// 있다.
///
/// **claude도 같은 파일을 쓴다.** 같은 순간이면 한쪽 쓰기를 잃는다. 「바뀐 게 없으면 안 쓴다」가 대부분을 막고, 갱신이 실제로
/// 필요한 첫 실행의 위험은 받아들인다(프로세스 스펙 「이미 설치한 훅의 자동 갱신」 — 설치 버튼에 있던 위험이 자동으로 온다).
///
/// 파일을 넷까지 읽고 쓰는 기다리는 일이라, 앱은 뒤 스레드에서 부른다(`startup::sync_hooks`). 처리기(`handler`)가 디스크에 선
/// 뒤에 부른다 — 설정만 새 경로를 가리키면 에이전트가 매 턴 없는 파일을 부른다.
pub fn sync(home: &Path, handler: &Path) -> Vec<String> {
    AGENTS
        .iter()
        .filter_map(|agent| {
            let (installed, merge) = (agent.installed, agent.merge);
            let wrote = apply(&(agent.path)(home), |source| match installed(source, handler)? {
                Installed::Partial => merge(source, handler),
                Installed::None | Installed::Full => Ok(source.to_string()),
            });
            match wrote {
                Ok(true) => Some(agent.name.to_string()),
                Ok(false) => None,
                Err(e) => {
                    eprintln!("atelier: {} 훅을 지금 목록으로 맞추지 못했습니다 — {e}", agent.name);
                    None
                }
            }
        })
        .collect()
}

/// 에이전트 하나의 지금 상태 — 설정 화면이 그리는 것 전부.
///
/// **앱이 따로 기억하는 상태가 없다**(구현 결정 8). 이 값은 부를 때마다 설정 파일을 읽어
/// 만든다 — 그래서 사람이 파일을 손으로 고쳐도 화면이 곧바로 그것을 말한다.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookStatus {
    /// `claude` · `codex`.
    pub agent: String,
    /// 사람이 읽는 경로 — `~/.claude/settings.json`.
    pub path: String,
    /// 없음 · 일부 · 전부(`Installed`). 선 위에서는 `"none"` · `"partial"` · `"full"`이다(검사
    /// `the_install_state_goes_over_the_wire_as_none_partial_or_full` — 프런트 `HookInstalled`의 짝).
    pub installed: Installed,
    /// 파일이 깨져 **판정을 못 했으면** 그 까닭. 그때 `installed`는 「없음」이지만 「안 깔렸다」가
    /// 아니라 「모른다」다 — 화면이 그 둘을 갈라 적는다.
    pub error: Option<String>,
    /// 방금 **넣거나 걷다** 난 오류. `error`와 한 칸을 쓰면 안 되는 이유가 있다 — 파일이
    /// 읽기 전용이면 쓰기만 실패하고 판정은 멀쩡히 되는데, 그때 화면이 「확인 못 함」이라
    /// 적으면 아는 사실을 「모른다」로 지우는 것이 된다.
    pub write_error: Option<String>,
    /// 그 파일에 실제로 들어가는 글자. **쓰는 함수와 같은 곳에서 나온다**(스토리 73) —
    /// 화면이 따로 적으면 「무엇이 들어가는지 보여 준다」는 약속이 실물과 갈릴 수 있다.
    pub preview: String,
}

/// Claude 쪽에 더해지는 조각을 사람이 읽을 글자로. **병합이 실제로 넣는 그 값**이다 —
/// 빈 파일에 병합한 결과가 곧 「우리가 더하는 것」이라, 두 벌로 적을 자리가 없다.
fn claude_preview(handler: &Path) -> String {
    merge_claude("{}", handler).unwrap_or_default()
}

/// 에이전트 하나가 무엇을 어디에 넣는지 — 이 표가 둘의 차이 전부다.
///
/// 새 에이전트가 생기면 여기 한 줄이고, 위·아래의 세 창구는 안 는다.
struct Agent {
    name: &'static str,
    path: fn(&Path) -> PathBuf,
    merge: fn(&str, &Path) -> Result<String, String>,
    unmerge: fn(&str) -> Result<String, String>,
    /// 얼마나 깔렸나 — 없음 · 일부 · 전부. 지금 줄과 견주므로 처리기 경로를 받는다.
    installed: fn(&str, &Path) -> Result<Installed, String>,
    preview: fn(&Path) -> String,
    /// 이 내용에 **우리 명령이 하나라도** 앉아 있나. `installed`(지금 모양 그대로인가)와 다른
    /// 물음이다 — 이쪽은 「걷고 났는데 뭐가 남았나」를 재는 자리라 하나만 남아도 참이다.
    remains: fn(&str) -> bool,
}

const AGENTS: &[Agent] = &[
    Agent {
        name: CLAUDE,
        path: claude_settings_path,
        merge: merge_claude,
        unmerge: unmerge_claude,
        installed: claude_installed,
        preview: claude_preview,
        remains: claude_remains,
    },
    Agent {
        name: CODEX,
        path: codex_config_path,
        merge: merge_codex,
        unmerge: unmerge_codex,
        installed: codex_installed,
        preview: codex_block,
        remains: codex_remains,
    },
];

/// 지금 상태 둘. **실패를 에이전트마다 따로 든다** — codex 설정이 깨졌다고 claude 쪽
/// 판정까지 못 하게 되면, 화면이 아무 말도 못 하는 자리가 는다.
pub fn status(home: &Path, handler: &Path) -> Vec<HookStatus> {
    AGENTS.iter().map(|agent| look(agent, home, handler, None)).collect()
}

/// 둘 다에 넣는다 — 이미 깔린 것은 지금 목록으로 맞춘다(병합이 갱신 모드다). 「업데이트 필요」의 화면에서 사람이 고칠 길이
/// 이 버튼이다. 돌아오는 것은 **넣고 난 뒤의 상태**다 — 화면이 다시 물어보지 않는다.
pub fn install(home: &Path, handler: &Path) -> Vec<HookStatus> {
    AGENTS
        .iter()
        .map(|agent| {
            let merge = agent.merge;
            let failed = apply(&(agent.path)(home), |source| merge(source, handler)).err();
            look(agent, home, handler, failed)
        })
        .collect()
}

/// 둘 다에서 걷어낸다. **스크립트 파일은 남긴다**(구현 결정 8).
///
/// **걷고 난 뒤에 남은 것이 있으면 그것도 말한다**(아래 `leftover`). 못 걷은 것을 조용히
/// 두면 화면이 「설치됨」인 채 버튼만 무위가 되고, 사람에게는 그 사실을 알 칸이 없다.
pub fn uninstall(home: &Path, handler: &Path) -> Vec<HookStatus> {
    AGENTS
        .iter()
        .map(|agent| {
            let unmerge = agent.unmerge;
            let path = (agent.path)(home);
            let failed = apply(&path, |source| unmerge(source)).err().or_else(|| leftover(agent, &path));
            look(agent, home, handler, failed)
        })
        .collect()
}

/// 걷고 난 파일에 **우리 명령이 아직 남아 있으면** 그 사실을 사람의 말로.
///
/// **두 에이전트의 잣대가 갈리는 자리를 메운다.** claude는 넣는 것도 빼는 것도 명령
/// 문자열(`is_ours`)이 근거라 손으로 적어 둔 훅도 함께 걷힌다. codex는 판정만 명령
/// 문자열이고(`codex_ours`) 제거는 울타리 두 줄(`strip_codex_block`)이다 — 그래서 울타리
/// 밖에 손으로 적어 둔 우리 훅은 살아남는데 판정은 「설치됨」이다. 그때 `unmerge_codex`가
/// 원문을 그대로 돌려주고 `apply`가 `after == before`로 아무것도 안 쓰므로, **오류도
/// 없고 바뀐 것도 없고 화면은 여전히 「설치됨」**이 된다.
///
/// **여기서 TOML을 파싱해 마저 걷지 않는 이유:** 넣는 것도 걷는 것도 텍스트라는 것이
/// 구현 결정 8이고(488줄짜리 실물의 주석과 순서를 파서에 맡길 이유가 없다), 우리가 안 쓴
/// 모양의 항목을 텍스트로 잘라 내는 일은 사람의 파일을 깨뜨릴 길이 우리가 얻는 것보다
/// 넓다. 그래서 **아는 것만 말한다** — 어느 파일의 무엇을 지우면 되는지.
fn leftover(agent: &Agent, path: &Path) -> Option<String> {
    let source = read_or_empty(path).ok()?;
    if !(agent.remains)(&source) {
        return None;
    }
    // 우리 것으로 알아보는 이름이 둘이라(`is_ours`) 둘 다 적는다 — 한쪽만 적으면 사람이 그 이름만 찾아 지우고 다른 줄을 남긴다.
    Some(format!(
        "손으로 적어 둔 훅이 남아 있어 앱이 못 걷었습니다 — {}을 열어 `{}`나 `{}`가 든 줄을 직접 지워 주세요.",
        atelier_core::collapse_home(path),
        crate::shells::SCRIPT_NAME,
        crate::shells::HANDLER_NAME
    ))
}

/// 한 에이전트의 지금 모습을 **파일에서** 만든다. `failed`는 방금 넣거나 걷다 난 오류다 —
/// **판정과 다른 칸에 싣는다.** 둘은 다른 사실이고(하나는 방금 한 일, 하나는 지금 아는 것),
/// 한 칸에 겹치면 「쓰기는 실패했지만 설치된 것은 안다」가 「확인 못 함」으로 지워진다.
fn look(agent: &Agent, home: &Path, handler: &Path, failed: Option<String>) -> HookStatus {
    let path = (agent.path)(home);
    let read = read_or_empty(&path).and_then(|source| (agent.installed)(&source, handler));
    HookStatus {
        agent: agent.name.to_string(),
        path: atelier_core::collapse_home(&path),
        installed: read.clone().unwrap_or(Installed::None),
        error: read.err(),
        write_error: failed,
        preview: (agent.preview)(handler),
    }
}

/// 파일이 없으면 빈 내용이다 — 첫 실행이 정상 경로다.
fn read_or_empty(path: &Path) -> Result<String, String> {
    match std::fs::read_to_string(path) {
        Ok(content) => Ok(content),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!(
            "설정을 읽지 못했습니다 ({}): {e}",
            atelier_core::collapse_home(path)
        )),
    }
}

/// **깨진 TOML은 거부한다.** 쓰는 것은 텍스트 덧붙이기라, 파서가 하는 일은 둘뿐이다 —
/// 「손대도 되는 파일인가」와 「우리 명령이 어디에 앉아 있나」(`codex_ours`).
fn parse_codex(source: &str) -> Result<toml::Table, String> {
    toml::from_str::<toml::Table>(source)
        .map_err(|e| format!("설정 파일이 잘못됐습니다: {e} — 손대지 않았습니다"))
}

/// 우리 훅만 걷어낸 새 내용. **스크립트 파일은 안 지운다** — 남아도 무해하고, 지우면
/// 아직 살아 있는 셸의 훅이 그 순간부터 없는 파일을 부른다.
///
/// **우리 이벤트만 보지 않는다.** 이벤트 목록이 판마다 바뀌면 지난 판이 깔아 둔 이벤트가
/// 목록 밖으로 나가 **영영 못 걷는 훅**이 된다. 근거는 목록이 아니라 명령 문자열이다.
///
/// 빈 껍데기는 함께 걷는다 — 우리가 만들어 둔 그룹·배열·`hooks` 구획이 알맹이 없이
/// 남으면 「되돌렸다」가 파일에서는 거짓이 된다. **다만 「지금 비어 있는 것」이 아니라
/// 「이번 제거가 비운 것」만이다** — 사람이 손으로 적어 둔 빈 그룹·빈 배열·빈 `hooks`는
/// 우리가 만든 껍데기가 아니라 그 사람의 내용이라, 걷으면 「우리 항목만 걷어낸다」가 깨진다.
pub fn unmerge_claude(source: &str) -> Result<String, String> {
    // 원문이 비어 있으면 걷을 것이 없다. 여기서 `{}`를 내면 claude를 한 번도 안 쓴 사람이
    // 「제거」를 누른 것만으로 `~/.claude/settings.json`이 생긴다 — codex 쪽은 빈 원문을
    // 빈 채로 돌려줘 아무것도 안 쓰는데, 같은 층에서 둘이 갈릴 이유가 없다.
    if source.trim().is_empty() {
        return Ok(source.to_string());
    }

    let mut root = parse_claude(source)?;

    // **이번 제거가 실제로 걷어낸 것이 있나.** 없으면 원문을 글자 그대로 돌려준다 —
    // 그러면 `apply`의 `after == before`가 참이 되어 디스크에 손이 안 간다. 이 플래그가
    // 없으면 비지 않은 파일은 언제나 파싱 후 재직렬화라, 사람이 4칸 들여쓰기로 관리하던
    // 파일이 **우리 것이 하나도 없어도** 통째로 다시 쓰이고 `.bak`이 뜬다. 우리가 지운 것은
    // 없는데 남의 파일만 바뀌어 있는 자리다(git dotfiles라면 전체가 diff로 뜬다).
    // `apply`의 독이 「바뀔 것이 없으면 아무것도 안 쓴다」라고 적고, `unmerge_claude`의 독이
    // 「codex 쪽은 아무것도 안 쓰는데 같은 층에서 둘이 갈릴 이유가 없다」고 적어 둔 그
    // 불변조건을 — 말이 아니라 값으로 — 세우는 한 줄이다.
    let mut removed = false;

    if let Some(hooks) = root.get_mut("hooks").and_then(Value::as_object_mut) {
        let mut emptied_events: Vec<String> = Vec::new();
        for (event, list) in hooks.iter_mut() {
            let Some(list) = list.as_array_mut() else { continue };
            // 우리 훅을 걷고 이번에 비운 그룹만 함께 걷는다(`strip_claude_ours`). 걷은 뒤 배열이 비었으면 우리가 비운 것이다 —
            // 처음부터 빈 배열이었으면 걷은 것이 없다.
            if strip_claude_ours(list) {
                removed = true;
                if list.is_empty() {
                    emptied_events.push(event.clone());
                }
            }
        }
        // **차례를 지키며 걷는다**(`shift_remove`). `remove`는 끝 키를 비운 자리로 옮겨, 사람의 이벤트 · 키 차례를 흩는다 —
        // 「설치 전 파일로 글자까지 돌아온다」가 우리 것이 끝에 있을 때만 서던 자리다.
        for event in &emptied_events {
            hooks.shift_remove(event);
        }
        if !emptied_events.is_empty() && hooks.is_empty() {
            root.shift_remove("hooks");
        }
    }

    if !removed {
        return Ok(source.to_string());
    }

    let mut out = serde_json::to_string_pretty(&Value::Object(root))
        .map_err(|e| format!("설정을 옮겨 적지 못했습니다: {e}"))?;
    out.push('\n');
    Ok(out)
}

/// 얼마나 깔렸나. **설정 파일을 읽어 판정한다** — 앱은 따로 기억하지 않는다(구현 결정 8).
///
/// 셋의 뜻은 `Installed`에 있다. 목록(`CLAUDE_EVENTS`)의 이벤트마다 우리 그룹이 지금 모양 그대로 꼭 하나이고 목록 밖에 우리 줄이
/// 없어야 「전부」다 — 병합이 바꿀 것이 없는 모양과 같은 잣대다(`claude_event_is_current`). 하나라도 어긋났으면 「일부」라야 화면이
/// 「업데이트 필요」를 말하고 설치 버튼이 그것을 채운다 — 반쯤 깔린 상태를 「설치됨」이라 부르면 사람이 고칠 까닭이 화면에서
/// 사라진다. 전에는 참 · 거짓뿐이라, 목록이 는 판(프로세스 결정 14)에서 이미 설치한 사람이 「설치 안 됨」으로 읽혔다 — 프로세스
/// 결정 15가 셋으로 고쳤다.
pub fn claude_installed(source: &str, handler: &Path) -> Result<Installed, String> {
    let root = parse_claude(source)?;
    let Some(hooks) = root.get("hooks").and_then(Value::as_object) else {
        return Ok(Installed::None);
    };
    let ours = claude_ours(hooks);
    Ok(Installed::judge(ours.is_empty(), claude_is_newer(&ours), || {
        CLAUDE_EVENTS.iter().all(|event| {
            hooks
                .get(*event)
                .and_then(Value::as_array)
                .is_some_and(|list| claude_event_is_current(list, &claude_group(handler, event)))
        }) && ours.iter().all(|(event, _)| CLAUDE_EVENTS.contains(event))
    }))
}

/// claude 쪽 짝(`codex_remains` 참조). 이쪽은 제거가 명령 문자열로 걷으므로 정상 경로에서
/// 늘 거짓이다 — 그래도 자리를 비워 두지 않는 것은, 걷는 규칙이 바뀌어 못 걷는 자리가
/// 생기면 화면이 침묵하는 대신 그것을 말하게 하기 위해서다.
fn claude_remains(source: &str) -> bool {
    let Ok(root) = parse_claude(source) else { return false };
    root.get("hooks").and_then(Value::as_object).is_some_and(|hooks| {
        hooks.values().any(|list| {
            list.as_array().is_some_and(|groups| groups.iter().any(claude_group_is_ours))
        })
    })
}

/// 빈 파일은 `{}`와 같다 — 첫 실행이 정상 경로다. **깨진 JSON은 거부한다**: 조용히
/// 기본값으로 넘어가면 우리 훅 다섯 줄과 맞바꿔 사용자의 설정 전부가 사라진다.
fn parse_claude(source: &str) -> Result<Map<String, Value>, String> {
    if source.trim().is_empty() {
        return Ok(Map::new());
    }
    let value: Value = serde_json::from_str(source)
        .map_err(|e| format!("설정 파일이 잘못됐습니다: {e} — 손대지 않았습니다"))?;
    match value {
        Value::Object(map) => Ok(map),
        _ => Err("설정 파일의 맨 바깥이 객체가 아닙니다 — 손대지 않았습니다".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// 새 처리기의 자리 — 설치가 사용자 설정에 적어 넣는 경로(티켓 21).
    fn script() -> PathBuf {
        PathBuf::from("/Users/someone/.atelier/hooks/atelier-hook.zsh")
    }

    /// 옛 python 처리기의 자리 — 이 판 전의 설치 버튼이 적던 경로. 옛 빌드가 깐 설정을 지을 때만 쓴다.
    fn old_script() -> PathBuf {
        PathBuf::from("/Users/someone/.atelier/hooks/atelier-hook.py")
    }

    /// 구현 결정 8의 다섯 — 판을 싣기 전의 설치 버튼이 claude에 걸던 목록.
    const OLD_CLAUDE: [&str; 5] = ["UserPromptSubmit", "PermissionRequest", "Elicitation", "Stop", "SessionEnd"];
    /// 같은 판의 codex 다섯.
    const OLD_CODEX: [&str; 5] = ["UserPromptSubmit", "PermissionRequest", "Stop", "Interrupt", "SessionEnd"];

    /// 옛 빌드가 깐 claude 훅 하나 — 옛 python 처리기를 부르는 셸 꼴 명령줄이고 판이 없다. 이 판 전의 `claude_group`이 적던 그대로다.
    fn old_claude_hook(event: &str) -> Value {
        json!({ "type": "command", "command": command_line(&old_script(), CLAUDE, event) })
    }

    /// 옛 빌드가 깐 claude 설정의 `hooks` 구획 — `events`마다 옛 그룹 하나.
    fn old_claude_hooks(events: &[&str]) -> Map<String, Value> {
        events.iter().map(|event| ((*event).to_string(), json!([{ "hooks": [old_claude_hook(event)] }]))).collect()
    }

    /// 옛 빌드가 `~/.codex/config.toml` 끝에 붙인 울타리 구획 — 옛 python 처리기의 명령줄이고 판이 없다.
    fn old_codex_block(events: &[&str]) -> String {
        let mut out = format!("{CODEX_BEGIN}\n");
        for event in events {
            out.push_str(&format!(
                "\n[[hooks.{event}]]\n\n[[hooks.{event}.hooks]]\ntype = \"command\"\ncommand = {}\n",
                toml_basic_string(&command_line(&old_script(), CODEX, event))
            ));
        }
        out.push_str(CODEX_END);
        out.push('\n');
        out
    }

    /// 사람의 파일 뒤에 옛 구획을 붙인 것 — 옛 설치 버튼이 한 그대로다(빈 줄 하나 뒤에 붙인다).
    fn codex_with_old_block(events: &[&str]) -> String {
        format!("{CODEX_REAL}\n{}", old_codex_block(events))
    }

    /// **첫 검사 케이스가 실물이다** — 지금 사용자의 `~/.claude/settings.json`에는 다른
    /// 도구(codegraph)의 `UserPromptSubmit` 훅이 이미 앉아 있다. 설치가 그것을 덮어쓰면
    /// 사용자는 앱을 켠 대가로 남의 도구를 잃는다.
    #[test]
    fn a_foreign_hook_on_the_same_event_survives() {
        let source = r#"{
  "model": "opus",
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command", "command": "codegraph prompt-hook" } ] }
    ]
  }
}"#;

        let merged = merge_claude(source, &script()).expect("병합이 된다");
        let value: Value = serde_json::from_str(&merged).expect("JSON이다");

        assert_eq!(value["model"], "opus", "우리 키 밖의 내용이 사라졌다");

        let prompt = value["hooks"]["UserPromptSubmit"].as_array().expect("배열이다");
        let commands: Vec<&str> =
            prompt.iter().filter_map(|g| g["hooks"][0]["command"].as_str()).collect();
        assert!(
            commands.contains(&"codegraph prompt-hook"),
            "남의 훅이 사라졌다: {commands:?}"
        );
        assert!(
            commands.iter().any(|c| c.contains(crate::shells::HANDLER_NAME)),
            "우리 훅이 안 들어갔다: {commands:?}"
        );

        for event in CLAUDE_EVENTS {
            let list = value["hooks"][event].as_array().unwrap_or_else(|| {
                panic!("`{event}`에 아무것도 안 들어갔다: {merged}")
            });
            assert!(
                list.iter().any(|g| g["hooks"][0]["command"]
                    .as_str()
                    .is_some_and(|c| c.contains(crate::shells::HANDLER_NAME))),
                "`{event}`에 우리 훅이 없다"
            );
        }
    }

    /// 빈 파일 · 아예 없는 파일이 **첫 실행의 정상 경로**다.
    #[test]
    fn an_empty_file_becomes_a_settings_file_with_only_our_hooks() {
        for source in ["", "   \n", "{}"] {
            let merged = merge_claude(source, &script()).expect("병합이 된다");
            let value: Value = serde_json::from_str(&merged).expect("JSON이다");
            let hooks = value["hooks"].as_object().expect("`hooks`가 섰다");
            assert_eq!(hooks.len(), CLAUDE_EVENTS.len(), "이벤트 수가 다르다: {merged}");
        }
    }

    /// **도구 사건 셋은 matcher 없이 `async: true`로 걸린다**(프로세스 결정 14 · S25). 도구마다 두 번 불리는 훅이
    /// 동기면 claude가 그때마다 처리기가 끝나길 기다린다 — 에이전트를 막지 않는 것이 결정 14의 조건이다.
    /// matcher가 없어야 모든 도구가 온다(`AskUserQuestion`도 PreToolUse로 와서 기다림이 된다).
    ///
    /// **나머지는 동기 그대로다** — `async` 칸이 아예 없다. 턴의 끝(`Stop`)이나 승인 요청을 비동기로 걸면 처리기가
    /// 끝나기 전에 다음 사건이 올 수 있고, 그 사건들은 순서 가드가 가려 줄 까닭이 없는 자리다.
    #[test]
    fn the_tool_events_go_in_without_a_matcher_and_async() {
        let merged = merge_claude("{}", &script()).expect("병합이 된다");
        let value: Value = serde_json::from_str(&merged).expect("JSON이다");
        let tools = ["PreToolUse", "PostToolUse", "PostToolUseFailure"];

        for event in tools {
            let groups = value["hooks"][event]
                .as_array()
                .unwrap_or_else(|| panic!("`{event}`가 안 들어갔다: {merged}"));
            assert_eq!(groups.len(), 1, "`{event}`의 그룹이 하나가 아니다");
            assert!(groups[0].get("matcher").is_none(), "`{event}`에 matcher가 섰다: {}", groups[0]);
            let inner = groups[0]["hooks"].as_array().expect("명령 훅 배열");
            assert_eq!(inner.len(), 1);
            assert_eq!(inner[0]["async"], Value::Bool(true), "`{event}`가 async가 아니다: {}", inner[0]);
            assert!(
                inner[0]["command"].as_str().is_some_and(|c| c.contains(crate::shells::HANDLER_NAME))
                    && inner[0]["args"][1] == event,
                "`{event}`의 명령이 우리 것이 아니다: {}",
                inner[0]
            );
        }

        // 앵커: 동기로 남는 것이 실제로 있고, 거기에는 `async` 칸이 아예 없다.
        let rest: Vec<&&str> = CLAUDE_EVENTS.iter().filter(|event| !tools.contains(event)).collect();
        assert!(!rest.is_empty());
        for event in rest {
            let inner = &value["hooks"][*event][0]["hooks"][0];
            assert!(inner["command"].is_string(), "`{event}`가 안 들어갔다: {merged}");
            assert!(inner.get("async").is_none(), "`{event}`가 async로 걸렸다: {inner}");
        }
    }

    /// **설치기가 거는 목록이 결정 14 그대로다** — claude는 다섯에 여섯을, codex는 다섯에 넷을 더했다. 이 목록은
    /// 프런트 어댑터의 갈래와 양방향으로 같아야 한다(`shell-attention.test.ts`의 「훅이 나르는 어휘」) — 그쪽이 이
    /// 선언을 글자로 읽으므로 여기서는 **무엇이 들었는가**를 잰다.
    ///
    /// **목록의 판도 함께 못박는다**(프로세스 스펙 P5). 목록(과 `async` 대상 · 등록 모양)을 바꾸는 사람은 이 검사를 고쳐야
    /// 하고, 그때 판도 올려야 한다 — 판이 그대로면 목록이 다른 두 빌드가 켤 때마다 서로의 설정을 되쓰고 토스트를 띄운다.
    #[test]
    fn the_installer_lists_are_decision_fourteen() {
        assert_eq!(
            LIST_VERSION, 2,
            "목록의 판이 바뀌었다 — 아래 목록도 그 판의 것인지 보고 함께 고친다(목록을 바꾸면 판을 올린다)"
        );
        let mut claude: Vec<&str> = CLAUDE_EVENTS.to_vec();
        claude.sort_unstable();
        assert_eq!(
            claude,
            [
                "Elicitation",
                "PermissionRequest",
                "PostToolUse",
                "PostToolUseFailure",
                "PreToolUse",
                "SessionEnd",
                "Stop",
                "StopFailure",
                "SubagentStart",
                "SubagentStop",
                "UserPromptSubmit",
            ]
        );
        let mut codex: Vec<&str> = CODEX_EVENTS.to_vec();
        codex.sort_unstable();
        assert_eq!(
            codex,
            [
                "Interrupt",
                "PermissionRequest",
                "PostToolUse",
                "PreToolUse",
                "SessionEnd",
                "Stop",
                "SubagentStart",
                "SubagentStop",
                "UserPromptSubmit",
            ]
        );
    }

    /// codex 울타리 블록에도 넷이 더해진다(결정 14 — 「지금 울타리 블록에 더함」). codex 쪽은 동기다: 스펙이
    /// `async`를 claude 도구 사건에만 걸었다.
    #[test]
    fn the_codex_block_carries_the_new_events_synchronously() {
        let block = codex_block(&script());
        let value: toml::Table = toml::from_str(&block).expect("TOML이다");
        for event in ["PreToolUse", "PostToolUse", "SubagentStart", "SubagentStop"] {
            let inner = value["hooks"][event][0]["hooks"][0].as_table().unwrap_or_else(|| panic!("`{event}`가 없다: {block}"));
            assert!(inner["command"].as_str().is_some_and(|c| c.ends_with(&format!("codex {event} list-{LIST_VERSION}"))));
            assert!(inner.get("async").is_none(), "`{event}`가 async로 걸렸다");
        }
    }

    /// **버튼을 두 번 눌러도 한 번이다**(스토리 72). 두 번째 병합은 첫 번째 결과와
    /// 글자까지 같아야 한다 — 다르면 그 차이가 곧 파일에 쌓이는 쓰레기다.
    #[test]
    fn installing_twice_is_the_same_as_installing_once() {
        let once = merge_claude("{}", &script()).unwrap();
        let twice = merge_claude(&once, &script()).unwrap();
        assert_eq!(once, twice);
    }

    /// **깨진 JSON은 거부하고 손대지 않는다.** 조용히 기본값으로 넘어가면 우리 훅 다섯
    /// 줄과 맞바꿔 사용자의 설정 전부가 사라진다.
    #[test]
    fn broken_json_is_refused() {
        for source in ["{ 여기서 잘렸", "[1, 2]", "\"글자\""] {
            let err = merge_claude(source, &script()).expect_err("거부해야 한다");
            assert!(err.contains("손대지 않았습니다"), "무슨 일이 났는지 안 말한다: {err}");
        }
    }

    /// **제거는 우리 항목만 걷어낸다.** 설치 전 파일과 글자까지 같아야 한다 — 되돌릴 수
    /// 있다는 말(스토리 74)이 「거의 되돌아간다」면 사람은 다음부터 버튼을 안 누른다.
    #[test]
    fn removing_ours_leaves_the_file_as_it_was() {
        let before = r#"{
  "model": "opus",
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "codegraph prompt-hook"
          }
        ]
      }
    ]
  }
}
"#;
        let installed = merge_claude(before, &script()).unwrap();
        assert_ne!(installed, before, "설치가 아무것도 안 했다");

        let removed = unmerge_claude(&installed).expect("제거가 된다");
        assert_eq!(removed, before, "제거가 원래 파일로 안 돌아왔다");
    }

    /// 남의 훅이 **우리 그룹 안에** 섞여 있어도 그것만은 남는다. 우리는 늘 우리 그룹을
    /// 따로 만들지만, 사람이 파일을 손으로 고쳐 한 그룹에 둘을 넣어 둘 수 있다.
    #[test]
    fn a_foreign_hook_inside_our_group_is_kept() {
        let source = format!(
            r#"{{"hooks":{{"Stop":[{{"hooks":[{{"type":"command","command":{}}},{{"type":"command","command":"say done"}}]}}]}}}}"#,
            serde_json::to_string(&command_line(&old_script(), "claude", "Stop")).unwrap()
        );

        let removed = unmerge_claude(&source).expect("제거가 된다");
        let value: Value = serde_json::from_str(&removed).unwrap();
        let inner = value["hooks"]["Stop"][0]["hooks"].as_array().expect("그룹이 남았다");
        assert_eq!(inner.len(), 1, "남의 훅까지 걷었거나 우리 것이 남았다: {removed}");
        assert_eq!(inner[0]["command"], "say done");
    }

    /// 깨진 파일은 제거에서도 거부한다 — 손대지 않는 쪽이 늘 안전하다.
    #[test]
    fn removing_from_broken_json_is_refused() {
        assert!(unmerge_claude("{ 잘렸").is_err());
    }

    /// **우리 훅이 하나도 없는 파일은 제거를 지나도 안 바뀐다.** 이 한 줄이 세 자리를
    /// 한꺼번에 지킨다 — 없는 `hooks` 키를 우리가 심지 않는 것, 객체가 아닌 원소에서
    /// 터지지 않는 것, 사람이 적어 둔 빈 구조를 우리가 비운 것으로 오인해 걷지 않는 것.
    ///
    /// **견주는 값이 원문 그대로다.** 한때 이 자리가 `pretty(원문)`이었다 — 제거가 늘 파싱
    /// 후 재직렬화라 들여쓰기까지 같을 수는 없다는 인정이었고, 그 인정이 **디스크 층까지
    /// 이어지지 않아** 우리 것이 하나도 없는 남의 파일이 통째로 재작성되던 자리다. 이제
    /// 걷은 것이 없으면 원문을 글자 그대로 돌려주므로, 여기서도 글자로 잰다.
    #[test]
    fn a_file_without_our_hooks_is_untouched_by_removal() {
        for source in [
            // 사람이 손으로 적어 둔 남의 그룹 — 안쪽 `hooks` 키가 아예 없다.
            r#"{"hooks":{"Stop":[{"matcher":"Bash"}]}}"#,
            // JSON으로는 멀쩡한데 모양만 다른 것. 여기서 **패닉**이 나면 거부가 아니라
            // 폭발이고, Tauri 명령의 프로미스가 안 끝나 화면의 버튼 둘이 영영 잠긴다.
            r#"{"hooks":{"Stop":["oops",null,123]}}"#,
            // 사람이 적어 둔 빈 구조 셋. 우리가 비운 것이 아니라 원래 그렇게 적힌 것이다.
            r#"{"model":"opus","hooks":{"Stop":[{"hooks":[]}],"Notification":[]}}"#,
            r#"{"model":"opus","hooks":{}}"#,
        ] {
            assert_eq!(
                unmerge_claude(source).expect("제거가 된다"),
                source,
                "제거가 남의 파일을 다시 썼다: {source}"
            );
        }
    }

    /// **없던 파일은 제거가 만들지 않는다.** claude를 한 번도 안 쓴 사람이 「제거」를 누르면
    /// `~/.claude/settings.json`이 `{}` 한 줄로 생기던 자리다 — codex 쪽은 빈 원문을 빈 채로
    /// 돌려줘 아무것도 안 쓰는데, 같은 층에서 두 에이전트가 갈릴 이유가 없다.
    #[test]
    fn removing_from_an_empty_file_writes_nothing() {
        assert_eq!(unmerge_claude("").expect("제거가 된다"), "");

        let home = temp_home("remove-empty");
        uninstall(&home, &script());
        assert!(!claude_settings_path(&home).exists(), "제거가 없던 파일을 만들었다");
        assert!(!codex_config_path(&home).exists(), "제거가 없던 파일을 만들었다");
        let _ = std::fs::remove_dir_all(&home);
    }

    /// **설치 여부는 파일이 답한다.** 앱이 따로 기억하는 상태가 없다는 말이 이렇게
    /// 읽힌다 — 손으로 적어 둔 훅도 「설치됨」이고, 손으로 지운 훅은 「아님」이다.
    #[test]
    fn installed_is_read_from_the_file() {
        assert_eq!(claude_installed("{}", &script()), Ok(Installed::None), "빈 파일이 설치됨이다");

        let installed = merge_claude("{}", &script()).unwrap();
        assert_eq!(claude_installed(&installed, &script()), Ok(Installed::Full), "설치한 파일이 전부가 아니다");

        let removed = unmerge_claude(&installed).unwrap();
        assert_eq!(claude_installed(&removed, &script()), Ok(Installed::None), "제거한 파일이 설치됨이다");
    }

    /// **반쯤 깔린 것은 「일부」다**(프로세스 결정 15 · 프로세스 스펙 S35). 사람이 한 줄을 지웠거나 판이 바뀌어 이벤트가
    /// 늘었을 때, 「설치됨」이라 답하면 사람은 고칠 까닭을 모르고, 「설치 안 됨」이라 답하면 깔린 훅을 안 깔렸다고 한다.
    #[test]
    fn a_half_installed_file_is_partial() {
        let installed = merge_claude("{}", &script()).unwrap();
        let mut value: Value = serde_json::from_str(&installed).unwrap();
        value["hooks"].as_object_mut().unwrap().shift_remove("Stop");

        assert_eq!(claude_installed(&value.to_string(), &script()), Ok(Installed::Partial));
    }

    /// 깨진 파일에서는 **판정을 안 한다.** 「아님」이라 답하면 화면이 설치 버튼을 열고,
    /// 눌러 봐야 병합이 거부해 사람은 왜인지 모른 채 두 번 실패한다.
    #[test]
    fn installed_on_broken_json_is_refused_not_false() {
        assert!(claude_installed("{ 잘렸", &script()).is_err());
    }

    // ── Codex TOML

    /// 실물의 모양이다 — 최상위 키 몇 줄 뒤에 테이블이 줄줄이 선다. **`notify`가 이미
    /// 차 있다**: 거기 물려 둔 다른 도구가 죽으면 안 된다(구현 결정 8 · 스토리 77).
    const CODEX_REAL: &str = r#"model = "gpt-5"
notify = ["SkyComputerUseClient", "turn-ended"]

[projects."/Users/someone/dev/atelier"]
trust_level = "trusted"
"#;

    /// **matcher 그룹과 명령 블록이 짝으로 들어간다**(구현 결정 8). 한쪽만 적히면 TOML이
    /// 통째로 거부돼 사용자의 codex가 안 뜬다 — 그래서 파싱해서 잰다.
    #[test]
    fn codex_gets_a_matcher_group_and_a_command_block_per_event() {
        let merged = merge_codex(CODEX_REAL, &script()).expect("병합이 된다");
        let value: toml::Table = toml::from_str(&merged).expect("TOML이다");

        let hooks = value["hooks"].as_table().expect("`hooks` 테이블이 섰다");
        for event in CODEX_EVENTS {
            let groups = hooks[*event].as_array().unwrap_or_else(|| panic!("`{event}`가 없다"));
            assert_eq!(groups.len(), 1, "`{event}`의 matcher 그룹이 하나가 아니다");
            let inner =
                groups[0]["hooks"].as_array().unwrap_or_else(|| panic!("`{event}`에 명령 블록이 없다"));
            assert_eq!(inner.len(), 1);
            assert_eq!(inner[0]["type"].as_str(), Some("command"));
            assert!(
                inner[0]["command"].as_str().is_some_and(|c| c.contains(crate::shells::HANDLER_NAME)),
                "`{event}`의 명령이 우리 것이 아니다"
            );
        }
    }

    /// **`notify`는 안 건드린다**(스토리 77). 그리고 파일 앞부분이 글자 그대로 살아 있어야
    /// 한다 — 덧붙이기이지 다시 쓰기가 아니다.
    #[test]
    fn codex_notify_and_the_rest_of_the_file_are_untouched() {
        let merged = merge_codex(CODEX_REAL, &script()).unwrap();
        assert!(merged.starts_with(CODEX_REAL), "앞부분이 바뀌었다:\n{merged}");

        let value: toml::Table = toml::from_str(&merged).unwrap();
        assert_eq!(
            value["notify"].as_array().map(Vec::len),
            Some(2),
            "`notify`가 바뀌었다 — 거기 물려 둔 도구가 죽는다"
        );
    }

    /// **파일 끝 개행 유무를 본다.** 마지막 줄에 개행이 없는 파일에 그냥 이어 붙이면
    /// 사용자의 마지막 키와 우리 주석이 한 줄에 붙어 TOML이 깨진다.
    #[test]
    fn codex_without_a_trailing_newline_is_still_valid_toml() {
        let merged = merge_codex("model = \"gpt-5\"", &script()).expect("병합이 된다");
        toml::from_str::<toml::Table>(&merged).expect("TOML이다");
    }

    /// 파일이 아예 없는 것도 정상 경로다 — codex를 처음 쓰는 사람이다.
    #[test]
    fn codex_from_an_empty_file_is_valid_toml() {
        let merged = merge_codex("", &script()).unwrap();
        let value: toml::Table = toml::from_str(&merged).unwrap();
        assert_eq!(value["hooks"].as_table().map(toml::Table::len), Some(CODEX_EVENTS.len()));
    }

    /// 두 번 눌러도 한 번이다 — 여기서는 블록이 두 벌 쌓이면 TOML이 **배열에 원소를
    /// 두 개** 넣어 훅이 두 번 돈다.
    #[test]
    fn merging_codex_twice_is_the_same_as_once() {
        let once = merge_codex(CODEX_REAL, &script()).unwrap();
        let twice = merge_codex(&once, &script()).unwrap();
        assert_eq!(once, twice);
    }

    /// **깨진 TOML은 거부하고 손대지 않는다.**
    #[test]
    fn broken_toml_is_refused() {
        let err = merge_codex("model = ", &script()).expect_err("거부해야 한다");
        assert!(err.contains("손대지 않았습니다"), "무슨 일이 났는지 안 말한다: {err}");
    }

    /// 제거는 설치 전 파일로 **글자까지** 돌아온다.
    #[test]
    fn removing_the_codex_block_leaves_the_file_as_it_was() {
        let installed = merge_codex(CODEX_REAL, &script()).unwrap();
        assert_ne!(installed, CODEX_REAL);
        assert_eq!(unmerge_codex(&installed).unwrap(), CODEX_REAL);
    }

    /// 설치·제거를 되풀이해도 파일 끝에 빈 줄이 쌓이지 않는다.
    #[test]
    fn install_and_remove_can_repeat_without_growing_the_file() {
        let mut now = CODEX_REAL.to_string();
        for _ in 0..3 {
            now = merge_codex(&now, &script()).unwrap();
            now = unmerge_codex(&now).unwrap();
        }
        assert_eq!(now, CODEX_REAL);
    }

    /// 설치 여부는 여기서도 파일이 답한다.
    #[test]
    fn codex_installed_is_read_from_the_file() {
        assert_eq!(codex_installed(CODEX_REAL, &script()), Ok(Installed::None));
        let installed = merge_codex(CODEX_REAL, &script()).unwrap();
        assert_eq!(codex_installed(&installed, &script()), Ok(Installed::Full));
        assert_eq!(codex_installed(&unmerge_codex(&installed).unwrap(), &script()), Ok(Installed::None));
        assert!(codex_installed("model = ", &script()).is_err(), "깨진 파일에서 판정을 하면 안 된다");
    }

    /// **울타리만 있고 알맹이가 빠진 것은 「일부」다.** 사람이 블록 안을 손으로
    /// 지웠거나 판이 바뀌어 이벤트가 늘었을 때 그렇다.
    #[test]
    fn a_codex_block_missing_an_event_is_partial() {
        let installed = merge_codex(CODEX_REAL, &script()).unwrap();
        // 헤더 한 줄만 지운다 — 남은 키들이 위 matcher 그룹으로 흘러들어 **TOML로는
        // 여전히 멀쩡하다.** 그래서 이 케이스가 「파일은 안 깨졌는데 훅은 없다」다.
        let broken = installed.replace("[[hooks.Stop.hooks]]\ntype", "type");
        toml::from_str::<toml::Table>(&broken).expect("여전히 TOML이다");
        assert_eq!(codex_installed(&broken, &script()), Ok(Installed::Partial));
    }

    /// 이 내용에서 그 이벤트에 우리 명령이 앉아 있는가 — 검사 쪽 잣대. 판정 함수와 같은
    /// 길을 따로 걷는다(구현을 그대로 부르면 구현이 틀려도 검사가 같이 틀린다).
    fn codex_ours_count(source: &str, event: &str) -> usize {
        let value: toml::Table = toml::from_str(source).expect("TOML이다");
        let Some(groups) = value.get("hooks").and_then(|h| h.get(event)).and_then(toml::Value::as_array)
        else {
            return 0;
        };
        groups
            .iter()
            .filter(|group| {
                group
                    .get("hooks")
                    .and_then(toml::Value::as_array)
                    .is_some_and(|inner| {
                        inner.iter().any(|h| {
                            h.get("command").and_then(toml::Value::as_str).is_some_and(is_ours)
                        })
                    })
            })
            .count()
    }

    /// 우리 블록과 같은 모양을 **울타리 없이** 손으로 적어 둔 파일.
    fn codex_by_hand(script: &Path) -> String {
        let mut out = String::from(CODEX_REAL);
        for event in CODEX_EVENTS {
            out.push_str(&format!(
                "\n[[hooks.{event}]]\n\n[[hooks.{event}.hooks]]\ntype = \"command\"\ncommand = {}\n",
                toml_basic_string(&codex_command(script, event))
            ));
        }
        out
    }

    /// **울타리는 있는데 우리 명령이 하나 없으면 「일부」다.** 판정 근거는 헤더 줄이 아니라
    /// 명령 문자열이다(구현 결정 8) — 사람이 `command` 줄만 지웠는데 「설치됨」이라 답하면
    /// 사람은 고칠 까닭을 모른다(claude 쪽 `a_half_installed_file_is_partial`과 같은 자리).
    #[test]
    fn a_codex_block_without_one_of_our_commands_is_partial() {
        let installed = merge_codex(CODEX_REAL, &script()).unwrap();
        let line = format!("command = {}\n", toml_basic_string(&codex_command(&script(), "Stop")));
        let gutted = installed.replace(&line, "");
        assert_ne!(gutted, installed, "지울 줄을 못 찾았다 — 검사가 아무것도 안 재고 있다");
        toml::from_str::<toml::Table>(&gutted).expect("여전히 TOML이다");

        assert_eq!(codex_installed(&gutted, &script()), Ok(Installed::Partial), "명령이 빠졌는데 「전부」다");
    }

    /// **손으로 적어 둔 codex 훅도 「설치됨」이다** — claude 쪽 짝
    /// (`a_hand_written_hook_reads_as_installed`)과 같은 잣대여야 한다. 그리고 그 위에
    /// 설치를 눌러도 **사본이 하나 더 붙지 않는다**: 붙으면 이벤트마다 훅이 두 번 돈다.
    #[test]
    fn a_hand_written_codex_hook_reads_as_installed_and_is_not_doubled() {
        let by_hand = codex_by_hand(&script());
        assert_eq!(codex_installed(&by_hand, &script()), Ok(Installed::Full), "손으로 적은 훅이 「전부」가 아니다");

        let merged = merge_codex(&by_hand, &script()).expect("병합이 된다");
        toml::from_str::<toml::Table>(&merged).expect("TOML이다");
        for event in CODEX_EVENTS {
            assert_eq!(codex_ours_count(&merged, event), 1, "`{event}`에 우리 명령이 두 벌이다");
        }
    }

    // ── 디스크에 넣는 층

    fn temp_home(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("atelier-hooks-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".claude")).unwrap();
        dir
    }

    /// **쓰기 전에 `.bak` 한 벌**(구현 결정 8). 내 설정을 앱에 맡기는 일이라, 병합이
    /// 잘못돼도 사람이 손으로 되돌릴 벌이 옆에 있어야 한다.
    ///
    /// **원자적이어야 한다.** 반쯤 쓰인 `settings.json`은 claude가 아예 안 뜨는 상태다 —
    /// 임시 파일이 그 자리에 남아 있으면 그 보장은 이미 깨진 것이다(`settings.rs`의 같은 검사).
    #[test]
    fn writing_leaves_a_backup_and_no_tmp() {
        let home = temp_home("backup");
        let path = claude_settings_path(&home);
        let before = "{\n  \"model\": \"opus\"\n}\n";
        std::fs::write(&path, before).unwrap();

        apply(&path, |source| merge_claude(source, &script())).expect("넣는다");

        assert_eq!(
            std::fs::read_to_string(path.with_extension("json.bak")).expect(".bak이 없다"),
            before,
            ".bak이 쓰기 전 내용이 아니다"
        );
        assert!(std::fs::read_to_string(&path).unwrap().contains(crate::shells::HANDLER_NAME));

        let leftovers: Vec<String> = std::fs::read_dir(home.join(".claude"))
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "임시 파일이 남았다: {leftovers:?}");
        let _ = std::fs::remove_dir_all(&home);
    }

    /// **원본의 권한을 그대로 물려준다.** 이 판이 새로 여는 자리는 **남의 홈**이라
    /// (`~/.claude/settings.json` · `~/.codex/config.toml`) 여기서 넓어지는 것은 우리 파일이
    /// 아니라 사람이 일부러 좁혀 둔 파일이다 — 실물 둘 다 0600이고 `env` 구획이 앉아 있다.
    ///
    /// **원자적 교체가 바로 그 자리다.** 새로 만든 tmp의 모드는 `0666 & !umask`(보통 0644)이고
    /// rename은 그 모드를 목적지로 그대로 옮긴다. `.bak`은 `std::fs::copy`라 0600으로 남으므로,
    /// 안 고치면 **백업만 좁고 살아 있는 설정이 넓어지는** 뒤집힌 모양이 된다.
    #[cfg(unix)]
    #[test]
    fn writing_keeps_the_files_mode() {
        use std::os::unix::fs::PermissionsExt;

        let home = temp_home("mode");
        let path = claude_settings_path(&home);
        std::fs::write(&path, "{\n  \"model\": \"opus\"\n}\n").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();

        apply(&path, |source| merge_claude(source, &script())).expect("넣는다");

        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(
            format!("{mode:o}"),
            "600",
            "설치 한 번이 남의 설정을 이 기계의 다른 사용자에게 열었다"
        );
        let _ = std::fs::remove_dir_all(&home);
    }

    /// **심링크를 끊지 않는다.** dotfiles 저장소에서 `~/.claude/settings.json`을 심링크로 걸어
    /// 둔 사람은 설치 한 번에 그것이 보통 파일로 갈리고, 그 뒤 저장소를 고쳐도 claude에
    /// 안 닿는다 — 조용하고 되돌리기 어려운 손해라 rename의 목적지를 실물로 고른다.
    #[cfg(unix)]
    #[test]
    fn writing_does_not_break_a_symlink() {
        let home = temp_home("symlink");
        let real = home.join("dotfiles-settings.json");
        std::fs::write(&real, "{\n  \"model\": \"opus\"\n}\n").unwrap();
        let path = claude_settings_path(&home);
        std::os::unix::fs::symlink(&real, &path).unwrap();

        apply(&path, |source| merge_claude(source, &script())).expect("넣는다");

        assert!(
            std::fs::symlink_metadata(&path).unwrap().file_type().is_symlink(),
            "심링크가 보통 파일로 갈렸다 — 저장소를 고쳐도 이제 claude에 안 닿는다"
        );
        assert!(
            std::fs::read_to_string(&real).unwrap().contains(crate::shells::HANDLER_NAME),
            "심링크 너머의 진짜 파일이 안 바뀌었다"
        );
        let _ = std::fs::remove_dir_all(&home);
    }

    /// **걷은 것이 하나도 없으면 디스크에 손이 안 간다.** 순수 함수 층의
    /// `a_file_without_our_hooks_is_untouched_by_removal`이 「내용이 안 바뀐다」까지만 재고,
    /// 그 인정이 여기까지 안 이어져 있었다 — `apply`의 판정은 **글자 일치**라, 사람이 손으로
    /// 4칸 들여쓰기로 관리하던 파일은 우리 것이 하나도 없어도 통째로 재작성되고 `.bak`이 뜬다.
    /// 우리가 지운 것은 없는데 남의 파일만 바뀌어 있는 자리다(git dotfiles라면 전체가 diff).
    #[test]
    fn removing_touches_nothing_when_there_was_nothing_of_ours() {
        let home = temp_home("remove-untouched");
        let path = claude_settings_path(&home);
        // 4칸 들여쓰기 · 끝 개행 없음 — serde_json의 pretty 출력과 글자가 다르다.
        let before = "{\n    \"model\": \"opus\"\n}";
        std::fs::write(&path, before).unwrap();

        uninstall(&home, &script());

        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            before,
            "우리 것이 하나도 없는데 남의 파일을 다시 썼다"
        );
        assert!(!path.with_extension("json.bak").exists(), "걷은 것이 없는데 벌을 떴다");
        let _ = std::fs::remove_dir_all(&home);
    }

    /// **못 걷은 것이 있으면 화면이 그것을 말한다.** codex 쪽 제거는 우리 울타리 두 줄만 보고
    /// 잘라내므로(`strip_codex_block`), 사람이 울타리 밖에 손으로 적어 둔 우리 훅은 그대로
    /// 산다 — 그런데 판정(`codex_installed`)은 명령 문자열이라 「설치됨」이다. 두 잣대가
    /// 갈린 채 침묵하면 사람은 「제거를 눌렀는데 아무 일도 안 나고 여전히 설치됨」을 만나고,
    /// 화면에는 그 사실을 알릴 칸이 없다.
    ///
    /// claude 쪽은 명령 문자열로 걷으니 손글씨도 사라진다 — 그래서 그쪽은 아무 말도 안 한다.
    #[test]
    fn a_hook_we_could_not_remove_is_said_out_loud() {
        let home = temp_home("codex-by-hand");
        std::fs::create_dir_all(home.join(".codex")).unwrap();
        std::fs::write(codex_config_path(&home), codex_by_hand(&script())).unwrap();

        let by_hand: serde_json::Map<String, Value> = CLAUDE_EVENTS
            .iter()
            .map(|event| ((*event).to_string(), json!([claude_group(&script(), event)])))
            .collect();
        std::fs::write(
            claude_settings_path(&home),
            json!({ "hooks": Value::Object(by_hand) }).to_string(),
        )
        .unwrap();

        let gone = uninstall(&home, &script());

        let codex = agent(&gone, "codex");
        assert_eq!(codex.installed, Installed::Full, "이 파일은 여전히 우리 명령을 들고 있다");
        let said = codex.write_error.clone().unwrap_or_default();
        assert!(
            said.contains("config.toml")
                && said.contains(crate::shells::SCRIPT_NAME)
                && said.contains(crate::shells::HANDLER_NAME),
            "제거가 조용히 아무 일도 안 했다 — 어느 파일의 무엇을 지워야 하는지 화면이 말할 것이 없다: {said:?}"
        );

        let claude = agent(&gone, "claude");
        assert_eq!(claude.installed, Installed::None, "claude 쪽 손글씨가 안 걷혔다");
        assert_eq!(claude.write_error, None, "다 걷었는데 남았다고 말한다");
        let _ = std::fs::remove_dir_all(&home);
    }

    /// **바뀔 것이 없으면 안 쓴다.** 두 번째 설치가 파일을 다시 쓰면 `.bak`이 「우리 훅이
    /// 이미 든 내용」으로 덮여, 되돌릴 벌이 사라진다.
    #[test]
    fn a_second_install_does_not_overwrite_the_backup() {
        let home = temp_home("twice");
        let path = claude_settings_path(&home);
        let before = "{\n  \"model\": \"opus\"\n}\n";
        std::fs::write(&path, before).unwrap();

        apply(&path, |s| merge_claude(s, &script())).unwrap();
        apply(&path, |s| merge_claude(s, &script())).unwrap();

        assert_eq!(
            std::fs::read_to_string(path.with_extension("json.bak")).unwrap(),
            before,
            "두 번째 설치가 되돌릴 벌을 덮어썼다"
        );
        let _ = std::fs::remove_dir_all(&home);
    }

    /// 깨진 파일은 **손대지 않는다** — 원문 그대로 남고 `.bak`도 안 생긴다.
    #[test]
    fn a_broken_file_is_left_alone_on_disk() {
        let home = temp_home("broken-disk");
        let path = claude_settings_path(&home);
        let before = "{ 여기서 잘렸";
        std::fs::write(&path, before).unwrap();

        apply(&path, |s| merge_claude(s, &script())).expect_err("거부해야 한다");

        assert_eq!(std::fs::read_to_string(&path).unwrap(), before, "깨진 파일을 고쳤다");
        assert!(!path.with_extension("json.bak").exists(), "손도 안 댔는데 벌을 떴다");
        let _ = std::fs::remove_dir_all(&home);
    }

    /// 폴더가 없는 것도 정상 경로다 — codex를 처음 쓰는 사람의 홈에는 `~/.codex`가 없다.
    #[test]
    fn a_missing_folder_is_created() {
        let home = temp_home("no-folder");
        let path = codex_config_path(&home);
        assert!(!path.parent().unwrap().exists());

        apply(&path, |s| merge_codex(s, &script())).expect("넣는다");

        let written = std::fs::read_to_string(&path).unwrap();
        toml::from_str::<toml::Table>(&written).expect("TOML이다");
        let _ = std::fs::remove_dir_all(&home);
    }

    // ── 화면이 보는 창구

    fn agent<'a>(list: &'a [HookStatus], name: &str) -> &'a HookStatus {
        list.iter().find(|s| s.agent == name).unwrap_or_else(|| panic!("`{name}`이 없다"))
    }

    /// 설치 → 상태 → 제거가 한 바퀴 돈다. **판정은 늘 파일에서 온다**(구현 결정 8).
    #[test]
    fn install_then_status_then_uninstall() {
        let home = temp_home("round");

        let before = status(&home, &script());
        assert_eq!(before.len(), 2, "에이전트가 둘이다");
        assert_eq!(agent(&before, "claude").installed, Installed::None);
        assert_eq!(agent(&before, "codex").installed, Installed::None);

        let after = install(&home, &script());
        assert_eq!(agent(&after, "claude").installed, Installed::Full, "{:?}", agent(&after, "claude").error);
        assert_eq!(agent(&after, "codex").installed, Installed::Full, "{:?}", agent(&after, "codex").error);
        // **새로 물어봐도 같은 답이다** — 방금 돌려준 값이 앱의 기억이 아니라 파일의 사실이다.
        assert_eq!(status(&home, &script()), after);

        let gone = uninstall(&home, &script());
        assert_eq!(agent(&gone, "claude").installed, Installed::None);
        assert_eq!(agent(&gone, "codex").installed, Installed::None);
        let _ = std::fs::remove_dir_all(&home);
    }

    /// **한쪽이 깨져도 다른 쪽은 깔린다.** 한 번의 거부가 둘을 다 막으면, codex 설정을
    /// 손으로 고칠 때까지 claude 쪽 신호도 못 켠다.
    #[test]
    fn a_broken_file_on_one_side_does_not_block_the_other() {
        let home = temp_home("one-broken");
        std::fs::create_dir_all(home.join(".codex")).unwrap();
        std::fs::write(codex_config_path(&home), "model = ").unwrap();

        let after = install(&home, &script());
        assert_eq!(agent(&after, "claude").installed, Installed::Full, "claude가 codex 때문에 막혔다");

        let codex = agent(&after, "codex");
        assert_eq!(codex.installed, Installed::None);
        assert!(codex.error.is_some(), "왜 안 됐는지 화면이 말할 것이 없다");
        assert_eq!(
            std::fs::read_to_string(codex_config_path(&home)).unwrap(),
            "model = ",
            "깨진 파일을 고쳤다"
        );
        let _ = std::fs::remove_dir_all(&home);
    }

    /// **손으로 적어 둔 훅도 「설치됨」이다.** 앱이 따로 기억하는 상태가 없다는 말이
    /// 이렇게 읽힌다 — 이 경로는 `install`을 한 번도 안 지났다.
    #[test]
    fn a_hand_written_hook_reads_as_installed() {
        let home = temp_home("hand-written");
        let by_hand: serde_json::Map<String, Value> = CLAUDE_EVENTS
            .iter()
            .map(|event| ((*event).to_string(), json!([claude_group(&script(), event)])))
            .collect();
        std::fs::write(
            claude_settings_path(&home),
            json!({ "hooks": Value::Object(by_hand) }).to_string(),
        )
        .unwrap();

        assert_eq!(agent(&status(&home, &script()), "claude").installed, Installed::Full);
        let _ = std::fs::remove_dir_all(&home);
    }

    /// **미리보기는 실제로 들어가는 글자다**(스토리 73). 화면이 따로 적으면 「무엇이
    /// 어디에 들어가는지 보여 준다」는 약속이 실물과 조용히 갈린다.
    ///
    /// **이름이 「빈 홈」인 이유:** claude 쪽 미리보기는 `merge_claude("{}")`, 곧 설정이
    /// 비어 있을 때의 결과다. 이미 내용이 있는 파일에서는 그 등식이 안 선다 — 거기서
    /// 지켜야 하는 것은 「미리보기가 보인 것이 다 들어간다」이고, 그것은 아래 검사가 잰다.
    #[test]
    fn the_preview_is_what_goes_into_an_empty_home() {
        let home = temp_home("preview");
        let before = status(&home, &script());
        install(&home, &script());

        let claude = std::fs::read_to_string(claude_settings_path(&home)).unwrap();
        assert_eq!(agent(&before, "claude").preview, claude, "미리보기가 실물과 다르다");

        let codex = std::fs::read_to_string(codex_config_path(&home)).unwrap();
        assert!(codex.contains(&agent(&before, "codex").preview), "미리보기가 실물과 다르다");

        // **어느 파일인지 값으로 못박는다.** 「`.c`가 들어 있다」는 두 경로 아무 데나
        // 걸려, 두 에이전트의 경로가 뒤바뀌어도 검사가 아무 말을 안 한다. (여기서 `~`로
        // 안 접히는 것은 임시 홈이 진짜 홈이 아니어서다 — 접는 자리는 `collapse_home`이다.)
        assert_eq!(
            agent(&before, "claude").path,
            claude_settings_path(&home).to_string_lossy(),
            "claude 칸이 claude 파일을 안 가리킨다"
        );
        assert_eq!(
            agent(&before, "codex").path,
            codex_config_path(&home).to_string_lossy(),
            "codex 칸이 codex 파일을 안 가리킨다"
        );
        assert!(agent(&before, "claude").path.ends_with("/.claude/settings.json"));
        assert!(agent(&before, "codex").path.ends_with("/.codex/config.toml"));
        let _ = std::fs::remove_dir_all(&home);
    }

    /// **내용이 이미 있는 파일에서도 미리보기가 보인 것은 다 들어간다.** 실물이 그
    /// 경우다(구현 결정 8 — 사용자의 `settings.json`에 codegraph 훅이 이미 있다).
    #[test]
    fn an_existing_file_gets_everything_the_preview_showed() {
        let home = temp_home("preview-existing");
        let before = r#"{"model":"opus","hooks":{"UserPromptSubmit":[{"hooks":[{"type":"command","command":"codegraph prompt-hook"}]}]}}"#;
        std::fs::write(claude_settings_path(&home), before).unwrap();

        let shown = agent(&status(&home, &script()), "claude").preview.clone();
        install(&home, &script());
        let after: Value =
            serde_json::from_str(&std::fs::read_to_string(claude_settings_path(&home)).unwrap())
                .unwrap();

        assert_eq!(after["model"], "opus", "우리 키 밖의 내용이 사라졌다");
        let shown: Value = serde_json::from_str(&shown).expect("미리보기가 JSON이다");
        for (event, groups) in shown["hooks"].as_object().expect("미리보기에 `hooks`가 있다") {
            let ours = groups[0]["hooks"][0]["command"].as_str().expect("명령이 있다");
            let landed = after["hooks"][event]
                .as_array()
                .is_some_and(|list| list.iter().any(|g| g["hooks"][0]["command"] == ours));
            assert!(landed, "미리보기가 보인 `{event}`이 파일에 없다");
        }
        let _ = std::fs::remove_dir_all(&home);
    }

    /// **쓰기가 실패했다고 아는 사실을 「모른다」로 지우지 않는다.** 파일이 읽기 전용이면
    /// 제거의 쓰기만 실패하고 판정은 멀쩡히 된다 — 그때 화면이 「확인 못 함」이라 적으면
    /// 이 판이 세운 낱말들(설치됨·업데이트 필요·설치 안 됨·확인 못 함)의 뜻이 그 자리에서 깨진다.
    /// 그래서 칸이 둘이다: `write_error`는 방금 난 일, `error`는 판정을 못 한 까닭.
    #[test]
    fn a_write_failure_does_not_erase_what_we_know() {
        let home = temp_home("write-failed");
        install(&home, &script());

        let one = look(&AGENTS[0], &home, &script(), Some("설정을 쓰지 못했습니다".to_string()));
        assert_eq!(one.installed, Installed::Full, "읽어서 아는 사실을 쓰기 실패가 지웠다");
        assert_eq!(one.error, None, "판정은 됐는데 「확인 못 함」 칸에 적혔다");
        assert_eq!(one.write_error.as_deref(), Some("설정을 쓰지 못했습니다"));
        let _ = std::fs::remove_dir_all(&home);
    }

    // ── 새 처리기의 줄과 갱신(프로세스 결정 15 · 프로세스 스펙 S28 · S35 · P5 · 티켓 21)

    /// **claude 훅은 처리기를 셸 없이 곧바로 부르는 `args` 꼴이다**(구현 기록 19절 — 훅마다 셸 한 벌을 던다). 경로는 따옴표로
    /// 안 감싼다 — 셸이 없으니 따옴표가 글자 그대로 파일 이름이 된다. 셋째 인자가 목록의 판이다(P5). 처리기는 셋째부터 안 읽는다.
    #[test]
    fn a_claude_hook_calls_the_handler_directly_with_the_list_version() {
        let merged: Value = serde_json::from_str(&merge_claude("{}", &script()).unwrap()).unwrap();
        for event in CLAUDE_EVENTS {
            let hook = &merged["hooks"][*event][0]["hooks"][0];
            assert_eq!(hook["type"], "command");
            assert_eq!(
                hook["command"], "/Users/someone/.atelier/hooks/atelier-hook.zsh",
                "`{event}`의 명령이 처리기 경로 그대로가 아니다: {hook}"
            );
            assert_eq!(hook["args"], json!(["claude", event, format!("list-{LIST_VERSION}")]), "`{event}`의 인자: {hook}");
        }
    }

    /// **codex에는 `args`가 없다** — 명령줄이 제 셸의 `-c`로 돈다(구현 기록 19절). 경로를 홑따옴표로 감싸고(sh · bash · zsh가 같게
    /// 읽는다) 판을 맨 끝 낱말로 싣는다.
    #[test]
    fn a_codex_hook_is_a_quoted_command_line_ending_in_the_list_version() {
        let value: toml::Table = toml::from_str(&codex_block(&script())).unwrap();
        for event in CODEX_EVENTS {
            assert_eq!(
                value["hooks"][*event][0]["hooks"][0]["command"].as_str(),
                Some(format!("'/Users/someone/.atelier/hooks/atelier-hook.zsh' codex {event} list-{LIST_VERSION}").as_str()),
            );
        }
    }

    /// **적어 넣은 줄이 처리기를 실제로 돌린다** — 에이전트가 부르는 모양 그대로다. claude는 `command`를 실행 파일로 `args`와 함께
    /// 곧바로 띄우고, codex는 명령줄을 셸의 `-c`로 돌린다. 판을 실은 셋째 낱말에 처리기가 걸려 넘어져도 훅은 늘 0으로 끝나고 아무
    /// 말도 안 남긴다(fail-open) — 어느 층도 안 빨개지고 셸만 영영 조용하다. 그래서 글자가 아니라 처리기가 남긴 상태 파일로 잰다.
    ///
    /// 셸 키는 이 검사만의 것(`test-<pid>-21`)이고 데이터 루트 · `HOME`은 임시 폴더다 — 진짜 셸의 파일과 안 겹친다.
    #[test]
    fn the_installed_lines_run_the_handler() {
        let root = temp_home("run-installed");
        crate::shells::write_hook_script(&root).expect("처리기를 세운다");
        let handler = crate::shells::handler_path(&root);
        let shell = format!("test-{}-21", std::process::id());

        let claude: Value = serde_json::from_str(&merge_claude("{}", &handler).unwrap()).unwrap();
        let hook = &claude["hooks"]["Stop"][0]["hooks"][0];
        let mut command = std::process::Command::new(hook["command"].as_str().expect("명령이 있다"));
        command.args(hook["args"].as_array().expect("인자가 있다").iter().map(|arg| arg.as_str().expect("글자다")));
        let written = run_once(command, &root, &shell);
        assert_eq!((written["agent"].as_str(), written["event"].as_str()), (Some("claude"), Some("Stop")), "{written}");

        let codex: toml::Table = toml::from_str(&codex_block(&handler)).unwrap();
        let line = codex["hooks"]["SessionEnd"][0]["hooks"][0]["command"].as_str().expect("명령줄이 있다");
        let mut command = std::process::Command::new("/bin/sh");
        command.arg("-c").arg(line);
        let written = run_once(command, &root, &shell);
        assert_eq!((written["agent"].as_str(), written["event"].as_str()), (Some("codex"), Some("SessionEnd")), "{written}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 훅 한 번을 에이전트처럼 띄운다 — 셸 키 · 데이터 루트 · `HOME`을 명시하고 페이로드를 준 뒤, 처리기가 남긴 상태 파일을 읽는다.
    /// `ATELIER_SHELL`은 늘 명시한다: 검사 프로세스는 이 앱의 셸에서 떠 진짜 셸 키를 물려받았다.
    fn run_once(mut command: std::process::Command, root: &Path, shell: &str) -> Value {
        use std::io::Write;

        let state = crate::shells::state_path(root, shell);
        let _ = std::fs::remove_file(&state);
        let mut child = command
            .env("ATELIER_SHELL", shell)
            .env("ATELIER_HOME", root)
            .env("HOME", root)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .unwrap_or_else(|e| panic!("훅이 안 뜬다({e}): {command:?}"));
        child.stdin.take().expect("stdin이 열려 있다").write_all(b"{}").expect("페이로드를 준다");
        let out = child.wait_with_output().expect("끝난다");
        assert!(out.status.success(), "훅이 0이 아닌 코드로 끝났다: {out:?}");
        let written = std::fs::read_to_string(&state)
            .unwrap_or_else(|e| panic!("처리기가 상태 파일을 안 남겼다({e}) — 적어 넣은 줄로는 처리기가 안 돈다: {command:?}"));
        serde_json::from_str(&written).expect("상태 파일이 JSON이다")
    }

    /// **우리 훅이 하나라도 있으면 지금 목록 전부로 맞춘다**(프로세스 결정 15). 옛 다섯만 깔린 설정도, 하나만 남은 설정도 — 우리
    /// 항목을 걷고 지금 모양으로 다시 넣는다. 옛 python 명령줄은 하나도 안 남는다.
    #[test]
    fn an_old_install_is_brought_to_the_current_list() {
        for events in [&OLD_CLAUDE[..], &["Stop"][..]] {
            let source = serde_json::to_string_pretty(&json!({ "hooks": old_claude_hooks(events) })).unwrap();
            assert_eq!(claude_installed(&source, &script()), Ok(Installed::Partial), "옛 설치가 「일부」가 아니다: {events:?}");

            let merged = merge_claude(&source, &script()).expect("맞춘다");
            let value: Value = serde_json::from_str(&merged).unwrap();
            for event in CLAUDE_EVENTS {
                assert_eq!(value["hooks"][*event], json!([claude_group(&script(), event)]), "`{event}`가 지금 줄 하나가 아니다: {merged}");
            }
            assert!(!merged.contains(crate::shells::SCRIPT_NAME), "옛 명령줄이 남았다: {merged}");
            assert_eq!(claude_installed(&merged, &script()), Ok(Installed::Full));
        }
    }

    /// **남의 항목과 그 순서는 그대로다**(프로세스 결정 15). 우리 것이 남의 것 사이에 끼어 있어도 걷고 나면 남의 것은 제 차례
    /// 그대로 서고, 우리 것은 그 이벤트의 맨 뒤에 다시 선다. 파일의 바깥 키와 이벤트의 차례도 그대로다.
    #[test]
    fn foreign_hooks_and_their_order_survive_an_update() {
        let codegraph = json!({ "hooks": [{ "type": "command", "command": "codegraph prompt-hook" }] });
        let greet = json!({ "hooks": [{ "type": "command", "command": "say hi" }] });
        let audit = json!({ "matcher": "Bash", "hooks": [{ "type": "command", "command": "audit" }] });
        let note = json!({ "hooks": [{ "type": "command", "command": "notify-send" }] });
        let old = |event: &str| json!({ "hooks": [old_claude_hook(event)] });
        let source = serde_json::to_string_pretty(&json!({
            "model": "opus",
            "hooks": {
                "UserPromptSubmit": [codegraph.clone(), old("UserPromptSubmit"), greet.clone()],
                "Notification": [note.clone()],
                "Stop": [old("Stop"), audit.clone()],
            },
            "env": { "A": "1" },
        }))
        .unwrap();

        let merged = merge_claude(&source, &script()).unwrap();
        let value: Value = serde_json::from_str(&merged).unwrap();

        let keys: Vec<&str> = value.as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(keys, ["model", "hooks", "env"], "바깥 키의 차례가 바뀌었다");
        let events: Vec<&str> = value["hooks"].as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(&events[..3], ["UserPromptSubmit", "Notification", "Stop"], "이벤트의 차례가 바뀌었다");
        assert_eq!(value["hooks"]["UserPromptSubmit"], json!([codegraph, greet, claude_group(&script(), "UserPromptSubmit")]));
        assert_eq!(value["hooks"]["Stop"], json!([audit, claude_group(&script(), "Stop")]));
        assert_eq!(value["hooks"]["Notification"], json!([note]));
        assert_eq!(value["env"], json!({ "A": "1" }));
    }

    /// **갱신이 옛 항목의 `async`를 맞춘다**(프로세스 스펙 S25 · 결정 15). 도구 사건에 빠진 것은 붙이고, 동기여야 할 사건에 붙은
    /// 것은 뗀다. 명령줄은 이미 지금 것이다 — `async`만 어긋나도 「일부」이고, 갱신이 그것을 고친다.
    #[test]
    fn the_update_sets_async_where_the_list_says() {
        let tools = ["PreToolUse", "PostToolUse", "PostToolUseFailure"];
        let mut hooks = Map::new();
        for event in CLAUDE_EVENTS {
            let mut hook = claude_group(&script(), event)["hooks"][0].clone();
            let hook_map = hook.as_object_mut().unwrap();
            // 뒤집는다 — 도구 셋에서는 떼고, 턴의 끝에는 붙인다.
            if tools.contains(event) {
                hook_map.shift_remove("async");
            } else if *event == "Stop" {
                hook_map.insert("async".into(), Value::Bool(true));
            }
            hooks.insert((*event).to_string(), json!([{ "hooks": [hook] }]));
        }
        let source = json!({ "hooks": hooks }).to_string();
        assert_eq!(claude_installed(&source, &script()), Ok(Installed::Partial), "`async`가 어긋났는데 「전부」다");

        let merged: Value = serde_json::from_str(&merge_claude(&source, &script()).unwrap()).unwrap();
        for event in CLAUDE_EVENTS {
            let groups = merged["hooks"][*event].as_array().unwrap();
            assert_eq!(groups.len(), 1, "`{event}`에 우리 줄이 겹쳤다: {merged}");
            let hook = &groups[0]["hooks"][0];
            let want = tools.contains(event).then_some(&Value::Bool(true));
            assert_eq!(hook.get("async"), want, "`{event}`의 async가 목록과 다르다: {hook}");
        }
    }

    /// **옛 이름과 새 이름을 모두 우리 것으로 알아보고 지금 줄로 갈아 끼운다**(프로세스 스펙 S28). 옛 python 명령줄, 새 처리기를
    /// 셸 꼴로 적은 줄, `args` 꼴이지만 판이 없는 줄, 옛 줄이 지금 줄 곁에 겹친 것 — 모두 이벤트마다 지금 줄 하나가 된다. 겹친 채
    /// 두면 그 이벤트에서 처리기가 두 번 돈다. 걷기도 두 이름을 다 안다.
    #[test]
    fn old_and_new_names_are_both_ours_and_give_way_to_the_current_line() {
        let current = |event: &str| claude_group(&script(), event);
        let source = json!({ "hooks": {
            "Stop": [{ "hooks": [old_claude_hook("Stop")] }],
            "PreToolUse": [{ "hooks": [{ "type": "command", "command": command_line(&script(), CLAUDE, "PreToolUse"), "async": true }] }],
            "PostToolUse": [{ "hooks": [{ "type": "command", "command": script().to_string_lossy(), "args": [CLAUDE, "PostToolUse"], "async": true }] }],
            "UserPromptSubmit": [{ "hooks": [old_claude_hook("UserPromptSubmit")] }, current("UserPromptSubmit")],
        }})
        .to_string();
        assert_eq!(claude_installed(&source, &script()), Ok(Installed::Partial));

        let merged = merge_claude(&source, &script()).unwrap();
        let value: Value = serde_json::from_str(&merged).unwrap();
        for event in CLAUDE_EVENTS {
            assert_eq!(value["hooks"][*event], json!([current(event)]), "`{event}`가 지금 줄 하나가 아니다: {merged}");
        }

        let removed = unmerge_claude(&source).unwrap();
        assert!(!removed.contains("atelier-hook"), "제거가 한쪽 이름만 걷었다: {removed}");
    }

    /// **codex는 울타리 구획을 통째로 새것으로 바꾼다**(프로세스 결정 15). 옛 다섯의 python 구획이 지금 목록의 새 구획 하나가 되고,
    /// 울타리 앞의 사람 글은 글자 그대로다.
    #[test]
    fn the_codex_block_is_replaced_whole() {
        let source = codex_with_old_block(&OLD_CODEX);
        toml::from_str::<toml::Table>(&source).expect("옛 구획도 TOML이다");
        assert_eq!(codex_installed(&source, &script()), Ok(Installed::Partial), "옛 구획인데 「일부」가 아니다");

        let merged = merge_codex(&source, &script()).unwrap();
        assert_eq!(merged, format!("{CODEX_REAL}\n{}", codex_block(&script())), "구획이 통째로 새것이 아니다");
        assert_eq!(codex_installed(&merged, &script()), Ok(Installed::Full));
    }

    /// **설치 상태는 셋이다**(프로세스 결정 15 · 프로세스 스펙 S35): 우리 훅이 하나도 없으면 없음, 지금 목록 전부가 지금 모양으로
    /// 있을 때만 전부, 그 사이는 일부다. `async`가 하나 빠진 것도, 옛 명령줄이 하나 남은 것도, 목록 밖 이벤트에 우리 줄이 남은
    /// 것도 일부다 — 앱이 뜰 때 맞추거나 설치 버튼이 고칠 것이 남았다.
    #[test]
    fn the_claude_install_state_is_none_partial_or_full() {
        let full = merge_claude("{}", &script()).unwrap();
        let edited = |edit: &dyn Fn(&mut Map<String, Value>)| {
            let mut value: Value = serde_json::from_str(&full).unwrap();
            edit(value["hooks"].as_object_mut().unwrap());
            value.to_string()
        };
        let state = |source: &str| claude_installed(source, &script()).unwrap();
        let foreign = json!({ "hooks": [{ "type": "command", "command": "say done" }] });

        assert_eq!(state("{}"), Installed::None);
        assert_eq!(state(&json!({ "hooks": { "Stop": [foreign.clone()] } }).to_string()), Installed::None, "남의 훅을 우리 것으로 읽었다");
        assert_eq!(state(&full), Installed::Full);
        assert_eq!(
            state(&edited(&|hooks| {
                hooks["PostToolUse"][0]["hooks"][0].as_object_mut().unwrap().shift_remove("async");
            })),
            Installed::Partial,
            "도구 사건의 async가 빠졌는데 「전부」다"
        );
        assert_eq!(
            state(&edited(&|hooks| {
                hooks["Stop"] = json!([{ "hooks": [old_claude_hook("Stop")] }]);
            })),
            Installed::Partial,
            "옛 명령줄이 남았는데 「전부」다"
        );
        assert_eq!(
            state(&edited(&|hooks| {
                hooks["Stop"].as_array_mut().unwrap().push(json!({ "hooks": [old_claude_hook("Stop")] }));
            })),
            Installed::Partial,
            "옛 줄이 지금 줄 곁에 겹쳤는데 「전부」다"
        );
        assert_eq!(
            state(&edited(&|hooks| {
                hooks.shift_remove("SubagentStop");
            })),
            Installed::Partial,
            "이벤트가 하나 빠졌는데 「전부」다"
        );
        assert_eq!(
            state(&edited(&|hooks| {
                hooks.insert("Notification".into(), json!([claude_group(&script(), "Notification")]));
            })),
            Installed::Partial,
            "목록 밖 이벤트에 우리 줄이 남았는데 「전부」다"
        );
        // 남의 훅이 곁에 있어도 우리 것이 지금 모양이면 전부다.
        assert_eq!(
            state(&edited(&|hooks| {
                hooks["Stop"].as_array_mut().unwrap().insert(0, foreign.clone());
            })),
            Installed::Full
        );
    }

    /// codex 쪽의 셋. 옛 구획 · 명령 하나가 빠진 구획은 일부이고(`a_codex_block_without_one_of_our_commands_is_partial`), 목록 밖
    /// 이벤트에 우리 줄이 남은 것도 일부다.
    #[test]
    fn the_codex_install_state_is_none_partial_or_full() {
        let state = |source: &str| codex_installed(source, &script()).unwrap();
        let full = merge_codex(CODEX_REAL, &script()).unwrap();

        assert_eq!(state(CODEX_REAL), Installed::None);
        assert_eq!(state(&full), Installed::Full);
        assert_eq!(state(&codex_with_old_block(&OLD_CODEX)), Installed::Partial, "옛 구획인데 「전부」다");
        let stray = format!(
            "{full}\n[[hooks.Notification]]\n\n[[hooks.Notification.hooks]]\ntype = \"command\"\ncommand = {}\n",
            toml_basic_string(&codex_command(&script(), "Notification"))
        );
        assert_eq!(state(&stray), Installed::Partial, "목록 밖 이벤트에 우리 줄이 남았는데 「전부」다");
    }

    /// **설치 상태는 선 위에서 `"none"` · `"partial"` · `"full"`이다** — 프런트 `HookInstalled`(`settings/types.ts`)의 짝이다.
    /// 화면은 이 글자로 낱말 표(`hookStateLabel`)를 고른다. 이름을 바꾸거나 `rename_all`을 바꾸면 어느 층도 안 빨개진 채
    /// 화면의 낱말만 빈다 — L2 · L3는 손으로 적은 답을 쓰고, 이 글자를 재는 것은 이 검사 하나다.
    #[test]
    fn the_install_state_goes_over_the_wire_as_none_partial_or_full() {
        for (installed, wire) in [(Installed::None, "none"), (Installed::Partial, "partial"), (Installed::Full, "full")] {
            assert_eq!(serde_json::to_value(installed).unwrap(), wire, "설치 상태 {installed:?}의 글자가 다르다");
        }
    }

    /// **파일에 적힌 목록의 판이 이 빌드보다 새로우면 맞추지 않는다**(프로세스 스펙 P5). 목록이 다른 두 빌드를 번갈아 켜도 서로
    /// 되쓰지 않게 — 새 빌드가 쓴 파일을 옛 빌드가 옛 목록으로 되돌리지 않는다. 설치 버튼(같은 병합)도 되돌리지 않는다. 판정은
    /// 「전부」다 — 「업데이트 필요」를 띄우면 그 버튼이 새 목록을 옛 목록으로 되쓴다(티켓 21 「스펙과 다른 점」).
    #[test]
    fn a_file_from_a_newer_list_is_left_as_it_is() {
        let newer = format!("list-{}", LIST_VERSION + 1);
        let ours = format!("list-{LIST_VERSION}");
        // 새 빌드가 쓴 모양: 이 빌드가 모르는 이벤트가 하나 더 있고, 판이 하나 높다.
        let mut hooks = Map::new();
        for event in CLAUDE_EVENTS.iter().chain(&["Notification"]) {
            let hook = json!({ "type": "command", "command": script().to_string_lossy(), "args": [CLAUDE, event, newer] });
            hooks.insert((*event).to_string(), json!([{ "hooks": [hook] }]));
        }
        let claude = serde_json::to_string_pretty(&json!({ "hooks": hooks })).unwrap();
        assert_eq!(merge_claude(&claude, &script()).unwrap(), claude, "새 목록을 옛 목록으로 되썼다");
        assert_eq!(claude_installed(&claude, &script()), Ok(Installed::Full), "새 목록의 파일이 「업데이트 필요」다");

        // 셸 꼴 줄의 판은 명령줄의 **마지막** 낱말이다 — 이 빌드의 줄은 다 지금 것이고, 목록 밖 이벤트에 셸 꼴로 적힌 줄 하나만
        // 새로운 판이어도 그 파일은 새 빌드의 것이다.
        let mut shell_form = serde_json::from_str::<Value>(&merge_claude("{}", &script()).unwrap()).unwrap();
        shell_form["hooks"]["Notification"] = json!([{ "hooks": [{
            "type": "command",
            "command": format!("{} {newer}", command_line(&script(), CLAUDE, "Notification")),
        }] }]);
        let shell_form = serde_json::to_string_pretty(&shell_form).unwrap();
        assert_eq!(merge_claude(&shell_form, &script()).unwrap(), shell_form, "셸 꼴 줄의 새 판을 못 읽고 되썼다");
        assert_eq!(claude_installed(&shell_form, &script()), Ok(Installed::Full));

        let mut codex = format!("{CODEX_REAL}\n{CODEX_BEGIN}\n");
        for event in CODEX_EVENTS.iter().chain(&["Notification"]) {
            codex.push_str(&format!(
                "\n[[hooks.{event}]]\n\n[[hooks.{event}.hooks]]\ntype = \"command\"\ncommand = {}\n",
                toml_basic_string(&format!("{} {newer}", command_line(&script(), CODEX, event)))
            ));
        }
        codex.push_str(&format!("{CODEX_END}\n"));
        assert_eq!(merge_codex(&codex, &script()).unwrap(), codex, "새 목록을 옛 목록으로 되썼다");
        assert_eq!(codex_installed(&codex, &script()), Ok(Installed::Full), "새 목록의 파일이 「업데이트 필요」다");

        // 앱이 뜰 때의 맞춤도 안 쓴다.
        let home = temp_home("newer-list");
        std::fs::write(claude_settings_path(&home), &claude).unwrap();
        std::fs::create_dir_all(home.join(".codex")).unwrap();
        std::fs::write(codex_config_path(&home), &codex).unwrap();
        assert_eq!(sync(&home, &script()), Vec::<String>::new(), "새 목록의 파일을 맞췄다");
        assert_eq!(std::fs::read_to_string(claude_settings_path(&home)).unwrap(), claude);
        assert_eq!(std::fs::read_to_string(codex_config_path(&home)).unwrap(), codex);
        let _ = std::fs::remove_dir_all(&home);

        // 앵커: 판만 이 빌드의 것으로 바꾸면 맞춘다(모르는 이벤트를 걷는다) — 판 말고 다른 까닭으로 안 쓴 것이 아니다.
        let same = claude.replace(&newer, &ours);
        assert_eq!(claude_installed(&same, &script()), Ok(Installed::Partial));
        assert_ne!(merge_claude(&same, &script()).unwrap(), same);
        let same = codex.replace(&newer, &ours);
        assert_eq!(codex_installed(&same, &script()), Ok(Installed::Partial));
        assert_ne!(merge_codex(&same, &script()).unwrap(), same);
    }

    /// **지금 모양 그대로면 병합이 원문을 글자 그대로 돌려준다** — 사람이 2칸이 아닌 들여쓰기로 두었거나 한 줄로 적어 둔
    /// 파일도. 다시 적으면 설치 버튼 한 번에 우리 것이 다 지금 모양인 파일이 통째로 다시 쓰이고 `.bak`이 덮인다.
    #[test]
    fn a_file_already_current_comes_back_as_it_was() {
        let full: Value = serde_json::from_str(&merge_claude("{}", &script()).unwrap()).unwrap();
        let one_line = json!({ "model": "opus", "hooks": full["hooks"] }).to_string();
        assert_eq!(merge_claude(&one_line, &script()).unwrap(), one_line, "바꿀 것이 없는데 다시 적었다");

        let home = temp_home("install-current");
        std::fs::write(claude_settings_path(&home), &one_line).unwrap();
        install(&home, &script());
        assert_eq!(std::fs::read_to_string(claude_settings_path(&home)).unwrap(), one_line);
        assert!(!backup_path(&claude_settings_path(&home)).exists(), "쓴 것이 없는데 벌을 떴다");
        let _ = std::fs::remove_dir_all(&home);
    }

    /// **목록 밖 이벤트에 앉은 우리 줄은 걷는다**(프로세스 결정 15의 「우리 항목을 걷고 지금 모양으로 다시 넣는다」). 지난 판이 깔고
    /// 이 판이 뺀 이벤트의 줄은 안 걷으면 영영 돌고, 판정은 늘 「일부」로 남는다. 그 이벤트에 남의 훅이 있으면 그것은 남고, 우리가
    /// 비운 이벤트는 키째 걷힌다.
    #[test]
    fn our_lines_on_events_off_the_list_are_taken_away() {
        let foreign = json!({ "hooks": [{ "type": "command", "command": "say idle" }] });
        let mut value: Value = serde_json::from_str(&merge_claude("{}", &script()).unwrap()).unwrap();
        value["hooks"]["Notification"] = json!([{ "hooks": [old_claude_hook("Notification")] }]);
        value["hooks"]["TeammateIdle"] = json!([claude_group(&script(), "TeammateIdle"), foreign.clone()]);
        let source = value.to_string();
        assert_eq!(claude_installed(&source, &script()), Ok(Installed::Partial));

        let merged: Value = serde_json::from_str(&merge_claude(&source, &script()).unwrap()).unwrap();
        assert!(merged["hooks"].get("Notification").is_none(), "우리가 비운 목록 밖 이벤트가 남았다: {merged}");
        assert_eq!(merged["hooks"]["TeammateIdle"], json!([foreign]), "목록 밖 이벤트의 우리 줄이 남았거나 남의 줄이 사라졌다");
        assert_eq!(claude_installed(&merged.to_string(), &script()), Ok(Installed::Full));
    }

    /// **제거가 남은 것의 차례를 지킨다.** 우리가 비운 이벤트 · `hooks` 구획을 걷을 때 끝 키를 그 자리로 옮기면(`Map::remove` —
    /// 차례를 지키는 맵에서 `swap_remove`다) 사람의 이벤트 · 키 차례가 흩어진다 — 「설치 전 파일로 글자까지 돌아온다」가 우리 것이
    /// 끝에 있을 때만 서던 자리다.
    #[test]
    fn removing_keeps_the_order_of_what_is_left() {
        let ours = json!([claude_group(&script(), "Stop")]);
        let say = |word: &str| json!([{ "hooks": [{ "type": "command", "command": word }] }]);
        let events = json!({ "hooks": { "Stop": ours, "Notification": say("a"), "SessionStart": say("b") } }).to_string();
        let removed: Value = serde_json::from_str(&unmerge_claude(&events).unwrap()).unwrap();
        let left: Vec<&str> = removed["hooks"].as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(left, ["Notification", "SessionStart"], "남의 이벤트 차례가 흩어졌다");

        let keys = json!({ "hooks": { "Stop": ours }, "model": "opus", "env": {} }).to_string();
        let removed: Value = serde_json::from_str(&unmerge_claude(&keys).unwrap()).unwrap();
        let left: Vec<&str> = removed.as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(left, ["model", "env"], "바깥 키 차례가 흩어졌다");
    }

    /// 옛 빌드가 깐 홈 — claude 설정에 옛 다섯, codex 설정에 옛 구획.
    fn old_home(name: &str) -> PathBuf {
        let home = temp_home(name);
        let claude = json!({ "model": "opus", "hooks": old_claude_hooks(&OLD_CLAUDE) });
        std::fs::write(claude_settings_path(&home), serde_json::to_string_pretty(&claude).unwrap()).unwrap();
        std::fs::create_dir_all(home.join(".codex")).unwrap();
        std::fs::write(codex_config_path(&home), codex_with_old_block(&OLD_CODEX)).unwrap();
        home
    }

    fn read(path: &Path) -> String {
        std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{}을 못 읽는다: {e}", path.display()))
    }

    /// **앱이 뜰 때의 맞춤은 우리 훅이 있는 설정을 지금 목록으로 맞춘다**(프로세스 결정 15). 쓰기 전에 `.bak`을 뜨고, 맞춘
    /// 에이전트를 돌려준다(시작 보고가 싣는다). **두 번째는 아무것도 안 쓴다** — 켤 때마다 토스트가 서면 안 되고, `.bak`이 「이미
    /// 맞춘 내용」으로 덮이면 되돌릴 벌이 사라진다.
    #[test]
    fn syncing_brings_an_old_install_up_and_a_second_sync_writes_nothing() {
        let home = old_home("sync-twice");
        let (claude, codex) = (claude_settings_path(&home), codex_config_path(&home));
        let (claude_before, codex_before) = (read(&claude), read(&codex));

        assert_eq!(sync(&home, &script()), ["claude", "codex"]);
        assert_eq!(read(&backup_path(&claude)), claude_before, "claude의 .bak이 맞추기 전 내용이 아니다");
        assert_eq!(read(&backup_path(&codex)), codex_before, "codex의 .bak이 맞추기 전 내용이 아니다");
        for one in status(&home, &script()) {
            assert_eq!(one.installed, Installed::Full, "{} 쪽이 맞춰지지 않았다: {one:?}", one.agent);
        }
        assert_eq!(serde_json::from_str::<Value>(&read(&claude)).unwrap()["model"], "opus", "우리 키 밖의 내용이 사라졌다");
        assert!(read(&codex).starts_with(CODEX_REAL), "codex 설정의 사람 글이 바뀌었다");

        let (claude_once, codex_once) = (read(&claude), read(&codex));
        assert_eq!(sync(&home, &script()), Vec::<String>::new(), "맞춘 설정을 다시 맞췄다 — 켤 때마다 토스트가 선다");
        assert_eq!((read(&claude), read(&codex)), (claude_once, codex_once));
        assert_eq!(read(&backup_path(&claude)), claude_before, "두 번째 맞춤이 되돌릴 벌을 덮었다");
        let _ = std::fs::remove_dir_all(&home);
    }

    /// **우리 훅이 없으면 건드리지 않는다**(프로세스 결정 15 — 설치 자체가 동의다). 남의 훅만 든 파일은 글자 그대로이고 `.bak`도
    /// 안 뜬다. 없는 파일은 만들지 않는다 — 한 번도 설치하지 않은 사람의 홈에 설정이 생기면 안 된다.
    #[test]
    fn syncing_a_home_without_our_hooks_touches_nothing() {
        let home = temp_home("sync-none");
        let claude = claude_settings_path(&home);
        // 4칸 들여쓰기 · 끝 개행 없음 — 다시 적으면 글자가 달라진다.
        let foreign = "{\n    \"model\": \"opus\",\n    \"hooks\": {\"Stop\": [{\"hooks\": [{\"type\": \"command\", \"command\": \"say done\"}]}]}\n}";
        std::fs::write(&claude, foreign).unwrap();

        assert_eq!(sync(&home, &script()), Vec::<String>::new());
        assert_eq!(read(&claude), foreign, "우리 것이 없는데 남의 파일을 다시 썼다");
        assert!(!backup_path(&claude).exists(), "쓴 것이 없는데 벌을 떴다");
        assert!(!codex_config_path(&home).exists(), "없던 codex 설정을 만들었다");

        std::fs::create_dir_all(home.join(".codex")).unwrap();
        std::fs::write(codex_config_path(&home), CODEX_REAL).unwrap();
        std::fs::remove_file(&claude).unwrap();
        assert_eq!(sync(&home, &script()), Vec::<String>::new());
        assert_eq!(read(&codex_config_path(&home)), CODEX_REAL, "우리 것이 없는데 codex 설정을 다시 썼다");
        assert!(!backup_path(&codex_config_path(&home)).exists());
        assert!(!claude.exists(), "없던 claude 설정을 만들었다");
        let _ = std::fs::remove_dir_all(&home);
    }

    /// **깨진 파일은 맞추지 않는다** — 원문 그대로, `.bak`도 없이. 다른 쪽은 그대로 맞춘다: 한쪽이 깨졌다고 다른 쪽 신호까지 낡은
    /// 채 두지 않는다.
    #[test]
    fn syncing_leaves_a_broken_file_alone() {
        let home = old_home("sync-broken");
        let claude = claude_settings_path(&home);
        let broken = "{ 여기서 잘렸 atelier-hook.py";
        std::fs::write(&claude, broken).unwrap();

        assert_eq!(sync(&home, &script()), ["codex"]);
        assert_eq!(read(&claude), broken, "깨진 파일을 고쳤다");
        assert!(!backup_path(&claude).exists(), "손도 안 댔는데 벌을 떴다");
        let _ = std::fs::remove_dir_all(&home);
    }

    /// **맞춤도 모드와 심링크를 지킨다** — 쓰기는 설치 버튼과 같은 길(`apply`)이다. dotfiles 저장소에 심링크로 걸어 둔 0600 설정이
    /// 앱을 켰다는 것만으로 보통 파일이 되거나 넓어지면 안 된다.
    #[cfg(unix)]
    #[test]
    fn syncing_keeps_the_mode_and_the_symlink() {
        use std::os::unix::fs::PermissionsExt;

        let home = old_home("sync-link");
        let real = home.join("dotfiles-settings.json");
        std::fs::rename(claude_settings_path(&home), &real).unwrap();
        std::fs::set_permissions(&real, std::fs::Permissions::from_mode(0o600)).unwrap();
        std::os::unix::fs::symlink(&real, claude_settings_path(&home)).unwrap();

        assert!(sync(&home, &script()).contains(&"claude".to_string()));
        let link = std::fs::symlink_metadata(claude_settings_path(&home)).unwrap();
        assert!(link.file_type().is_symlink(), "심링크가 보통 파일로 갈렸다");
        assert!(read(&real).contains(crate::shells::HANDLER_NAME), "심링크 너머의 진짜 파일이 안 맞춰졌다");
        let mode = std::fs::metadata(&real).unwrap().permissions().mode() & 0o777;
        assert_eq!(format!("{mode:o}"), "600", "맞춤이 남의 설정을 넓혔다");
        let _ = std::fs::remove_dir_all(&home);
    }
}
