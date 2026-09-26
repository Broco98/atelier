//! 벽시계 — 에포크 기준 **지금**. 이 앱이 적는 시각은 모두 이 시계 하나에서 온다: 셸의 마지막 출력 · 추이의 점 · 정리 기록의
//! 사건(ms), 인스턴스 기록의 갱신 시각(µs), 이 실행의 세대(ms, `shell_key::generation`).
//!
//! **한 시계인 것이 요점이다.** 인스턴스 기록의 갱신 시각은 커널이 준 프로세스의 시작 시각과 견준다(확정 고아 (나), `verdict`) —
//! 둘이 같은 벽시계라야 견줄 수 있다. 자리마다 몸통을 따로 적으면 한 자리의 「에포크 앞」 처리만 바뀌어도 아무 검사가 안 운다.
//!
//! **시계가 에포크 앞이면 0으로 눕는다.** `duration_since`가 오류를 내는 자리라, 여기서 눕히지 않으면 부르는 길(셸 띄우기, 기록
//! 쓰기)이 통째로 무너진다. 그 상황에서 할 수 있는 더 나은 일이 없고, 대가는 시각 몇 개가 1970년으로 읽히는 것뿐이다.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// 지금(에포크 ms).
pub fn now_ms() -> u64 {
    ms_at(SystemTime::now())
}

/// 지금(에포크 µs). 프로세스의 커널 시작 시각(`pbi_start_tvsec` · `pbi_start_tvusec`)과 같은 단위다.
pub fn now_us() -> u64 {
    since_epoch(SystemTime::now()).as_micros() as u64
}

/// 시각 하나 → 에포크 ms. **시계를 인자로 받는 것은 검사를 위해서다** — 「에포크 앞이면 0」을 헤드리스로 잰다. 이 실행의
/// 세대도 이 값이다(`shell_key::generation_at`).
pub fn ms_at(t: SystemTime) -> u64 {
    since_epoch(t).as_millis() as u64
}

fn since_epoch(t: SystemTime) -> Duration {
    t.duration_since(UNIX_EPOCH).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, UNIX_EPOCH};

    use super::*;

    /// 에포크 뒤의 시각은 그 ms 그대로다.
    #[test]
    fn a_time_after_the_epoch_is_its_milliseconds() {
        assert_eq!(ms_at(UNIX_EPOCH + Duration::from_millis(1_700_000_000_123)), 1_700_000_000_123);
    }

    /// 시계가 `UNIX_EPOCH` 이전으로 가 있는 경우. 실물에서 거의 안 밟히지만 `unwrap_or_default`가 조용히 사라지면
    /// `duration_since`가 Err를 내는 자리라 시각을 적는 길이 통째로 무너진다 — 값으로 눕는 것을 못박는다.
    #[test]
    fn a_clock_before_the_epoch_lies_down_at_zero() {
        assert_eq!(ms_at(UNIX_EPOCH - Duration::from_secs(1)), 0, "epoch 이전 시각이 0으로 안 눕었다");
    }

    /// ms와 µs가 **한 시계**다 — 같은 순간을 읽으면 µs를 1000으로 나눈 것이 ms와 같거나 그 뒤다.
    #[test]
    fn the_milliseconds_and_the_microseconds_come_from_one_clock() {
        let ms = now_ms();
        let us = now_us();
        assert!(us / 1_000 >= ms, "µs 시계({us})가 ms 시계({ms})보다 앞에 있다 — 두 시계가 갈렸다");
        assert!(us / 1_000 - ms < 60_000, "µs 시계({us})와 ms 시계({ms})가 1분 넘게 벌어졌다 — 단위가 틀렸다");
    }
}
