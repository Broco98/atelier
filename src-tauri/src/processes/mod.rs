//! 셸이 띄운 프로세스를 가려내 끝낸다 — 이 맥의 프로세스 표를 읽는 **수집**, 그 값으로 「무엇이 어느
//! 셸에서 나왔는가」를 가르는 **판정**, 판정이 고른 것에 신호를 보내는 **끝내기**(프로세스 결정 2 · 3).
//!
//! 셸 그룹과 그 순간의 foreground 그룹에만 신호를 보내면(`pty.rs`의 `groups_of`) claude Bash 도구가
//! 띄운 dev 서버에는 안 닿는다 — 별도 세션이고 제어 tty가 없다. 그것을 찾는 길이 둘이다: 셸의 PID
//! 트리, 그리고 셸이 자손에게 물려준 **표식**(셸 env의 셸 키). 부모가 먼저 죽어 launchd 밑으로 넘어간
//! 것은 트리가 끊겨 표식으로만 잡힌다.
//!
//! **층을 가른 것이 요점이다.**
//! - 수집(`snapshot`)은 부작용 층이다. 프로세스 표를 한 번 읽어 값(스냅샷)으로 만든다. macOS 커널
//!   인터페이스(`libproc`, `KERN_PROCARGS2`)라 macOS에서만 읽고, 다른 OS는 빈 스냅샷을 돌려준다.
//! - 판정(`verdict`)은 순수 함수다. 스냅샷 값만 받으므로 살아 있는 프로세스 없이 모든 갈래를 표로
//!   잰다. 모든 OS에서 컴파일되고 검사가 돈다 — PR 게이트(우분투)가 재는 것은 이 층이다.
//! - 예외 목록(`exceptions`)은 판정이 **가장 먼저** 가르는 이름 목록이다(프로세스 결정 5). 기본 목록이 여기
//!   Rust 상수로 산다 — 판정이 화면 없이 쓰기 때문이다. 사람이 고친 목록은 설정 파일에서 온다.
//! - 끝내기(`ending`)는 부작용 층이다. 판정이 고른 신원만 받고, 누가 우리 것인지 다시 판단하지 않는다.
//!   신호마다 직전에 신원을 다시 본다. 커널을 트레이트 뒤에 둬 가짜 커널로 모든 갈래를 잰다. 모듈 이름에
//!   `terminate`를 쓰지 않는 것은 `terminate.rs`가 이미 ⌘Q · Dock 종료를 묻는 macOS 델리게이트이기
//!   때문이다.
//! - 인스턴스 기록(`instances`)은 부작용 층이다(프로세스 결정 6). 이 실행이 띄운 셸의 키를 디스크 한 장에 적어,
//!   함께 뜬 다른 빌드의 판정이 그 셸의 자손을 고아로 안 보게 한다. 판정은 그 기록을 값으로 받을 뿐 읽지 않는다.
//! - 정리 기록(`cleanup_log`)은 앱이 무엇을 언제 왜 끝냈는지를 남긴다(티켓 11). 끝내기의 결과와 판정의 행으로 사건을 짓는
//!   것은 순수하고, 쓰기는 인스턴스 기록과 같은 뮤텍스 안에서 한다(`instances::Record::log`).
//! - 화면 스냅샷(`screen`)은 판정 결과를 `Processes` 화면에 보낼 값으로 옮긴다(티켓 26). 판정을 다시 가르지 않는다 — 묶음의
//!   이름과 모양이 판정의 것 그대로다.
//! - 지표(`metrics`)는 부작용 층이다(티켓 28). 판정이 고른 프로세스만 메모리(`phys_footprint`) · CPU 시간 · LISTEN 포트를 읽고,
//!   두 표본의 차이로 CPU%를 짓는 계산(순수)을 함께 든다. 수집처럼 macOS에서만 읽고 다른 OS는 빈 값이다.
//! - 요약(`summary`)은 nav 메타가 10초마다 묻는 값이다(티켓 29) — 앱 전체 메모리 합계, 출처 불명의 신원, `●`를 켜는 기록의 머리 id.
//!   요약 카드(티켓 30)가 읽는 CPU와 앱 본체(Rust + 웹뷰의 WebContent), 합계의 1시간 고리(추이)도 여기 산다. 화면이 닫혀 있어도
//!   배경 표본이 모은다. 값과 그 값을 쥐는 자리만 짓는다 — 웹뷰에게 묻는 FFI는 앱 층(`webview.rs`)이 건다.
//!
//! - 셸 키(`shell_key`)는 셸 키 `<세대>-<PTY 번호>`를 짓고 읽는 규칙 한 벌이다 — 판정 · 화면 · 훅 상태 파일(`shells`)이 모두 이
//!   규칙으로 가른다. 이 실행의 세대(`shell_key::generation`)도 여기 산다. 시계(`clock`)는 이 앱이 적는 시각의 벽시계 하나다.
//! - 프로세스 서비스(`service`)는 **읽기**를 잇는 자리다 — `Processes` 화면의 스냅샷과 배경 표본(요약 · 추이), 정리 기록 읽기. 풀은
//!   트레이트(`service::ShellListing`) 뒤에서 본다: 이 모듈은 `pty`를 모른다. 앱이 풀과 따로 들고, 명령이 그것을 찾는다.
//!
//! **끝내기**를 잇는 자리(셸 띄우기 · 셸 닫기 · 새로고침 · 셸 스스로 끝남 · 앱 종료 · 앱 시작의 정리 · 손으로 끝내기)는 풀을 쥔
//! `pty.rs`에 있다.

// **안 쓰임 경고를 이 모듈 한 자리에서 끈다.** 판정 결과의 출처 불명 · 다른 인스턴스 · 예외 묶음은 13 · 31이 읽는다(판정의
// 모드와 확정 고아, 시작 정리가 끝낸 결과는 10이, 끝내기의 결과와 판정의 도우미 표시는 11의 정리 기록이 읽는다). 그때까지는
// 검사만 부르고, 리눅스에서는 실물 검사마저 빠진다. 칸마다 적으면 열 줄이 넘고 하나씩 낡는다 — 판 01이 끝나면 이 줄을
// 걷는다(다른 인스턴스 · 예외 묶음은 판 04의 31이 처음 읽으니, 그때까지 그 칸들에만 따로 단다). 11을 마친 때도 macOS lib
// 빌드에서 이 줄이 가리는 것은 검사만 부르는 `ending::start` 하나다.
#![allow(dead_code)]

use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

pub(crate) mod cleanup_log;
pub(crate) mod clock;
pub(crate) mod ending;
pub(crate) mod exceptions;
pub(crate) mod instances;
pub(crate) mod metrics;
pub(crate) mod procargs;
pub(crate) mod screen;
pub(crate) mod service;
pub(crate) mod shell_key;
pub(crate) mod snapshot;
pub(crate) mod summary;
#[cfg(all(test, target_os = "macos"))]
pub(crate) mod testkit;
pub(crate) mod verdict;

/// 셸이 자손에게 물려주는 표식의 변수 이름. 값이 셸 키(`<세대>-<PTY 번호>`, `shell_key`)다.
///
/// 심는 자리(`pty.rs`의 셸 빌더)와 읽는 자리(수집)가 이 상수 하나로 이어진다. 양쪽에 글자를 박으면
/// 한쪽 오타가 「표식 없음」으로 조용히 눕는다 — 셸을 닫아도 dev 서버가 남는데 아무 검사도 안 운다.
pub(crate) const SHELL_KEY_ENV: &str = "ATELIER_SHELL";

/// 앱이 물려받은 셸 키 — 앱 env의 표식(프로세스 스펙 S6). 앱을 아틀리에 셸에서 띄웠을 때만 있다(설치본
/// 셸에서 `pnpm tauri dev`). 판정은 이 키를 문 것을 어느 묶음에도 넣지 않는다 — 앱과 함께 뜬 vite가 그렇다.
///
/// 뜬 뒤에 안 바뀌므로 한 번 읽는다.
pub(crate) fn inherited_key() -> Option<&'static str> {
    static KEY: OnceLock<Option<String>> = OnceLock::new();
    KEY.get_or_init(|| std::env::var(SHELL_KEY_ENV).ok().filter(|key| !key.is_empty())).as_deref()
}

/// **이 실행** — 판정이 「이 실행의 것」과 「앱 자신」을 가를 때 쓰는 세 값: 이 실행의 세대, 앱의 pid, 앱이 물려받은 셸
/// 키(프로세스 스펙 S6 · S52). 판정의 입력(`verdict::Inputs::run`)이다.
///
/// **한 값으로 묶어 한 자리에서 짓는다**(`ThisRun::current`). 판정을 부르는 자리가 여섯이다(`pty.rs`의 닫기 전 물음 · 앱 종료 ·
/// 시작 정리 · 셸 닫기와 새로고침과 셸 스스로 끝남의 앞 절반, `service`의 화면 스냅샷 · 요약). 세 칸을 자리마다 손으로 채우면
/// 한 자리만 어긋나도(물려받은 키를 `None`으로) 그 길에서만 앱과 함께 뜬 vite가 판정에 선다 — 그 변형이 L1을 모두 통과한
/// 실측이 있다. 판정 표는 값을 손으로 짓는다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ThisRun<'a> {
    /// 이 실행의 세대(`shell_key::generation`).
    pub generation: &'a str,
    /// 앱 자신의 pid.
    pub app_pid: u32,
    /// 앱이 물려받은 셸 키(`inherited_key`). 앱을 아틀리에 셸에서 띄웠을 때만 있다.
    pub inherited_key: Option<&'a str>,
}

impl ThisRun<'static> {
    /// 지금 도는 이 앱의 것. 세 값 모두 뜬 뒤에 안 바뀐다. 세대를 처음 잡는 자리가 아니다 — 판정은 앱이 뜬 뒤에 돌고, 그
    /// 전에 setup의 쓸기가 세대를 잡는다(`shell_key::generation`).
    pub fn current() -> Self {
        ThisRun { generation: shell_key::generation(), app_pid: std::process::id(), inherited_key: inherited_key() }
    }
}

/// 프로세스 하나의 신원 — pid와 커널이 준 시작 시각의 쌍(프로세스 결정 3 · 프로세스 스펙 S1).
///
/// pid만으로는 재사용을 못 가른다. 스냅샷과 신호 사이에 그 pid가 다른 프로세스에게 넘어가면 남에게
/// 신호가 간다. 시작 시각까지 같아야 같은 프로세스다.
///
/// 인스턴스 기록에 앱의 신원으로 적힌다(`instances`) — 그 모양이 `{"pid": …, "startedUs": …}`다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub pid: u32,
    /// 에포크 기준 µs(`pbi_start_tvsec` · `pbi_start_tvusec`).
    pub started_us: u64,
}

/// 스냅샷의 한 행.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Proc {
    pub id: Identity,
    pub ppid: u32,
    pub pgid: u32,
    /// 유효 uid.
    pub uid: u32,
    /// 커널이 아는 이름 — **실제로 실행된 파일**의 이름이다. 심링크로 부르면 링크 뒤의 이름이 온다.
    pub name: String,
    /// 사람이 부른 이름(exec 때의 argv[0]). env를 읽은 행에만 있다 — 다른 uid, 읽기를 건너뛴 것,
    /// 읽다 실패한 것은 `None`이다.
    pub argv0: Option<String>,
    /// 명령줄 — exec 때의 argv 전체를 빈칸 하나로 이었다(티켓 11). 부른 이름과 같은 버퍼에서 읽어 따로 드는 비용이 없고,
    /// `argv0`처럼 env를 읽은 행에만 있다. 정리 기록이 앞 200자를 담고(`cleanup_log`), 판 04의 자손 행 툴팁이 쓴다.
    pub command: Option<String>,
    /// 표식(exec 때의 셸 키). 없거나 못 읽었으면 `None`.
    ///
    /// **exec 때의 env다.** 뜬 뒤에 바꾼 env는 안 보인다. 시스템 바이너리(`/bin/zsh`, `/bin/sleep`)는
    /// env가 0개로 읽혀 늘 `None`이다 — 그것들은 트리로만 잡힌다(결정의 사실 4).
    pub shell_key: Option<String>,
}

/// 이 맥의 프로세스 표 한 장.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Snapshot {
    /// 찍은 쪽(앱)의 유효 uid. env는 이 uid인 프로세스만 읽었고, 판정도 이 uid의 것만 가른다 — 남의
    /// uid는 어차피 못 읽고 못 끝낸다.
    pub uid: u32,
    pub procs: Vec<Proc>,
    /// 목록에 있었는데 행으로 못 세운 수 — 목록과 정보 읽기 사이에 끝난 것, 좀비, 정보를 못 읽은 것.
    pub skipped: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// **이 실행은 이 앱의 세대 · pid · 물려받은 셸 키를 싣는다**(프로세스 스펙 S6). 판정을 부르는 여섯 자리가 모두 이 한 값을
    /// 받으니(`pty.rs`의 `every_verdict_gets_this_run_from_one_place`) 이 자리가 곧 그 배선이다.
    ///
    /// 값으로 보고 **자리로도 본다.** 물려받은 키는 이 검사 프로세스의 env에 달렸다 — 아틀리에 셸 밖(CI)에서 돌리면 `None`이라
    /// `inherited_key: None`으로 바꾼 변형이 값 단언을 통과한다. 그러면 설치본 셸에서 띄운 dev 앱이 시작 정리에서 제 vite를
    /// 지난 실행의 확정 고아로 끝낸다. 그래서 짓는 글자를 함께 못박는다.
    #[test]
    fn this_run_carries_this_apps_generation_pid_and_inherited_key() {
        let run = ThisRun::current();
        assert_eq!(run.generation, shell_key::generation(), "이 실행의 세대가 셸 키를 짓는 세대가 아니다");
        assert_eq!(run.app_pid, std::process::id(), "앱의 pid가 이 프로세스의 것이 아니다");
        assert_eq!(run.inherited_key, inherited_key(), "앱이 물려받은 셸 키가 env의 표식이 아니다");

        let src = include_str!("mod.rs");
        let body = src
            .split_once("pub fn current() -> Self {")
            .expect("여는 표식이 있다")
            .1
            .split_once("\n    }\n")
            .expect("닫는 표식이 있다")
            .0;
        assert!(!body.contains("mod tests"), "잘라 낸 자리가 테스트 모듈까지 삼켰다 — 소스 스캔이 제 문자열을 읽고 통과한다");
        for wired in ["generation: shell_key::generation()", "app_pid: std::process::id()", "inherited_key: inherited_key()"] {
            assert!(body.contains(wired), "이 실행을 지을 때 `{wired}`가 없다 — 판정이 이 앱을 다른 값으로 본다");
        }
    }
}
