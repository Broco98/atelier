//! 에이전트 프로세스 하나의 생애 — 여러 스레드가 본 사실(자식의 끝 · 수신 EOF · stderr의 끝)과 우리가 한 일
//! (세션을 엶 · 끄기 시작 · 거두기)을 한 자리에 모은다. 그래서
//!
//! - **죽음을 한 번만 알린다.** 수신 EOF와 자식의 끝 가운데 먼저 온 쪽이 죽음이고, 둘째는 거른다.
//! - **우리가 끈 것은 죽음이 아니다.** 끄기를 시작한 뒤의 끝은 알리지 않는다. 세션을 열기 전의 끝은 열기
//!   실패가 알리므로 여기서는 알리지 않는다.
//! - **거둔 번호에 신호를 보내지 않는다.** 그룹을 끄는 일과 「거뒀다」 표시를 같은 잠금 안에서 한다 — 거둔 뒤의
//!   번호는 남의 프로세스에게 갈 수 있다.

use std::collections::VecDeque;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use crate::process::{self, Exit};

/// 죽음 줄에 싣는 stderr 꼬리의 줄 수.
const STDERR_TAIL_LINES: usize = 20;

/// 죽음을 안 뒤 stderr를 끝까지 읽기를 기다리는 시간 — 유언이 꼬리에 들게. 그룹을 끈 뒤라 대개 곧바로 닫힌다.
/// 그룹 밖으로 달아난 후손이 stderr를 쥐고 있어도 이 시간에서 끊는다.
const STDERR_DRAIN: Duration = Duration::from_secs(1);

/// 프로세스 죽음 — 까닭(사람이 읽을 한 줄)과 stderr 꼬리.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Death {
    pub reason: String,
    pub stderr_tail: Vec<String>,
}

pub(crate) struct Life {
    state: Mutex<State>,
    changed: Condvar,
}

#[derive(Default)]
struct State {
    /// 자식이 끝난 모양. 거두지는 않았다.
    exit: Option<Exit>,
    /// 자식의 끝과 수신 EOF 가운데 먼저 온 쪽 — 죽음의 까닭을 짓는다.
    first: Option<Gone>,
    /// 세션이 열렸다 — 이제부터의 끝은 죽음으로 알린다.
    armed: bool,
    /// 우리가 끄는 중이다.
    stopping: bool,
    /// 거둔다 — 이 뒤로 그 번호에 신호를 보내지 않는다.
    reaped: bool,
    stderr_done: bool,
    stderr_tail: VecDeque<String>,
}

#[derive(Clone, Copy)]
enum Gone {
    Exited,
    ClosedOutput,
}

impl Life {
    pub(crate) fn new() -> Arc<Self> {
        Arc::new(Self { state: Mutex::new(State::default()), changed: Condvar::new() })
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn change(&self, apply: impl FnOnce(&mut State)) {
        apply(&mut self.lock());
        self.changed.notify_all();
    }

    /// 자식이 끝났다(지켜보는 스레드).
    pub(crate) fn exited(&self, exit: Exit) {
        self.change(|state| {
            state.exit = Some(exit);
            state.first.get_or_insert(Gone::Exited);
        });
    }

    /// 수신 EOF(stdout을 읽는 스레드).
    pub(crate) fn closed_output(&self) {
        self.change(|state| {
            state.first.get_or_insert(Gone::ClosedOutput);
        });
    }

    /// stderr 한 줄을 꼬리에 더한다.
    pub(crate) fn stderr_line(&self, line: &str) {
        let mut state = self.lock();
        if state.stderr_tail.len() == STDERR_TAIL_LINES {
            state.stderr_tail.pop_front();
        }
        state.stderr_tail.push_back(line.to_owned());
    }

    pub(crate) fn stderr_closed(&self) {
        self.change(|state| state.stderr_done = true);
    }

    /// 세션이 열렸다.
    pub(crate) fn arm(&self) {
        self.change(|state| state.armed = true);
    }

    /// 끄기를 시작한다.
    pub(crate) fn stop(&self) {
        self.change(|state| state.stopping = true);
    }

    /// 자식이 끝나기를 `deadline`까지 기다린다. 끝났으면 true다. 끝을 지켜보지 못했으면 마감까지 기다린 셈 친다.
    pub(crate) fn wait_exit(&self, deadline: Instant) -> bool {
        let mut state = self.lock();
        loop {
            if state.exit.is_some() {
                return true;
            }
            let now = Instant::now();
            if now >= deadline {
                return false;
            }
            state = self.changed.wait_timeout(state, deadline - now).unwrap_or_else(|poisoned| poisoned.into_inner()).0;
        }
    }

    /// 거두기 직전 — 그룹째 SIGKILL하고 「거뒀다」를 세운다. 같은 잠금 안이라 죽음을 지켜보는 쪽이 그 뒤에
    /// 그룹을 쏘지 않는다.
    pub(crate) fn kill_before_reaping(&self, pgid: u32) {
        let mut state = self.lock();
        process::kill_group(pgid);
        state.reaped = true;
    }

    /// 죽음을 지켜보는 스레드를 띄운다. 세션이 열린 뒤 수신 EOF나 자식의 끝이 오면, 그룹째 끄고(남은 후손 ·
    /// 출력을 쥔 손주) stderr를 다 읽기를 잠깐 기다린 뒤 `on_death`를 한 번 부른다. 끄기가 먼저 오면 조용히 끝난다.
    pub(crate) fn watch_death(self: &Arc<Self>, pgid: u32, on_death: impl FnOnce(Death) + Send + 'static) {
        let life = Arc::clone(self);
        std::thread::spawn(move || {
            let mut state = life.lock();
            let gone = loop {
                if state.stopping {
                    return;
                }
                if let (true, Some(gone)) = (state.armed, state.first) {
                    break gone;
                }
                state = life.changed.wait(state).unwrap_or_else(|poisoned| poisoned.into_inner());
            };
            if !state.reaped {
                process::kill_group(pgid);
            }
            let reason = match (gone, state.exit) {
                (Gone::ClosedOutput, _) => "에이전트가 출력을 닫았습니다".to_string(),
                (Gone::Exited, Some(Exit::Code(code))) => format!("에이전트 프로세스가 끝났습니다 (종료 코드 {code})"),
                (Gone::Exited, Some(Exit::Signal(signal))) => format!("에이전트 프로세스가 끝났습니다 (시그널 {signal})"),
                (Gone::Exited, _) => "에이전트 프로세스가 끝났습니다".to_string(),
            };
            let deadline = Instant::now() + STDERR_DRAIN;
            while !state.stderr_done {
                let now = Instant::now();
                if now >= deadline {
                    break;
                }
                state =
                    life.changed.wait_timeout(state, deadline - now).unwrap_or_else(|poisoned| poisoned.into_inner()).0;
            }
            let stderr_tail = state.stderr_tail.iter().cloned().collect();
            drop(state);
            on_death(Death { reason, stderr_tail });
        });
    }
}
