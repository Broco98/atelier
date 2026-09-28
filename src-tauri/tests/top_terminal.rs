//! 최상위 터미널이 **어느 세계에서 뜨는가** (#181). 셸을 진짜로 띄워 그 안에서 두 값을
//! 읽는다 — 앱이 심은 `ATELIER_MODE`와, cwd를 안 준 셸이 선 자리. 같은 줄에서 셸 키도 읽는다 —
//! 띄우기 답에 실린 셸 키가 그 셸 env의 표식(`ATELIER_SHELL`)과 같은가(프로세스 스펙 S34 · 티켓 23).
//!
//! **왜 여기여야 하나.** 이 저장소의 pty 검사들은 살아 있는 pty가 없어 값과 자리로만
//! 재고, 그 한계를 스스로 적어 두었다(`pty.rs`의 `close_check_hands_both_values_to_the_verdict`).
//! 심은 값이 **자식 프로세스까지 실제로 내려가는지**는 그 방식으로 못 본다 —
//! `CommandBuilder`에 적힌 값을 읽는 검사는 크레이트가 그것을 안 넘기게 되는 날 그대로
//! 초록이다. 여기서 한 번 실행으로 딛는다.
//!
//! **왜 별도 프로세스인가.** 셸의 자리를 재려면 `ATELIER_HOME`을 세워야 하는데, 그 값을
//! 단위 테스트가 세우면 같은 프로세스에서 병렬로 도는 다른 테스트의 데이터 루트까지 함께
//! 옮긴다(커널 `paths.rs`가 같은 이유로 env를 안 만진다). 그래서 이 파일에는 **테스트가
//! 하나뿐이다** — 늘리려면 env를 세우지 않는 것이거나, 파일을 새로 내야 한다.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use atelier_core::Mode;
use atelier_lib::pty::{self, PtyPool};
use tauri::ipc::{Channel, InvokeResponseBody};

/// 셸이 뜨고 한 줄을 뱉기까지 기다려 주는 시간. 로그인 셸의 프로필까지 도는 시간이고,
/// CI의 느린 기계도 함께 본다. 여기서 걸리면 그것은 「느리다」가 아니라 「안 나온다」다.
const PATIENCE: Duration = Duration::from_secs(30);

/// 셸에 쳐 넣는 한 줄. **찍히는 값이 쳐 넣은 글자와 안 겹치게** 적었다 — 터미널은 입력을
/// 그대로 되비추므로, `mode=[maison]`을 그대로 치면 셸이 한 글자도 안 돌아도 그 문자열이
/// 출력에 있다. `%s`를 거쳐 나오면 되비친 줄에는 `mode=[%s]`만 있다.
const PROBE: &str = "printf 'probe mode=[%s] key=[%s] cwd=[%s]\\n' \"$ATELIER_MODE\" \"$ATELIER_SHELL\" \"$(pwd)\"\n";

/// 심볼릭 링크를 지나온 자리. macOS의 임시 폴더는 `/var/…`로 오고 셸의 `pwd`는
/// `/private/var/…`를 돌려준다 — 같은 자리인데 글자가 다르다.
fn real(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|e| panic!("{}를 못 폈다: {e}", path.display()))
}

/// 모드 하나로 최상위 터미널을 띄우고, 그 안에서 찍은 줄이 나올 때까지 기다렸다가
/// 그 셸의 띄우기 답과 지금까지 받은 바이트를 통째로 돌려준다.
fn probe(pool: &Arc<PtyPool>, mode: Mode) -> (pty::PtySpawned, String) {
    let seen = Arc::new(Mutex::new(Vec::<u8>::new()));
    let sink = Arc::clone(&seen);
    // 프레임을 바이트 그대로 쌓는다. 조각 경계가 멀티바이트 문자를 가르므로 조각마다
    // 문자열로 만들면 그 자리가 깨진다 — 다 모은 뒤 한 번에 읽는다 (`pty.rs`와 같은 이유).
    let channel = Channel::new(move |body| {
        if let InvokeResponseBody::Raw(bytes) = body {
            sink.lock().unwrap_or_else(|e| e.into_inner()).extend_from_slice(&bytes);
        }
        Ok(())
    });

    let spawned = pty::spawn(pool, mode, None, 200, 24, channel)
        .unwrap_or_else(|e| panic!("{mode}의 최상위 터미널이 안 떴다: {e}"));
    pty::write(pool, spawned.id, PROBE).expect("셸에 쓰지 못했다");

    let deadline = Instant::now() + PATIENCE;
    loop {
        let text = {
            let bytes = seen.lock().unwrap_or_else(|e| e.into_inner());
            String::from_utf8_lossy(&bytes).into_owned()
        };
        // 되비친 줄에는 `cwd=[%s]`가 있다. `cwd=[/`는 셸이 실제로 찍은 줄에만 있다.
        if text.contains("cwd=[/") {
            return (spawned, text);
        }
        assert!(
            Instant::now() < deadline,
            "{mode} 셸이 {PATIENCE:?} 안에 아무 줄도 안 찍었다 — 받은 것: {text:?}"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// **두 세계의 최상위 셸이 서로 다른 값을 들고 다른 자리에서 뜬다.**
///
/// 모드 하나만 재면 안 된다 — Maison만 보면 `mode_home`을 늘 `maison`으로 눕혀도 초록이고,
/// 그러면 Atelier 터미널이 생활 쪽 폴더에서 뜬다. 두 값이 서로 다르다는 것까지 함께 잰다.
#[test]
fn a_top_terminal_carries_its_world_into_the_shell() {
    let home = std::env::temp_dir().join(format!("atelier-top-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&home);
    std::fs::create_dir_all(&home).unwrap();

    // 데이터 루트를 임시 폴더로 옮긴다. 이 프로세스에는 테스트가 하나뿐이라 안전하다.
    std::env::set_var("ATELIER_HOME", &home);
    // **셸을 최소한의 것으로 고정한다.** 여기서 재는 것은 앱이 심는 값과 자리이지 사용자의
    // 셸이 아니고, 진짜 `$SHELL`을 쓰면 남의 기계의 dotfile 한 줄(`cd`·긴 프롬프트)에
    // 검사가 흔들린다. HOME도 함께 옮겨 로그인 셸이 읽을 프로필이 아예 없게 한다.
    std::env::set_var("SHELL", "/bin/sh");
    std::env::set_var("HOME", home.join("nobody"));

    let pool = Arc::new(PtyPool::default());
    let mut shells = Vec::new();
    let mut keys = Vec::new();

    for (mode, planted) in [(Mode::Atelier, "atelier"), (Mode::Maison, "maison")] {
        let (spawned, out) = probe(&pool, mode);
        shells.push(spawned.id);
        assert!(
            out.contains(&format!("mode=[{planted}]")),
            "{mode} 셸 안에서 $ATELIER_MODE가 '{planted}'가 아니다 — 이 셸에서 뜬 claude가 \
             저쪽 세계의 목록을 본다. 받은 것: {out:?}"
        );
        // **답에 실린 셸 키가 그 셸 env의 표식이다**(프로세스 스펙 S34). 프런트는 이 값으로 셸을 가리키고(방금 부른 셸로),
        // 훅은 env의 값으로 상태 파일을 짓는다 — 둘이 갈리면 키로 찾는 길이 엉뚱한 셸로 가거나 아무 데도 안 간다. 이 검사
        // 프로세스도 제 셸 키를 물려받았으니(앱의 셸 안에서 돈다), 빌더가 덮지 않으면 그 값이 찍혀 여기서 갈린다.
        assert!(
            out.contains(&format!("key=[{}]", spawned.shell_key)),
            "{mode} 셸의 띄우기 답에 실린 셸 키({})가 그 셸 env의 `ATELIER_SHELL`이 아니다. 받은 것: {out:?}",
            spawned.shell_key
        );
        keys.push(spawned.shell_key);
        // 자리를 **글자로 견주기 전에** 그 폴더가 생겼는지부터 본다. 없으면 아래
        // `real`이 「경로를 못 폈다」로 터지는데, 그것은 무엇이 틀렸는지 안 말한다.
        let home = atelier_core::mode_home(mode);
        assert!(
            home.is_dir(),
            "{mode}의 홈({})이 안 생겼다 — cwd 없는 셸은 여기서 떠야 하고, 그 갈래가 \
             폴더를 만드는 유일한 자리다",
            home.display()
        );
        let expected = real(&home);
        assert!(
            out.contains(&format!("cwd=[{}]", expected.display())),
            "{mode}의 최상위 터미널이 {}에서 안 떴다. 받은 것: {out:?}",
            expected.display()
        );
    }

    // 두 셸의 키가 다르다 — 같으면 키로 찾는 길이 늘 첫 셸로 간다.
    assert_ne!(keys[0], keys[1], "두 셸이 같은 셸 키를 받았다");

    // 두 자리가 정말 다른가. 위 두 바퀴는 각자 자기 기대를 보므로, `mode_home`이 둘 다
    // 같은 곳을 가리켜도 기대가 함께 눕는다면 통과한다.
    assert_ne!(
        atelier_core::mode_home(Mode::Atelier),
        atelier_core::mode_home(Mode::Maison),
        "두 세계의 홈이 같은 자리다 — 최상위 터미널 둘이 같은 폴더에서 뜬다"
    );

    // 셸은 사람이 끝내듯 스스로 끝나게 둔다 — 앱 종료 길(`end_for_exit`)은 이 기계의 표 전체를 판정해 끝내는데,
    // 검사가 그것을 진짜 표에 돌리지 않는다. 이 셸들은 `/bin/sh`에 프로필도 없어 `exit`에 곧 끝나고, 그래도 남으면
    // 이 프로세스가 끝나며 pty가 닫혀 SIGHUP을 받는다.
    //
    // 스스로 끝난 셸도 그 셸 키를 문 생존자를 끝낸다(티켓 13) — 그 판정이 고르는 것은 **이 셸의 키**를 문 것뿐이고, 키의
    // 세대는 이 프로세스가 셸을 처음 띄운 ms라 이 검사 밖의 어떤 프로세스도 물 수 없다. 이 셸들은 띄운 것이 없어 끝낼 것도
    // 없다. 셸 그룹에는 신호가 안 간다(리더인 셸이 이미 없다). 기록을 안 연 풀이라 인스턴스 기록 · 정리 기록도 안 쓴다.
    for id in shells {
        let _ = pty::write(&pool, id, "exit\n");
    }
    let _ = std::fs::remove_dir_all(&home);
}
