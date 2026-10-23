import { Archive, FolderX } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WorkGone } from "./types";

// 읽기만 된 Thread의 입력창 자리(v1 티켓 38 · 구현 스펙 §11 「보관」 · 스토리 103) — 이은 Work가 보관됐거나 지워진 Thread는 말을 받지
// 않는다(엔진이 거절한다). 그래서 입력창 대신 그 까닭 한 줄이 입력창의 면(r · 면 · 그림자)에 선다. 글은 엔진의 거절 글과 같다.
//
// - 걸린 물음(승인 · 질문 · Work 만들기 카드)이 있으면 그것이 먼저 선다 — 보관된 때 돌던 턴을 사람이 끝낼 수 있게.
// - 그 턴이 도는 동안만 「멈추기」가 선다. 턴이 끝나면 엔진이 Session을 끈다.
// - 캔버스에 이 자리의 그림이 없다 — 입력창의 면과 안내 글(14 · `fg-secondary`)을 따른다.

const TEXT: Record<WorkGone, string> = {
  archived: "보관된 Work의 Thread는 읽기만 돼요",
  removed: "지워진 Work의 Thread는 읽기만 돼요",
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
      className="flex min-h-14 shrink-0 items-center gap-2.5 rounded-composer bg-surface-composer py-2.5 pr-2.5 pl-5 shadow-composer"
    >
      <Icon className="size-4 shrink-0 text-fg-tertiary" aria-hidden />
      <p className="min-w-0 flex-1 text-sm text-fg-secondary">{TEXT[gone]}</p>
      {running && (
        <Button variant="ghost" onClick={onStop}>
          멈추기
        </Button>
      )}
    </div>
  );
}

export default ReadOnlyNotice;
