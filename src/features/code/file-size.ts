/**
 * 파일 크기(바이트) — 1KB 아래는 바이트, 1MB 아래는 KB, 그 위는 MB(소수 한 자리). 단위는 1024다(Finder가 아니라 `ls -h`와
 * 같은 셈). 코드 카드 안내의 크기는 무엇인지를 가늠하는 값이라 이만큼이면 된다.
 *
 * **KB와 MB의 경계는 반올림한 KB로 가른다**(`processes/metrics.ts`의 `formatMemory`와 같다). 1MB에 조금 못 미치는 값을 KB로
 * 반올림하면 「1024.0KB」가 되는데, 그 글자는 MB로 적기로 한 크기다 — 그때부터 MB로 선다.
 */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  const kb = (bytes / 1024).toFixed(1);
  if (Number(kb) < 1024) return `${kb}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
