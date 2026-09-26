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
//
// 트리를 고치는 함수(더하기·지우기·옮기기·놓기, 티켓 13)는 새 초안과 함께 **그 뒤에 고를 자리**를 준다
// (`TreeEdit`). 할 수 없는 조작은 `null`이고, 버튼의 잠금이 그 답이다(`editsAt`). 트리가 할 수 있는 것을 가르는
// 이 몇 가지(제 안으로 놓지 않는다, 폴더 안에만 들인다)는 엔진의 검증이 아니라 트리의 모양에서 나온다.

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
 * 트리를 고친 결과 — 새 초안과, 그 뒤에 **고를 자리**(티켓 13). 자리가 인덱스 경로라 항목을 더하거나 옮기면
 * 고른 자리도 따라가야 한다: 옮긴 항목을 계속 고르고, 더한 항목을 고르고, 지우면 그 앞 행을 고른다.
 */
export interface TreeEdit {
  draft: LayoutDraft;
  select: EntryPath;
}

/**
 * 항목을 더한다(티켓 13 · 프로토타입의 동작).
 *
 * - 고른 것이 **폴더**면 그 안의 마지막 자식으로, **파일**이면 그 뒤의 형제로 더한다. 머리 `spec/`(빈 경로)을
 *   골랐으면 최상위의 맨 뒤다.
 * - 이름 틀은 `untitled`(파일이면 `untitled.md`)다. 형제와 겹치면 `untitled-2`처럼 번호를 붙인다 — 형제 사이에
 *   같은 이름 틀이 둘이면 저장이 거절한다(엔진의 검증). 엔진처럼 글자 그대로 견준다.
 * - 더한 항목을 고른다.
 */
export function addEntry(draft: LayoutDraft, selected: EntryPath, kind: "file" | "folder"): TreeEdit {
  const at = entryAt(draft.layout, selected);
  const inside = at === null || selected.length === 0 || isFolder(at);
  const parent = inside ? (at === null ? [] : selected) : selected.slice(0, -1);
  const siblings = entryAt(draft.layout, parent)?.children ?? [];
  const index = inside ? siblings.length : selected[selected.length - 1] + 1;
  const pattern = freePattern(siblings, kind === "file" ? ".md" : "");
  return {
    draft: {
      ...draft,
      layout: updateChildren(draft.layout, parent, (children) => [
        ...children.slice(0, index),
        { pattern, kind },
        ...children.slice(index),
      ]),
    },
    select: [...parent, index],
  };
}

/**
 * 항목을 지운다(티켓 13) — **자기 아래가 함께 사라진다.** 빈 경로(맨 위 항목, spec 폴더 자신)는 지울 수 없어
 * `null`이다. 머리 `spec/`을 골랐을 때 휴지통이 잠기는 것이 이 답이다(`editsAt`).
 *
 * - 사라진 항목들이 가리키던 템플릿 본문을 함께 뗀다 — 아무도 가리키지 않는 본문은 저장이 거절한다. 남은
 *   파일 항목이 같은 경로를 가리키면 그 본문은 남는다(`detachTemplate`과 같은 규칙).
 * - 그 뒤에는 트리에서 **바로 위에 보이던 행**을 고른다 — 앞 형제가 있으면 그 아래의 맨 끝 행, 없으면 부모다.
 *   첫 최상위 항목이었으면 머리 `spec/`이다.
 */
export function removeEntry(draft: LayoutDraft, path: EntryPath): TreeEdit | null {
  const entry = path.length === 0 ? null : entryAt(draft.layout, path);
  if (entry === null) return null;
  const parent = path.slice(0, -1);
  const index = path[path.length - 1];
  const layout = updateChildren(draft.layout, parent, (children) =>
    children.filter((_, i) => i !== index),
  );
  const kept = templatesOf(layout.root);
  const dropped = templatesOf(entry).filter((template) => !kept.includes(template));
  return {
    draft: { layout, templates: dropped.reduce(without, draft.templates) },
    select: index === 0 ? parent : lastRowUnder(layout, [...parent, index - 1]),
  };
}

/** 키보드 길의 옮기기 넷 — 버튼 넷과 ⌥↑ ⌥↓ ⌥← ⌥→. */
export type EntryMove = "up" | "down" | "outdent" | "indent";

/**
 * 고른 항목을 키보드 길로 옮긴다(티켓 13). **자기 아래는 함께 옮긴다** — 항목이 자식을 쥐고 간다. 옮긴 항목을
 * 계속 고른다. 할 수 없으면 `null`이다 — 버튼의 잠금이 이 답이다(`editsAt`).
 *
 * - 위로·아래로: 앞·뒤 형제와 자리를 바꾼다.
 * - 들여쓰기: 바로 앞의 형제가 폴더일 때만 된다. 그 폴더의 마지막 자식이 된다.
 * - 내어쓰기: 부모의 바로 뒤 형제가 된다. 뒤에 있던 형제들은 부모 안에 남는다. 최상위 항목은 내어쓸 수 없다.
 * - 머리 `spec/`(빈 경로)은 항목이 아니라 아무것도 옮기지 않는다.
 */
export function moveEntry(draft: LayoutDraft, path: EntryPath, move: EntryMove): TreeEdit | null {
  if (path.length === 0 || entryAt(draft.layout, path) === null) return null;
  const parent = path.slice(0, -1);
  const index = path[path.length - 1];
  const siblings = entryAt(draft.layout, parent)?.children ?? [];
  switch (move) {
    case "up":
      return index === 0 ? null : relocate(draft, path, () => [...parent, index - 1]);
    case "down":
      return index === siblings.length - 1 ? null : relocate(draft, path, () => [...parent, index + 1]);
    case "indent": {
      if (index === 0 || !isFolder(siblings[index - 1])) return null;
      const folder = [...parent, index - 1];
      return relocate(draft, path, (rest) => [...folder, entryAt(rest, folder)?.children?.length ?? 0]);
    }
    case "outdent":
      return parent.length === 0
        ? null
        : relocate(draft, path, () => [...parent.slice(0, -1), parent[parent.length - 1] + 1]);
  }
}

/**
 * 고른 자리에서 할 수 있는 것 — 트리 위 한 줄의 옮기기 넷과 휴지통이 잠기는지가 이것이다. 답은 조작 함수가
 * 준다: 판정과 조작이 따로 규칙을 들면, 누를 수 있는 버튼이 아무것도 안 하거나 잠긴 버튼 뒤의 단축키가 트리를
 * 바꾸는 날이 온다. 머리 `spec/`을 골랐으면 모두 잠긴다. 더하기는 늘 된다.
 */
export function editsAt(draft: LayoutDraft, path: EntryPath): Record<EntryMove | "remove", boolean> {
  const can = (move: EntryMove) => moveEntry(draft, path, move) !== null;
  return {
    up: can("up"),
    down: can("down"),
    outdent: can("outdent"),
    indent: can("indent"),
    remove: removeEntry(draft, path) !== null,
  };
}

/** 행의 어디에 놓았는가 — 그 앞, 그 뒤, 그 안(마지막 자식). */
export type DropPlace = "before" | "after" | "inside";

/**
 * 끌어 놓을 대상 — 트리의 행 하나와 그 자리, 또는 트리 아래 빈 자리(`end`, 최상위의 맨 뒤). 머리 `spec/`은
 * 대상이 아니다(결정 26).
 */
export type DropTarget = { path: EntryPath; place: DropPlace } | { place: "end" };

/**
 * 행의 어디에 놓였는가를 가른다(티켓 13) — `ratio`는 그 행의 높이에서 포인터가 선 비율이다(0이 위 가장자리).
 * 사각형을 재는 것은 편집기이고, 여기는 비율만 받는다.
 *
 * - 파일: 위쪽 반은 앞, 아래쪽 반은 뒤다.
 * - 폴더: 위쪽은 앞, 가운데는 안, 아래쪽은 뒤다. **자식이 있는 폴더의 아래쪽은 안이다** — 그 행 바로 아래에는
 *   첫 자식이 서 있어, 거기를 「폴더 뒤」(자식들 다음)로 치면 보이는 선과 실제로 서는 자리가 갈린다.
 */
export function dropPlaceAt(entry: LayoutEntryJson, ratio: number): DropPlace {
  if (!isFolder(entry)) return ratio < 0.5 ? "before" : "after";
  if (ratio < 0.3) return "before";
  return ratio < 0.7 || (entry.children ?? []).length > 0 ? "inside" : "after";
}

/**
 * 끌어온 항목을 대상의 앞·뒤·안에 놓는다(티켓 13 · 구현 스펙 5절 「놓기 계산」). 자기 아래는 함께 간다. 옮긴
 * 항목을 고른다.
 *
 * **놓을 수 없으면 `null`이다** — 끄는 동안 선을 세울지도 이 답으로 가른다:
 * - 자기 자신과 자기 아래로는 놓을 수 없다. 제 안으로 들어가면 항목이 트리에서 떨어져 나간다.
 * - 머리 `spec/`(빈 경로)은 끌 것도 대상도 아니다.
 * - 파일 안에는 놓지 않는다 — 파일 항목의 `children`은 저장이 거절한다.
 */
export function dropEntry(draft: LayoutDraft, from: EntryPath, target: DropTarget): TreeEdit | null {
  if (from.length === 0 || entryAt(draft.layout, from) === null) return null;
  if (target.place === "end") {
    return relocate(draft, from, (rest) => [rest.root.children?.length ?? 0]);
  }
  const { path, place } = target;
  const onto = path.length === 0 ? null : entryAt(draft.layout, path);
  if (onto === null || within(path, from) || (place === "inside" && !isFolder(onto))) return null;
  return relocate(draft, from, (rest) => {
    const at = afterRemoval(path, from);
    if (place === "inside") return [...at, entryAt(rest, at)?.children?.length ?? 0];
    const index = at[at.length - 1];
    return [...at.slice(0, -1), place === "before" ? index : index + 1];
  });
}

/** `path`가 `ancestor` 자신이거나 그 아래인가. */
function within(path: EntryPath, ancestor: EntryPath): boolean {
  return path.length >= ancestor.length && ancestor.every((index, i) => path[i] === index);
}

/**
 * `removed` 자리의 항목을 뗀 뒤 `path`가 가리키게 되는 경로 — 같은 부모 안에서 뗀 항목보다 뒤에 있던 갈래는
 * 한 칸 당겨진다. `path`가 뗀 항목 아래이면 안 된다(`within`으로 먼저 거른다).
 */
function afterRemoval(path: EntryPath, removed: EntryPath): EntryPath {
  const depth = removed.length - 1;
  const shifted =
    path.length > depth &&
    removed.slice(0, depth).every((index, i) => path[i] === index) &&
    path[depth] > removed[depth];
  return shifted ? [...path.slice(0, depth), path[depth] - 1, ...path.slice(depth + 1)] : path;
}

/**
 * 그 자리의 항목을 떼어 다른 자리에 세운다 — 자식은 항목과 함께 간다. 세울 자리는 **뗀 뒤의 트리**에서의 경로다
 * (`to`가 뗀 레이아웃을 받는다). 템플릿 본문은 그대로다: 가리키는 항목이 자리만 바꾼다.
 */
function relocate(
  draft: LayoutDraft,
  from: EntryPath,
  to: (rest: SpecLayoutJson) => EntryPath,
): TreeEdit {
  const entry = entryAt(draft.layout, from) as LayoutEntryJson;
  const index = from[from.length - 1];
  const rest = updateChildren(draft.layout, from.slice(0, -1), (children) =>
    children.filter((_, i) => i !== index),
  );
  const at = to(rest);
  const slot = at[at.length - 1];
  const layout = updateChildren(rest, at.slice(0, -1), (children) => [
    ...children.slice(0, slot),
    entry,
    ...children.slice(slot),
  ]);
  return { draft: { ...draft, layout }, select: at };
}

/** 그 항목 아래에서 트리의 맨 끝 행 — 마지막 자식을 따라 끝까지 내려간다. 자식이 없으면 그 자신이다. */
function lastRowUnder(layout: SpecLayoutJson, path: EntryPath): EntryPath {
  const count = entryAt(layout, path)?.children?.length ?? 0;
  return count === 0 ? path : lastRowUnder(layout, [...path, count - 1]);
}

/** 형제와 겹치지 않는 새 이름 틀 — `untitled`, `untitled-2`, `untitled-3` … 뒤에 확장자를 붙인다. */
function freePattern(siblings: LayoutEntryJson[], ext: string): string {
  const taken = new Set(siblings.map((entry) => entry.pattern));
  let pattern = `untitled${ext}`;
  for (let n = 2; taken.has(pattern); n += 1) pattern = `untitled-${n}${ext}`;
  return pattern;
}

/**
 * 폴더인가 — 종류가 없는 항목(맨 위 항목)도 폴더로 친다. 트리의 행과 엔진(`LayoutEntry::is_folder`)이 같은
 * 규칙이다.
 */
function isFolder(entry: LayoutEntryJson): boolean {
  return entry.kind !== "file";
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
 * 그 자리의 폴더 항목의 자식 목록을 갈아 끼운다 — `updateEntry`를 지나 층마다 펼친다. **비면 `children` 키를
 * 뗀다**: 디스크 형식은 빈 자식 목록을 적지 않아서(엔진의 `serialize_layout`), 자식을 하나 더했다 지운 초안이
 * 읽은 것과 같은 모양으로 돌아온다.
 */
function updateChildren(
  layout: SpecLayoutJson,
  path: EntryPath,
  change: (children: LayoutEntryJson[]) => LayoutEntryJson[],
): SpecLayoutJson {
  return updateEntry(layout, path, (entry) => {
    const children = change(entry.children ?? []);
    return children.length === 0 ? without(entry, "children") : { ...entry, children };
  });
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
