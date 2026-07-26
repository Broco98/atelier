// scroll-quiet 스크롤바의 노출 트리거 — 스크롤하는 동안만 보이고 멎으면 사라진다.
//
// CSS만으로는 "스크롤 중"을 알 수 없어 클래스로 표시한다. 호버로 대신하지 않는 이유가 둘 있다.
// (1) 정책이 "스크롤하면 생겼다가 일정 시간 뒤 사라진다"이고, 호버는 멎어도 계속 보인다.
// (2) WebKit은 :hover 변화만으로 스크롤바 의사요소 스타일을 다시 계산하지 않는 경우가 있어
//     작업 패널의 스펙 트리에서 막대가 아예 안 나타났다. 클래스 토글은 요소의 스타일을
//     확실히 무효화해 그 경로를 피한다.
//
// scroll은 버블링하지 않으므로 캡처 단계에서 문서 하나로 위임해 받는다 —
// scroll-quiet이 붙은 영역이 몇 개든 리스너는 하나다.

const HIDE_DELAY_MS = 900;

const timers = new WeakMap<Element, number>();

export function installScrollQuiet(): void {
  document.addEventListener(
    "scroll",
    (event) => {
      const el = event.target;
      if (!(el instanceof Element) || !el.classList.contains("scroll-quiet")) return;

      el.classList.add("is-scrolling");

      const pending = timers.get(el);
      if (pending !== undefined) window.clearTimeout(pending);
      timers.set(
        el,
        window.setTimeout(() => {
          el.classList.remove("is-scrolling");
          timers.delete(el);
        }, HIDE_DELAY_MS),
      );
    },
    true,
  );
}
