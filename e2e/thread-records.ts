import { readFileSync } from "node:fs";
import { join } from "node:path";
import { THREAD_LIST_EVENT, THREAD_RECORD_EVENT } from "@/features/thread/events";
import type { Attachment, RecordKind, RecordLine, ThreadRecordEvent, ThreadSummary, ThreadView } from "@/features/thread/types";
import type { SpecTreeItem, WorkView } from "@/features/works/types";
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
  readOnly: view.readOnly,
  broken: null,
});

/** 목록 요약 이벤트를 쏜다 — 엔진이 새 Thread를 세우거나 참여자가 늘 때 내보내는 것 그대로다. 사이드바가 이것으로 줄을 세운다. */
export async function fireSummary(page: Page, view: ThreadView): Promise<void> {
  await fireEvent(page, THREAD_LIST_EVENT, summaryOf(view));
}

/** L3의 홈 — 하네스가 `plugin:path|resolve_directory`에 주는 답과 같다(`harness.ts` `PLUGINS`). */
const FIXTURE_HOME = "/Users/tester";

/**
 * 기록의 자료 자리를 L3 홈의 절대 경로로 편다(v1 티켓 40). L1은 임시 데이터 루트를 `~/.atelier`로 고쳐 적어 두지만(`fix_record_sessions`),
 * 진짜 엔진은 홈 아래 `.atelier`의 절대 경로를 적는다. 화면은 이은 Work의 spec 폴더(`~`를 편 것)와 견줘 새 spec 문서의 쓰기를 가린다 —
 * 대화 속 문서 카드가 서려면 줄이 진짜 꼴이어야 한다(v1 티켓 35).
 */
export const atHome = (lines: readonly RecordLine[]): RecordLine[] =>
  JSON.parse(JSON.stringify(lines).split("~/.atelier/").join(`${FIXTURE_HOME}/.atelier/`)) as RecordLine[];

/** 기록 안 그 종류 · 상태의 첫 줄(`question` · `work` · `permission` 줄은 `payload.state`로 갈린다). */
export function lineOf(lines: readonly RecordLine[], kind: RecordKind, state: string): RecordLine {
  const found = lines.find((line) => line.kind === kind && (line.payload as { state?: string }).state === state);
  if (!found) throw new Error(`기록에 ${kind} ${state} 줄이 없다`);
  return found;
}

/** 그 seq까지 사람이 본 Thread 이름 — 첫 말이 이름이고, 그 뒤 `title` 줄이 바꾼다. */
export function titleThrough(lines: readonly RecordLine[], seq: number): string {
  const renamed = linesThrough(lines, seq).filter((line) => line.kind === "title");
  const last = renamed[renamed.length - 1];
  return last ? (last.payload as { title: string }).title : sentPayloads(lines)[0].text;
}

/**
 * 턴이 그 Work의 spec 폴더에 새로 쓴 문서(`Write`의 `rawInput`) — spec 기준 경로 → 글, 쓴 차례다. 줄은 홈을 편 것(`atHome`)이어야 한다.
 * 대화 속 문서 카드 · Work 카드의 문서 칸 · 문서 보기의 글이 이것이다.
 */
export function specWrites(lines: readonly RecordLine[], slug: string): Record<string, string> {
  const root = `${FIXTURE_HOME}/.atelier/works/${slug}/spec/`;
  return Object.fromEntries(
    lines.flatMap((line) => {
      const update = (line.payload as { update?: { sessionUpdate?: string; rawInput?: { file_path?: string; content?: string } } })
        .update;
      const path = update?.sessionUpdate === "tool_call" ? update.rawInput?.file_path : undefined;
      const content = update?.rawInput?.content;
      return path?.startsWith(root) && content !== undefined ? [[path.slice(root.length), content]] : [];
    }),
  );
}

/** 머리말이 Host에게 알린 이은 Work의 이름(「- Work: `slug` — 이름」) — L1이 그 Work를 그 이름으로 세웠다. */
export function workTitleOf(lines: readonly RecordLine[], slug: string): string {
  const sent = lines.find((line) => line.kind === "sent")?.payload as { prompt?: { text?: string }[] } | undefined;
  const title = new RegExp(`- Work: \`${slug}\` — (.+)`).exec(sent?.prompt?.[0]?.text ?? "")?.[1];
  if (!title) throw new Error(`머리말에 Work ${slug}의 이름이 없다`);
  return title;
}

/** spec 기준 경로들의 트리(`specTree.items`) — 폴더는 이름 뒤에 선다. 레이아웃의 자리(아이콘 · 묶음)는 없다. */
function specItems(paths: readonly string[], prefix = ""): SpecTreeItem[] {
  const here = paths.filter((path) => !path.includes("/"));
  const folders = [...new Set(paths.filter((path) => path.includes("/")).map((path) => path.slice(0, path.indexOf("/"))))];
  const item = (name: string, kind: "file" | "folder", children: SpecTreeItem[] = []): SpecTreeItem => ({
    name,
    path: `${prefix}${name}`,
    kind,
    icon: null,
    group: null,
    children,
  });
  return [
    ...here.map((name) => item(name, "file")),
    ...folders.map((folder) =>
      item(
        folder,
        "folder",
        specItems(
          paths.filter((path) => path.startsWith(`${folder}/`)).map((path) => path.slice(folder.length + 1)),
          `${prefix}${folder}/`,
        ),
      ),
    ),
  ];
}

/**
 * 기록이 세운 · 이은 Work의 목록 줄(`list_works`, v1 티켓 40) — 머리 줄 Work 알약 · Work 카드 · 사이드바 Work 줄이 이것으로 선다. 이름 ·
 * 브랜치 · Project는 기록(`work` 줄 · Work 만들기 답 · `pr` 줄)에서 읽어 넘기고, spec 문서와 worktree가 선 Project는 그 장면의 것을 준다.
 */
export function workView(
  work: { slug: string; title: string; branch: string | null; projects: readonly string[] },
  { docs = [], trees = [] }: { docs?: readonly string[]; trees?: readonly string[] } = {},
): WorkView {
  const home = `~/.atelier/works/${work.slug}`;
  return {
    slug: work.slug,
    title: work.title,
    status: "active",
    branch: work.branch,
    createdAt: "2026-10-10",
    projects: [...work.projects],
    pinned: false,
    worktrees: trees.map((project) => ({ project, path: `${home}/trees/${project}`, exists: true, dirty: true })),
    specDir: `${home}/spec`,
    specFiles: [...docs],
    specTree: { fallback: null, defaultDoc: docs[0] ?? null, items: specItems(docs) },
  };
}
