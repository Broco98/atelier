import { describe, expect, it } from "vitest";
import { fileSize } from "./file-size";

// git-integration 판 01 티켓 09 — 코드 카드 안내의 크기(구현 스펙 「종류별 몸」: 1024 단위, 1KB 아래 `NB`, 1MB 아래 `N.NKB`, 그 위
// `N.NMB`). 바이너리 · UTF-8 아님 · 너무 큼이 무엇인지를 가늠하는 값이다.

describe("파일 크기", () => {
  it("1KB 아래는 바이트, 1MB 아래는 KB, 그 위는 MB다(소수 한 자리)", () => {
    expect(fileSize(0)).toBe("0B");
    expect(fileSize(300)).toBe("300B");
    expect(fileSize(1023)).toBe("1023B");
    expect(fileSize(1024)).toBe("1.0KB");
    expect(fileSize(1_536)).toBe("1.5KB");
    expect(fileSize(1024 * 1024)).toBe("1.0MB");
    expect(fileSize(7_864_320)).toBe("7.5MB");
  });

  // 경계는 **반올림한 값으로 가른다**(`processes/metrics.ts`의 `formatMemory`와 같다). 1MB에 조금 못 미치는 값을 KB로 반올림하면
  // 「1024.0KB」가 되는데, 그 글자는 MB로 적기로 한 크기다.
  it("반올림하면 1024.0KB가 되는 크기는 1.0MB로 선다", () => {
    expect(fileSize(1_048_524)).toBe("1023.9KB");
    expect(fileSize(1_048_525)).toBe("1.0MB");
    expect(fileSize(1_048_570)).toBe("1.0MB");
    expect(fileSize(1_048_575)).toBe("1.0MB");
  });
});
