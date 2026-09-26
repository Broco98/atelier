import {
  BookOpen,
  Compass,
  FileText,
  Flag,
  FlaskConical,
  ImageIcon,
  Layers,
  Lightbulb,
  ListChecks,
  NotebookPen,
  Scale,
  Search,
  type LucideIcon,
} from "lucide-react";

// spec 트리의 아이콘 이름 → 그림. **이름을 그림으로 바꾸는 곳은 여기 하나다**(구현 스펙 4절
// 「아이콘」). 엔진은 레이아웃 항목의 `icon`을 해석하지 않고 spec 트리에 그대로 싣는다. 앱은 이
// 표에서 그림을 찾고, 표에 없는 이름은 아이콘 없이 그린다. 편집기에서 아이콘을 고르는 목록도 이
// 표에서 나온다. 적힌 순서가 그 목록의 순서다.
//
// 이름은 lucide의 이름(kebab-case) 그대로다 — 새 말을 짓지 않는다. 정해 둔 열두 개 안팎이고,
// 앞의 다섯이 내장본의 것이다. 이 파일은 Rust 테스트 둘이 읽는다. 내장본의 이름이 모두 여기
// 있는지(`atelier-core`의 `every_builtin_icon_is_in_the_apps_icon_table`), 그리고 에이전트가 받는
// 레이아웃 형식 설명(`atelier-cli`의 `LAYOUT_FORMAT`)이 이 키를 모두, 이 순서대로 적는지
// (`the_format_lists_every_icon_the_app_draws`)다. 그래서 아이콘을 더하거나 이름을 바꾸면 형식
// 설명의 `icon` 줄과 그 기대값 파일(`crates/atelier-cli/tests/expected/spec-layout-format.txt`)도
// 함께 고친다. 두 검사 모두 이 표 안에서 따옴표 친 키로 시작하는 줄을 항목으로 치니, **키는
// 따옴표를 떼지 않고 표는 `} satisfies`로 끝낸다.**
export const SPEC_ICONS = {
  "compass": Compass,
  "layers": Layers,
  "list-checks": ListChecks,
  "search": Search,
  "book-open": BookOpen,
  "file-text": FileText,
  "notebook-pen": NotebookPen,
  "lightbulb": Lightbulb,
  "flask-conical": FlaskConical,
  "scale": Scale,
  "image": ImageIcon,
  "flag": Flag,
} satisfies Record<string, LucideIcon>;

export type SpecIconName = keyof typeof SPEC_ICONS;

/**
 * 아이콘 이름의 그림. 이름이 없거나 표에 없으면 `null`이다 — 그 자리는 아이콘 없이 그린다.
 *
 * 표를 제 키로만 찾는다. 객체 리터럴이라 `"constructor"` 같은 이름으로 찾으면 프로토타입의 것이
 * 나온다 — 레이아웃의 `icon`은 사람이 적는 글자라 그런 이름이 올 수 있다.
 */
export function specIconOf(name: string | null): LucideIcon | null {
  if (name === null || !Object.prototype.hasOwnProperty.call(SPEC_ICONS, name)) return null;
  return SPEC_ICONS[name as SpecIconName];
}
