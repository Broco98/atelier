//! Agent 부르기 — Agent가 Thread 도구로 다른 Agent에게 일을 맡기고, 그 Agent의 마지막 메시지를 결과로 받는다(v1 구현 스펙 §8 ·
//! S15 · S16, v1 티켓 16). plan 「v1의 Contract는 텍스트다」 그대로 — 맡기는 것도 받는 것도 글이다.
//!
//! - **부를 수 있나 — 셋을 차례로 본다.** 부른 쪽 정의(스냅숏)의 `tools.agents`에 있나(Host는 「범위 안 아무나」, S15) → 이 Thread의
//!   범위 안인가(이미 참여자이거나 범위에서 풀린다 — 멘션과 같은 규칙, v1 티켓 11 · 13) → 지금 호출 고리 밖인가(S16). 하나라도
//!   어기면 아무것도 적지 않고 거절 까닭을 도구의 실패로 돌려준다.
//! - **맡긴 일은 사람의 말과 같은 길로 간다.** 불린 Agent가 참여자가 아니면 들이고(`joined` · 스냅숏), 그 Session의 턴 차례에
//!   [`Assignment`]를 실은 말로 넣는다 — 머리말 · 지난 말 규칙(S10)이 같고, 그 Session의 턴이 돌면 대기 줄에 든다. 다만 기록은
//!   `sent`가 아니라 `call` 시작 줄이다 — 사람의 말이 아니다.
//! - **결과는 그 턴의 끝이다.** 턴 차례가 맡긴 일을 받은 턴을 닫으면 그 턴 끝 줄을 맡긴 일에 돌려준다. 부른 쪽의 도구 호출(연결마다의
//!   스레드)이 그것을 기다리다가 기록에서 그 턴의 마지막 메시지를 읽어 결과로 돌려주고 `call` 끝 줄을 적는다. **엔진은 시간 제한을
//!   두지 않는다** — 불린 Agent가 사람에게 물으면 카드는 불린 Agent의 것이고, 부른 쪽은 그 답까지 함께 기다린다.
//! - **멈춤은 고리 전체다.** 사람이 Thread를 멈추면 그 Thread의 도는 턴이 모두 멈추고(불린 턴 포함) 대기 줄에 든 맡긴 일은 거둔다.
//!   그때 결과는 「사람이 멈춤」이다.
//! - 맡긴 일이 턴 끝 없이 사라지면(Session의 죽음 · 닫힘 · 대기 줄에서 지움) 쥔 손이 놓이며 기다림이 풀린다 — 「답하지 못함」이다.
//! - **「다시 맡기기」는 사람이 같은 부르기를 다시 하는 것이다**(§8, v1 티켓 17) — 부른 Agent의 이름으로 같은 맡긴 글을 같은 길로
//!   보내고, 그 결과를 부른 Agent의 다음 말로 넣는다. 사람이 누른 일이라 그 말은 사람의 말(`sent`)이다.

use std::sync::mpsc;
use std::time::Instant;

use atelier_core::{AgentCalls, AgentRoster, Participant, RecordKind, RecordLine};
use serde_json::{json, Value};

use super::{answers_to, newcomer, ConversationHost, Recipient, SessionKey};
use crate::past;
use crate::records::TurnEndLine;
use crate::thread_tools;
use crate::HostError;

/// 맡긴 일 하나 — 불린 Agent에게 가는 말에 실려 그 Session의 턴 차례를 지난다. 턴 차례는 이것을 실은 말을 `call` 시작 줄로
/// 적고([`Assignment::started`]), 그 말이 연 턴이 끝나면 턴 끝 줄을 돌려준다([`Assignment::ended`]). 기다리는 쪽은 부른 Agent의
/// 도구 호출이다 — 이것이 턴 끝 없이 놓이면(죽음 · 닫힘 · 대기 줄에서 빠짐) 기다림이 풀린다.
pub(in crate::host) struct Assignment {
    id: String,
    from: String,
    to: String,
    /// 이 일을 받은 턴의 호출 고리 — 처음 부른 Agent부터 불린 Agent까지. 불린 Agent가 또 부르면 이 고리 안의 Agent는 못 부른다(S16).
    chain: Vec<String>,
    ended: mpsc::Sender<TurnEndLine>,
}

impl Assignment {
    /// 맡긴 일과, 그 일을 받은 턴의 끝을 기다리는 쪽.
    pub(in crate::host) fn new(id: &str, from: &str, to: &str, chain: Vec<String>) -> (Self, mpsc::Receiver<TurnEndLine>) {
        let (ended, waiting) = mpsc::channel();
        (Self { id: id.to_owned(), from: from.to_owned(), to: to.to_owned(), chain, ended }, waiting)
    }

    /// 일을 맡긴 Agent — `call` 줄의 참여자(`who`)다.
    pub(in crate::host) fn from(&self) -> &str {
        &self.from
    }

    /// 불린 Agent에게 가는 본문 — 「<부른 쪽>이 맡긴 일」과 맡긴 글(§8 흐름 2).
    pub(in crate::host) fn body(&self, task: &str) -> String {
        format!(
            "{} 맡긴 일이다. 이 턴을 끝낼 때의 마지막 메시지가 @{}에게 결과로 돌아간다.\n\n{task}",
            subject(&self.from),
            self.from
        )
    }

    /// `call` 시작 줄의 payload — 맡긴 말(`text`)과, 불린 Agent에게 실제로 간 머리말 · 지난 말 · 본문(`prompt`, `sent`와 같다).
    pub(in crate::host) fn started(&self, task: &str, prompt: &[Value]) -> Value {
        json!({"state": "started", "id": self.id, "from": self.from, "to": self.to, "text": task, "prompt": prompt})
    }

    /// 맡긴 일을 받은 턴이 끝났다 — 그 턴 끝 줄을 기다리는 쪽에 돌려준다. 기다리는 쪽이 이미 떠났으면 할 일이 없다.
    pub(in crate::host) fn ended(self, line: TurnEndLine) {
        let _ = self.ended.send(line);
    }

    /// 이 일을 받은 턴의 호출 고리.
    pub(in crate::host) fn chain(&self) -> &[String] {
        &self.chain
    }

    pub(in crate::host) fn id(&self) -> &str {
        &self.id
    }
}

/// 부르기가 끝난 꼴 — `call` 끝 줄의 `outcome`이고, 부른 Agent에게 갈 도구의 결과다.
enum Outcome {
    /// 불린 Agent가 턴을 끝냈다 — 그 마지막 메시지.
    Answered(String),
    /// 답하지 못함 — 그 까닭.
    Failed(String),
    /// 사람이 Thread를 멈췄다.
    Stopped,
}

/// 「사람이 멈춤」의 글.
const STOPPED: &str = "사람이 멈춤";

/// 다시 맡긴 부르기의 기다림 스레드 이름.
const AGAIN_THREAD: &str = "atelier-call-again";

impl ConversationHost {
    /// 「Agent 부르기」(§8) — `key`의 Agent가 `call`(handle 또는 `project/handle`)을 불러 `task`를 맡긴다. **막히는 호출이다** — 불린
    /// Agent의 턴이 끝날 때까지 기다린다(연결마다의 스레드에서 불린다). 거절이면 아무것도 적지 않고, 맡긴 뒤에는 `call` 끝 줄을
    /// 적는다. 답은 도구의 결과(MCP `content`)다.
    pub(super) fn call_agent(&self, key: &SessionKey, call: &str, task: &str) -> Value {
        let begun = Instant::now();
        // 멈춤의 차례 — 이 부르기 동안 사람이 Thread를 멈추면 바뀐다.
        let halts = self.threads.halts(&key.thread);
        // 읽기만 된 Thread(v1 티켓 38)에서는 새 턴을 열지 않는다 — 지금 턴이 끝나면 Session이 꺼진다.
        if let Err(error) = self.writable(&key.thread) {
            return thread_tools::said(&error.to_string(), true);
        }
        let (callee, chain) = match self.callable(key, call) {
            Ok(callable) => callable,
            Err(refusal) => return thread_tools::said(&refusal, true),
        };
        self.run_call(key, callee, chain, task, halts, begun).1
    }

    /// 「다시 맡기기」(§8 · v1 티켓 17) — 사람이 호출 줄에서 `from`의 부르기를 같은 글(`task`)로 다시 한다. 부를 수 있는지는
    /// [`Self::call_agent`]와 같은 셋을 곧바로 보고, 거절이면 아무것도 적지 않고 그 까닭으로 실패한다. **기다리지 않는다** — 맡기고
    /// 불린 턴을 기다리는 일은 따로 선 스레드가 하고, 결과는 부른 Agent에게 다음 말로 간다(받은 답은 그 Agent가 아직 보지 못한 불린
    /// Agent의 마지막 메시지라 지난 말에 든다 — 본문은 그것을 가리킨다). 사람이 그사이 Thread를 멈췄거나 호스트를 끄는 중이면 보내지
    /// 않는다 — 멈춘 고리를 다시 돌리지 않는다.
    pub fn call_again(&self, thread: &str, from: &str, to: &str, task: &str) -> Result<(), HostError> {
        let begun = Instant::now();
        let halts = self.threads.halts(thread);
        let file = self.writable(thread)?;
        if !file.participants.iter().any(|participant| participant.handle == from) {
            return Err(HostError::ParticipantNotFound { thread: thread.to_owned(), handle: from.to_owned() });
        }
        let key = SessionKey::new(thread, from);
        let (callee, chain) = self.callable(&key, to).map_err(HostError::CallRefused)?;
        let host = ConversationHost(std::sync::Arc::clone(&self.0));
        let task = task.to_owned();
        std::thread::Builder::new()
            .name(AGAIN_THREAD.to_owned())
            .spawn(move || {
                let to = callee.handle().to_owned();
                let relay = match host.run_call(&key, callee, chain, &task, halts, begun).0 {
                    Outcome::Answered(_) => format!("같은 일을 @{to}에게 다시 맡겼어요. 받은 답으로 이어 가 주세요."),
                    Outcome::Failed(reason) => format!("같은 일을 @{to}에게 다시 맡겼지만 답하지 못했어요 — {reason}"),
                    Outcome::Stopped => return,
                };
                if host.logins.closed() || host.threads.halts(&key.thread) != halts {
                    return;
                }
                if let Err(error) = host.say_in_thread(&key, &relay, Vec::new(), None) {
                    eprintln!("{error}");
                }
            })
            .map(drop)
            .map_err(|error| HostError::Send(format!("다시 맡기지 못했습니다: {error}")))
    }

    /// 맡기고 `call` 끝 줄을 적는다 — 끝난 꼴과, 부른 Agent에게 갈 도구의 결과.
    fn run_call(
        &self,
        key: &SessionKey,
        callee: Recipient,
        chain: Vec<String>,
        task: &str,
        halts: u64,
        begun: Instant,
    ) -> (Outcome, Value) {
        let to = callee.handle().to_owned();
        let id = uuid::Uuid::new_v4().to_string();
        let outcome = self.hand_over(key, &id, callee, chain, task, halts);
        let duration = u64::try_from(begun.elapsed().as_millis()).unwrap_or(u64::MAX);
        // 끝 줄 하나로도 부르기 하나가 읽힌다 — 맡긴 일이 가기 전에 막히면 시작 줄이 없다.
        let mut payload = json!({
            "state": "ended", "id": id, "from": key.handle, "to": to, "text": task, "durationMs": duration,
        });
        let result = match &outcome {
            Outcome::Answered(answer) => {
                payload["outcome"] = json!("answered");
                payload["answer"] = json!(answer);
                thread_tools::said(answer, false)
            }
            Outcome::Failed(reason) => {
                payload["outcome"] = json!("failed");
                payload["reason"] = json!(reason);
                thread_tools::said(&format!("{} 답하지 못함 — {reason}", subject(&to)), true)
            }
            Outcome::Stopped => {
                payload["outcome"] = json!("stopped");
                payload["reason"] = json!(STOPPED);
                thread_tools::said(&format!("{STOPPED} — 사람이 이 Thread를 멈췄다. @{to}에게 맡긴 일도 멈췄다"), true)
            }
        };
        let written = self.thread_log(&key.thread).map_err(|error| error.to_string()).and_then(|log| {
            log.write(RecordKind::Call, Some(&key.handle), payload).map(drop)
        });
        if let Err(error) = written {
            eprintln!("{error}");
        }
        (outcome, result)
    }

    /// 부를 수 있나(§8 「부를 수 있나」) — 불린 쪽과, 그 일을 받을 턴의 호출 고리. 거절이면 그 까닭(Agent가 읽을 글)이다.
    fn callable(&self, key: &SessionKey, call: &str) -> Result<(Recipient, Vec<String>), String> {
        let file = self.read_thread_file(&key.thread).map_err(|error| error.to_string())?;
        let mut scope = Scope { host: self, seated: &file.participants, work: file.work.as_deref(), roster: None };
        let callee = scope.resolve(call);
        // 1. 부른 쪽 정의의 `tools.agents` — 정의는 스냅숏에서만 읽는다(§19).
        let definition = self.snapshot_definition(key).map_err(|error| error.to_string())?;
        if let AgentCalls::Listed(names) = &definition.tools.agents {
            let named = |name: &String| {
                name.trim_start_matches('@') == call
                    || matches!((&callee, scope.resolve(name)), (Ok(callee), Ok(listed)) if callee.handle() == listed.handle())
            };
            if !names.iter().any(named) {
                let listed: Vec<String> = names.iter().map(|name| format!("@{}", name.trim_start_matches('@'))).collect();
                let listed = if listed.is_empty() { "없음".to_owned() } else { listed.join(", ") };
                return Err(format!(
                    "@{call} — 네 정의의 tools.agents에 없는 Agent라 부를 수 없어요. 부를 수 있는 Agent: {listed}"
                ));
            }
        }
        // 2. 이 Thread의 범위.
        let callee = callee.map_err(|error| error.to_string())?;
        // 3. 지금 호출 고리 — 부른 쪽이 맡은 일의 고리, 맡은 일이 아니면 부른 쪽 하나다(S16).
        let mut chain = self.chain_of(key);
        if chain.iter().any(|handle| handle == callee.handle()) {
            let shown: Vec<String> = chain.iter().map(|handle| format!("@{handle}")).collect();
            return Err(format!(
                "@{} — 지금 호출 고리 안에 있어 다시 부를 수 없어요: {}",
                callee.handle(),
                shown.join(" → ")
            ));
        }
        chain.push(callee.handle().to_owned());
        Ok((callee, chain))
    }

    /// 그 Session의 지금 턴이 든 호출 고리 — 맡은 일을 받은 턴이면 그 고리, 아니면(사람의 말 · 스스로 이어 간 턴) 그 Agent 하나다.
    fn chain_of(&self, key: &SessionKey) -> Vec<String> {
        self.threads
            .find(key)
            .and_then(|conv| conv.lock_found().and_then(|state| state.order.serving().map(|call| call.chain().to_vec())))
            .unwrap_or_else(|| vec![key.handle.clone()])
    }

    /// 맡긴다 — 불린 Agent를 들이고, 맡긴 일(`id`)을 그 Session에 보내고, 그 일을 받은 턴이 끝날 때까지 기다린다.
    fn hand_over(&self, key: &SessionKey, id: &str, callee: Recipient, chain: Vec<String>, task: &str, halts: u64) -> Outcome {
        let to = match callee {
            Recipient::Seated(handle) => handle,
            Recipient::Newcomer(found) => match self.join(&key.thread, &found) {
                Ok(handle) => handle,
                Err(error) => return Outcome::Failed(error.to_string()),
            },
        };
        let (assignment, ended) = Assignment::new(id, &key.handle, &to, chain);
        let at = SessionKey::new(&key.thread, &to);
        let halted = || self.threads.halts(&key.thread) != halts;
        if let Err(error) = self.say_in_thread(&at, task, Vec::new(), Some(assignment)) {
            // 턴을 연 뒤 보내지 못했으면 그 턴 끝(오류)이 이미 왔다. 아니면 맡긴 일이 가기 전에 막혔다 — 맡긴 일은 놓였다.
            return match ended.try_recv() {
                Ok(line) => self.outcome_of(key, &to, id, &line, halted()),
                Err(_) if halted() => Outcome::Stopped,
                Err(_) => Outcome::Failed(error.to_string()),
            };
        }
        if halted() {
            // 맡기는 사이에 사람이 Thread를 멈췄다 — 그 멈춤은 이 일을 보지 못했다.
            self.halt(&at, id);
        }
        match ended.recv() {
            Ok(line) => self.outcome_of(key, &to, id, &line, halted()),
            Err(_) if halted() => Outcome::Stopped,
            Err(_) => Outcome::Failed(self.vanished(&key.thread, &to, id)),
        }
    }

    /// 맡긴 일을 받은 턴의 끝 → 끝난 꼴. 턴이 제대로 끝났으면 사람이 그사이 멈췄어도 받은 답이다.
    fn outcome_of(&self, key: &SessionKey, to: &str, id: &str, line: &TurnEndLine, halted: bool) -> Outcome {
        let cut = line.error.is_some() || line.cancelled_by_us || line.stop_reason.as_deref() == Some("cancelled");
        if cut && halted {
            return Outcome::Stopped;
        }
        if let Some(error) = &line.error {
            let message = error["message"].as_str().map_or_else(|| error.to_string(), str::to_owned);
            return Outcome::Failed(message);
        }
        if cut {
            return Outcome::Failed("턴을 끝내기 전에 멈췄다".to_owned());
        }
        let lines = match self.read_thread_record(&key.thread, 0) {
            Ok(lines) => lines,
            Err(error) => return Outcome::Failed(error.to_string()),
        };
        let answer = started_at(&lines, id).and_then(|after| past::answer(&lines, to, after));
        answer.map_or_else(|| Outcome::Failed("마지막 메시지 없이 턴을 끝냈다".to_owned()), Outcome::Answered)
    }

    /// 맡긴 일이 턴 끝 없이 사라진 까닭 — 기록에서 읽는다.
    fn vanished(&self, thread: &str, to: &str, id: &str) -> String {
        let lines = self.read_thread_record(thread, 0).unwrap_or_default();
        let Some(after) = started_at(&lines, id) else {
            return "맡긴 일이 전해지기 전에 대기 줄에서 빠졌다".to_owned();
        };
        let died = lines.iter().rev().take_while(|line| line.seq > after).find_map(|line| {
            let died = line.kind == RecordKind::Session && line.who.as_deref() == Some(to) && line.payload["state"] == "died";
            died.then(|| line.payload["reason"].as_str().unwrap_or_default().to_owned())
        });
        match died {
            Some(reason) => format!("@{to}의 Session이 끝났다 — {reason}"),
            None => format!("턴을 끝내기 전에 @{to}의 Session이 닫혔다"),
        }
    }

    /// 맡긴 일 하나를 멈춘다 — 대기 줄에 있으면 거두고, 그 일을 받은 턴이 돌면 멈춘다.
    fn halt(&self, at: &SessionKey, id: &str) {
        let Some(conv) = self.threads.find(at) else { return };
        let Some(mut state) = conv.lock_found() else { return };
        conv.seat(&mut state).withdraw_calls();
        if state.order.serving().is_some_and(|call| call.id() == id) {
            if let Err(refused) = conv.seat(&mut state).stop() {
                eprintln!("{}", refused.into_host(&at.thread));
            }
        }
    }
}

/// 맡긴 일의 `call` 시작 줄의 seq — 그 일이 불린 Agent에게 간 자리.
fn started_at(lines: &[RecordLine], id: &str) -> Option<u64> {
    lines
        .iter()
        .find(|line| line.kind == RecordKind::Call && line.payload["state"] == "started" && line.payload["id"] == id)
        .map(|line| line.seq)
}

/// 부르는 이름을 이 Thread의 범위에서 푼다 — 멘션과 같은 차례다(v1 티켓 13): 이미 참여자인 이름이 먼저(정의가 바뀌어도 그
/// 참여자, 스토리 52), 아니면 범위(`work`가 없으면 Library만)에서 푼다. 범위는 처음 쓸 때 한 번 읽는다.
struct Scope<'a> {
    host: &'a ConversationHost,
    seated: &'a [Participant],
    work: Option<&'a str>,
    roster: Option<AgentRoster>,
}

impl Scope<'_> {
    fn resolve(&mut self, call: &str) -> Result<Recipient, HostError> {
        let call = call.trim_start_matches('@');
        if let Some(participant) = self.seated.iter().find(|participant| answers_to(participant, call)) {
            return Ok(Recipient::Seated(participant.handle.clone()));
        }
        let roster = match &self.roster {
            Some(roster) => roster,
            None => self.roster.insert(self.host.agents_in_scope(self.work)?),
        };
        newcomer(roster, self.seated, call)?
            .map(Recipient::Newcomer)
            .ok_or_else(|| HostError::AgentNotFound { call: call.to_owned(), work: self.work.map(str::to_owned) })
    }
}

/// `@handle` 뒤에 주격 조사를 붙인 것 — 끝 글자가 받침 있는 한글이면 「이」, 아니면 「가」(영문 handle은 대개 모음으로 읽힌다).
pub(super) fn subject(handle: &str) -> String {
    let batchim = handle.chars().last().is_some_and(|last| {
        ('\u{AC00}'..='\u{D7A3}').contains(&last) && (u32::from(last) - 0xAC00) % 28 != 0
    });
    format!("@{handle}{}", if batchim { "이" } else { "가" })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 부른_쪽의_이름_뒤에는_받침에_맞는_주격_조사가_붙는다() {
        assert_eq!(subject("host"), "@host가");
        assert_eq!(subject("리뷰어"), "@리뷰어가");
        assert_eq!(subject("검토관"), "@검토관이");
    }
}
