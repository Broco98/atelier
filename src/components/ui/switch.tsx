// 앱 규격으로 고친 자리: 앱에 선례가 없는 부품이라 shadcn 기본을 앱 토큰으로 그린다(결정 12). 글자가 없는 부품이라 글자 크기도 고칠 것이 없다. 색과 모양은 Codex `Toggle`의 스위치다(codex-ds 결정 27 · DS `.at-switch`): 32×18 알약 · 테두리 없음, 꺼진 바탕 bg-input→bg-fill-active(전경 12% — 같은 값), 켜진 바탕 bg-primary→bg-accent-solid(흰 손잡이를 얹는 파랑 면), 손잡이는 14 원 · 안쪽 2 · 흰 조각 bg-fg-on-solid(DS `#ffffff` — 다크에서도 희다) · 그림자 `shadow-raised`(0.5px 링 + `shadow-200`), 켜면 14만큼 옮긴다, 바탕 · 손잡이의 전환은 Codex 기본(`duration-basic` · `ease-default`). 작은 크기(sm)는 같은 비례로 24×14 · 손잡이 10이다. 포커스는 앱의 한 링(`focus-ring` — codex-ds 결정 11)이고 registry의 border-ring · ring-ring/50과 틀린 값(aria-invalid)의 빨간 링, 고르는 카드(FieldLabel) 안에서 링을 끄던 갈래를 걷었다. registry의 다크 덧칠(`dark:` 색 변형)을 걷었다 — Codex 토큰이 `.dark`에서 다크 값을 든다.
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
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full p-0.5 transition-colors outline-none focus-ring after:absolute after:-inset-x-3 after:-inset-y-2 data-[size=default]:h-4.5 data-[size=default]:w-8 data-[size=sm]:h-3.5 data-[size=sm]:w-6 data-checked:bg-accent-solid data-unchecked:bg-fill-active data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-full bg-fg-on-solid shadow-raised transition-transform group-data-[size=default]/switch:size-3.5 group-data-[size=sm]/switch:size-2.5 group-data-[size=default]/switch:data-checked:translate-x-3.5 group-data-[size=sm]/switch:data-checked:translate-x-2.5 data-unchecked:translate-x-0"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
