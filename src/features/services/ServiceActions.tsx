import type { ReactNode, RefObject } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Copy, FilePen, MoreHorizontal, Trash2, type LucideIcon } from "lucide-react";
import { PLACE_ROW_BUTTON } from "@/components/catalog/PlaceList";
import { copyText } from "@/components/shell/copy-text";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useServicesFolder } from "./hooks";
import { serviceFile, serviceName, serviceRowMenu, type ServiceAct } from "./service-view";
import type { Service } from "./types";

// **Service 하나의 ⋯가 하는 일**(restart 03-3 · 스펙 「03 — 목록과 상세」 「파일로 고치기는 ⋯ 메뉴와 경고에서 닿는다」 · 보드 PlaceSheet 「⋯ 메뉴」 ·
// Places `MENUS.services`) — 목록 줄과 상세 머리가 같은 셋을 쓴다.
//   파일로 고치기 ─ 그 Service 파일을 글 그대로 고치는 화면(`/services/$slug/edit`). 상세의 경고 끝 단추도 같은 곳이다
//   경로 복사 ─ 그 Service 파일(`~/.atelier/services/<slug>.md`). 폴더를 아직 못 읽었으면 서지 않는다
//   삭제… ─ 확인 창(`useServiceDelete`)을 거쳐 지우고 「되돌리기」 토스트가 선다. 지우는 길은 화면의 이 메뉴뿐이다(§17)
// 한때(03) ⋯는 「관계 편집 · 삭제…」였다.

/**
 * ⋯ 항목의 글리프(보드 `MENUS.services` — 연필 · 복사 · 지우기). 「파일로 고치기」는 연필 대신 파일 위 연필이다 — 상세 ⋯에서는 「이름 바꾸기」가 연필이라
 * (Project 상세와 같다) 둘이 갈리게 했다. 보드 `ic-trash`는 그림이 깨진다 — 앱의 휴지통을 쓴다(README).
 */
export const SERVICE_ACT_ICONS: Record<ServiceAct, LucideIcon> = { "edit-file": FilePen, "copy-path": Copy, delete: Trash2 };

/** ⋯의 셋을 하는 길 — `onDelete`가 확인 창을 연다. 경로 복사는 폴더를 읽은 뒤에만 고를 수 있다(`canCopy`). */
export function useServiceActs(onDelete: (service: Service) => void) {
  const navigate = useNavigate();
  const { data: folder } = useServicesFolder();
  const act = (service: Service, what: ServiceAct) => {
    if (what === "edit-file") void navigate({ to: "/services/$slug/edit", params: { slug: service.slug } });
    else if (what === "copy-path") {
      if (folder !== undefined) copyText(serviceFile(folder, service.slug));
    } else onDelete(service);
  };
  return { act, canCopy: folder !== undefined };
}

/** 그 메뉴에 설 항목 — 폴더를 못 읽었으면 「경로 복사」를 뺀다. */
export function shownActs<T extends { act: string }>(items: readonly T[], canCopy: boolean): T[] {
  return items.filter((item) => canCopy || item.act !== "copy-path");
}

/**
 * 목록 줄 끝의 ⋯(보드 `.pl-acts .ra-tbtn` — 30) — 줄 아래에서 줄 오른쪽 끝에 맞춰 선다(보드 `.pl-menu` — 줄의 아래 12에 걸친다). 메뉴 카드는 208 폭이고
 * 항목 사이에 구분선 · 빨강이 없다(Projects 줄의 ⋯와 같다).
 */
export function ServiceRowMenu({
  service,
  anchor,
  canCopy,
  onAct,
}: {
  service: Service;
  anchor: RefObject<HTMLDivElement | null>;
  canCopy: boolean;
  onAct: (what: ServiceAct) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={`${serviceName(service)} 메뉴`} className={PLACE_ROW_BUTTON}>
        <MoreHorizontal aria-hidden className="size-3.75" />
      </DropdownMenuTrigger>
      <DropdownMenuContent anchor={anchor} side="bottom" align="end" sideOffset={-12} width="place">
        {shownActs(serviceRowMenu(), canCopy).map((item) => (
          <ActItem key={item.act} icon={SERVICE_ACT_ICONS[item.act]} label={item.label} onClick={() => onAct(item.act)} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ActItem({ icon: Icon, label, onClick }: { icon: LucideIcon; label: ReactNode; onClick: () => void }) {
  return (
    <DropdownMenuItem onClick={onClick}>
      <Icon />
      <span>{label}</span>
    </DropdownMenuItem>
  );
}
