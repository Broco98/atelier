import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { useSearchHits } from "./hooks";
import { hitTarget } from "./hit-target";
import type { SearchHit } from "./types";

/**
 * ⇧⇧로 여는 검색 팔레트.
 *
 * **떠 있는 표면의 규격은 확인 창(`AppDialog`)의 것을 그대로 쓴다** — `rounded-[13px]` ·
 * `border-border-strong` · `bg-background` · `shadow-lg`. 이 저장소의 떠 있는 것들이 같은
 * 반지름·테두리·그림자를 쓰고 있어 새 어휘를 들일 이유가 없다.
 *
 * **터미널 스토어를 import하지 않는다.** 하면 `@xterm/*`와 그 CSS가 따라 들어와 이 파일의
 * 정적 마크업 검사가 서지 못한다(SearchPalette.test.tsx가 그 계약을 센다) — 사이드바 목록이
 * 같은 이유로 셸 개수를 슬롯으로 받는 그 자리와 같다.
 *
 * 치면 좁혀진다. **맞추는 규칙은 코어에 있다**(결정 15) — 여기는 친 것을 그대로 넘기고 받은
 * 것을 순서대로 그린다. 본문 층은 판 02다.
 */

/**
 * 그려지는 것 전부. **상태와 콜백만 받는다** — 이 조각이 정적 마크업 seam에서 재는 것이다.
 */
export function SearchList({
  query,
  hits,
  truncated,
  selected,
  onQuery,
  onGo,
  onClose,
}: {
  query: string;
  hits: SearchHit[];
  /** 상한에 걸려 못 나온 줄이 있는가. **코어가 말해 준다** — 줄 수로는 못 가른다. */
  truncated: boolean;
  /** 지금 골라진 줄. 목록이 비면 아무 줄도 안 골라진다(`-1`). */
  selected: number;
  onQuery: (query: string) => void;
  onGo: (hit: SearchHit) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // **포커스를 빌렸다가 돌려준다.** 입력칸이 생기면서 팔레트를 열 때마다 포커스가 셸을 떠나는데,
  // 안 돌려주면 Esc 뒤에 친 글자가 아무 데도 안 들어간다. `autoFocus` 대신 여기서 옮기는 것은
  // **순서 때문이다** — 그 속성은 커밋 중에 먹어서, 이 효과가 도는 시점에는 「어디 있었나」가
  // 이미 입력칸으로 덮여 있다.
  useEffect(() => {
    const before = document.activeElement;
    inputRef.current?.focus();
    return () => {
      if (before instanceof HTMLElement) before.focus();
    };
  }, []);

  // 방향키로 목록 밖까지 내려가면 골라진 줄이 화면에서 사라진다 — 훑는 것이 고르는 것보다
  // 비싸지 않아야 한다는 것이 프리뷰를 없앤 이유였다(결정 6). 골라진 줄은 **표시**로 찾는다:
  // 자리로 세면 목록이 갈릴 때마다 두 자리가 어긋난다.
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <div
      // 바깥을 눌러도 닫힌다 — 확인 창과 같은 규칙이고, 여는 것 말고는 아무 일도 안 하는
      // 표면이라 닫는 데 잃는 것이 없다.
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center bg-background/55 p-8 pt-[12vh] backdrop-blur-[2px]"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[60vh] w-[560px] max-w-full flex-col overflow-hidden rounded-[13px] border border-border-strong bg-background shadow-lg"
      >
        {/* **디바운스가 없다**(결정 29). 글자 하나마다 그대로 물어본다 — 실측 10~20ms짜리
            일에 지연을 얹으면 「치는 동안 즉시 따라온다」를 스스로 깨는 것이다. */}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          aria-label="검색어"
          placeholder="이름으로 좁히기"
          // 팔레트에 제목이 없다(결정 17) — 이 칸이 첫 줄이라 아래 목록과 선 하나로 갈린다.
          className="shrink-0 border-b border-border px-3.5 py-2.5 text-[13px] outline-none placeholder:text-muted-foreground"
        />
        <div
          ref={listRef}
          role="listbox"
          aria-label="검색 결과"
          // 구르는 상자는 저장소 공통 막대를 쓴다(결정 32) — 한 자리만 다른 막대를 쓰면
          // 그 자리에서 폭이 달라지고, 화면에는 「목록이 밀렸다」로 보인다.
          className="flex min-h-0 flex-col gap-px overflow-y-auto p-1.5 scroll-quiet"
        >
          {hits.map((hit, at) => (
            <button
              key={`${hit.slug}/${hit.path}`}
              type="button"
              role="option"
              // 줄을 집는 표식. 모양(클래스 문자열)으로 가르면 규격을 손보는 날 검사가 샌다.
              data-row=""
              aria-selected={at === selected}
              onClick={() => onGo(hit)}
              className={cn(
                "flex shrink-0 items-baseline gap-2 rounded-[8px] px-2.5 py-1.5 text-left",
                at === selected ? "bg-state-2" : "hover:bg-state-1",
              )}
            >
              {/* work 제목과 경로가 **함께** 선다(결정 12) — `overview.md`가 29개라
                  파일명만으로는 어느 것인지 못 고른다. 맞추는 재료도 이 둘이라, 왜 떴는지가
                  줄 안에서 설명된다. */}
              <span className="shrink-0 text-[13px] tracking-[-0.01em]">{hit.title}</span>
              <span className="truncate text-[12px] text-tertiary">{hit.path}</span>
              {/* 아카이브는 **가는 화면이 다르다** — 고르기 전에 그것을 알아야 한다. */}
              {hit.archived && (
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">아카이브</span>
              )}
            </button>
          ))}
          {/* 빈 목록은 **아무 말도 안 하면 고장과 구별되지 않는다.** 줄이 아니므로 방향키가
              여기 서지 않는다(`role="option"`이 없다). */}
          {hits.length === 0 && (
            <p data-note="" className="px-2.5 py-1.5 text-[13px] text-muted-foreground">
              맞는 것이 없습니다
            </p>
          )}
        </div>
        {/* 결정 24. **「더 보기」는 안 만든다** — 걸리면 좁히는 것이 답이고, 목록은 걸렸다는
            것만 말한다. 목록 밖에 두는 것은 구르는 상자 안이면 끝까지 내려야 보이기 때문이다. */}
        {truncated && (
          <p
            data-note=""
            className="shrink-0 border-t border-border px-3.5 py-2 text-[11px] text-muted-foreground"
          >
            20개까지만 보입니다 — 더 치면 좁혀집니다
          </p>
        )}
      </div>
    </div>
  );
}

/** 친 것을 들고 목록을 물어 오고 키를 듣는 자리. 그리는 일은 위가 한다. */
function SearchPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const { data } = useSearchHits(query);
  const hits = data?.hits ?? [];
  const [selected, setSelected] = useState(0);
  // 목록이 뒤늦게 오거나 짧아져도 고른 자리가 목록 밖으로 나가지 않는다.
  const at = hits.length === 0 ? -1 : Math.min(selected, hits.length - 1);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const handled = () => {
        event.preventDefault();
        event.stopPropagation();
      };
      if (event.key === "Escape") {
        handled();
        onClose();
      } else if (event.key === "ArrowDown") {
        handled();
        setSelected(Math.min(at + 1, hits.length - 1));
      } else if (event.key === "ArrowUp") {
        handled();
        setSelected(Math.max(at - 1, 0));
      } else if (event.key === "Enter" && at >= 0) {
        handled();
        onClose();
        void navigate(hitTarget(hits[at]));
      }
    };
    // **캡처로 듣는다.** 셸에 포커스가 있는 채로 열렸으면 xterm의 키 핸들러가 먼저 보는
    // 자리라, 버블에서 기다리면 방향키가 셸로 들어간 뒤다(`AppDialog`가 Esc를 같은 이유로
    // 캡처에서 듣는다). 글자 키는 안 잡는다 — 포커스가 입력칸에 있으므로 그리로 간다.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [at, hits, navigate, onClose]);

  return (
    <SearchList
      query={query}
      hits={hits}
      truncated={data?.truncated ?? false}
      selected={at}
      onQuery={(next) => {
        setQuery(next);
        // 좁히면 **맨 위로 돌아간다.** 자리를 그대로 두면 방금 친 글자가 만든 목록에서
        // 엉뚱한 줄이 골라진 채로 Enter를 기다린다.
        setSelected(0);
      }}
      onClose={onClose}
      onGo={(hit) => {
        onClose();
        void navigate(hitTarget(hit));
      }}
    />
  );
}

export default SearchPalette;
