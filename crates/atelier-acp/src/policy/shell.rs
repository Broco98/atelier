//! 판정이 읽는 셸 낱말 — 명령 글을 셸이 실행하는 명령마다 조각낸다(코드 리뷰 1차 A1 · 끝-점검-PR4 (d)). 판정(`policy.rs`)은 조각만
//! 보고, 따옴표 · 치환 · heredoc · `sh -c`는 이 파일이 안다.

/// 명령 조각 하나 — 셸이 실행하는 명령 하나다. 걸림은 두 꼴을 함께 본다.
pub(super) struct Piece {
    /// 쓰인 그대로의 낱말을 빈칸 하나로 이은 글 — 앞의 변수 놓기 · 셸 문법 낱말(`if` · `then` · `{` …) · 재지정은 뗐다.
    pub(super) said: String,
    /// 셸이 푼 낱말(따옴표를 벗긴 글)들. git이면 전역 옵션(`-C <dir>` · `--no-pager` …)을 걷어 `git <하위 명령> …`이다.
    pub(super) words: Vec<String>,
    /// `words`를 빈칸 하나로 이은 글.
    pub(super) run: String,
    /// 걷은 git 전역 옵션이 git이 실행할 것을 바꾸나(`-c` · `--config-env` · `--exec-path` — `-c core.pager=…`는 아무 명령이나
    /// 띄운다). 넘기는 쪽은 그때 `run`을 믿지 않는다.
    pub(super) reconfigured: bool,
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
/// `-c`로 받은 글을 명령으로 실행하는 셸.
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
