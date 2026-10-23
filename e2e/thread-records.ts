import { readFileSync } from "node:fs";
import { join } from "node:path";
import { THREAD_LIST_EVENT, THREAD_RECORD_EVENT } from "@/features/thread/events";
import type { Attachment, RecordKind, RecordLine, ThreadRecordEvent, ThreadSummary, ThreadView } from "@/features/thread/types";
import { REPO_ROOT } from "./dev-server";
import type { Page } from "./evidence";
import { fireEvent } from "./harness";

// Thread 화면 L3의 자료(v1 구현 스펙 Testing Decisions 경계 ② · 스토리 137). **L1이 축복한 기록을 그대로 쏜다** — Thread 엔진 검사(L1)가
// 시나리오를 돌려 남긴 `threads/<id>/events.jsonl`의 고정값 사본이 `crates/atelier-acp/tests/records/`에 있고, 이 층의 목업 백엔드는 그
// 줄을 기록 읽기(`thread_read_record`)의 답과 기록 줄 이벤트(`thread:record`)로 흘린다. 그래서 엔진과 화면이 같은 기록 모양을 본다 —
// 엔진이 줄 모양을 바꾸면 L1이 그 파일을 다시 쓰고, 화면이 그 모양을 못 읽으면 여기서 빨개진다.
//
// three-axes의 `chat-records.ts`(대화창)를 Thread로 넓힌 것이다(v1 티켓 08이 그 틀을 걷었고 10이 다시 세웠다). 손으로 짓는 줄은 ACP 몸통에만
// 쓴다 — 우리 줄(보낸 말 · 턴 끝 · 들어옴 …)은 L1이 그 갈래를 지나며 남긴 기록에서 자른다.
//
// **`fixtures.ts`에서 읽지 않는다.** 그 모듈은 L2의 `tauri-commands.test`가 임포트하므로 파일을 읽게 만들면 L2도 그 파일에 묶인다.
// Thread spec이 이 모듈을 불러 제 답을 덮어쓴다.

const RECORDS = join(REPO_ROOT, "crates/atelier-acp/tests/records");

/** L1이 축복한 기록 하나 — 줄마다 `{seq, at, kind, who?, payload}`다. 끝의 빈 줄은 버린다. */
export function record(name: string): RecordLine[] {
  return readFileSync(join(RECORDS, `${name}.jsonl`), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as RecordLine);
}

/** 그 종류의 `nth`번째(1부터) 줄의 seq — 「여기까지는 기록 읽기로, 그 뒤는 이벤트로」를 가를 자리를 찾는다. */
export function seqOf(lines: readonly RecordLine[], kind: RecordKind, nth = 1): number {
  const found = lines.filter((line) => line.kind === kind)[nth - 1];
  if (!found) throw new Error(`기록에 ${nth}번째 ${kind} 줄이 없다`);
  return found.seq;
}

/** 기록에서 그 seq까지 · 그 뒤의 줄들. */
export const linesThrough = (lines: readonly RecordLine[], seq: number) => lines.filter((line) => line.seq <= seq);
export const linesAfter = (lines: readonly RecordLine[], seq: number) => lines.filter((line) => line.seq > seq);

/** 사람이 보낸 말(`sent` 줄)의 payload — 화면 글 · 첨부를 기록에서 읽는다. 시험이 글을 따로 적으면 축복 기록이 바뀔 때 갈린다. */
export function sentPayloads(lines: readonly RecordLine[]) {
  return lines
    .filter((line) => line.kind === "sent")
    .map((line) => line.payload as { text: string; attachments?: Attachment[] });
}

/**
 * 기록 줄을 차례로 쏜다 — 엔진이 줄을 적을 때마다 내보내는 기록 줄 이벤트 그대로다(`{thread, seq, line}`). 구독은 앱 층에
 * 하나라(`AppShell`의 `useThreadFeeds`) 마지막 구독 하나에 쏘는 `fireEvent`로 실물과 같다.
 */
export async function streamLines(page: Page, thread: string, lines: readonly RecordLine[]): Promise<void> {
  for (const line of lines) {
    const event: ThreadRecordEvent = { thread, seq: line.seq, line };
    await fireEvent(page, THREAD_RECORD_EVENT, event);
  }
}

/** Thread 하나의 목록 요약(`thread_list` 줄 · `thread:list` 이벤트) — 화면이 여는 Thread 그대로다. */
export const summaryOf = (view: ThreadView): ThreadSummary => ({
  id: view.id,
  title: view.title,
  createdAt: view.createdAt,
  work: view.work,
  handles: view.participants.map((one) => one.handle),
  lastRead: view.lastRead,
  broken: null,
});

/** 목록 요약 이벤트를 쏜다 — 엔진이 새 Thread를 세우거나 참여자가 늘 때 내보내는 것 그대로다. 사이드바가 이것으로 줄을 세운다. */
export async function fireSummary(page: Page, view: ThreadView): Promise<void> {
  await fireEvent(page, THREAD_LIST_EVENT, summaryOf(view));
}
