import { createContext } from "react";

/**
 * 대화 속 문서의 자리(v1 티켓 35 · restart 02b-6) — 이은 Work의 spec 폴더(절대 경로)와 그 문서를 넓힌 카드에서 여는 길. Work 없는 Thread · Session을
 * 띄운 화면 밖에서는 `null`이다. 흐름의 모든 턴이 같은 값을 쓰므로 Context로 건넨다(`LogPlace`와 같다). 답 아래 문서 카드(`ThreadFlow`)와 작업 로그의
 * spec 문서 줄(`WorkLog`)이 읽는다 — 둘이 같은 폴더로 가른다.
 */
export const DocPlace = createContext<{ specRoot: string; open: (path: string) => void } | null>(null);
