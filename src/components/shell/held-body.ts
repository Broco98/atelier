// **떠난 화면의 패널 몸을 접힘이 끝날 때까지 남긴다**(restart 02a-14b · 시안 Shell 「규칙」 「작업공간을 떠나면 레일과 패널이 함께
// 500ms로 접혀요」 · Motion 「레일이 들고 난다」).
//
// spec 패널의 몸(spec 트리)은 작업공간 화면이 그려 앱 셸 기둥의 자리로 보낸다(`WorkTools` — 포털). 몸과 그 일(문서 열기 · 복사 · 폴더
// 열기)이 화면의 것이라 화면이 내려가면 몸도 함께 걷힌다 — 그대로면 패널 상자가 빈 채로 접힌다. 그래서 화면이 내려가는 그 순간 자리의
// 그림을 떠 두고(사본) 패널 상자의 접힘이 끝나면 걷는다. 사본은 그림일 뿐이다 — 누를 수도 읽을 수도 없다(`inert` · `aria-hidden`).
// 한때(02a-14) 몸이 곧바로 비고 빈 카드가 접혔다.
//
// 구른 자리는 깊은 복제가 옮기지 않으므로 사본을 자리에 세운 뒤 옮겨 적는다 — 그러지 않으면 접히는 첫 프레임에 트리가 맨 위로 튄다.
// 걷는 때는 패널 상자 자신의 트랜지션(`flex-basis`)이 끝날 때다 — 박자를 따로 적지 않는다. 동작 줄이기로 트랜지션이 없으면 다음
// 프레임에 걷는다. 작업공간이 다시 서면 곧바로 걷는다(`dropHeldBody` — 새 몸 곁에 사본이 남지 않게).

/** 지금 남긴 사본 — 앱에 하나다. 걷을 때 이것이 바뀌었으면(다시 섰거나 또 남겼다) 늦게 끝난 접힘은 아무것도 하지 않는다. */
let held: { copies: ChildNode[] } | null = null;

/** 요소의 노드 종류(`Node.ELEMENT_NODE`). */
const ELEMENT = 1;

/** 요소와 그 자손 — 문서 차례다. 원본과 깊은 사본에서 같은 차례로 나온다. */
const family = (element: Element): Element[] => [element, ...Array.from(element.querySelectorAll("*"))];

/**
 * 자리의 지금 그림을 떠서 같은 자리에 세운다 — 화면이 제 몸을 걷기 **전에** 부른다(레이아웃 이펙트의 정리). 앞 사본이 있으면 먼저 걷는다.
 * 패널 상자(`aside`)의 접힘이 끝나면 스스로 걷힌다.
 */
export function holdBody(slot: HTMLElement): void {
  dropHeldBody();
  const scrolled: Array<{ at: number; top: number; left: number }>[] = [];
  const copies: ChildNode[] = [];
  for (const node of Array.from(slot.childNodes)) {
    const copy = node.cloneNode(true) as ChildNode;
    if (node.nodeType === ELEMENT) {
      const element = copy as Element;
      element.setAttribute("data-held-body", "");
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
      scrolled.push(
        family(node as Element)
          .map((one, at) => ({ at, top: one.scrollTop, left: one.scrollLeft }))
          .filter(({ top, left }) => top !== 0 || left !== 0),
      );
    } else {
      scrolled.push([]);
    }
    copies.push(copy);
  }
  for (const copy of copies) slot.appendChild(copy);
  copies.forEach((copy, index) => {
    if (scrolled[index].length === 0) return;
    const members = family(copy as Element);
    for (const { at, top, left } of scrolled[index]) {
      members[at].scrollTop = top;
      members[at].scrollLeft = left;
    }
  });
  const mine = { copies };
  held = mine;
  // 접힘은 기둥이 다시 그린 뒤(값이 비고 상자가 `basis-0`이 된 뒤) 시작한다 — 한 프레임 뒤에 상자의 트랜지션을 집는다.
  const box = slot.closest("aside");
  requestAnimationFrame(() => {
    if (held !== mine) return;
    const folding = box?.getAnimations?.() ?? [];
    void Promise.allSettled(folding.map((one) => one.finished)).then(() => {
      if (held === mine) dropHeldBody();
    });
  });
}

/** 남긴 사본을 걷는다 — 작업공간이 다시 섰거나 접힘이 끝났다. 남긴 것이 없으면 아무것도 하지 않는다. */
export function dropHeldBody(): void {
  if (!held) return;
  for (const copy of held.copies) copy.remove();
  held = null;
}
