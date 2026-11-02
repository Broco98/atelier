import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dropHeldBody, holdBody } from "./held-body";

// **작업공간을 떠나 spec 패널이 접히는 동안 마지막 몸이 그대로 보이고, 접힘이 끝난 뒤 빈다**(restart 02a-14b · 시안 Shell 「규칙」 ·
// Motion 「레일이 들고 난다」). 몸은 작업공간 화면이 그려 기둥의 자리로 보내므로 화면과 함께 내려간다 — 내려가는 그 순간 자리의 그림을
// 떠 두고(사본), 패널 상자의 접힘(트랜지션)이 끝나면 걷는다. seam은 `holdBody` · `dropHeldBody`와 자리(DOM)다. 검사는 DOM이 없어
// 자리를 DOM의 꼴 그대로 흉내 낸다(아래 `Box`). 앱 위의 프레임은 시안 비교가 WebKit에서 잰다.

/** DOM 요소의 꼴 — 이 모듈이 쓰는 만큼만이다. 깊은 복제는 DOM처럼 구른 자리를 옮기지 않는다. */
class Box {
  readonly nodeType = 1;
  readonly attributes = new Map<string, string>();
  readonly childNodes: Box[] = [];
  parent: Box | null = null;
  scrollTop = 0;
  scrollLeft = 0;
  animations: Array<{ finished: Promise<unknown> }> = [];
  constructor(
    readonly tag: string,
    readonly text = "",
  ) {}
  appendChild(child: Box): Box {
    child.remove();
    child.parent = this;
    this.childNodes.push(child);
    return child;
  }
  remove(): void {
    if (!this.parent) return;
    this.parent.childNodes.splice(this.parent.childNodes.indexOf(this), 1);
    this.parent = null;
  }
  cloneNode(deep: boolean): Box {
    const copy = new Box(this.tag, this.text);
    for (const [name, value] of this.attributes) copy.attributes.set(name, value);
    if (deep) for (const child of this.childNodes) copy.appendChild(child.cloneNode(true));
    return copy;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  querySelectorAll(selector: "*"): Box[] {
    expect(selector).toBe("*");
    return this.childNodes.flatMap((child) => [child, ...child.querySelectorAll("*")]);
  }
  closest(tag: string): Box | null {
    let at: Box | null = this;
    while (at && at.tag !== tag) at = at.parent;
    return at;
  }
  getAnimations() {
    return this.animations;
  }
}

/** 기둥의 패널 상자(`aside`) 안 몸의 자리에 작업공간 화면이 그린 몸(spec 패널 — 머리 · 구르는 트리) 하나. */
function standingPanel() {
  const aside = new Box("aside");
  const slot = aside.appendChild(new Box("div"));
  const body = slot.appendChild(new Box("div", "spec"));
  const scroller = body.appendChild(new Box("div"));
  scroller.appendChild(new Box("button", "overview.md"));
  scroller.appendChild(new Box("button", "목업"));
  return { aside, slot, body, scroller };
}

const texts = (slot: Box) => [slot, ...slot.querySelectorAll("*")].map((one) => one.text).filter(Boolean);
const settle = () => new Promise((done) => setTimeout(done, 0));

describe("떠난 화면의 패널 몸을 접힘이 끝날 때까지 남긴다", () => {
  let frames: Array<() => void>;
  const nextFrame = () => frames.splice(0).forEach((frame) => frame());
  const hold = (slot: Box) => holdBody(slot as unknown as HTMLElement);

  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (frame: () => void) => frames.push(frame));
  });
  afterEach(() => {
    dropHeldBody();
    vi.unstubAllGlobals();
  });

  it("화면이 몸을 거둬도 자리에는 같은 그림이 남는다 — 누를 수도 읽을 수도 없다", () => {
    const { slot, body } = standingPanel();
    hold(slot);
    body.remove(); // 화면이 내려가며 React가 제 몸을 걷는다
    expect(texts(slot)).toEqual(["spec", "overview.md", "목업"]);
    const [copy] = slot.childNodes;
    expect(copy).not.toBe(body);
    expect(Object.fromEntries(copy.attributes)).toMatchObject({ "data-held-body": "", inert: "", "aria-hidden": "true" });
  });

  it("구른 자리도 그대로다 — 사본의 트리가 맨 위로 튀지 않는다", () => {
    const { slot, body, scroller } = standingPanel();
    scroller.scrollTop = 120;
    scroller.scrollLeft = 8;
    hold(slot);
    body.remove();
    const copied = slot.childNodes[0].childNodes[0];
    expect([copied.scrollTop, copied.scrollLeft]).toEqual([120, 8]);
  });

  it("패널 상자의 접힘이 끝나면 비운다 — 그 전에는 남아 있다", async () => {
    const { aside, slot, body } = standingPanel();
    let finish = () => {};
    aside.animations = [{ finished: new Promise<void>((done) => (finish = done)) }];
    hold(slot);
    body.remove();
    nextFrame();
    await settle();
    expect(texts(slot)).toEqual(["spec", "overview.md", "목업"]);
    finish();
    await settle();
    expect(slot.childNodes).toEqual([]);
  });

  it("접힘이 끊겨도(되돌린 트랜지션) 비운다", async () => {
    const { aside, slot, body } = standingPanel();
    let cancel = () => {};
    aside.animations = [{ finished: new Promise<void>((_, fail) => (cancel = () => fail(new Error("cancel")))) }];
    hold(slot);
    body.remove();
    nextFrame();
    cancel();
    await settle();
    expect(slot.childNodes).toEqual([]);
  });

  it("움직임이 없으면(동작 줄이기) 다음 프레임에 비운다", async () => {
    const { slot, body } = standingPanel();
    hold(slot);
    body.remove();
    expect(slot.childNodes).toHaveLength(1);
    nextFrame();
    await settle();
    expect(slot.childNodes).toEqual([]);
  });

  it("작업공간이 다시 서면 곧바로 비운다 — 새 몸 곁에 사본이 남지 않고, 늦게 끝난 접힘이 새 몸을 건드리지 않는다", async () => {
    const { aside, slot, body } = standingPanel();
    let finish = () => {};
    aside.animations = [{ finished: new Promise<void>((done) => (finish = done)) }];
    hold(slot);
    body.remove();
    nextFrame();
    const fresh = slot.appendChild(new Box("div", "새 몸"));
    dropHeldBody();
    expect(slot.childNodes).toEqual([fresh]);
    finish();
    await settle();
    expect(slot.childNodes).toEqual([fresh]);
  });

  it("또 남기면 앞 사본은 걷히고 지금 몸만 뜬다 — 자리에 사본은 하나다", () => {
    const { slot, body } = standingPanel();
    hold(slot);
    body.remove();
    const fresh = slot.appendChild(new Box("div", "새 몸"));
    hold(slot);
    fresh.remove();
    expect(texts(slot)).toEqual(["새 몸"]);
    expect(slot.childNodes[0].attributes.has("data-held-body")).toBe(true);
  });
});
