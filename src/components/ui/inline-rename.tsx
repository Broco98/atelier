import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { imeHolds } from "@/lib/ime";
import { cn } from "@/lib/utils";

// **제자리 이름 바꾸기**(codex-ds 스펙 §9 · 결정 18). 이름이 쓰인 자리가 그대로 입력칸이 된다 — 부르는 쪽이 이름 글자를 빼고 이것을
// 그 자리에 세우며, 글자 단계와 자리(안쪽)는 `className`으로 그 이름의 것을 건넨다. 테두리는 포커스 링이다(`focus-ring` — 글
// 입력칸은 어떻게 포커스되든 `:focus-visible`이라 서 있는 동안 늘 선다. DS `.at-wtitle.is-edit`의 옅은 파랑 고리 대신 앱의 링이다
// — 결정 11).
//
// 폭은 그 이름이 선 꼴을 따른다(`fit`).
// - `fill` — 이름이 선 칸의 남는 폭이다(`flex-1`). 사이드바 행 · 목록 행처럼 이름이 원래 행 폭을 다 쓰는 자리다. 고치는 동안
//   글자가 길어져도 칸이 춤추지 않는다.
// - `text` — 이름 글자만큼이다. 머리 카드처럼 이름이 제 글자 폭으로 서는 자리다(DS `.at-wtitle` — 고치는 꼴 `.is-edit`도 글자 폭
//   `flex: 0 1 auto`를 그대로 둔다). 재지 않는다: 같은 글자를 든 보이지 않는 짝과 입력칸을 한 grid 칸에 겹쳐, 칸의 폭은 짝이 정하고
//   입력칸은 그 폭을 채운다. 짝 끝에 빈칸 하나를 더 두어 끝에 선 커서가 글자를 밀지 않는다. 칸이 줄면(긴 이름) 함께 준다(`min-w-0`).
//   테두리 · 바탕 · 자리는 그 칸이 든다(`focus-ring`은 바로 안 입력칸의 포커스에도 선다).
//
// 규칙은 한 벌이다.
// - **들어가면 이름 전체가 골라진다**(`autoFocus` + 처음 포커스 때 `select()`) — 곧바로 새 이름을 치면 옛 이름을 갈아 쓴다. 다시
//   받는 포커스(메뉴에서 돌아옴)는 다시 고르지 않는다 — 사람이 그 사이 만든 고름이 남는다.
// - **손대기 전에는 지금 이름을 따른다.** 고치는 동안 바깥(에이전트의 MCP · 다른 창)이 이름을 바꾸면 손대지 않은 입력칸은 새 이름을
//   든다 — 다시 전부 골라진 채다. 손대지 않은 채 끝내면 아무것도 부르지 않는다: 옛 이름을 쥔 칸이 「다른 곳 = 저장」으로 닫혀 바깥이
//   바꾼 이름을 말없이 되돌리지 않는다. 한 글자라도 친 뒤에는 친 글자가 앞선다.
// - **Enter · 다른 곳 누르기는 저장, Esc는 취소다.** 다른 곳은 blur로 듣는다. 둘 다 끝낸 뒤 고치기를 접는 것(`onDone`)은 부르는 쪽이다.
// - **메뉴 카드로 간 포커스는 「다른 곳」이 아니다.** 입력칸의 우클릭 · ⇧F10은 편집 메뉴를 열고(`EditMenu`) 그 카드가 포커스를
//   쥔다 — 그 blur로 끝내면 메뉴가 사라진 칸을 고친다. 그래서 포커스가 메뉴(`[role="menu"]`)로 가면 기다린다: 메뉴가 닫히며
//   포커스가 칸으로 돌아오면(편집 메뉴의 `finalFocus`) 이어 고치고, 메뉴에서 칸이 아닌 곳으로 가면 그때 저장한다.
// - **입력칸이 blur 없이 내려가도 저장이다.** 키로 화면이 바뀌면(⌘, · ⌘J) 고치던 이름 자리가 포커스를 쥔 채 걷히는데, React는 커밋
//   중의 언마운트로 생긴 blur를 `onBlur`로 넘기지 않는다. 그 내려감도 「다른 곳으로 갔다」라 마지막 그림의 값으로 저장하고
//   `onDone`을 부른다 — 대상은 그때 고치던 것이다(마지막 그림의 `onCommit`). 고치던 행이 바깥에서 사라진 때도 같다(MCP 아카이브 ·
//   지우기 — 그대로면 부르지 않고 고치기만 접는다). StrictMode가 붙였다 떼었다 다시 붙이는 것은 내려감이 아니다 — 뗀 다음 마이크로
//   태스크에서 다시 붙었는지를 본다.
// - **비움의 뜻은 부르는 쪽이 정한다**(`emptyMeans`, 구현 노트 Q8). work · 프로젝트는 「원래 이름」(`revert` — 아무것도 부르지 않는다),
//   셸 탭은 「붙인 이름을 지운다」(`clear` — 빈 이름으로 부른다, 스펙 S7). 앞뒤 빈칸은 늘 걷는다.
// - **이름이 그대로면 아무것도 부르지 않는다.** 「그대로」는 저장된 이름과 견준다(`saved` — 없으면 보이는 이름 `value`). 보이는 이름이
//   저장된 이름이 아닐 수 있는 자리가 그것을 준다 — 셸 탭은 붙인 이름이 없으면 OSC 타이틀 · 셸 이름이 보이는데, 그 글자를 손수 다시
//   쳐서 저장한 것도 사람이 고른 이름이라 붙어야 다음 타이틀에 안 덮인다(스펙 S7). 손대지 않은 채 끝낸 것은 여전히 부르지 않는다(위).
// - **키로 끝내면 포커스가 이름으로 돌아간다**(`returnFocus`) — 입력칸이 사라지는 자리에 포커스가 남으면 문서 몸으로 떨어진다. 다른 곳을
//   눌러 끝낸 때는 그 자리가 포커스를 가져갔으니 돌려주지 않는다. 이름 요소는 입력칸이 사라진 뒤에야 다시 서므로 다음 그림에서 찾는다.
// - **입력칸 안의 누름 · 키는 둘레로 올라가지 않는다.** 사이드바 행은 누르면 열고 끌면 옮기며, 화면은 window에서 Enter · Esc를 듣는다
//   (떠 있는 창 닫기 · 셸 키). 입력칸의 Enter · Esc는 여기서 끝난다.
// - **입력기가 쥔 키는 끝내는 키가 아니다**(`imeHolds`) — 한글 조합 중의 Enter는 조합을 끝내는 키라 저장으로 읽으면 마지막 글자가 빠진
//   이름이 저장되고, 조합 중의 Esc는 조합을 거두는 키다. WKWebView는 그 키를 `isComposing` 없이 keyCode 229로 주기도 해 둘을 함께 본다.
//
// 끝은 한 번뿐이다(`finished`). Enter로 끝내 입력칸이 사라질 때 따라오는 blur가 한 번 더 저장하지 않는다.
export function InlineRename({
  value,
  saved,
  label,
  emptyMeans,
  fit,
  onCommit,
  onDone,
  returnFocus,
  className,
}: {
  /** 지금 이름. 고치기는 이 글자에서 시작하고, 손대기 전에는 이것을 따르며, `saved`가 없으면 「그대로」도 이것과 견준다. */
  value: string;
  /** 저장된 이름 — 「그대로」는 이것과 견준다(머리말). 보이는 이름이 다른 갈래에서 올 수 있는 자리가 준다. 없으면 `value`다. */
  saved?: string;
  /** 입력칸의 이름(`aria-label`) — 무엇의 이름인가(「작업 이름」 · 「프로젝트 이름」). */
  label: string;
  /** 비운 채 저장할 때의 뜻 — `revert`는 원래 이름(부르지 않는다), `clear`는 빈 이름으로 부른다. */
  emptyMeans: "revert" | "clear";
  /** 폭 — `fill`은 이름이 선 칸의 남는 폭, `text`는 이름 글자만큼(머리말). */
  fit: "fill" | "text";
  /** 바뀐 이름(앞뒤 빈칸을 걷은 것)으로 부른다. 그대로 · 손대지 않음 · `revert`로 비운 때는 부르지 않는다. */
  onCommit: (name: string) => void;
  /** 저장이든 취소든 고치기가 끝났다 — 부르는 쪽이 입력칸을 걷는다. */
  onDone: () => void;
  /** 키(Enter · Esc)로 끝낸 뒤 포커스를 받을 요소 — 입력칸이 걷힌 다음 그림에서 부른다. */
  returnFocus?: () => HTMLElement | null | undefined;
  /** 그 이름의 글자 단계와 자리 — 입력칸 글자가 이름 글자와 같은 자리에 선다. `text`면 칸(입력칸과 짝을 든 상자)에 단다. */
  className?: string;
}) {
  // 친 글자. 손대기 전에는 없다 — 그동안 보이는 글자는 지금 이름이다(머리말).
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  const field = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const mounted = useRef(false);
  // 마지막 그림의 값 — blur 없이 내려간 뒤 끝내는 데 쓴다(머리말). 그림마다 커밋 뒤에 옮겨 둔다.
  const kept = saved ?? value;
  const last = useRef({ draft, kept, emptyMeans, onCommit, onDone });
  useLayoutEffect(() => {
    last.current = { draft, kept, emptyMeans, onCommit, onDone };
  });

  // 손대기 전에 이름이 바뀌면 새 이름을 다시 전부 고른다 — 바뀐 글자 끝으로 커서가 가면 곧바로 친 글자가 새 이름 뒤에 붙는다.
  // 이름이 바뀔 때만 본다(친 글자가 생기는 것은 고를 까닭이 아니다). 손댔는지는 그 그림의 `draft`로 읽는다.
  useEffect(() => {
    const el = field.current;
    if (last.current.draft === null && el !== null && document.activeElement === el) el.select();
  }, [value]);

  // 그림 밖에서 「다른 곳으로 갔다」로 끝낸다 — 마지막 그림의 값으로 저장하고 끝을 알린다. ref만 읽어 어느 그림의 것을 불러도 같다.
  const finishOutside = () => {
    if (finished.current) return;
    finished.current = true;
    const { draft, kept, emptyMeans, onCommit, onDone } = last.current;
    commitIfChanged(draft, kept, emptyMeans, onCommit);
    onDone();
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => {
        if (!mounted.current) finishOutside();
      });
    };
  }, []);

  // 처음 들어섰나 — 전부 고름은 그때 한 번이다. 메뉴에서 돌아온 포커스는 그 사이의 고름을 그대로 둔다(머리말).
  const entered = useRef(false);
  // 포커스가 메뉴 카드에 가 있나(머리말). 그 사이 포커스가 칸도 메뉴도 아닌 곳에 서면 그때 「다른 곳」으로 끝낸다.
  const inMenu = useRef(false);
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      if (!inMenu.current || event.target === field.current || isMenu(event.target)) return;
      inMenu.current = false;
      finishOutside();
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  const finish = (save: boolean, byKey: boolean) => {
    if (finished.current) return;
    finished.current = true;
    if (save) commitIfChanged(draft, kept, emptyMeans, onCommit);
    onDone();
    if (byKey) requestAnimationFrame(() => returnFocus?.()?.focus());
  };

  const input = (
    <input
      ref={field}
      // 고치기에 들어선 순간이 곧 이 입력칸이 서는 순간이라, 서자마자 포커스를 받는다(머리말).
      autoFocus
      aria-label={label}
      value={shown}
      size={fit === "text" ? 1 : undefined}
      spellCheck={false}
      autoComplete="off"
      onChange={(event) => setDraft(event.target.value)}
      onFocus={(event) => {
        inMenu.current = false;
        if (entered.current) return;
        entered.current = true;
        event.currentTarget.select();
      }}
      onBlur={(event) => {
        if (isMenu(event.relatedTarget)) inMenu.current = true;
        else finish(true, false);
      }}
      onKeyDown={(event) => {
        if (imeHolds(event.nativeEvent)) return;
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          finish(true, true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          finish(false, true);
        }
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      className={
        fit === "fill"
          ? cn("min-w-0 flex-1 rounded-md bg-surface outline-none focus-ring", className)
          : "col-start-1 row-start-1 h-full w-full min-w-0 bg-transparent outline-none"
      }
    />
  );
  if (fit === "fill") return input;
  return (
    <span className={cn("grid min-w-0 rounded-md bg-surface focus-ring", className)}>
      {/* 칸의 폭을 정하는 짝 — 보이지도 읽히지도 않는다. 끝의 빈칸은 커서 자리다(머리말). */}
      <span aria-hidden className="invisible col-start-1 row-start-1 min-w-0 overflow-hidden whitespace-pre">
        {`${shown} `}
      </span>
      {input}
    </span>
  );
}

/** 메뉴 카드(또는 그 안의 줄)인가 — 입력칸의 포커스가 그리로 가면 고치기를 접지 않는다(머리말). */
function isMenu(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[role="menu"]') !== null;
}

/** 저장할 이름이면 부른다 — 손대지 않음 · 그대로(저장된 이름 `kept`와 같음) · `revert`로 비운 이름은 부르지 않는다(머리말). */
function commitIfChanged(
  draft: string | null,
  kept: string,
  emptyMeans: "revert" | "clear",
  onCommit: (name: string) => void,
) {
  if (draft === null) return;
  const next = draft.trim();
  if (next !== kept && (next !== "" || emptyMeans === "clear")) onCommit(next);
}
