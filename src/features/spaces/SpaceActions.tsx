import { useNavigate } from "@tanstack/react-router";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { spaceName } from "./space-view";
import type { Space } from "./types";

/**
 * Space 하나의 ⋯(03 구현 스펙 §14 — 목록 줄 끝 · 상세 머리 「← Space」 줄 오른쪽, 시안 F1-Space `.act` · F1-SpaceDetail `.topbar`) —
 * 「관계 편집」(그 Space 파일을 글 그대로 고치는 화면)과 「삭제…」(확인 창). 지우는 길은 화면의 이 메뉴뿐이다(§17).
 */
export function SpaceActions({ space, onDelete }: { space: Space; onDelete: (space: Space) => void }) {
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${spaceName(space)} 메뉴`}
        className="icon-button text-fg-titlebar transition-colors quiet-hover focus-ring"
      >
        <MoreHorizontal aria-hidden className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={() => void navigate({ to: "/spaces/$slug/edit", params: { slug: space.slug } })}>
          <Pencil />
          <span>관계 편집</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => onDelete(space)}>
          <Trash2 />
          <span>삭제…</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
