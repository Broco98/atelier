import { templatePathFor } from "./template-path";
import type { LayoutEntryJson, SpecLayoutJson, TemplateBodies } from "./types";

// 편집기의 초안과 그것을 고치는 함수들(spec 레이아웃 티켓 11 · 구현 스펙 5절 「초안 조작은 순수 함수다」).
//
// **초안은 읽은 것을 펼쳐 고친다.** 레이아웃은 엔진이 준 디스크 형식 그대로라, 이름 붙은 키 말고도
// 사람이 손으로 적은 모르는 키가 실려 온다. 함수마다 새 객체를 지으면 그 키가 저장 한 번에 조용히
// 사라진다 — 설정의 `patchTerminal`이 못박은 것과 같은 규칙이고, 그래서 필드를 바꾸는 길은 모두 아래
// `updateEntry` 하나를 지난다.
//
// 규칙은 여기 없다(결정 13). 이름 틀이 맞는지, 폴더에 자식이 있어도 되는지는 저장이 엔진의 검증으로
// 판정한다. 여기가 아는 것은 「무엇이 따라가는가」다 — 종류를 바꾸거나 템플릿을 켜고 끌 때 항목의
// `template`과 본문 맵이 함께 움직인다. 템플릿 경로를 짓는 것만 따로 산다(`template-path.ts`).

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
  if (kind === "folder") return detachTemplate(draft, path, (entry) => ({ ...entry, kind }));
  return { ...draft, layout: updateEntry(draft.layout, path, (entry) => ({ ...entry, kind })) };
}

/**
 * 파일 항목의 템플릿을 켜거나 끈다(티켓 12 · 구현 스펙 5절 「템플릿 파일은 `layout.json`과 같은 폴더에 둔다」).
 *
 * - **켜면** 항목에 `template` 경로가 서고 본문 맵에 빈 본문이 선다. 경로는 사람이 적지 않는다 — 지금 이름
 *   틀과 이미 쓰인 경로들(다른 항목이 가리키는 템플릿)로 여기서 **한 번** 짓는다(`templatePathFor`). 이름
 *   틀을 나중에 고쳐도 경로는 따라가지 않는다.
 * - **이미 경로가 있으면 그대로다** — 손으로 고친 `layout.json`이 폴더 안의 다른 경로(`templates/adr.md`)를
 *   가리켜도 존중하고, 본문도 건드리지 않는다. 템플릿 파일이 사라진 항목(본문 맵에 경로가 없다)도 켜진
 *   채다: 본문 칸에 적어야(`setTemplateBody`) 맵에 들어간다.
 * - **끄면** `template`과 본문이 함께 빠진다 — 저장이 가리키지 않게 된 템플릿 파일을 지운다(티켓 07). 끄고
 *   다시 켜면 그때의 이름 틀로 다시 짓는다.
 */
export function setTemplate(draft: LayoutDraft, path: EntryPath, on: boolean): LayoutDraft {
  const entry = entryAt(draft.layout, path);
  if (entry === null) return draft;
  if (!on) return detachTemplate(draft, path, (entry) => entry);
  if (entry.template !== undefined) return draft;
  const template = templatePathFor(entry.pattern ?? "", [
    ...templatesOf(draft.layout.root),
    ...Object.keys(draft.templates),
  ]);
  return {
    layout: updateEntry(draft.layout, path, (entry) => ({ ...entry, template })),
    templates: { ...draft.templates, [template]: "" },
  };
}

/**
 * 항목이 가리키는 템플릿의 본문을 바꾼다. 본문은 경로로 맵에 산다 — 템플릿 파일이 사라져 맵에 없던
 * 경로도 여기서 들어간다(누락이 풀린다). 템플릿이 없는 항목이면 그대로다.
 */
export function setTemplateBody(draft: LayoutDraft, path: EntryPath, body: string): LayoutDraft {
  const template = entryAt(draft.layout, path)?.template;
  if (template === undefined) return draft;
  return { ...draft, templates: { ...draft.templates, [template]: body } };
}

/**
 * 그 자리의 항목에서 `template`을 떼고(`change`도 함께 입힌다), 본문 맵에서 그 본문을 뗀다. 본문은 **다른
 * 파일 항목이 같은 경로를 가리키지 않을 때만** 뗀다 — 그쪽은 여전히 그 본문의 주인이다. 아무도 가리키지
 * 않는 본문은 저장이 거절한다.
 */
function detachTemplate(
  draft: LayoutDraft,
  path: EntryPath,
  change: (entry: LayoutEntryJson) => LayoutEntryJson,
): LayoutDraft {
  const template = entryAt(draft.layout, path)?.template;
  const layout = updateEntry(draft.layout, path, (entry) => change(without(entry, "template")));
  if (template === undefined || templatesOf(layout.root).includes(template)) {
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

/**
 * 이 항목과 그 아래 항목들이 가리키는 템플릿 경로 전부. 저장의 검증처럼 경로 글자 그대로다 — 「아무도
 * 가리키지 않는 본문」을 가리는 데 쓴다.
 */
function templatesOf(entry: LayoutEntryJson): string[] {
  return [
    ...(entry.template === undefined ? [] : [entry.template]),
    ...(entry.children ?? []).flatMap(templatesOf),
  ];
}

/** 키 하나를 뗀 사본 — 나머지(모르는 키까지)는 그대로다. */
function without<T extends Record<string, unknown>>(value: T, key: string): T {
  const { [key]: _gone, ...rest } = value;
  return rest as T;
}
