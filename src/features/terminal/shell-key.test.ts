import { describe, expect, it } from "vitest";
import { ptyIdOf } from "./shell-key";

// 훅이 아는 이름과 레지스트리가 아는 번호를 잇는 자리. 셸 키는 `<세대>-<PTY 번호>`라(Rust `processes/shell_key.rs`의
// `mint`) 뒤쪽 번호만 되뽑으면 `shellOfPty`가 그다음을 잇는다.
//
// 표는 Rust `split`의 검사(`a_key_splits_at_its_last_separator_into_a_generation_and_a_number`)와 같은 줄이다 — 두 언어는
// 규칙을 글자로만 나누므로, 한쪽 표가 바뀌면 다른 쪽도 함께 본다. 한 줄만 다르다: Rust는 PTY 번호(`u32`)에 안 드는
// 꼬리(`G-99999999999`)도 끊는다. 앱은 그런 키를 짓지 않는다.
describe("셸 키에서 pty 번호를 되뽑는다", () => {
  it.each([
    ["1757000000-3", 3],
    ["1757000000-12", 12],
    // 세대에 `-`가 없다는 보장은 없다. 마지막 `-` 뒤가 번호다.
    ["l3-fixture-7", 7],
    ["test-42-inherited-1", 1],
  ] as const)("%s → %i", (shellId, ptyId) => {
    expect(ptyIdOf(shellId)).toBe(ptyId);
  });

  // **모르는 모양은 `null`이다.** 여기서 `NaN`이 새면 `shellOfPty`가 아무 칸도 못 찾는
  // 것으로 조용히 지나가고, 왜 상태가 안 앉는지 아무 데서도 안 보인다.
  it.each(["", "1757000000", "1757000000-", "1757000000-abc", "1757000000-3x", "-3", "G-+1"])(
    "%s는 아무 번호도 아니다",
    (shellId) => {
      expect(ptyIdOf(shellId)).toBeNull();
    },
  );
});
