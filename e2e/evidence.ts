import { writeFileSync } from "node:fs";
import { test as base, type TestInfo } from "@playwright/test";

// 실패한 테스트가 **그 순간의 증거**를 파일로 남긴다. 에이전트가 사람에게 "무슨 일이
// 났는지 봐 달라"고 되묻지 않고 폴더 하나만 읽고 다음 수정을 정할 수 있어야 한다.
//
// Playwright도 실패하면 `error-context.md`를 같은 폴더에 넣는다. 하지만 그것은 타입에도
// 문서에도 없는 내부 산출물이라, 판올림 한 번에 사라져도 `pnpm verify`는 초록인 채 증거만
// 반쯤 빈다 — 이 작업이 없애려는 바로 그 모양이다. 그래서 티켓이 요구한 네 가지는 전부
// 여기서 **공개 API로** 만들고, error-context.md는 있으면 덤으로 둔다.
//
// 트레이스(zip)는 켜지 않는다. 같은 정보를 담지만 뷰어로만 읽히므로 "폴더를 읽어서
// 판단한다"에 쓸 수 없다. 대신 어느 단계까지 갔는지의 시퀀스는 남지 않는다.
export const test = base.extend<{ evidence: void }>({
  evidence: [
    async ({ page }, use, testInfo) => {
      const messages: string[] = [];
      page.on("console", (message) => messages.push(`[${message.type()}] ${message.text()}`));
      page.on("pageerror", (error) => messages.push(`[pageerror] ${error.stack ?? String(error)}`));

      await use();

      // 통과한 실행은 아무것도 남기지 않는다. 낡은 증거와 섞이면 오진의 원인이 된다.
      if (testInfo.status === testInfo.expectedStatus) return;

      // 남은 시간이 없으면 Playwright는 fixture 해체를 통째로 건너뛴다. 즉 **테스트가
      // 아니라 해체가 예산을 다 쓴** 타임아웃에서는 아래가 돌지 않는다. 그때도 스크린샷은
      // 러너가 찍는다.
      writeFileSync(testInfo.outputPath("failure.txt"), failureReport(testInfo));

      // 빈 파일 대신 그렇게 적는다 — 빈 파일은 "콘솔이 조용했다"와 "수집이 고장났다"를
      // 구별해 주지 않는다.
      writeFileSync(
        testInfo.outputPath("console.txt"),
        messages.length > 0 ? `${messages.join("\n")}\n` : "(콘솔 출력 없음)\n",
      );

      // 접근성 트리 스냅샷은 **숨은 요소를 뺀다.** 그래서 "안 그려졌다"와 "그려졌는데
      // CSS로 가려졌다"가 똑같이 '없음'으로 보인다 — 고칠 곳이 전혀 다른 두 경우다.
      // 페이지가 죽은 채로 실패했을 수도 있다. 그때 여기서 던지면 증거 수집기가 원래
      // 실패보다 시끄러워진다 — 이유를 파일에 적고 넘어간다.
      let dom: string;
      try {
        dom = await page.content();
      } catch (error) {
        dom = `<!-- DOM을 뜨지 못했습니다: ${String(error)} -->\n`;
      }
      writeFileSync(testInfo.outputPath("dom.html"), dom);
    },
    { auto: true },
  ],
});

/**
 * 무엇이 어디서 깨졌는가. `TestInfoError`가 타입으로 보장하는 것은 message·stack·value
 * 셋뿐이다 — 런타임 객체에는 location·snippet도 붙어 있지만 그것을 읽으려면 캐스팅이
 * 필요하고, 그러면 이 파일이 피하려던 "계약 없는 내부 구조에 기대기"로 돌아간다.
 * 실패 지점은 stack의 첫 프레임에 파일:줄:열로 들어 있으므로 그것으로 충분하다.
 */
function failureReport(testInfo: TestInfo): string {
  const lines = [
    `테스트: ${testInfo.titlePath.join(" > ")}`,
    `선언: ${testInfo.file}:${testInfo.line}`,
    `상태: ${testInfo.status} (기대: ${testInfo.expectedStatus}, 재시도 ${testInfo.retry})`,
  ];
  testInfo.errors.forEach((error, index) => {
    lines.push(
      `\n--- 오류 ${index + 1} ---`,
      stripAnsi(error.stack ?? error.message ?? error.value ?? "(내용 없음)"),
    );
  });
  return `${lines.join("\n")}\n`;
}

/** 에러 본문에는 터미널 색이 섞여 들어온다. 파일로 읽을 것이므로 벗긴다. */
function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

export { expect } from "@playwright/test";
