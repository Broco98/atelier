import type { LayoutEntryJson, SpecLayoutJson, TemplateBodies } from "./types";

// 편집기의 초안과 그것을 고치는 함수들(spec 레이아웃 티켓 11 · 구현 스펙 5절 「초안 조작은 순수 함수다」).
//
// **초안은 읽은 것을 펼쳐 고친다.** 레이아웃은 엔진이 준 디스크 형식 그대로라, 이름 붙은 키 말고도
// 사람이 손으로 적은 모르는 키가 실려 온다. 함수마다 새 객체를 지으면 그 키가 저장 한 번에 조용히
// 사라진다 — 설정의 `patchTerminal`이 못박은 것과 같은 규칙이고, 그래서 필드를 바꾸는 길은 모두 아래
// `updateEntry` 하나를 지난다.
//
// 규칙은 여기 없다(결정 13). 이름 틀이 맞는지, 폴더에 자식이 있어도 되는지는 저장이 엔진의 검증으로
// 판정한다. 여기가 아는 것은 「종류를 바꾸면 무엇이 따라가는가」 하나다.

/** 편집기가 쥔 초안 — 레이아웃과, 저장에 **늘 전부** 돌려줄 템플릿 본문. */
export interface LayoutDraft {
  layout: SpecLayoutJson;
  templates: TemplateBodies;
}

/**
 * 항목의 자리 — 맨 위 항목에서부터의 인덱스 경로. `[]`이 맨 위 항목(spec 폴더 자신)이고, `[2, 0]`은
 * 셋째 최상위 항목의 첫 자식이다. 엔진의 검증 오류가 같은 모양으로 자리를 말한다(`LayoutError.path`).
 */
export type EntryPath = readonly number[];

/** 그 자리의 항목. 없으면 `null`이다. */
export function entryAt(layout: SpecLayoutJson, path: EntryPath): LayoutEntryJson | null {
  let entry: LayoutEntryJson | undefined = layout.root;
  for (const index of path) entry = entry?.children?.[index];
  return entry ?? null;
}

/** 이름 틀을 바꾼다. 비운 칸도 그대로 싣는다 — 빈 이름 틀은 저장이 그 자리의 오류로 알린다. */
export function setPattern(draft: LayoutDraft, path: EntryPath, pattern: string): LayoutDraft {
  return { ...draft, layout: updateEntry(draft.layout, path, (entry) => ({ ...entry, pattern })) };
}

/**
 * 설명을 바꾼다. 빈 경로면 맨 위 항목의 설명 — 안내문 맨 위의 방침 문단이다. **비우면 키를 뗀다**:
 * 디스크 형식은 빈 설명을 적지 않는다(엔진의 `serialize_layout`).
 */
export function setDescription(draft: LayoutDraft, path: EntryPath, description: string): LayoutDraft {
  return {
    ...draft,
    layout: updateEntry(draft.layout, path, (entry) =>
      description === "" ? without(entry, "description") : { ...entry, description },
    ),
  };
}

/** 아이콘을 바꾼다. `null`은 「아이콘 없음」이라 키를 뗀다. */
export function setIcon(draft: LayoutDraft, path: EntryPath, icon: string | null): LayoutDraft {
  return {
    ...draft,
    layout: updateEntry(draft.layout, path, (entry) =>
      icon === null ? without(entry, "icon") : { ...entry, icon },
    ),
  };
}

/**
 * 종류를 바꾼다(구현 스펙 5절).
 *
 * - **폴더로 바꾸면 템플릿을 뗀다** — 그 항목의 `template`과 본문 맵의 본문이다. 폴더에는 템플릿이 없고,
 *   아무도 가리키지 않는 본문은 저장이 거절한다. 본문은 **다른 파일 항목이 같은 경로를 가리키지 않을
 *   때만** 뗀다 — 그쪽은 여전히 그 본문의 주인이다.
 * - **파일로 바꾸면 자식은 그대로 둔다.** 사람의 손을 대신 치우지 않는다 — 저장이 그 자리에 「파일 항목의
 *   `children`」 오류를 세우고, 옮기기로 푼다.
 */
export function setKind(draft: LayoutDraft, path: EntryPath, kind: "file" | "folder"): LayoutDraft {
  const template = entryAt(draft.layout, path)?.template;
  const layout = updateEntry(draft.layout, path, (entry) =>
    kind === "folder" ? { ...without(entry, "template"), kind } : { ...entry, kind },
  );
  if (kind === "file" || template === undefined || pointsTo(layout.root, template)) {
    return { ...draft, layout };
  }
  return { layout, templates: without(draft.templates, template) };
}

/**
 * 그 자리의 항목 하나를 갈아 끼운 새 레이아웃. **지나는 층을 모두 펼친다** — 레이아웃과, 경로를 따라
 * 내려가는 폴더 항목마다. 한 층이라도 새로 지으면 그 층의 모르는 키가 빠진다.
 */
function updateEntry(
  layout: SpecLayoutJson,
  path: EntryPath,
  change: (entry: LayoutEntryJson) => LayoutEntryJson,
): SpecLayoutJson {
  const down = (entry: LayoutEntryJson, rest: EntryPath): LayoutEntryJson => {
    if (rest.length === 0) return change(entry);
    const [index, ...deeper] = rest;
    const children = entry.children ?? [];
    return {
      ...entry,
      children: children.map((child, i) => (i === index ? down(child, deeper) : child)),
    };
  };
  return { ...layout, root: down(layout.root, path) };
}

/** 이 항목이나 그 아래 어느 항목이 그 템플릿을 가리키는가. 저장의 검증처럼 경로 글자로 견준다. */
function pointsTo(entry: LayoutEntryJson, template: string): boolean {
  return entry.template === template || (entry.children ?? []).some((child) => pointsTo(child, template));
}

/** 키 하나를 뗀 사본 — 나머지(모르는 키까지)는 그대로다. */
function without<T extends Record<string, unknown>>(value: T, key: string): T {
  const { [key]: _gone, ...rest } = value;
  return rest as T;
}
