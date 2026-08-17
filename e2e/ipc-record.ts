// 하네스가 브라우저 안에 쌓는 IPC 기록. 하네스(쓰는 쪽)와 증거 수집기(실패했을 때 읽는
// 쪽)가 둘 다 알아야 하는데, 서로를 임포트하면 방향이 꼬인다 — 그래서 둘이 공유하는
// 이름과 모양만 여기 둔다.

export interface IpcRecord {
  /** 부른 순서 그대로. "list_projects가 아예 안 불렸다"를 이걸로만 알 수 있다. */
  calls: string[];
  /** 화이트리스트 밖으로 새어 나간 호출. 비어 있지 않으면 하네스가 낡은 것이다. */
  unknown: string[];
}

/** 브라우저 전역에 기록이 붙는 자리. */
export const IPC_RECORD_KEY = "__ATELIER_IPC__";
