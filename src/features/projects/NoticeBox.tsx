import { Book, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * **안내 상자**(03 구현 스펙 §16 · 시안 `.ntc`) — 경고는 노랑 · 세모, 알림은 파랑 · 저장소 글리프. 굵지 않은 첫 줄과 흐린 둘째 줄, 단추가 있으면
 * 오른쪽 가운데에 선다. Project 추가 창의 폴더 갈래(「git 저장소가 아니에요」 …)와 Project 상세의 「Project를 찾을 수 없어요」가 함께 쓴다(03 코드
 * 리뷰 D1 — 두 곳이 옮겨 적었다). 자리(폭 · 위 여백)는 쓰는 쪽이 `className`으로 준다.
 */
export function NoticeBox({
  tone,
  title,
  body,
  action,
  className,
}: {
  tone: "warn" | "info";
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}) {
  const warn = tone === "warn";
  const Icon = warn ? TriangleAlert : Book;
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-2 rounded-lg px-3 py-2.5 text-chat-meta break-keep",
        warn ? "bg-notice-warn text-fg-notice-warn" : "bg-notice-info text-fg-notice-info",
        className,
      )}
    >
      <Icon className={cn("mt-0.5 size-3.5 shrink-0", warn ? "text-fg-notice-warn-icon" : "text-accent-solid")} aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span>{title}</span>
        <span className="text-fg-secondary">{body}</span>
      </span>
      {action && (
        <Button variant="outline" size="xs" className="shrink-0 self-center rounded-full bg-surface text-chat-meta text-fg" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
