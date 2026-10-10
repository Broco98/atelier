//! L1 대화 호스트 시험의 공용 도우미 — 샌드박스와 가짜 로그인 셸.
//!
//! 호스트는 앱에서처럼 짓되, 셸 경로의 원천은 이 샌드박스가 쓴 가짜 로그인 셸이다. 시험은 호스트의
//! 답과 가짜가 남긴 영수증(받은 호출 · 띄운 pid)만 본다 — 호스트 안쪽을 부르지 않는다.
//!
//! `tests/common.rs`가 아니라 `tests/common/mod.rs`인 까닭: 앞의 것은 cargo가 시험 파일로도 짓는다.

#![allow(dead_code)] // 시험 파일마다 쓰는 도우미가 달라, 안 쓰는 파일에서 경고가 난다.

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use atelier_acp::{ConversationHost, HostEvent, ShellSource, TranslatorCommand};
use serde_json::Value;

/// 가짜 로그인 셸의 시나리오.
#[derive(Clone, Copy, Debug)]
pub enum LoginShell {
    /// 표지 앞뒤와 stderr에 rc 인사말을 찍고, 정해진 env로 호스트의 명령을 돈다.
    Normal,
    /// rc가 띄운 배경 작업이 stdout을 쥔 채 남는다 — 셸이 끝나도 EOF가 오지 않는다.
    BackgroundHoldsStdout,
    /// 호스트의 명령을 돌지 않고 exit 0 — rc가 다른 셸로 exec한 꼴.
    NoMarker,
    /// 호스트의 명령 전에 잠든다.
    Slow,
}

pub struct Sandbox {
    _dir: tempfile::TempDir,
    root: PathBuf,
}

impl Sandbox {
    pub fn new() -> Self {
        let dir = tempfile::tempdir().expect("임시 폴더");
        let root = dir.path().to_path_buf();
        for sub in ["home", "receipts", "receipts/acp"] {
            fs::create_dir_all(root.join(sub)).unwrap();
        }
        Self { _dir: dir, root }
    }

    /// 데이터 루트(`ATELIER_HOME` 자리).
    pub fn data_root(&self) -> PathBuf {
        self.root.join("home")
    }

    fn receipts(&self) -> PathBuf {
        self.root.join("receipts")
    }

    /// 로그인 PATH에 넣을 폴더 하나를 만든다.
    pub fn bin(&self, name: &str) -> PathBuf {
        let dir = self.root.join(name);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// 실행 비트가 붙은 가짜 프로그램. 찾기만 하므로 내용은 상관없다.
    pub fn plant(&self, dir: &Path, program: &str) {
        self.plant_with_mode(dir, program, 0o755);
    }

    /// 실행 비트가 없는 같은 이름의 파일.
    pub fn plant_unexecutable(&self, dir: &Path, program: &str) {
        self.plant_with_mode(dir, program, 0o644);
    }

    fn plant_with_mode(&self, dir: &Path, program: &str, mode: u32) {
        let path = dir.join(program);
        fs::write(&path, "#!/bin/sh\nexit 0\n").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(mode)).unwrap();
    }

    /// 가짜 로그인 셸을 쓰고 그 경로를 돌려준다. 호스트의 명령은 `path`만 PATH로 든 env에서 돈다 —
    /// 시험하는 기계의 진짜 `claude`로 새지 않는다.
    ///
    /// 영수증: 부를 때마다 `calls`에 받은 플래그 한 줄, 띄운 프로세스의 pid는 `pids`에 한 줄씩.
    pub fn login_shell(&self, scenario: LoginShell, path: &[&Path]) -> PathBuf {
        self.login_shell_with_env(scenario, path, &[])
    }

    /// [`Self::login_shell`]과 같되 로그인 env에 변수를 더 싣는다 — 가짜 ACP 에이전트의 시나리오처럼, 호스트가
    /// 띄우는 에이전트까지 닿아야 하는 값은 로그인 env로만 갈 수 있다(호스트가 자식 env를 통째로 바꾼다).
    ///
    /// 호스트의 명령을 도는 같은 셸이 그 앞에 자기 env를 `login-env`에 `env -0` 꼴로 떠 둔다 — 호스트가 읽은
    /// 로그인 env 그대로다. 검사는 그것으로 「자식 env가 준 env와 같다」를 잰다. 뒤가 아니라 앞인 것은, 호스트가
    /// END 표지를 읽자마자 셸의 그룹을 끄기 때문이다.
    pub fn login_shell_with_env(&self, scenario: LoginShell, path: &[&Path], env: &[(&str, &str)]) -> PathBuf {
        let path_var = path.iter().map(|dir| dir.display().to_string()).collect::<Vec<_>>().join(":");
        let extra = env.iter().map(|(name, value)| format!("{name}='{value}' ")).collect::<String>();
        let before_command = match scenario {
            LoginShell::Normal => "",
            LoginShell::BackgroundHoldsStdout => "sleep 30 &\necho $! >> \"$RECEIPTS/pids\"\n",
            LoginShell::NoMarker => "exit 0\n",
            LoginShell::Slow => "echo $$ >> \"$RECEIPTS/pids\"\nsleep 30 &\necho $! >> \"$RECEIPTS/pids\"\nwait\n",
        };
        // 표지 밖 인사말에 `PATH=`를 일부러 싣는다. 꼬리는 `env -0`과 같은 꼴(NUL로 갈린 `PATH=…`)이라,
        // END 표지 너머까지 env로 읽으면 진짜 PATH를 덮어 찾은 경로가 틀어진다.
        let script = format!(
            "#!/bin/sh\n\
             # 가짜 로그인 셸({scenario:?}) — 호스트가 `-l -i -c <명령>`으로 부른다.\n\
             RECEIPTS='{receipts}'\n\
             echo \"$1 $2 $3\" >> \"$RECEIPTS/calls\"\n\
             echo 'PATH=/rc-greeting'\n\
             echo 'PATH=/rc-stderr' >&2\n\
             {before_command}\
             /usr/bin/env -i PATH='{path_var}' HOME='{home}' {extra}/bin/sh -c '/usr/bin/env -0 > \"$0\"; '\"$4\" \"$RECEIPTS/login-env\"\n\
             printf '\\000PATH=/rc-tail\\000'\n",
            receipts = self.receipts().display(),
            home = self.data_root().display(),
        );
        let shell = self.root.join(format!("login-shell-{scenario:?}"));
        fs::write(&shell, script).unwrap();
        fs::set_permissions(&shell, fs::Permissions::from_mode(0o755)).unwrap();
        shell
    }

    /// 가짜 로그인 셸이 받은 호출들 — 줄마다 받은 플래그.
    pub fn shell_calls(&self) -> Vec<String> {
        fs::read_to_string(self.receipts().join("calls"))
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect()
    }

    /// 가짜 로그인 셸이 적은 pid들(셸 자신 · 배경 작업).
    pub fn shell_pids(&self) -> Vec<u32> {
        fs::read_to_string(self.receipts().join("pids"))
            .unwrap_or_default()
            .lines()
            .map(|line| line.trim().parse().expect("pid 줄"))
            .collect()
    }

    /// 가짜 로그인 셸이 떠 둔 로그인 env.
    pub fn login_env(&self) -> BTreeMap<String, String> {
        let bytes = fs::read(self.receipts().join("login-env")).expect("가짜 로그인 셸이 env를 떠 뒀어야 한다");
        bytes
            .split(|byte| *byte == 0)
            .filter_map(|entry| {
                let entry = String::from_utf8_lossy(entry);
                let (name, value) = entry.split_once('=')?;
                (!name.is_empty()).then(|| (name.to_owned(), value.to_owned()))
            })
            .collect()
    }

    /// 앱처럼 지은 호스트. 셸 경로의 원천만 가짜 로그인 셸이다.
    pub fn host(&self, shell: ShellSource) -> ConversationHost {
        self.host_builder(shell, |_| {}).build()
    }

    pub fn host_with_limit(&self, shell: ShellSource, limit: Duration) -> ConversationHost {
        self.host_builder(shell, |_| {}).login_shell_limit(limit).build()
    }

    /// 호스트가 내보낸 이벤트를 모으는 호스트.
    pub fn host_with_events(&self, shell: ShellSource) -> (ConversationHost, Events) {
        let (builder, events) = self.host_builder_with_events(shell);
        (builder.build(), events)
    }

    pub fn host_builder_with_events(&self, shell: ShellSource) -> (atelier_acp::HostBuilder, Events) {
        let events = Events::default();
        let sink = events.clone();
        (self.host_builder(shell, move |event| sink.0.lock().unwrap().push(event)), events)
    }

    fn host_builder(
        &self,
        shell: ShellSource,
        emit: impl Fn(HostEvent) + Send + Sync + 'static,
    ) -> atelier_acp::HostBuilder {
        // 변환기 시험 bin은 13이 세운다. 이 장의 명령은 Claude 대화를 띄우지 않는다.
        let translator = TranslatorCommand::new("/usr/bin/false", ["acp-claude"]);
        ConversationHost::builder(self.data_root(), translator, shell, emit)
    }

    // ── work와 Codex 대화 ──────────────────────────────────────────────────────

    /// 데이터 루트에 work 하나를 세운다 — `work.json`과 spec 폴더, 프로젝트마다 워크트리 자리. git은 없어도
    /// 된다(호스트는 `git status`를 부르지 않는다).
    pub fn work(&self, slug: &str, projects: &[&str]) -> PathBuf {
        let dir = self.work_dir(slug);
        fs::create_dir_all(dir.join("spec")).unwrap();
        for project in projects {
            fs::create_dir_all(dir.join("trees").join(project)).unwrap();
        }
        let work = serde_json::json!({
            "title": format!("{slug} 제목"),
            "status": "active",
            "createdAt": "2026-10-10",
            "projects": projects,
        });
        fs::write(dir.join("work.json"), work.to_string()).unwrap();
        dir
    }

    pub fn work_dir(&self, slug: &str) -> PathBuf {
        self.data_root().join("works").join(slug)
    }

    /// Codex를 띄우는 데 드는 셋을 둔 PATH 폴더. `codex-acp`는 가짜 ACP 에이전트 bin을 가리키는 링크이고,
    /// `codex` · `node`는 찾기만 하는 가짜다.
    pub fn codex_bin(&self) -> PathBuf {
        let bin = self.bin("codex-bin");
        std::os::unix::fs::symlink(env!("CARGO_BIN_EXE_fake-acp-agent"), bin.join("codex-acp")).unwrap();
        self.plant(&bin, "codex");
        self.plant(&bin, "node");
        bin
    }

    /// 가짜 ACP 에이전트의 시나리오를 로그인 env에 실은 로그인 셸.
    pub fn codex_login_shell(&self, scenario: &str, extra: &[(&str, &str)]) -> ShellSource {
        let bin = self.codex_bin();
        self.codex_login_shell_in(&bin, scenario, extra)
    }

    /// `codex-acp` 자리에 가짜 ACP 에이전트 대신 이 내용의 실행 파일을 둔 로그인 셸 — ACP가 아닌 명령,
    /// 실행할 수 없는 파일.
    pub fn codex_login_shell_with_program(&self, contents: &[u8]) -> ShellSource {
        let bin = self.bin("codex-bin");
        let program = bin.join("codex-acp");
        fs::write(&program, contents).unwrap();
        fs::set_permissions(&program, fs::Permissions::from_mode(0o755)).unwrap();
        self.plant(&bin, "codex");
        self.plant(&bin, "node");
        self.codex_login_shell_in(&bin, "normal", &[])
    }

    fn codex_login_shell_in(&self, bin: &Path, scenario: &str, extra: &[(&str, &str)]) -> ShellSource {
        let receipts = self.acp_receipts();
        let receipts = receipts.to_str().unwrap();
        let mut env = vec![("FAKE_ACP_SCENARIO", scenario), ("FAKE_ACP_RECEIPTS", receipts)];
        env.extend_from_slice(extra);
        ShellSource::Path(self.login_shell_with_env(LoginShell::Normal, &[bin, Path::new("/usr/bin"), Path::new("/bin")], &env))
    }

    /// 영수증 폴더의 `name` 파일에 한 줄씩 적힌 pid들 — 가짜 `codex-acp` 스크립트가 적는다.
    pub fn receipt_pids(&self, name: &str) -> Vec<u32> {
        fs::read_to_string(self.acp_receipts().join(name))
            .unwrap_or_default()
            .lines()
            .map(|line| line.trim().parse().expect("pid 줄"))
            .collect()
    }

    fn acp_receipts(&self) -> PathBuf {
        self.receipts().join("acp")
    }

    /// 가짜 ACP 에이전트가 그 세션을 열 때 남긴 영수증.
    pub fn acp_receipt(&self, session_id: &str) -> Value {
        let path = self.acp_receipts().join(format!("{session_id}.json"));
        serde_json::from_str(&fs::read_to_string(&path).unwrap_or_else(|_| panic!("영수증이 없다: {}", path.display())))
            .unwrap()
    }

    /// 가짜 ACP 에이전트가 세션을 연 뒤 겪은 일들(줄마다 하나).
    pub fn acp_events(&self, session_id: &str) -> Vec<String> {
        fs::read_to_string(self.acp_receipts().join(format!("{session_id}.events")))
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect()
    }

    /// 그 work의 `agents.json`.
    pub fn agents_json(&self, slug: &str) -> Value {
        let path = self.work_dir(slug).join("agents/agents.json");
        serde_json::from_str(&fs::read_to_string(&path).unwrap_or_else(|_| panic!("없다: {}", path.display()))).unwrap()
    }

    /// `agents.json`의 그 대화 줄.
    pub fn agents_row(&self, slug: &str, conversation: &str) -> Value {
        self.agents_json(slug)["conversations"]
            .as_array()
            .expect("conversations 배열")
            .iter()
            .find(|row| row["id"] == conversation)
            .unwrap_or_else(|| panic!("agents.json에 {conversation} 줄이 없다"))
            .clone()
    }

    /// 그 대화의 기록 파일 줄들.
    pub fn record(&self, slug: &str, conversation: &str) -> Vec<Value> {
        let path = self.record_path(slug, conversation);
        fs::read_to_string(&path)
            .unwrap_or_else(|_| panic!("없다: {}", path.display()))
            .lines()
            .map(|line| serde_json::from_str(line).expect("기록 줄은 JSON"))
            .collect()
    }

    pub fn record_path(&self, slug: &str, conversation: &str) -> PathBuf {
        self.work_dir(slug).join("agents").join(format!("{conversation}.jsonl"))
    }

    /// 기록이 `done`을 채울 때까지 기다린다. 턴은 에이전트의 스레드에서 흐르므로 시험은 기록을 지켜본다.
    /// 마감을 넘기면 그때까지의 기록을 싣고 터진다.
    pub fn wait_record(&self, slug: &str, conversation: &str, done: impl Fn(&[Value]) -> bool) -> Vec<Value> {
        let deadline = Instant::now() + PATIENCE;
        loop {
            let record = self.record(slug, conversation);
            if done(&record) {
                return record;
            }
            if Instant::now() > deadline {
                panic!("기록이 기다린 꼴이 되지 않았다:\n{}", lines_text(&record));
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    /// 그 kind의 줄이 `n`개 적힐 때까지 기다린다.
    pub fn wait_kind(&self, slug: &str, conversation: &str, kind: &str, n: usize) -> Vec<Value> {
        self.wait_record(slug, conversation, |record| record.iter().filter(|line| line["kind"] == kind).count() >= n)
    }

    /// 가짜 ACP 에이전트가 그 세션에서 받은 `session/prompt`의 인자들 — 받은 순서대로.
    pub fn acp_prompts(&self, session_id: &str) -> Vec<Value> {
        fs::read_to_string(self.acp_receipts().join(format!("{session_id}.prompts")))
            .unwrap_or_default()
            .lines()
            .map(|line| serde_json::from_str(line).expect("prompt 영수증 줄은 JSON"))
            .collect()
    }

    /// 그 대화의 에이전트 쪽 세션 id(`agents.json`).
    pub fn agent_session_id(&self, slug: &str, conversation: &str) -> String {
        self.agents_row(slug, conversation)["agentSessionId"].as_str().expect("에이전트 쪽 세션 id").to_owned()
    }
}

// ── S26 — L1이 남긴 기록을 L3 자료로 ─────────────────────────────────────────────

/// 검사 자료 폴더. 만드는 쪽(L1)이 갖고, 대화창의 L3 목업 백엔드가 그대로 쏜다.
pub fn records_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/records")
}

/// 다시 지은 기록을 고정값으로 바꾼다 — 매번 달라지는 것은 시각 · 걸린 시간 · 임시 데이터 루트 · 에이전트 쪽
/// 세션 id다. 시각은 `기준 + seq초`로 다시 찍는다. 그래서 L3에서 「N초 동안 작업함」이 0이 아닌 값으로 선다.
pub fn fix_record(record: &[Value], data_root: &Path, session_id: &str) -> Vec<Value> {
    fn at(seq: u64) -> String {
        format!("2026-10-10T10:{:02}:{:02}.000+09:00", seq / 60, seq % 60)
    }
    fn replace(value: &mut Value, from: &str, to: &str) {
        match value {
            Value::String(text) => *text = text.replace(from, to),
            Value::Array(items) => items.iter_mut().for_each(|item| replace(item, from, to)),
            Value::Object(fields) => fields.values_mut().for_each(|field| replace(field, from, to)),
            _ => {}
        }
    }
    let root = data_root.display().to_string();
    let mut last_sent = 0;
    record
        .iter()
        .map(|line| {
            let mut line = line.clone();
            let seq = line["seq"].as_u64().expect("seq");
            line["at"] = Value::from(at(seq));
            match line["kind"].as_str() {
                Some("sent") => last_sent = seq,
                Some("turn-end") => line["payload"]["durationMs"] = Value::from((seq - last_sent) * 1000),
                _ => {}
            }
            replace(&mut line, &root, "~/.atelier");
            replace(&mut line, session_id, "fake-session");
            line
        })
        .collect()
}

/// 다시 지은 기록이 검사 자료 `tests/records/<name>.jsonl`과 같은지 잰다. 줄마다 JSON으로 견준다 — 키 순서에
/// 기대지 않는다. `ATELIER_BLESS_RECORDS=1`이면 견주지 않고 자료를 다시 쓴다(가짜의 턴 모양을 바꾼 날).
///
/// 어긋나면 실제 기록을 증거 폴더(`test-results/l1-records/`)에 떠 두고 첫 어긋난 줄을 싣고 터진다.
pub fn assert_record(name: &str, actual: &[Value]) {
    let path = records_dir().join(format!("{name}.jsonl"));
    let text: String = actual.iter().map(|line| format!("{line}\n")).collect();
    if std::env::var_os("ATELIER_BLESS_RECORDS").is_some() {
        fs::create_dir_all(records_dir()).unwrap();
        fs::write(&path, &text).unwrap();
        return;
    }
    let expected: Vec<Value> = fs::read_to_string(&path)
        .unwrap_or_else(|_| panic!("검사 자료가 없다: {} — ATELIER_BLESS_RECORDS=1로 지어 둔다", path.display()))
        .lines()
        .map(|line| serde_json::from_str(line).expect("검사 자료 줄은 JSON"))
        .collect();
    if expected == actual {
        return;
    }
    let evidence: Value =
        serde_json::from_str(include_str!("../../../../scripts/evidence-dir.json")).expect("증거 폴더 설정");
    let dumped = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(evidence["evidenceDir"].as_str().expect("evidenceDir"))
        .join("l1-records")
        .join(format!("{name}.jsonl"));
    let _ = fs::create_dir_all(dumped.parent().unwrap());
    let _ = fs::write(&dumped, &text);
    let at = (0..expected.len().max(actual.len()))
        .find(|i| expected.get(*i) != actual.get(*i))
        .expect("어긋난 줄이 있다");
    panic!(
        "다시 지은 기록이 검사 자료 {}와 다르다 — {}번째 줄\n  자료: {}\n  실제: {}\n실제 기록: {}\n가짜의 턴 모양을 일부러 바꿨으면 ATELIER_BLESS_RECORDS=1로 다시 짓는다",
        path.display(),
        at + 1,
        expected.get(at).map_or("(없음)".to_owned(), Value::to_string),
        actual.get(at).map_or("(없음)".to_owned(), Value::to_string),
        dumped.display(),
    );
}

/// 턴 · 죽음 같은 비동기 일을 기다리는 마감.
pub const PATIENCE: Duration = Duration::from_secs(10);

/// 기록 줄들을 한 줄씩 — 실패 메시지용.
pub fn lines_text(record: &[Value]) -> String {
    record.iter().map(|line| line.to_string()).collect::<Vec<_>>().join("\n")
}

/// 기록에서 그 kind의 줄들.
pub fn of_kind<'a>(record: &'a [Value], kind: &str) -> Vec<&'a Value> {
    record.iter().filter(|line| line["kind"] == kind).collect()
}

/// 호스트가 내보낸 이벤트들.
#[derive(Clone, Default)]
pub struct Events(Arc<Mutex<Vec<HostEvent>>>);

impl Events {
    pub fn all(&self) -> Vec<HostEvent> {
        self.0.lock().unwrap().clone()
    }
}

/// 테스트 프로세스 자신의 Unix 세션 id.
pub fn own_sid() -> i32 {
    // SAFETY: getsid(0)은 인자 없이 자기 세션 id를 돌려줄 뿐이다.
    unsafe { libc::getsid(0) }
}

/// 프로세스가 살아 있나 — `ps`에 없거나 좀비(`Z`)면 끝난 것이다. macOS와 ubuntu에서 같게 돈다.
pub fn is_running(pid: u32) -> bool {
    let out = Command::new("ps").args(["-p", &pid.to_string(), "-o", "state="]).output().expect("ps");
    let state = String::from_utf8_lossy(&out.stdout);
    let state = state.trim();
    !state.is_empty() && !state.starts_with('Z')
}

/// SIGKILL은 곧바로 닿지만 `ps`에서 사라지는 데는 틈이 있다. 그 틈만 기다리고, 넘으면 남은 것을 싣고 터진다.
pub fn assert_all_gone(pids: &[u32]) {
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        let alive: Vec<u32> = pids.iter().copied().filter(|pid| is_running(*pid)).collect();
        if alive.is_empty() {
            return;
        }
        if Instant::now() > deadline {
            panic!("남은 프로세스가 있다: {alive:?} (전부 {pids:?})");
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}
