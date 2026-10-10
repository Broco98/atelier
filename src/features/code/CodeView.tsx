import { FileWarning, FileX, FolderX, Link2Off, type LucideIcon } from "lucide-react";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import type { CodeTarget } from "@/features/terminal/shell-registry";
import { codeRefOf } from "@/routes/-work-search";
import { HighlightedCode } from "./HighlightedCode";
import { useCodeFile } from "./hooks";
import type { WorktreeFile } from "./types";

/**
 * **코드 카드의 몸**(git-integration 판 01 — 파일 탭의 본문). 카드와 그 머리(`<프로젝트> › 폴더 › 파일` · 경로 복사)는 화면
 * (`WorksPage`)이 세우고, 이것은 카드 안에서 도는 스크롤 상자 하나를 낸다 — 문서 카드의 몸(`SpecViewer`)과 같은 나눔이다.
 * 상자는 갈래마다 제 것을 든다: 텍스트는 강조된 코드의 가상화 틀이 곧 스크롤 상자이고(`HighlightedCode`), 안내는 가운데
 * 서는 상자다(`Notice`). 어느 쪽이든 **카드의 직계 flex 자식**이어야 남는 높이를 차지한다(`SpecViewer`의 그 상자와 같은 이유).
 *
 * 텍스트는 강조된 코드다(티켓 08). 그 밖의 답은 **탭 안의 안내**다: 파일이 없다고 spec으로 조용히 돌아가지 않고 무엇이
 * 없는지를 말한다(스토리 61 · 82).
 *
 * **이 모듈은 따로 떼어 받는다**(결정 35) — 화면이 `lazy`로 부르고, 강조 라이브러리(`@pierre/diffs`)는 이 모듈 아래에서만
 * 들어온다. 그래서 첫 로드에 붙지 않고 파일 탭이 처음 설 때 받는다(`code-view-chunk.test.ts`가 프로덕션 빌드로 잰다).
 */
function CodeView({ slug, target, wide }: { slug: string; target: CodeTarget; wide: boolean }) {
  const { data, error } = useCodeFile(slug, target.project, target.path);
  // 코어가 거절한 주소(`..` · 절대 경로)다 — 답의 갈래가 아니라 실패로 온다.
  if (error) return <Notice icon={FileWarning} title="읽지 못한 파일" detail={String(error)} />;
  return data ? <FileBody file={data} target={target} wide={wide} /> : null;
}

/**
 * 답의 갈래 하나가 몸 하나로 간다. **`switch`인 것이 계약이다** — 코어가 갈래를 더하면(09의 이미지 · 바이너리 · 너무 큼)
 * 여기가 컴파일에서 깨진다. 마지막을 `else`로 두면 새 갈래가 조용히 한 안내로 떨어진다(`SpecViewer`의 `bodyView`와 같다).
 */
function FileBody({ file, target, wide }: { file: WorktreeFile; target: CodeTarget; wide: boolean }) {
  switch (file.kind) {
    case "text":
      // 파일마다 새 보기다 — 같은 보기에 다른 파일을 넣으면 라이브러리가 그 파일의 강조가 올 때까지 앞 파일을 그리고, 스크롤
      // 자리도 앞 파일의 것이 남는다. 같은 파일의 새 내용은 키가 같아 같은 보기에 들어간다(G6).
      return <HighlightedCode key={codeRefOf(target)} path={target.path} content={file.content} wide={wide} />;
    case "missing":
      // 열린 탭의 파일이 지워져도 탭은 남는다 — 닫는 것은 사람이다(결정 「묻지 않고 둔 기본값」).
      return <Notice icon={FileX} title="지워진 파일" detail="워크트리에 이 파일이 없어요." />;
    case "worktreeMissing":
      return <Notice icon={FolderX} title="워크트리 없음" detail={`이 작업에 ${target.project} 워크트리가 없어요.`} />;
    case "outsideLink":
      // 코어가 그 대상을 읽지 않았다(스토리 78) — 어디를 가리키는지만 말한다.
      return (
        <Notice
          icon={Link2Off}
          title="바깥을 가리키는 링크"
          detail={`워크트리 밖(${file.target})을 가리켜 읽지 않아요.`}
        />
      );
    case "unreadable":
      return <Notice icon={FileWarning} title="읽지 못한 파일" detail={file.reason} />;
    default: {
      const unhandled: never = file;
      return unhandled;
    }
  }
}

/** 가운데 안내 — 제목과 까닭 한 줄. 큰 빈 화면 부품(`Empty`)을 그대로 쓴다. 좁은 카드에서 넘치면 이 상자가 스크롤한다. */
function Notice({ icon: Icon, title, detail }: { icon: LucideIcon; title: string; detail: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto scroll-quiet">
      <div className="flex min-h-full min-w-0 flex-col items-center justify-center p-10">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon strokeWidth={1.6} />
            </EmptyMedia>
            <EmptyTitle>{title}</EmptyTitle>
            <EmptyDescription>{detail}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    </div>
  );
}

export default CodeView;
