//! Claude 변환기 — 앱 실행 파일의 하위 모드 `acp-claude`로 도는 ACP 에이전트(three-axes 결정 12, 워크플로 S4).
//! `claude -p` 하나를 쥐고 stream-json ↔ ACP를 옮긴다. 호스트에게는 codex-acp와 같은 「stdio로 ACP를 말하는 자식」이다.
//!
//! - **ACP 세션 하나 = 변환기 하나 = `claude` 하나.** `claude`는 변환기의 프로세스 그룹 안에 띄운다(새 세션에 두지 않는다)
//!   — 호스트가 변환기를 새 세션에 띄우고 끌 때 그룹째 SIGKILL하므로 claude와 그 MCP 자식들도 함께 끝난다.
//! - **ACP 쪽은 손으로 짠 줄 단위 응답기다.** 받는 메서드가 몇 안 되고, claude의 답을 기다리는 동안 ACP 요청의 답을 미루고
//!   claude가 보낸 순서대로 내보내는 일을 직접 쥐어야 한다.
//! - **stdin EOF면 claude의 stdin을 닫고 끝난다** — 앱이 비정상으로 끝나도(호스트가 그룹을 끄지 못해도) 고아가 남지 않는다.
//!
//! **몸은 둘이다.** 무엇을 옮기고 언제 답하는지는 상태 기계 [`machine`]이 안다 — 입력 하나(ACP 메시지 · claude의 줄 · 끝)를
//! 받아 낼 것들(ACP 줄 · claude stdin 줄 · 띄우기와 거두기 · 끝)을 돌려준다. 이 파일은 그 바깥의 입출력만 쥔다 — stdio 줄 ·
//! claude 띄우기와 끄기 · 읽는 스레드 둘(ACP · claude) · EOF. 몸통 하나가 두 스레드의 줄을 채널로 받아 받은 차례대로 상태
//! 기계에 넣고, 낸 것을 그 자리에서 한다(tokio 없이 `std::thread`와 채널로 짓는다, 워크플로 §7). claude의 stdin은 몸통이 쓴다 —
//! claude의 stdout은 읽는 스레드가 따로 비우므로, stdin 쓰기가 막혀도 claude의 줄이 막히지 않는다.

use std::collections::VecDeque;
use std::io::{BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, ExitStatus, Stdio};
use std::sync::mpsc::{self, Sender};
use std::time::{Duration, Instant};

use serde_json::Value;

mod agent_flags;
mod machine;
mod stream;

use machine::{Input, Launch, Machine, Output};

use crate::process;

/// stdin EOF 뒤 claude가 스스로 끝나기를 기다리는 시간. 진짜 claude 2.1.296은 1~1.6초에 끝났다(판 02 실측 G5). 넘으면
/// claude를 끈다 — 호스트가 없어 그룹째 끄는 손이 없을 때도 고아가 남지 않게.
const CLAUDE_EOF_GRACE: Duration = Duration::from_secs(5);

/// claude가 끝나기를 기다리는 동안 그 끝을 다시 보는 틈.
const EXIT_POLL: Duration = Duration::from_millis(20);

/// 앱 실행 파일이 Claude 변환기가 되는 하위 모드의 이름 — 첫 인자가 정확히 이것이면 진입점이 Tauri를 짓지 않고
/// [`run_claude_translator`]로 간다(three-axes 티켓 13, 워크플로 S4). 띄우는 쪽(앱의 대화 호스트)과 받는 쪽(진입점)이 이 상수
/// 하나를 함께 쓴다 — 한쪽만 이름을 바꾸면 앱의 Claude 대화만 열리지 않는다.
pub const CLAUDE_TRANSLATOR_MODE: &str = "acp-claude";

/// 변환기의 몸통 — 앱 진입점의 `acp-claude` 갈래([`CLAUDE_TRANSLATOR_MODE`])와 변환기 시험 bin이 이것 하나를 부른다. stdin이
/// 닫히면(쥔 claude가 끝난 뒤) 끝나고, 세션이 열린 뒤 claude가 끝나면 그 종료 코드로 끝난다. **stdout이 곧 ACP 선이다** — 이
/// 함수 밖에서 stdout에 아무것도 쓰지 않는다.
pub fn run_claude_translator() -> i32 {
    let (events, received) = mpsc::channel();
    read_acp(events.clone());
    let mut body = Body { machine: Machine::default(), claude: None, launched: 0, events, closing: None };
    loop {
        let event = match body.closing {
            None => received.recv().ok(),
            Some(deadline) => {
                if let Some(code) = body.watch_close(deadline) {
                    return code;
                }
                received.recv_timeout(EXIT_POLL).ok()
            }
        };
        if let Some(code) = event.and_then(|event| body.on(event)) {
            return code;
        }
    }
}

/// 몸통이 받는 것 — 읽는 스레드들이 보낸다.
enum Event {
    /// 호스트의 ACP 줄 하나(읽은 JSON).
    Acp(Value),
    /// 호스트가 stdin을 닫았다.
    AcpEnded,
    /// n번째로 띄운 claude의 stdout 줄 하나.
    Claude(u64, Value),
    /// n번째로 띄운 claude가 stdout을 닫았다.
    ClaudeClosed(u64),
}

/// 쥔 `claude` 하나 — 몇 번째로 띄웠나 · stdin(닫으면 `None`) · 프로세스.
struct Claude {
    nth: u64,
    stdin: Option<ChildStdin>,
    child: Child,
}

/// 변환기의 몸통 — 상태 기계와, 그것이 내는 것을 하는 손.
struct Body {
    machine: Machine,
    claude: Option<Claude>,
    /// 지금까지 띄운 claude 수 — 거둔 claude의 줄을 가린다.
    launched: u64,
    /// 읽는 스레드에 나눠 줄 보내는 쪽.
    events: Sender<Event>,
    /// 끄는 중이면 claude가 끝나기를 기다리는 마감 — 넘으면 끈다.
    closing: Option<Instant>,
}

impl Body {
    /// 받은 것 하나. 변환기가 끝나면 그 종료 코드.
    fn on(&mut self, event: Event) -> Option<i32> {
        match event {
            Event::Acp(message) => self.feed(Input::Acp(message)),
            Event::AcpEnded => self.feed(Input::AcpEnded),
            Event::Claude(nth, line) if self.holds(nth) => self.feed(Input::Claude(line)),
            // 끄는 중의 끝은 [`Body::watch_close`]가 프로세스로 본다 — claude의 후손이 stdout을 쥐고 있어도 마감이 선다.
            Event::ClaudeClosed(nth) if self.holds(nth) && self.closing.is_none() => {
                let claude = self.claude.as_mut().expect("쥔 claude다");
                let status = claude.child.wait();
                self.feed(ended(status))
            }
            // 거둔 claude의 것이다.
            Event::Claude(..) | Event::ClaudeClosed(_) => None,
        }
    }

    /// 지금 쥔 claude가 n번째로 띄운 것인가.
    fn holds(&self, nth: u64) -> bool {
        self.claude.as_ref().is_some_and(|claude| claude.nth == nth)
    }

    /// 입력 하나를 상태 기계에 넣고, 낸 것을 낸 차례대로 한다. 하다 생긴 입력(쓰지 못한 줄 · 띄우지 못함)은 그 자리에서 넣는다.
    fn feed(&mut self, input: Input) -> Option<i32> {
        let mut outputs: VecDeque<Output> = self.machine.step(input).into();
        while let Some(output) = outputs.pop_front() {
            match output {
                Output::Acp(line) => send(&line),
                Output::Claude(line) => {
                    if !self.write(&line) {
                        outputs.extend(self.machine.step(Input::Unwritten(line)));
                    }
                }
                Output::Launch(launch) => {
                    if let Err(error) = self.launch(&launch) {
                        outputs.extend(self.machine.step(Input::LaunchFailed(error)));
                    }
                }
                Output::Dismiss => self.dismiss(),
                Output::Close => self.close(),
                Output::Stderr(line) => eprintln!("{line}"),
                Output::Exit(code) => return Some(code),
            }
        }
        None
    }

    /// claude를 띄우고 그 stdout을 읽는 스레드를 띄운다. env는 받은 것(호스트가 준 로그인 env) 그대로다. claude의 stderr는
    /// 변환기의 stderr로 흘린다 — 호스트가 그 줄을 기록하고, 죽음 줄의 꼬리에도 싣는다.
    fn launch(&mut self, launch: &Launch) -> Result<(), String> {
        let mut child = Command::new(&launch.program)
            .args(&launch.args)
            .current_dir(&launch.cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|error| error.to_string())?;
        let stdin = child.stdin.take();
        let stdout = child.stdout.take().expect("stdout을 파이프로 띄웠다");
        self.launched += 1;
        read_claude(self.launched, stdout, self.events.clone());
        self.claude = Some(Claude { nth: self.launched, stdin, child });
        Ok(())
    }

    /// claude의 stdin에 줄 하나를 쓴다. 쓰지 못했으면(claude가 끝났거나 stdin을 닫았다) false다.
    fn write(&mut self, line: &Value) -> bool {
        let Some(stdin) = self.claude.as_mut().and_then(|claude| claude.stdin.as_mut()) else { return false };
        writeln!(stdin, "{line}").and_then(|()| stdin.flush()).is_ok()
    }

    /// 쥔 claude를 거둔다 — stdin을 닫고 스스로 끝나기를 기다린다. 넘으면 끈다. 그 claude의 줄은 더 들이지 않는다.
    fn dismiss(&mut self) {
        let Some(mut claude) = self.claude.take() else { return };
        drop(claude.stdin.take());
        let deadline = Instant::now() + CLAUDE_EOF_GRACE;
        while exited_or_killed(&mut claude.child, deadline).is_none() {
            std::thread::sleep(EXIT_POLL);
        }
    }

    /// 끄기 — 쥔 claude의 stdin을 닫는다. 끝은 [`Body::watch_close`]가 본다.
    fn close(&mut self) {
        if let Some(claude) = self.claude.as_mut() {
            drop(claude.stdin.take());
        }
        self.closing = Some(Instant::now() + CLAUDE_EOF_GRACE);
    }

    /// 끄는 중 — claude가 끝났으면(마감을 넘겼으면 꺼서) 그 끝을 상태 기계에 넣는다. 변환기가 끝나면 그 종료 코드.
    fn watch_close(&mut self, deadline: Instant) -> Option<i32> {
        let Some(claude) = self.claude.as_mut() else { return Some(0) };
        let status = exited_or_killed(&mut claude.child, deadline)?;
        self.feed(ended(status))
    }
}

/// 끝났으면 그 끝. 마감을 넘겼으면 끄고 거둔 끝. 아직이면 `None`.
fn exited_or_killed(child: &mut Child, deadline: Instant) -> Option<std::io::Result<ExitStatus>> {
    match child.try_wait() {
        Ok(Some(status)) => Some(Ok(status)),
        Ok(None) if Instant::now() < deadline => None,
        _ => {
            let _ = child.kill();
            Some(child.wait())
        }
    }
}

/// claude의 끝 → 상태 기계의 입력.
fn ended(status: std::io::Result<ExitStatus>) -> Input {
    match status {
        Ok(status) => Input::ClaudeEnded { status: status.to_string(), code: status.code() },
        Err(error) => Input::ClaudeEnded { status: error.to_string(), code: None },
    }
}

/// 호스트의 ACP 줄을 읽는 스레드 — 다 읽으면 끝을 알린다. 읽을 수 없는 줄은 건너뛴다.
fn read_acp(events: Sender<Event>) {
    std::thread::spawn(move || {
        process::for_each_line(std::io::stdin().lock(), |buf| {
            let line = String::from_utf8_lossy(buf);
            if line.trim().is_empty() {
                return;
            }
            match serde_json::from_str(&line) {
                Ok(message) => {
                    let _ = events.send(Event::Acp(message));
                }
                Err(error) => eprintln!("변환기: 읽을 수 없는 ACP 줄을 건너뜁니다 — {error}"),
            }
        });
        let _ = events.send(Event::AcpEnded);
    });
}

/// n번째로 띄운 claude의 stdout을 줄 단위로 읽는 스레드 — 다 읽으면 끝을 알린다. JSON이 아닌 줄은 버린다.
fn read_claude(nth: u64, stdout: ChildStdout, events: Sender<Event>) {
    std::thread::spawn(move || {
        process::for_each_line(BufReader::new(stdout), |buf| {
            if let Ok(line) = serde_json::from_slice::<Value>(buf) {
                let _ = events.send(Event::Claude(nth, line));
            }
        });
        let _ = events.send(Event::ClaudeClosed(nth));
    });
}

/// ACP 한 줄을 stdout에 쓴다. 호스트가 떠났으면 쓰기가 실패하고, 할 일이 없다.
fn send(message: &Value) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{message}").and_then(|()| out.flush());
}
