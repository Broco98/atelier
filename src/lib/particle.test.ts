import { describe, expect, it } from "vitest";
import { particle } from "./particle";

describe("이름 뒤의 조사", () => {
  it("영어 이름의 조사는 끝소리로 고른다 — web-app을 · api-server를 · Host가 · 숫자도 읽는 소리대로", () => {
    expect(particle("web-app", "을", "를")).toBe("을");
    expect(particle("api-server", "을", "를")).toBe("를");
    expect(particle("Host", "이", "가")).toBe("가");
    expect(particle("helm", "으로", "로")).toBe("으로");
    expect(particle("tool", "으로", "로")).toBe("로");
    expect(particle("v1", "을", "를")).toBe("을");
    expect(particle("v2", "을", "를")).toBe("를");
    expect(particle("환불 API 버그 수정", "을", "를")).toBe("을");
  });

  it("끝의 닫는 괄호 · 따옴표 · 문장 부호는 건너뛰고 그 앞 글자로 고른다 — 진짜 Host가 지은 이름 「… (#31)」(v1 티켓 39)", () => {
    expect(particle("환불 API 부분 환불 버그 수정 (#31)", "을", "를")).toBe("을");
    expect(particle("환불 API 부분 환불 버그 (#31)", "으로", "로")).toBe("로");
    expect(particle("「결제 화면」", "을", "를")).toBe("을");
    expect(particle("v2!", "을", "를")).toBe("를");
  });
});
