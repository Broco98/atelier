// 보고 있는 **문서**도 주소에 둔다. URL이 위치의 정본이라는 결정(이슈 #25)이 파일까지
// 미치는 이유는 하나다 — 문서 링크를 따라 들어갔으면 뒤로가기로 돌아올 수 있어야 한다.
// 링크가 없던 시절에는 문서를 옮기는 길이 트리뿐이라 이 값이 없어도 티가 나지 않았다.
//
// Works와 아카이브가 **같은 규칙을 함께 쓴다.** 같은 문서를 어느 화면에서 열든 뒤로가기가
// 다르게 굴면 안 되는데, 판정이 두 라우트로 갈려 있으면 어긋나도 화면에 티가 나지 않는다.
// 그래서 규칙을 여기 한 번만 적는다. 파일명의 "-" 접두사는 라우트 생성기가 이 파일을
// 라우트로 취급하지 않게 한다.
//
// 값이 없으면 기본 문서(Works는 overview.md, 아카이브는 목록 첫 항목)를 본다는 뜻이다.
// 빈 문자열도 같은 뜻이라 여기서 걸러 내보내지 않는다 — 화면 쪽에서 한 번 더 판단하지
// 않아도 되게.
export interface FileSearch {
  file?: string;
}

export const validateFileSearch = (search: Record<string, unknown>): FileSearch =>
  typeof search.file === "string" && search.file ? { file: search.file } : {};
