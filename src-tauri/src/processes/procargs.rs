//! `KERN_PROCARGS2` — 프로세스가 **exec될 때** 받은 argv와 env를 읽는다.
//!
//! 커널이 주는 모양은 `[argc: i32][실행 파일 경로]\0[정렬용 \0…][argv…][env…]` 이고 문자열마다 NUL로
//! 끝난다. 가르는 일은 값만 받는 순수 판정(`ProcArgs::parse`)이라 모든 OS에서 잰다. 커널에 묻는
//! 일(`read`)만 macOS에 있다.
//!
//! 읽는 자리가 둘이다. 셸 탭이 「지금 도는 명령」의 이름을 고를 때(`pty.rs`의 `foreground_name`)는
//! argv 전체를, 수집이 프로세스마다 부른 이름과 표식을 읽을 때는 argv[0]과 env 하나를 본다. 원래 pty
//! 층에 argv만 읽는 파서로 있던 것을 env까지 넓혀 여기로 옮겼다.

use super::SHELL_KEY_ENV;

/// 한 프로세스의 exec 때 문자열 — 커널이 채운 버퍼를 **빌려** 본다. 수집은 프로세스 수백 개를 버퍼
/// 하나로 돌려 읽으므로(프로세스 스펙 S2), 행마다 argv 전체를 문자열로 떠 두지 않는다.
pub(crate) struct ProcArgs<'b> {
    argc: usize,
    /// argv[0]부터 버퍼 끝까지. 실행 파일 경로와 정렬용 NUL은 이미 건넜다.
    strings: &'b [u8],
}

impl<'b> ProcArgs<'b> {
    /// 커널이 준 버퍼를 가른다. 모양이 아니면 `None`이다.
    pub(crate) fn parse(buf: &'b [u8]) -> Option<Self> {
        let argc = i32::from_ne_bytes(buf.get(..4)?.try_into().ok()?);
        let argc = usize::try_from(argc).ok()?;
        // 4바이트 argc 다음이 실행 파일 경로다. 그것을 건너뛰고, 그 뒤의 정렬용 NUL도 건너뛴다.
        let rest = &buf[4..];
        let path_end = rest.iter().position(|b| *b == 0)?;
        let start = rest[path_end..]
            .iter()
            .position(|b| *b != 0)
            .map_or(rest.len(), |at| path_end + at);
        Some(Self { argc, strings: &rest[start..] })
    }

    /// exec 때의 argv. 조각이 argc보다 적으면(잘린 버퍼) 있는 만큼만 준다.
    pub(crate) fn argv(&self) -> impl Iterator<Item = &'b [u8]> {
        self.strings.split(|b| *b == 0).take(self.argc)
    }

    /// exec 때의 env — argv 바로 다음부터 빈 문자열까지. 그 뒤에 커널이 덧붙이는 것
    /// (`executable_path=` 등)은 env가 아니다.
    pub(crate) fn env(&self) -> impl Iterator<Item = &'b [u8]> {
        self.strings.split(|b| *b == 0).skip(self.argc).take_while(|entry| !entry.is_empty())
    }

    /// env에서 이름 하나의 값. 같은 이름이 둘이면 앞의 것이다 — `getenv`가 그렇게 읽는다.
    pub(crate) fn var(&self, name: &str) -> Option<&'b [u8]> {
        self.env().find_map(|entry| entry.strip_prefix(name.as_bytes())?.strip_prefix(b"="))
    }

    /// 표식. 비었거나 UTF-8이 아니면 없는 것으로 센다 — 앱이 심는 값은 `<세대>-<번호>` 꼴의 ASCII다.
    pub(crate) fn shell_key(&self) -> Option<&'b str> {
        std::str::from_utf8(self.var(SHELL_KEY_ENV)?).ok().filter(|key| !key.is_empty())
    }
}

/// 커널에 묻는 버퍼의 크기 — `KERN_ARGMAX`.
///
/// **이 sysctl은 버퍼가 모자라면 잘라 주지 않고 `ENOMEM`으로 통째로 실패한다** — argv 뒤에 env가
/// 함께 실려 오므로 「명령이 짧으니 4KB면 되겠지」가 안 통한다. 그 값은 부팅 중 안 바뀌어서 한 번만
/// 묻는다.
#[cfg(target_os = "macos")]
pub(crate) fn buffer_len() -> usize {
    use std::os::raw::c_int;
    use std::sync::OnceLock;

    static ARG_MAX: OnceLock<usize> = OnceLock::new();
    *ARG_MAX.get_or_init(|| {
        let mut mib = [libc::CTL_KERN, libc::KERN_ARGMAX];
        let mut value: c_int = 0;
        let mut len = std::mem::size_of::<c_int>();
        let ok = unsafe {
            libc::sysctl(mib.as_mut_ptr(), 2, (&raw mut value).cast(), &mut len, std::ptr::null_mut(), 0)
        };
        // 못 물으면 macOS의 실제 값(1MB)으로 간다 — 여기서 0을 쓰면 아래가 늘 실패한다.
        if ok == 0 && value > 0 { value as usize } else { 1 << 20 }
    })
}

/// 그 pid의 exec 때 문자열을 `buf`에 읽고 채운 길이를 준다. 못 읽으면 `None`이다 — 그사이 끝난 것,
/// 좀비, 권한이 없는 것(다른 uid). `buf`는 `buffer_len()`만큼이어야 한다.
#[cfg(target_os = "macos")]
pub(crate) fn read(pid: i32, buf: &mut [u8]) -> Option<usize> {
    let mut len = buf.len();
    let mut mib = [libc::CTL_KERN, libc::KERN_PROCARGS2, pid];
    let ok = unsafe {
        libc::sysctl(mib.as_mut_ptr(), 3, buf.as_mut_ptr().cast(), &mut len, std::ptr::null_mut(), 0)
    };
    (ok == 0).then_some(len)
}

/// 그 pid의 **argv**. 셸 탭이 도는 명령의 이름을 고를 때 쓴다(`pty.rs`의 `foreground_name`).
///
/// 부를 때마다 버퍼를 새로 잡는다. 셸마다 초당 한 번이라 수집처럼 수백 번을 한 버퍼로 돌 일이 없다.
///
/// UTF-8이 아닌 인자는 버리지 않고 자리를 지킨다 — 자리가 밀리면 argv[1]이 argv[2]가 된다.
#[cfg(target_os = "macos")]
pub(crate) fn argv(pid: i32) -> Option<Vec<String>> {
    let mut buf = vec![0u8; buffer_len()];
    let len = read(pid, &mut buf)?;
    let args = ProcArgs::parse(&buf[..len])?;
    Some(args.argv().map(|arg| String::from_utf8_lossy(arg).into_owned()).collect())
}

/// 리눅스판은 「못 읽었다」로 답한다(`pty.rs`의 `process_name`과 같은 거래). 셸 탭은 그때 셸 이름을 단다.
#[cfg(not(target_os = "macos"))]
pub(crate) fn argv(_pid: i32) -> Option<Vec<String>> {
    None
}

/// **인터프리터가 자기 이름을 대신 내주는 것을 막는다.** 이 목록에 에이전트 이름은 없다 —
/// 백엔드가 그것을 알면 에이전트가 늘 때마다 Rust를 고쳐야 한다(adr-04). 여기 있는 것은
/// 「스스로는 아무것도 아니고 뒤따르는 스크립트가 진짜인 것들」뿐이다.
const INTERPRETERS: [&str; 7] = ["node", "bun", "deno", "python", "python3", "ruby", "perl"];

/// argv에서 **사람이 부른 이름**을 고른다 — 값 하나만 받는 순수 판정이다.
///
/// 경로가 붙어 오면 마지막 조각만 쓴다(`/opt/homebrew/bin/codex` → `codex`). 인터프리터가
/// argv[0]이면 **그 뒤 첫 비-플래그 인자**의 이름이 진짜다: `codex`가 `#!/usr/bin/env node`
/// 스크립트라 그 프로세스의 argv[0]은 `node`이고 스크립트 경로가 argv[1]에 온다.
///
/// **오탐은 여기서 막는다.** 인터프리터가 아니면 argv[0]에서 끝내므로 `vim claude.md`는
/// `vim`이다 — 인자를 훑지 않는다는 것이 그 보장이다.
pub(crate) fn invoked_name(argv: &[String]) -> Option<String> {
    let base = |arg: &String| -> String { arg.rsplit('/').next().unwrap_or(arg).to_string() };
    let mut it = argv.iter().filter(|arg| !arg.is_empty());
    let first = base(it.next()?);
    if !INTERPRETERS.contains(&first.as_str()) {
        return Some(first);
    }
    // 플래그를 건너뛴다 — `node --enable-source-maps <스크립트>`가 그 모양이다.
    for arg in it {
        if arg.starts_with('-') {
            continue;
        }
        return Some(base(arg));
    }
    Some(first)
}

#[cfg(test)]
mod tests {
    use super::ProcArgs;

    /// 커널이 주는 모양 그대로 버퍼를 짓는다: argc, 실행 파일 경로, 정렬용 NUL, 문자열들.
    fn kernel_buffer(argc: i32, exec_path: &str, padding: usize, strings: &[&str]) -> Vec<u8> {
        let mut buf = argc.to_ne_bytes().to_vec();
        buf.extend_from_slice(exec_path.as_bytes());
        buf.push(0);
        buf.extend(std::iter::repeat_n(0, padding));
        for s in strings {
            buf.extend_from_slice(s.as_bytes());
            buf.push(0);
        }
        buf
    }

    fn texts<'b>(it: impl Iterator<Item = &'b [u8]>) -> Vec<&'b str> {
        it.map(|s| std::str::from_utf8(s).unwrap()).collect()
    }

    /// dev 서버 하나의 모양: argv 둘, env 셋, 그리고 env 끝을 알리는 빈 문자열 뒤에 커널이 덧붙인 것.
    #[test]
    fn argv_env_and_the_marker_come_apart() {
        let buf = kernel_buffer(
            2,
            "/opt/homebrew/bin/node",
            5,
            &[
                "node",
                "server.js",
                "PATH=/usr/bin",
                "ATELIER_SHELL=1790081243175-18",
                "HOME=/Users/x",
                "",
                "executable_path=/opt/homebrew/bin/node",
            ],
        );
        let args = ProcArgs::parse(&buf).expect("모양이 맞는 버퍼다");

        assert_eq!(texts(args.argv()), ["node", "server.js"]);
        assert_eq!(
            texts(args.env()),
            ["PATH=/usr/bin", "ATELIER_SHELL=1790081243175-18", "HOME=/Users/x"],
            "env는 빈 문자열에서 끝난다 — 그 뒤는 커널이 덧붙인 것이다"
        );
        assert_eq!(args.shell_key(), Some("1790081243175-18"));
    }

    /// 시스템 바이너리(`/bin/sleep`)는 env가 0개로 읽힌다 — 표식이 없는 것이다(결정의 사실 4).
    #[test]
    fn a_system_binary_with_no_env_has_no_marker() {
        let buf = kernel_buffer(2, "/bin/sleep", 3, &["sleep", "30", "", ""]);
        let args = ProcArgs::parse(&buf).expect("모양이 맞는 버퍼다");

        assert_eq!(texts(args.argv()), ["sleep", "30"]);
        assert_eq!(args.env().count(), 0);
        assert_eq!(args.shell_key(), None);
    }

    /// **argv는 argc만큼만 argv다.** 표식 모양의 인자(`echo ATELIER_SHELL=x`)를 env로 읽으면 남의
    /// 셸 키를 문 프로세스가 생긴다. 빈 인자도 자리를 지킨다 — 자리가 밀리면 env 첫 줄을 argv로 먹는다.
    #[test]
    fn an_argument_that_looks_like_the_marker_is_not_the_marker() {
        let buf = kernel_buffer(
            4,
            "/bin/echo",
            0,
            &["echo", "", "ATELIER_SHELL=forged", "x", "ATELIER_SHELL=real-1"],
        );
        let args = ProcArgs::parse(&buf).expect("모양이 맞는 버퍼다");

        assert_eq!(texts(args.argv()), ["echo", "", "ATELIER_SHELL=forged", "x"]);
        assert_eq!(args.shell_key(), Some("real-1"));
    }

    /// 같은 이름이 둘이면 앞의 것(`getenv`와 같다). 빈 값은 표식이 아니다.
    #[test]
    fn the_first_marker_wins_and_an_empty_one_is_none() {
        let twice = kernel_buffer(1, "/x", 0, &["x", "ATELIER_SHELL=a-1", "ATELIER_SHELL=b-2"]);
        assert_eq!(ProcArgs::parse(&twice).unwrap().shell_key(), Some("a-1"));

        let empty = kernel_buffer(1, "/x", 0, &["x", "ATELIER_SHELL="]);
        assert_eq!(ProcArgs::parse(&empty).unwrap().shell_key(), None);

        let prefix = kernel_buffer(1, "/x", 0, &["x", "ATELIER_SHELLX=c-3"]);
        assert_eq!(ProcArgs::parse(&prefix).unwrap().shell_key(), None, "이름이 같아야 한다");
    }

    /// 모양이 아닌 버퍼는 못 읽은 것이다. 잘린 버퍼는 있는 만큼만 준다.
    #[test]
    fn a_buffer_that_is_not_the_shape_reads_as_nothing() {
        assert!(ProcArgs::parse(&[]).is_none(), "argc 4바이트도 없다");
        assert!(ProcArgs::parse(&[1, 0, 0]).is_none(), "argc 4바이트도 없다");
        assert!(ProcArgs::parse(&kernel_buffer(-1, "/x", 0, &["x"])).is_none(), "argc가 음수다");

        let mut no_nul = 1i32.to_ne_bytes().to_vec();
        no_nul.extend_from_slice(b"/bin/x");
        assert!(ProcArgs::parse(&no_nul).is_none(), "실행 파일 경로가 NUL로 안 끝난다");

        let cut = kernel_buffer(3, "/x", 0, &["x", "a"]);
        let args = ProcArgs::parse(&cut).expect("argc보다 짧아도 읽는다");
        assert_eq!(texts(args.argv()), ["x", "a", ""]);
        assert_eq!(args.shell_key(), None);
    }

    #[test]
    fn the_name_a_person_typed_wins_over_the_file_that_actually_ran() {
        // 값만 받는 순수 판정이라 전수한다.
        let argv = |parts: &[&str]| parts.iter().map(|p| p.to_string()).collect::<Vec<_>>();

        // 사람이 친 그대로. 경로가 붙어 와도 마지막 조각만 쓴다.
        assert_eq!(super::invoked_name(&argv(&["claude"])), Some("claude".into()));
        assert_eq!(
            super::invoked_name(&argv(&["/Users/x/.local/bin/claude", "-p", "hi"])),
            Some("claude".into())
        );

        // **인터프리터는 자기 이름을 안 내준다.** `codex`가 `#!/usr/bin/env node` 스크립트라
        // 그 프로세스의 argv[0]이 `node`다 — 여기서 안 가르면 codex가 영영 `node`로 읽힌다.
        assert_eq!(
            super::invoked_name(&argv(&["node", "/opt/homebrew/bin/codex", "exec"])),
            Some("codex".into())
        );
        assert_eq!(
            super::invoked_name(&argv(&["node", "--enable-source-maps", "/opt/hb/bin/codex"])),
            Some("codex".into())
        );
        // 인터프리터 혼자면 그것이 이름이다(REPL).
        assert_eq!(super::invoked_name(&argv(&["node"])), Some("node".into()));

        // **오탐은 여기서 막힌다.** 인터프리터가 아니면 argv[0]에서 끝내므로 인자를 안 훑는다 —
        // adr-04가 타이틀 추론을 기각한 그 근거를 이 한 줄이 지킨다.
        assert_eq!(super::invoked_name(&argv(&["vim", "claude.md"])), Some("vim".into()));
        assert_eq!(super::invoked_name(&argv(&["grep", "claude"])), Some("grep".into()));

        assert_eq!(super::invoked_name(&[]), None);
    }

    /// **pty 층이 고친 버그를 실물로 못박는다.**
    ///
    /// 커널이 `p_comm`에 적는 것은 **실제로 실행된 파일**의 이름이라 심링크 뒤의 것이 온다.
    /// Claude Code의 네이티브 설치본이 정확히 그 모양이다 — `~/.local/bin/claude`가
    /// `~/.local/share/claude/versions/2.1.251`을 가리켜 이름이 `2.1.251`로 읽혔고, 그래서
    /// 탭에도 사이드바에도 로고가 안 떴다.
    ///
    /// 여기서는 `/bin/sleep`을 `claude`라는 이름의 심링크로 부른다: 스냅샷 행의 커널 이름은 `sleep`을,
    /// 부른 이름은 `claude`를 줘야 한다. **둘을 함께 단언하는 것이 핵심이다** — 뒤엣것만 보면
    /// 「어차피 원래 됐던 것 아닌가」와 갈리지 않는다. 셸 탭이 쓰는 길(`argv` → `invoked_name`)도 같은
    /// 이름을 줘야 한다.
    ///
    /// 자식이 시스템 바이너리여도 되는 것은 env가 아니라 argv를 재기 때문이다 — argv는 읽힌다.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_symlinked_command_is_named_by_the_link_not_the_file_behind_it() {
        use crate::processes::snapshot::{take, EnvScope};

        let dir = std::env::temp_dir().join(format!("atelier-argv-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("임시 폴더를 만든다");
        let link = dir.join("claude");
        let _ = std::fs::remove_file(&link);
        std::os::unix::fs::symlink("/bin/sleep", &link).expect("심링크를 건다");

        let mut child = std::process::Command::new(&link)
            .arg("30")
            .spawn()
            .expect("심링크로 띄운다");
        let pid = child.id();

        // 행이 설 때까지 기다린다. **「claude가 될 때까지」로 기다리지 않는다** — 그러면 아래 단언이
        // 스스로 통과한다. 기다리는 조건은 「스냅샷에 그 pid가 무엇이든 선다」다.
        let mut row = None;
        for _ in 0..300 {
            row = take(EnvScope::All).procs.into_iter().find(|p| p.id.pid == pid);
            if row.is_some() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        let invoked = super::argv(pid as i32).as_deref().and_then(super::invoked_name);

        // **거두는 것이 단언보다 먼저다.** 단언이 빨개지면 그 자리에서 패닉이라, 뒤에 둔 정리는 안 돈다.
        let _ = child.kill();
        let _ = child.wait();
        let _ = std::fs::remove_file(&link);
        let _ = std::fs::remove_dir(&dir);

        let row = row.expect("스냅샷에 자식이 서지 않았다");
        assert_eq!(row.name, "sleep", "커널은 심링크 뒤의 파일 이름을 준다");
        assert_eq!(
            row.argv0.as_deref().map(|arg| arg.rsplit('/').next().unwrap_or(arg)),
            Some("claude"),
            "사람이 부른 이름은 argv[0]에 있다"
        );
        assert_eq!(invoked.as_deref(), Some("claude"), "셸 탭이 쓰는 길도 부른 이름을 준다");
    }
}
