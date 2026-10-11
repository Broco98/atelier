import { Store } from "@tanstack/react-store";

// 문서를 **그 줄에서** 연다(three-axes 티켓 26). 대화창의 문서 링크(알약 목록의 파일)가 스펙 창을 그 파일의 첫 고친 자리로 연다
// (스토리 72). 파일까지 가는 길은 이미 있다 — 주소의 `file`을 바꾸는 이동(`fileSearch`, 탭도 spec으로 돌린다). 없던 것은 **줄까지**다:
// 이동은 주소만 바꾸고, 그 파일의 내용은 그 뒤에 읽혀 그려진다(`specFileQuery`의 `placeholderData`가 파일을 옮기면 내용을 한 번
// 비운다). 그래서 「보일 줄」을 여기 적어 두고, 스펙 창이 그 파일의 내용을 그린 뒤 그 줄의 블록으로 굴러가며 지운다.
//
// 한 번에 하나다 — 새 요청이 앞의 것을 덮는다. 저장하지 않는다.

export interface DocReveal {
  work: string;
  /** spec 폴더 기준 경로. */
  file: string;
  /** 원문의 줄(1부터). */
  line: number;
}

export const docRevealStore = new Store<DocReveal | null>(null);

/** 그 파일이 그려지면 그 줄로 간다. 줄을 모르면 앞서 기다리던 요청만 거둔다 — 파일을 맨 위에서 연다. */
export function requestReveal(work: string, file: string, line: number | null): void {
  docRevealStore.setState(() => (line === null ? null : { work, file, line }));
}

/** 그 요청을 끝냈다 — 그사이 새 요청이 섰으면 그것은 남긴다. */
export function settleReveal(done: DocReveal): void {
  docRevealStore.setState((pending) => (pending === done ? null : pending));
}
