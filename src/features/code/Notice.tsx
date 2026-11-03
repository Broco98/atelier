import type { LucideIcon } from "lucide-react";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";

/**
 * 가운데 안내 — 제목과 까닭 한 줄. 큰 빈 화면 부품(`Empty`)을 그대로 쓴다. 파일 탭의 몸(`CodeView`)과 넓힌 카드의 변경 보기(`WideDiff`)가
 * 함께 쓴다 — 이 모듈은 강조 라이브러리를 부르지 않아 넓힌 카드가 코드 보기 청크 없이 들인다(`code-view-chunk.test.ts`).
 */
export function Notice({ icon: Icon, title, detail }: { icon: LucideIcon; title: string; detail: string }) {
  return (
    <ScrollBox className="items-center justify-center p-10">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Icon />
          </EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{detail}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </ScrollBox>
  );
}

/**
 * 그림 · 안내의 스크롤 상자 — 카드의 직계 flex 자식이라 남는 높이를 받고, 좁은 카드에서 넘치면 이 상자가 돈다. 강조된 코드는
 * 제 가상화 틀이 이 자리다(`HighlightedCode`).
 */
export function ScrollBox({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto scroll-quiet">
      <div className={cn("flex min-h-full min-w-0 flex-col", className)}>{children}</div>
    </div>
  );
}
