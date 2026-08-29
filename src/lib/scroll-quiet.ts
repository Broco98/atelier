// 스크롤 막대 — **콘텐츠 위에 떠서 자리를 안 먹는다.** 그리는 것도 우리다.
//
// 왜 우리가 그리는가. 이 엔진(WKWebView)에서는 「폭을 안 먹는 커스텀 막대」가 없다 —
// 실측으로 갈랐다(400px 상자, WebKit):
//
//   ::-webkit-scrollbar { width: 11px }  +  overflow: scroll   → 콘텐츠 389px (11 먹음)
//   ::-webkit-scrollbar { width: 11px }  +  overflow: overlay  → 콘텐츠 389px (overlay가 auto로 계산됨)
//   커스텀 규칙 없음                     +  overflow: auto     → 콘텐츠 400px (네이티브 오버레이)
//
// 즉 갈림길은 둘뿐이다. 커스텀으로 그리면 **늘 폭을 먹고**, 네이티브에 맡기면 폭은 안 먹지만
// 생김새가 macOS 설정("스크롤 막대 항상 표시")과 마우스 연결 여부에 딸린다 — 마우스를 꽂는
// 순간 클래식으로 바뀌어 넘치는 순간 콘텐츠가 통째로 밀린다. 그 밀림이 없애려는 그 사고다.
//
// 그래서 네이티브를 숨기고(index.css의 scroll-quiet) 막대를 여기서 그린다. 설정에도
// 입력기기에도 안 딸리고, 자리도 안 먹는다.
//
// 그리는 자리는 **body 직계의 fixed**다 — PopoverPortal과 같은 이유이자 같은 방법이다.
// 상자 안에 넣으면 그 상자가 위치 기준(relative)이 되어 안쪽 absolute들의 기준 상자가 바뀌고,
// 스크롤 넘침 계산에도 끼어들며, React가 그 상자의 자식을 갈아 끼울 때 우리 노드와 겹친다.
// 밖에 두면 상자는 아무것도 모른다.
//
// 막대는 **문서에 한 쌍**이다. 스코프마다 만들면 그 상자가 언마운트될 때 body에 남은 막대를
// 누가 걷을지가 문제가 되는데, 한 번에 스크롤되는 상자는 포인터 아래 하나라 다시 겨누면
// 충분하다. 두 상자가 동시에 굴러도(한쪽 관성 + 다른 쪽 휠) 최악은 막대가 옮겨 뛰는 것이다.
//
// **잡아 끌 수는 없다**(pointer-events: none). 멎으면 사라지는 막대라 지금도 겨눌 수 없었고,
// 끌기를 살리려면 이 파일이 드래그까지 들어야 한다. 휠·트랙패드·⇧PageUp은 그대로다.
//
// scroll은 버블링하지 않으므로 캡처 단계에서 문서 하나로 위임해 받는다.

// 멎고 사라지기 시작하기까지. 페이드 자체는 CSS의 opacity 트랜지션이 든다.
// 짧다 — 막대는 「지금 구르고 있다」를 말하는 것이라, 멎은 뒤에도 남아 있으면 그 말이 거짓이 된다.
const HIDE_DELAY_MS = 420;
const THICKNESS = 6;
// 상자 안쪽 끝에서 띄우는 거리 — 둥근 모서리 호를 침범하지 않는다.
const EDGE = 3;
// 끝까지 짧아지면 막대가 점이 되어 어디쯤인지를 못 말한다.
const MIN_LENGTH = 28;

let vertical: HTMLDivElement | null = null;
let horizontal: HTMLDivElement | null = null;
let hideTimer = 0;

function bar(axis: "vertical" | "horizontal"): HTMLDivElement {
  const made = document.createElement("div");
  made.dataset.scrollbar = axis;
  document.body.appendChild(made);
  return made;
}

// 한 축의 막대를 상자 안쪽에 앉힌다. 넘치지 않는 축은 숨긴다 —
// 세로만 구르는 상자에 가로 막대가 함께 뜨면 그것이 거짓말이다.
function lay(
  target: HTMLDivElement,
  { view, full, offset, along, across }: {
    view: number;
    full: number;
    offset: number;
    // 막대가 미끄러지는 축의 시작점(화면 좌표)
    along: number;
    // 막대가 놓이는 반대 축의 좌표(화면 좌표) — 상자 안쪽 끝에서 THICKNESS + EDGE 만큼 안이다
    across: number;
  },
  axis: "vertical" | "horizontal",
): void {
  if (full <= view + 1) {
    delete target.dataset.on;
    return;
  }
  const length = Math.max(MIN_LENGTH, (view / full) * view);
  const slid = ((view - length) * offset) / (full - view);
  const x = axis === "vertical" ? across : along + slid;
  const y = axis === "vertical" ? along + slid : across;
  target.style.width = `${axis === "vertical" ? THICKNESS : length}px`;
  target.style.height = `${axis === "vertical" ? length : THICKNESS}px`;
  target.style.transform = `translate(${x}px, ${y}px)`;
  target.dataset.on = "";
}

function show(el: Element): void {
  const box = el.getBoundingClientRect();
  // 테두리 안쪽이 실제로 구르는 상자다 — clientLeft/Top이 그 테두리 두께다.
  const left = box.left + el.clientLeft;
  const top = box.top + el.clientTop;
  const width = el.clientWidth;
  const height = el.clientHeight;

  vertical ??= bar("vertical");
  horizontal ??= bar("horizontal");
  lay(
    vertical,
    {
      view: height,
      full: el.scrollHeight,
      offset: el.scrollTop,
      along: top,
      across: left + width - THICKNESS - EDGE,
    },
    "vertical",
  );
  lay(
    horizontal,
    {
      view: width,
      full: el.scrollWidth,
      offset: el.scrollLeft,
      along: left,
      across: top + height - THICKNESS - EDGE,
    },
    "horizontal",
  );
}

function hide(): void {
  if (vertical) delete vertical.dataset.on;
  if (horizontal) delete horizontal.dataset.on;
}

export function installScrollQuiet(): void {
  document.addEventListener(
    "scroll",
    (event) => {
      const el = event.target;
      if (!(el instanceof Element) || !el.classList.contains("scroll-quiet")) return;
      show(el);
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(hide, HIDE_DELAY_MS);
    },
    true,
  );
}
