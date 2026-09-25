/**
 * `tick`을 **화면 프레임마다** 부르고, 멈추는 손잡이를 돌려준다. 멈춘 뒤에는 한 번도 더 안 부른다.
 *
 * 끄는 동안의 가장자리 자동 스크롤처럼 **포인터가 가만히 있어도** 돌아야 하는 일이 쓴다(`ShellTabs`). 이 모듈이
 * 기능 폴더 밖에 있다고 부르는 쪽이 시계를 모르는 것은 아니다 — 터미널 폴더에서 이것을 부르는 파일은
 * `shell-attention.test.ts`의 「시간을 아는 파일」에 이름으로 선언된다(그 검사가 `everyFrame`을 시계로 센다).
 */
export function everyFrame(tick: () => void): () => void {
  let frame: number | null = requestAnimationFrame(function loop() {
    frame = requestAnimationFrame(loop);
    tick();
  });
  return () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  };
}
