import { useQuery } from "@tanstack/react-query";
import type { ScopeOf } from "@/features/services/scope";
import { threadApi } from "./api";

// 「@」 언급(restart 02b-3 · 구현 스펙 「02b — 대화창」 · 시안 Composer 「「@」 언급」 · 「첨부 · 언급」). 입력칸의 커서 앞 낱말이 `@`로 시작하면
// 입력창 위에 「파일」 메뉴가 서서 그 뒤의 글자로 파일을 찾는다. **찾는 자리와 넣을 경로의 모양은 core 하나가 정한다**(`mention_files` — 작업
// 폴더 · spec 폴더 · 읽는 범위의 Project, 작업 폴더 안은 상대 경로 · 밖은 절대 경로). 여기는 받은 파일을 거르고, 고른 것을 `@경로`로 넣고, 넣은
// 언급을 칠할 자리를 가른다. 보낼 때는 글 그대로 간다 — 언급을 다른 모양(첨부 · 자원 링크)으로 바꾸지 않는다.

/** 찾기 명령(`mention_files`)이 주는 자리 하나 — core `MentionPlace` 그대로다. */
export interface MentionPlace {
  /** 작업 폴더 안의 자리면 `null`, 밖이면 Project 이름이나 `spec`. */
  name: string | null;
  /** 파일 앞에 붙여 넣는 것 — 작업 폴더 안이면 상대 자리(`""` · `web-app/`), 밖이면 절대 경로와 `/`. */
  root: string;
  files: string[];
}

/** 메뉴의 파일 한 줄. */
export interface MentionFile {
  /** `@` 뒤에 넣는 경로. */
  path: string;
  /** 줄에 보이는 경로 — 작업 폴더 안이면 넣는 경로, 밖이면 그 자리 안의 경로. */
  shown: string;
  /** 줄 끝의 자리 이름 — 작업 폴더 안이면 없다. */
  place: string | null;
}

/**
 * 찾기 명령의 열쇠 — **`["works"]` 아래에 둔다.** 자리는 Work 파일 · worktree · 등록부에 달려 있어 `works:changed`의 무효화(`invalidateWorks`)와
 * 범위 쿼리의 무효화가 함께 지운다.
 */
export function mentionKey(of: ScopeOf) {
  return ["works", "mention-files", of.thread ?? null, of.work ?? null, of.service ?? null, of.project ?? null];
}

/**
 * 찾을 자리의 파일 — 메뉴가 열려 있을 때만 읽는다(`enabled`). 파일은 Agent가 일하는 동안에도 늘어 오래 쥐지 않는다 — 5초가 지난 뒤 메뉴를 다시
 * 열면 새로 읽는다.
 */
export function useMentionFiles(of: ScopeOf | undefined, enabled: boolean) {
  return useQuery({
    queryKey: mentionKey(of ?? {}),
    queryFn: () => threadApi.mentionFiles(of ?? {}),
    enabled: enabled && of !== undefined,
    staleTime: 5_000,
  });
}

/** 자리들을 메뉴의 줄들로 편다 — 받은 차례(작업 폴더 → spec → Project) 그대로다. */
export function mentionFiles(places: readonly MentionPlace[]): MentionFile[] {
  return places.flatMap(({ name, root, files }) =>
    files.map((file) => ({ path: root + file, shown: name === null ? root + file : file, place: name })),
  );
}

/** 메뉴가 한 번에 세우는 줄의 상한. */
const SHOWN = 50;

/**
 * 친 글자로 파일을 찾는다(대소문자 없이) — 파일 이름이 그 글자로 시작하는 것, 이름이 품은 것, 경로(밖이면 「자리 이름/경로」)가 품은 것, 글자가
 * 그 차례로 띄엄띄엄 든 것 차례다. 같은 차례면 작업 폴더의 것이 먼저이고 그다음 짧은 경로, 받은 차례다. 빈 말이면 받은 차례 그대로다.
 */
export function matchMentions(files: readonly MentionFile[], query: string): MentionFile[] {
  const typed = query.toLowerCase();
  if (typed === "") return files.slice(0, SHOWN);
  const ranked: { file: MentionFile; tier: number; key: string; order: number }[] = [];
  files.forEach((file, order) => {
    const key = (file.place === null ? file.shown : `${file.place}/${file.shown}`).toLowerCase();
    const name = key.slice(key.lastIndexOf("/") + 1);
    const tier = name.startsWith(typed) ? 0 : name.includes(typed) ? 1 : key.includes(typed) ? 2 : spread(key, typed) ? 3 : null;
    if (tier !== null) ranked.push({ file, tier, key, order });
  });
  ranked.sort(
    (a, b) =>
      a.tier - b.tier ||
      Number(a.file.place !== null) - Number(b.file.place !== null) ||
      a.key.length - b.key.length ||
      a.order - b.order,
  );
  return ranked.slice(0, SHOWN).map(({ file }) => file);
}

/** `typed`의 글자가 `key`에 그 차례로 들어 있나. */
function spread(key: string, typed: string): boolean {
  let at = 0;
  for (const letter of key) {
    if (letter === typed[at]) at += 1;
    if (at === typed.length) return true;
  }
  return false;
}

/** 입력칸에서 찾는 중인 언급 — `@`의 자리, 바꿀 끝, `@` 뒤 커서까지의 글자. */
export interface MentionAt {
  at: number;
  end: number;
  query: string;
}

const SPACE = /\s/;

/**
 * 커서 앞 낱말이 언급이면 그 자리 — 낱말은 빈칸 사이의 글자이고, 말의 처음이나 빈칸 바로 뒤의 `@`로 시작해야 한다(메일 주소의 `@`는 아니다).
 * 찾는 말은 `@` 뒤부터 커서까지이고, 바꿀 자리는 커서 뒤로 낱말 끝까지다.
 */
export function mentionQuery(draft: string, caret: number): MentionAt | null {
  let at = caret;
  while (at > 0 && !SPACE.test(draft[at - 1])) at -= 1;
  if (draft[at] !== "@" || at === caret) return null;
  let end = caret;
  while (end < draft.length && !SPACE.test(draft[end])) end += 1;
  return { at, end, query: draft.slice(at + 1, caret) };
}

/** 글에 넣는 언급 — `@경로`. 빈칸이 든 경로는 따옴표로 감싼다(어디서 끝나는지 글로 남는다). */
const mentionText = (path: string) => (SPACE.test(path) ? `@"${path}"` : `@${path}`);

/**
 * 고른 파일을 넣는다 — 찾던 낱말(`@`부터 낱말 끝)이 언급과 빈칸 하나로 바뀐다(뒤에 이미 빈칸이 있으면 더하지 않는다). 커서는 그 빈칸 뒤다 —
 * 이어 쓰면 메뉴가 닫힌 채다.
 */
export function insertMention(draft: string, found: MentionAt, path: string): { draft: string; caret: number; mention: string } {
  const mention = mentionText(path);
  const rest = draft.slice(found.end);
  const gap = SPACE.test(rest[0] ?? "") ? "" : " ";
  return { draft: draft.slice(0, found.at) + mention + gap + rest, caret: found.at + mention.length + 1, mention };
}

/**
 * 입력칸의 글자를 누가 그리나 — 언급이 서 있으면 칠 층(입력칸은 caret만), 아니면 입력칸이다. **한글을 조합하는 동안은 입력칸이 그린다** —
 * 입력기는 조합 중인 글자의 밑줄을 입력칸의 글자색으로 긋는데, 칠 층이 그리는 동안 그 색은 투명이라 밑줄이 사라진다. 그동안 칠 층은 면만
 * 둔다. 두 층의 글자 자리는 같아 갈아 그려도 흔들리지 않는다.
 */
export const inkOf = (painted: boolean, composing: boolean): "paint" | "field" => (painted && !composing ? "paint" : "field");

/** 입력칸 글의 한 조각 — 언급 칠을 입는가. */
export interface PaintedPart {
  text: string;
  mention: boolean;
}

/** 그 자리의 글자가 경로를 잇는가 — 그러면 앞의 언급은 다른 경로가 된 것이다. 문장 끝의 마침표 · 조사 · 빈칸은 잇지 않는다. */
const continues = (draft: string, at: number) =>
  /[A-Za-z0-9_\-/]/.test(draft[at] ?? "") || (draft[at] === "." && /[A-Za-z0-9]/.test(draft[at + 1] ?? ""));

/**
 * 입력칸 글을 언급 칠로 가른다 — 메뉴로 넣은 언급(`mentions`)이 말의 처음이나 빈칸 뒤에서 낱말째 나오면 칠한다. 찾는 중인 글자, 고쳐 다른
 * 경로가 된 언급은 칠하지 않는다. 조각을 이으면 글 그대로다.
 */
export function paintMentions(draft: string, mentions: readonly string[]): PaintedPart[] {
  const known = [...new Set(mentions)].sort((a, b) => b.length - a.length);
  const parts: PaintedPart[] = [];
  let plain = 0;
  let at = 0;
  while (at < draft.length) {
    const hit =
      at === 0 || SPACE.test(draft[at - 1])
        ? known.find((mention) => draft.startsWith(mention, at) && !continues(draft, at + mention.length))
        : undefined;
    if (hit === undefined) {
      at += 1;
      continue;
    }
    if (plain < at) parts.push({ text: draft.slice(plain, at), mention: false });
    parts.push({ text: hit, mention: true });
    at += hit.length;
    plain = at;
  }
  if (plain < draft.length) parts.push({ text: draft.slice(plain), mention: false });
  return parts;
}
