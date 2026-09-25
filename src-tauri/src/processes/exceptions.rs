//! 예외 목록 — 셸을 닫아도, 앱이 무엇을 자동으로 끝내든 건드리지 않는 프로세스(프로세스 결정 5 · 프로세스
//! 스펙 S7). `tmux` 서버, 키 에이전트, 컨테이너 런타임처럼 셸보다 오래 살아야 하는 것들이다.
//!
//! **기본 목록이 Rust 상수 하나인 것이 요점이다.** 설정 파일에는 사용자가 고친 것만 적고(`null`이면 기본
//! 목록 — `settings::process_exceptions`), 그 기본값을 실제로 쓰는 자리는 판정이다. 판정은 화면 없이 앱
//! 안에서 돈다(셸 닫기, 새로고침, 앱 종료). 화면은 이 목록을 IPC로 받아 편집 칸에 보인다
//! (`commands::default_process_exceptions`) — 두 곳에 적으면 한쪽이 조용히 낡는다.
//!
//! 판정이 이 목록을 **다른 묶음보다 먼저** 가른다(`verdict::judge`). 여기는 「이 행이 걸리나」만 답한다.

use super::Proc;

/// 기본 목록. 끝이 `*`인 항목은 그 앞부분으로 시작하는 이름을 모두 잡는다 — `docker` 계열은 이름이 여럿이라
/// (`docker`, `docker-compose`, `com.docker.backend` …) 하나씩 적을 수 없다.
pub(crate) const DEFAULTS: [&str; 7] =
    ["tmux", "gpg-agent", "ssh-agent", "colima", "limactl", "docker*", "com.docker.*"];

/// 기본 목록을 설정 값과 같은 모양(문자열 목록)으로.
pub(crate) fn defaults() -> Vec<String> {
    DEFAULTS.iter().map(|entry| entry.to_string()).collect()
}

/// 이 행이 목록에 걸리나 — **커널 이름**이나 **부른 이름**(argv[0]의 마지막 조각)이 항목과 같으면 걸린다.
///
/// 둘을 다 보는 것은 둘이 어긋나는 일이 흔해서다. 심링크로 부르면 커널은 링크 뒤의 파일 이름을 주고, 사람이
/// 목록에 적는 것은 자기가 친 이름이다. 부른 이름은 env를 읽은 행에만 있다(`Proc::argv0`) — 읽기를 건너뛴 행은
/// 커널 이름으로만 걸린다.
pub(crate) fn caught(list: &[String], proc: &Proc) -> bool {
    let invoked = proc.argv0.as_deref().and_then(|argv0| argv0.rsplit('/').next());
    list.iter().any(|entry| {
        matches(entry, &proc.name) || invoked.is_some_and(|name| matches(entry, name))
    })
}

/// 항목 하나와 이름 하나. 끝이 `*`면 그 앞부분으로 시작하는지 보고, 아니면 글자 그대로 같은지 본다. `*`는 끝에서만
/// 뜻이 있다 — 가운데의 `*`는 글자다.
///
/// 앞뒤 공백은 걷는다(손으로 고친 파일). 빈 항목은 아무것도 안 잡는다 — 이름을 못 읽은 행(빈 이름)이 빈 줄에
/// 걸려 남지 않게. `*` 하나는 모든 이름을 잡는다: 사람이 그렇게 적었으면 「아무것도 끝내지 마라」가 그 뜻이다.
fn matches(entry: &str, name: &str) -> bool {
    let entry = entry.trim();
    match entry.strip_suffix('*') {
        Some(prefix) => name.starts_with(prefix),
        None => !entry.is_empty() && name == entry,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::processes::Identity;

    fn proc(name: &str, argv0: Option<&str>) -> Proc {
        Proc {
            id: Identity { pid: 100, started_us: 1 },
            ppid: 1,
            pgid: 100,
            uid: 501,
            name: name.to_string(),
            argv0: argv0.map(str::to_string),
            shell_key: None,
        }
    }

    fn list(entries: &[&str]) -> Vec<String> {
        entries.iter().map(|entry| entry.to_string()).collect()
    }

    /// **일치 표**(프로세스 스펙 S7). 한 줄에 목록 · 커널 이름 · argv[0] · 기대를 둔다. 「안 걸린다」 줄은 같은
    /// 목록으로 걸리는 줄을 곁에 둔다 — 목록이 아무것도 안 잡아도 그 줄은 초록이기 때문이다.
    #[test]
    fn an_entry_catches_by_the_kernel_name_or_the_invoked_name() {
        let cases: [(&str, &[&str], &str, Option<&str>, bool); 16] = [
            ("정확히 같은 커널 이름", &["tmux"], "tmux", None, true),
            ("이름의 일부만 같으면 안 걸린다 — 뒤에 더 붙음", &["tmux"], "tmuxx", None, false),
            ("이름의 일부만 같으면 안 걸린다 — 앞이 모자람", &["tmux"], "tmu", None, false),
            ("이름의 일부만 같으면 안 걸린다 — 앞에 더 붙음", &["tmux"], "xtmux", None, false),
            ("`*`로 끝나면 앞부분으로 — 앞부분 그대로", &["docker*"], "docker", None, true),
            ("`*`로 끝나면 앞부분으로 — 뒤에 더 붙음", &["docker*"], "docker-compose", None, true),
            ("`*` 앞에 점이 있으면 점까지 본다", &["com.docker.*"], "com.docker.backend", None, true),
            ("`*` 앞부분이 모자라면 안 걸린다", &["com.docker.*"], "com.dockerd", None, false),
            ("`*`가 가운데 있으면 글자 그대로다", &["dock*er"], "docker", None, false),
            ("부른 이름(argv[0])으로 — 경로의 마지막 조각", &["tmux"], "p1", Some("/opt/homebrew/bin/tmux"), true),
            ("부른 이름으로 — 경로 없이", &["ssh-agent"], "p1", Some("ssh-agent"), true),
            ("부른 이름에도 `*` 접두사", &["docker*"], "p1", Some("/usr/local/bin/docker-credential-desktop"), true),
            ("부른 이름의 경로 가운데 조각은 안 본다", &["tmux"], "p1", Some("/tmux/bin/zsh"), false),
            ("커널 이름이 걸리면 부른 이름이 달라도 걸린다", &["limactl"], "limactl", Some("/bin/lima"), true),
            ("목록의 여러 항목 중 하나", &["tmux", "colima"], "colima", None, true),
            ("빈 항목은 아무것도 안 잡는다", &["", "  "], "tmux", Some("tmux"), false),
        ];

        let mut wrong = Vec::new();
        for (what, entries, name, argv0, want) in cases {
            let got = caught(&list(entries), &proc(name, argv0));
            if got != want {
                wrong.push(format!("{what}: 목록 {entries:?}, 이름 {name}, argv[0] {argv0:?} → 기대 {want}, 받음 {got}"));
            }
        }
        assert!(wrong.is_empty(), "일치가 어긋난 줄 {}개:\n  {}", wrong.len(), wrong.join("\n  "));
    }

    /// 기본 목록이 결정 5의 이름을 다 든다 — 화면(IPC)과 판정이 이 상수 하나에서 읽는다.
    #[test]
    fn the_defaults_are_the_ones_decision_5_named() {
        assert_eq!(
            defaults(),
            ["tmux", "gpg-agent", "ssh-agent", "colima", "limactl", "docker*", "com.docker.*"]
        );
        let caught_by_default = |name: &str| caught(&defaults(), &proc(name, None));
        assert!(caught_by_default("com.docker.backend"), "docker 계열(데스크톱 앱의 백엔드)이 안 걸린다");
        assert!(caught_by_default("docker"), "docker CLI가 안 걸린다");
        assert!(!caught_by_default("zsh"), "셸이 기본 목록에 걸렸다");
    }
}
