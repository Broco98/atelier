import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * 대화 속 카드의 글자 단추(ChatCards · Cards 보드 `.ra-opt` · restart 02b-6) — PR 카드의 「변경 사항 보기」 · 「GitHub에서 열기 ↗」 · 「고쳐 달라고
 * 하기」, 결과 카드의 「열기」가 쓴다. 28 알약 · 좌우 12 · 13 / 18 · 400 글자에 안쪽 1 `border-heavy` 링이고 가리키면 `fill-soft`다(`Button`의
 * outline). 글자색은 놓인 자리를 따르고(PR 카드의 실패 칸에서는 `fg-secondary`), 끝 글리프(부르는 자리가 단다)는 12 · 4 사이 · `fg-tertiary`다.
 * 꺼지면 50%다.
 */
export function OptionButton({ className, ...props }: Omit<ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <Button
      variant="outline"
      className={cn(
        "h-7 gap-1 rounded-full px-3 font-normal text-inherit disabled:opacity-50 has-data-[icon=inline-end]:pr-3",
        className,
      )}
      {...props}
    />
  );
}
