import { createContext } from "react";

// 대화창의 문서 링크 자리(three-axes 티켓 18) — 도구 줄의 파일을 누르면 스펙 창이 그 파일을 연다(스토리 77). 링크는 흐름 깊숙이
// (대화 몸 → 흐름 → 턴 → 도구 줄) 서므로 대화창 뿌리(`ChatPane`)가 한 번 내려 준다. 주소를 쥔 것은 화면이라 여는 일은 받아서
// 부른다 — 알약 목록의 파일(티켓 26)과 같은 길이다. `chat` 탭(24)에서 눌러도 같다: 문서를 고르면 탭이 spec으로 돌아간다.

export interface ChatDocs {
  /** 그 work의 spec 폴더(코어가 준 홈 축약 표기) — 스펙 창은 이 폴더 안의 파일만 연다. */
  specDir: string;
  /** spec 폴더 기준 경로를 그 줄에서 연다. 줄을 모르면 `null`이다. */
  onOpenDoc: (path: string, line: number | null) => void;
}

/** 대화창 밖(문서 링크를 받을 곳이 없는 자리)에서는 null이다 — 그때 파일 이름은 글로만 선다. */
export const ChatDocsContext = createContext<ChatDocs | null>(null);
