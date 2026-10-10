// 앱 규격으로 고친 자리: 색 이름뿐이다 — 앱에 선례가 없는 부품이라 shadcn 기본을 앱 토큰으로 그린다(결정 12). 글자가 없는 부품이라 글자 크기도 고칠 것이 없다. 색은 Codex 이름이다(codex-ds 결정 27): 꺼진 바탕 bg-input→bg-fill-active(전경 12% — 같은 값), 켜진 바탕 bg-primary→bg-accent-solid(흰 손잡이를 얹는 파랑 면, DS `.at-switch.is-on`), 손잡이 bg-background→bg-surface, 포커스 border-ring · ring-ring/50→Codex 파랑(`border-(--accent)` · `ring-(--accent)/50` — 유틸리티 `accent`는 아직 옅은 면이다), 틀린 값 destructive→danger. registry의 다크 덧칠(`dark:` 색 변형)을 걷었다 — Codex 토큰이 `.dark`에서 다크 값을 든다.
import { Switch as SwitchPrimitive } from "@base-ui/react/switch"
import { cn } from "@/lib/utils"

function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full border border-transparent transition-all outline-none group-has-[:focus-visible]/field-label:border-transparent group-has-[:focus-visible]/field-label:ring-0 after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-(--accent) focus-visible:ring-3 focus-visible:ring-(--accent)/50 aria-invalid:border-danger aria-invalid:ring-3 aria-invalid:ring-danger/20 data-[size=default]:h-[18.4px] data-[size=default]:w-[32px] data-[size=sm]:h-[14px] data-[size=sm]:w-[24px] data-checked:bg-accent-solid data-unchecked:bg-fill-active data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-full bg-surface ring-0 transition-transform group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 group-data-[size=default]/switch:data-checked:translate-x-[calc(100%-2px)] group-data-[size=sm]/switch:data-checked:translate-x-[calc(100%-2px)] group-data-[size=default]/switch:data-unchecked:translate-x-0 group-data-[size=sm]/switch:data-unchecked:translate-x-0"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
