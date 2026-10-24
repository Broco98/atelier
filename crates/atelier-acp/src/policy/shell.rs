//! 판정이 읽는 셸 낱말 — 명령 글을 셸이 실행하는 명령마다 조각낸다(코드 리뷰 1차 A1 · 끝-점검-PR4 (d)). 판정(`policy.rs`)은 조각만
//! 보고, 따옴표 · 치환 · heredoc · `sh -c`는 이 파일이 안다.

/// 명령 조각 하나 — 셸이 실행하는 명령 하나다. 걸림은 여러 꼴을 함께 본다.
pub(super) struct Piece {
    /// 쓰인 그대로의 낱말을 빈칸 하나로 이은 글 — 앞의 변수 놓기 · 셸 문법 낱말(`if` · `then` · `{` …) · 재지정은 뗐다.
    pub(super) said: String,
    /// 셸이 푼 낱말(따옴표를 벗긴 글)들. git이면 전역 옵션(`-C <dir>` · `--no-pager` …)을 걷어 `git <하위 명령> …`이고, gh면
    /// 명령 · 하위 명령 앞뒤의 옵션(`-R o/r` …)을 걷어 `gh pr merge …`다. 명령 이름은 쓰인 그대로다(`/usr/bin/git`).
    pub(super) words: Vec<String>,
    /// `words`를 빈칸 하나로 이은 글.
    pub(super) run: String,
    /// `run`의 명령 이름에서 경로를 뗀 글(`/usr/bin/git push` → `git push`) — 막는 쪽만 본다. 넘기는 쪽이 보면 `git status`의
    /// 허락이 `./git status`(아무 실행 파일)를 넘긴다.
    pub(super) bare: String,
    /// 걷은 git 전역 옵션이 git이 실행할 것을 바꾸나(`-c` · `--config-env` · `--exec-path` — `-c core.pager=…`는 아무 명령이나
    /// 띄운다). 넘기는 쪽은 그때 `run`을 믿지 않는다.
    pub(super) reconfigured: bool,
    /// 셸이 실행할 것을 글에서 읽을 수 없는 조각이다(코드 리뷰 2차 A1) — 글을 흘려 넣은 셸(`… | sh` · `bash <<'EOF'` · `sh < 파일`),
    /// 명령 이름이나 git · gh의 하위 명령에 치환 · 변수 · 글롭이 든 조각(`$(echo git) push` · `$G push` · `git $(echo push)`). 막는
    /// 쪽은 걸렸을 수 있다고 보고, 넘기는 쪽은 허락을 짓지 않는다.
    pub(super) opaque: bool,
}

/// 명령의 조각들(코드 리뷰 1차 A1 · 끝-점검-PR4 (d)) — 셸이 명령 하나로 실행하는 단위마다 하나다.
///
/// - `&&` · `||` · `;` · `|` · `&` · 줄바꿈 · 괄호(subshell)로 자른다. 재지정의 `&`(`2>&1` · `&>`)로는 자르지 않는다. **따옴표
///   안의 구분자로도 자르지 않는다**(v1 티켓 24) — `python3 -c "import a; a.b()"`는 조각 하나다. 셸이 그 글을 한 인자로 넘기기
///   때문이고, 거기서 자르면 「다시 묻지 않기」가 `Bash(a.b() *)` 같은 허락을 짓는다.
/// - 실행되는 안쪽도 조각이다 — 명령 치환(`$(…)` · `` `…` ``, 큰따옴표 안에서도) · 프로세스 치환(`<(…)`), `sh -c '…'` ·
///   `bash -o pipefail -lc "…"` · `/bin/sh -c '…'` · `eval '…'`의 글. 셸 · `eval` 조각은 제 자리를 안쪽 조각들에 내준다 — 그
///   셸이 실행하는 것이 안쪽이다. `-c` 없이 글을 흘려 받는 셸은 볼 수 없는 조각이다([`Piece::opaque`]).
/// - heredoc 본문은 명령이 아니다 — 따옴표 친 끝말(`<<'EOF'`)이면 글 그대로, 아니면 그 안의 명령 치환만 조각이다. 주석(`# …`)도
///   뺀다. 셸이 받는 heredoc은 위의 흘려 받는 셸이다.
/// - 앞의 변수 놓기(`FOO=1 git push`) · 셸 문법 낱말 · 재지정을 떼고, 그것만인 조각 · 닫는 낱말(`}` · `fi` …)만인 조각은 버린다.
///
/// 글자로 읽는 그물이다 — 별칭(`git config alias.ship push` 뒤 `git ship`) · 스크립트 파일 · 감싸는 명령(`xargs` · `find -exec` ·
/// `exec` · `env` · `timeout` · `nice` …) 같은 길로 실행되는 명령은 보지 못한다(결정.md 「코드 리뷰 1차」 · 「코드 리뷰 2차」).
pub(super) fn pieces(text: &str) -> Vec<Piece> {
    let chars: Vec<char> = text.chars().collect();
    let mut lexed = Vec::new();
    Lexer { chars: &chars, at: 0 }.lex(None, &mut lexed);
    let mut pieces = Vec::new();
    for words in lexed {
        read_command(&words, &mut pieces);
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
/// 받은 글을 명령으로 실행하는 셸 — 이름은 경로를 떼고 견준다(`/bin/sh`).
const SHELLS: [&str; 5] = ["sh", "bash", "zsh", "dash", "ksh"];

/// 셸의 명령 하나(낱말 목록)를 조각으로 — 앞말(변수 놓기 · 셸 문법 낱말 · 재지정)을 떼고, 셸 · `eval`이면 안쪽 글을 다시 조각낸다.
fn read_command(words: &[Word], pieces: &mut Vec<Piece>) {
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
    let name = base_name(&first.text);
    let mut opaque = unreadable(&first.text);
    if SHELLS.contains(&name) {
        match shell_input(&words[1..]) {
            ShellInput::Code(code) => {
                pieces.extend(self::pieces(&code.text));
                return;
            }
            ShellInput::Script => {}
            ShellInput::Unseen => opaque = true,
        }
    }
    if first.text == "eval" && words.len() > 1 {
        pieces.extend(self::pieces(&joined(&words[1..], |word| &word.text)));
        return;
    }
    let said = joined(words, |word| &word.raw);
    // 머리 — 막는 규칙(push · merge)이 읽는 낱말이다. 명령 이름과, git이면 하위 명령, gh면 명령 · 하위 명령까지다.
    let (run, reconfigured, head) = match name {
        "git" => {
            let (run, reconfigured) = git_run(words);
            (run, reconfigured, 2)
        }
        "gh" => (gh_run(words), false, 3),
        _ => (words.iter().map(|word| word.text.clone()).collect(), false, 1),
    };
    opaque |= run.iter().take(head).any(|word| unreadable(word));
    let bare = [name.to_owned()].into_iter().chain(run[1..].iter().cloned()).collect::<Vec<_>>().join(" ");
    pieces.push(Piece { said, run: run.join(" "), words: run, bare, reconfigured, opaque });
}

fn joined<'w>(words: &'w [Word], part: impl Fn(&'w Word) -> &'w str) -> String {
    words.iter().map(part).collect::<Vec<_>>().join(" ")
}

/// 명령 이름에서 경로를 뗀 것(`/usr/bin/git` → `git`).
fn base_name(name: &str) -> &str {
    name.rsplit('/').next().unwrap_or(name)
}

/// 셸이 펼쳐야 알 수 있는 낱말인가 — 치환 · 변수(`$` · `` ` ``) · 글롭(`*` · `?` · `[`) · 중괄호 펼침(`{a,b}`). 명령 `[` · `[[`는
/// 이름이다.
fn unreadable(word: &str) -> bool {
    word.contains(['$', '`', '*', '?', '{']) || (word.contains('[') && !matches!(word, "[" | "[["))
}

/// 셸이 무엇을 실행하나.
enum ShellInput<'w> {
    /// `-c`로 받은 글.
    Code(&'w Word),
    /// 스크립트 파일 — 그 속은 읽지 않는다(머리말의 스크립트 파일).
    Script,
    /// 흘려 받은 글(표준 입력 · heredoc · 재지정)이거나, 옵션 · 스크립트 자리를 읽을 수 없다(`bash $F 'git push'`).
    Unseen,
}

/// 셸(`bash [옵션…] [-c 글 | 스크립트] …`)의 낱말에서 실행할 것을 찾는다 — 재지정은 낱말이 아니고, 옵션을 건너며(값을 받는 `-o` ·
/// `+o` · `-O` · `--rcfile` · `--init-file`은 그 값까지), `-c`가 있으면 첫 옵션 아닌 낱말이 글이다. `-c`도 스크립트도 없거나
/// `-s`면 표준 입력을 읽는다.
fn shell_input(args: &[Word]) -> ShellInput<'_> {
    let mut words = Vec::new();
    let mut at = 0;
    while let Some(word) = args.get(at) {
        at += match redirection(&word.raw) {
            Some(true) => 2,
            Some(false) => 1,
            None => {
                words.push(word);
                1
            }
        };
    }
    let (mut at, mut commands, mut stdin) = (0, false, false);
    while let Some(text) = words.get(at).map(|word| word.text.as_str()) {
        if matches!(text, "-" | "--") {
            at += 1;
            break;
        }
        let Some(flags) = text.strip_prefix(['-', '+']).filter(|flags| !flags.is_empty()) else { break };
        if let Some(long) = flags.strip_prefix('-') {
            at += if matches!(long, "rcfile" | "init-file") { 2 } else { 1 };
            continue;
        }
        commands |= text.starts_with('-') && flags.contains('c');
        stdin |= text.starts_with('-') && flags.contains('s');
        at += if flags.contains(['o', 'O']) { 2 } else { 1 };
    }
    match words.get(at) {
        Some(code) if commands => ShellInput::Code(code),
        Some(script) if !stdin && !unreadable(&script.text) => ShellInput::Script,
        _ => ShellInput::Unseen,
    }
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
    (words[..1].iter().chain(rest).map(|word| word.text.clone()).collect(), reconfigured)
}

/// gh의 옵션을 걷은 낱말들 — 명령 · 하위 명령(`gh <명령> <하위 명령>`)의 앞과 사이에 선 옵션을 걷는다(`gh pr -R o/r merge 1` →
/// `gh pr merge 1`). 값을 따로 받는 `-R` · `--repo`는 그 값까지다. 하위 명령 뒤는 그대로 둔다.
fn gh_run(words: &[Word]) -> Vec<String> {
    let mut run = vec![words[0].text.clone()];
    let mut at = 1;
    while let Some(word) = words.get(at).filter(|_| run.len() < 3) {
        if word.text.starts_with('-') {
            at += if matches!(word.text.as_str(), "-R" | "--repo") { 2 } else { 1 };
        } else {
            run.push(word.text.clone());
            at += 1;
        }
    }
    run.extend(words.get(at..).unwrap_or_default().iter().map(|word| word.text.clone()));
    run
}

/// 따옴표 · 치환 · heredoc을 아는 작은 셸 낱말 읽기 — 조각마다 낱말 목록을 낸다. 치환의 안쪽 조각은 그 바깥 조각 뒤에 선다.
struct Lexer<'a> {
    chars: &'a [char],
    at: usize,
}

/// 읽는 중인 명령 — 낱말들 · 읽는 중인 낱말 · 이 조각 안에서 만난 치환의 조각들 · 줄이 끝나면 건너뛸 heredoc 본문들.
#[derive(Default)]
struct CommandSoFar {
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

impl CommandSoFar {
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
        let mut so_far = CommandSoFar::default();
        let mut depth = 0usize;
        while let Some(c) = self.peek(0) {
            match c {
                ' ' | '\t' => {
                    so_far.end_word();
                    self.at += 1;
                }
                '\\' if self.peek(1) == Some('\n') => self.at += 2,
                '\\' => {
                    let word = so_far.word();
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
                        so_far.word().text.push(quoted);
                        self.at += 1;
                    }
                    self.skip(1);
                    self.raw(&mut so_far, start);
                }
                '"' => self.double(&mut so_far),
                '`' if close == Some('`') => {
                    self.at += 1;
                    break;
                }
                '`' => self.substitution(&mut so_far, 1, '`'),
                '$' | '<' | '>' if self.peek(1) == Some('(') && (c == '$' || so_far.word.is_none()) => self.substitution(&mut so_far, 2, ')'),
                '<' if self.peek(1) == Some('<') && self.peek(2) != Some('<') => self.heredoc(&mut so_far),
                '#' if so_far.word.is_none() => {
                    while self.peek(0).is_some_and(|c| c != '\n') {
                        self.at += 1;
                    }
                }
                '(' => {
                    so_far.end_piece(out);
                    depth += 1;
                    self.at += 1;
                }
                ')' => {
                    so_far.end_piece(out);
                    self.at += 1;
                    if depth == 0 && close == Some(')') {
                        return;
                    }
                    depth = depth.saturating_sub(1);
                }
                '&' if self.peek(1) == Some('>') || so_far.word.as_ref().is_some_and(|word| word.raw.ends_with(['>', '<'])) => {
                    so_far.push(c);
                    self.at += 1;
                }
                ';' | '|' | '&' => {
                    so_far.end_piece(out);
                    self.at += 1;
                }
                '\n' => {
                    so_far.end_piece(out);
                    self.at += 1;
                    self.skip_heredoc_bodies(&mut so_far);
                    out.append(&mut so_far.nested);
                }
                _ => {
                    so_far.push(c);
                    self.at += 1;
                }
            }
        }
        so_far.end_piece(out);
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
    fn raw(&self, so_far: &mut CommandSoFar, start: usize) {
        so_far.word().raw.extend(self.taken(start));
    }

    /// 큰따옴표 — 백슬래시는 `"` · `\` · `$` · `` ` `` 앞에서만 푼다. 안의 명령 치환은 실행된다.
    fn double(&mut self, so_far: &mut CommandSoFar) {
        let start = self.at;
        self.at += 1;
        while let Some(c) = self.peek(0) {
            match c {
                '"' => {
                    self.at += 1;
                    break;
                }
                '\\' if self.peek(1).is_some_and(|next| matches!(next, '"' | '\\' | '$' | '`' | '\n')) => {
                    so_far.word().text.extend(self.peek(1));
                    self.at += 2;
                }
                '$' if self.peek(1) == Some('(') => {
                    let inner = self.at;
                    self.at += 2;
                    self.lex(Some(')'), &mut so_far.nested);
                    so_far.word().text.extend(self.taken(inner));
                }
                '`' => {
                    let inner = self.at;
                    self.at += 1;
                    self.lex(Some('`'), &mut so_far.nested);
                    so_far.word().text.extend(self.taken(inner));
                }
                _ => {
                    so_far.word().text.push(c);
                    self.at += 1;
                }
            }
        }
        self.raw(so_far, start);
    }

    /// 치환(`$(` · `<(` · `` ` ``) — 안쪽을 조각으로 읽고, 낱말에는 쓰인 그대로 남긴다.
    fn substitution(&mut self, so_far: &mut CommandSoFar, head: usize, close: char) {
        let start = self.at;
        self.at += head;
        self.lex(Some(close), &mut so_far.nested);
        let raw: String = self.taken(start).iter().collect();
        let word = so_far.word();
        word.raw.push_str(&raw);
        word.text.push_str(&raw);
    }

    /// heredoc 여는 말(`<<EOF` · `<<-'EOF'` · `<< "EOF"`) — 본문은 이 줄이 끝난 뒤에 건너뛴다.
    fn heredoc(&mut self, so_far: &mut CommandSoFar) {
        so_far.end_word();
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
        self.raw(so_far, start);
        so_far.end_word();
        so_far.heredocs.push(Heredoc { end, expands: !quoted, tabs });
    }

    /// 줄이 끝난 뒤 — 그 줄에서 연 heredoc의 본문을 차례로 건너뛴다. 따옴표 없는 끝말의 본문에서는 명령 치환만 읽는다.
    fn skip_heredoc_bodies(&mut self, so_far: &mut CommandSoFar) {
        let chars = self.chars;
        for doc in std::mem::take(&mut so_far.heredocs) {
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
                            '$' if inner.peek(1) == Some('(') => inner.substitution(so_far, 2, ')'),
                            '`' => inner.substitution(so_far, 1, '`'),
                            _ => inner.at += 1,
                        }
                    }
                    so_far.word = None;
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
