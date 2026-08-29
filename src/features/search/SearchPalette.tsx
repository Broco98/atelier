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
 * 입력칸은 아직 없다. 지금 서는 것은 「최근 고쳐진 문서」뿐이고, 치면서 좁히는 것은 다음
 * 판이 이 위에 얹는다.
 */

/**
 * 줄들 자체. **상태와 콜백만 받는다** — 이 조각이 정적 마크업 seam에서 재는 것 전부다.
 */
export function SearchList({
  hits,
  selected,
  onGo,
  onClose,
}: {
  hits: SearchHit[];
  /** 지금 골라진 줄. 목록이 비면 아무 줄도 안 골라진다(`-1`). */
  selected: number;
  onGo: (hit: SearchHit) => void;
  onClose: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

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
                  파일명만으로는 어느 것인지 못 고른다. */}
              <span className="shrink-0 text-[13px] tracking-[-0.01em]">{hit.title}</span>
              <span className="truncate text-[12px] text-tertiary">{hit.path}</span>
              {/* 아카이브는 **가는 화면이 다르다** — 고르기 전에 그것을 알아야 한다. */}
              {hit.archived && (
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">아카이브</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 목록을 물어 오고 키를 듣는 자리. 그리는 일은 위가 한다. */
function SearchPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { data: hits = [] } = useSearchHits();
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
    // 캡처에서 듣는다).
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [at, hits, navigate, onClose]);

  return (
    <SearchList
      hits={hits}
      selected={at}
      onClose={onClose}
      onGo={(hit) => {
        onClose();
        void navigate(hitTarget(hit));
      }}
    />
  );
}

export default SearchPalette;
