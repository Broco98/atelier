/**
 * `tick`을 **화면 프레임마다** 부르고, 멈추는 손잡이를 돌려준다. 멈춘 뒤에는 한 번도 더 안 부른다.
 *
 * 끄는 동안의 가장자리 자동 스크롤처럼 **포인터가 가만히 있어도** 돌아야 하는 일이 쓴다(`ShellTabs`). 기능
 * 폴더 밖에 따로 둔 것은 터미널 폴더가 시계를 모른다는 계약 때문이다(`shell-attention.test.ts`의 「시간을 아는
 * 파일」) — 프레임 루프는 셸 상태의 시간이 아니라 제스처의 박자다.
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
