import { Archive, FolderX } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WorkGone } from "./types";

// 읽기만 된 Thread의 입력창 자리(v1 티켓 38 · 구현 스펙 §11 「보관」 · 스토리 103) — 이은 Work가 보관됐거나 지워진 Thread는 말을 받지
// 않는다(엔진이 거절한다). 그래서 입력창 자리에 그 까닭 한 줄의 안내가 선다(restart 02b-2 · 시안 Composer 「읽기 전용」 `.ra-notice` — 최소 40 ·
// 둥글기 12 · 옅은 면 `fill-soft` · 안쪽 8 / 8 / 8 / 12 · 13 `fg-secondary` · 글리프 15와 글 사이 8). 글은 엔진의 거절 글과 같다.
//
// - 걸린 물음(승인 · 질문 · Work 만들기 카드)이 있으면 그것이 먼저 선다 — 보관된 때 돌던 턴을 사람이 끝낼 수 있게.
// - 그 턴이 도는 동안만 「멈추기」가 선다. 턴이 끝나면 엔진이 Session을 끈다.

const TEXT: Record<WorkGone, string> = {
  archived: "보관된 작업공간의 채팅은 읽기만 돼요",
  removed: "지워진 작업공간의 채팅은 읽기만 돼요",
};

interface ReadOnlyNoticeProps {
  gone: WorkGone;
  /** 턴이 도는가 — 도는 동안만 멈추기가 선다. */
  running: boolean;
  onStop: () => void;
}

function ReadOnlyNotice({ gone, running, onStop }: ReadOnlyNoticeProps) {
  const Icon = gone === "archived" ? Archive : FolderX;
  return (
    <div
      role="status"
      className="flex min-h-10 shrink-0 items-center gap-2 rounded-xl bg-fill-soft py-2 pr-2 pl-3 text-chat-meta text-fg-secondary"
    >
      <Icon className="size-3.75 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">{TEXT[gone]}</p>
      {running && (
        <Button variant="ghost" onClick={onStop}>
          멈추기
        </Button>
      )}
    </div>
  );
}

export default ReadOnlyNotice;
