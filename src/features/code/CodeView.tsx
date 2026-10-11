import { FileDigit, FileStack, FileType, FileWarning, FileX, FolderX, Link2Off, type LucideIcon } from "lucide-react";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { expandHome } from "@/features/works/doc-refs";
import { useHomeDir } from "@/features/works/hooks";
import { ImageDoc, SourceView } from "@/features/works/SpecViewer";
import type { CodeTarget } from "@/features/terminal/shell-registry";
import { fileSize } from "./file-size";
import { useCodeFile } from "./hooks";
import type { WorktreeFile } from "./types";

/**
 * **코드 카드의 몸**(git-integration 판 01 — 파일 탭의 본문). 카드와 그 머리(`<프로젝트> › 폴더 › 파일` · 경로 복사)는 화면
 * (`WorksPage`)이 세우고, 이것은 카드 안에서 도는 스크롤 상자 하나를 낸다 — 문서 카드의 몸(`SpecViewer`)과 같은 나눔이다.
 *
 * 텍스트는 지금 있는 원문 보기(줄 번호, 강조 없음)를 빌린다 — 강조된 보기는 다음 장(08)이 갈아 끼운다. 그림은 spec의 그림
 * 보기를 빌린다. 그 밖의 답은 **탭 안의 안내**다: 파일이 없다고 spec으로 조용히 돌아가지 않고 무엇이 없는지를 말한다
 * (스토리 61 · 82), 글이 아닌 것은 깨진 글자 대신 무엇인지와 크기만 말한다(스토리 74–76).
 *
 * `worktreeDir`는 그 프로젝트의 워크트리 자리(`~` 축약, 끝에 `/`)다 — 카드 머리의 경로 복사가 그 파일의 경로를 잇는 그
 * 뿌리이고, 그림은 거기에 코어가 링크를 푼 실제 경로를 이어 건다. 그 프로젝트의 워크트리가 이 work에 없으면 `null`이다.
 */
function CodeView({
  slug,
  target,
  worktreeDir,
  wide,
}: {
  slug: string;
  target: CodeTarget;
  worktreeDir: string | null;
  wide: boolean;
}) {
  const { data, error } = useCodeFile(slug, target.project, target.path);
  return (
    // 이 상자가 **카드의 직계 flex 자식**이어야 남는 높이를 차지한다(`SpecViewer`의 그 상자와 같은 이유).
    <div className="min-h-0 flex-1 overflow-y-auto scroll-quiet">
      <div className="flex min-h-full min-w-0 flex-col">
        {error ? (
          // 코어가 거절한 주소(`..` · 절대 경로)다 — 답의 갈래가 아니라 실패로 온다.
          <Notice icon={FileWarning} title="읽지 못한 파일" detail={String(error)} />
        ) : data ? (
          <FileBody file={data} target={target} worktreeDir={worktreeDir} wide={wide} />
        ) : null}
      </div>
    </div>
  );
}

/**
 * 답의 갈래 하나가 몸 하나로 간다. **`switch`인 것이 계약이다** — 코어가 갈래를 더하면 여기가 컴파일에서 깨진다. 마지막을
 * `else`로 두면 새 갈래가 조용히 한 안내로 떨어진다(`SpecViewer`의 `bodyView`와 같다).
 */
function FileBody({
  file,
  target,
  worktreeDir,
  wide,
}: {
  file: WorktreeFile;
  target: CodeTarget;
  worktreeDir: string | null;
  wide: boolean;
}) {
  switch (file.kind) {
    case "text":
      // `.md` · svg도 여기다 — 렌더된 문서는 spec 칸의 몫이고, svg는 원문을 읽는 코드다(결정 36).
      return <SourceView content={file.content} wide={wide} />;
    case "image":
      // 대체 글은 부른 경로다 — 링크여도 사람이 연 것은 그 이름이다. 거는 자리만 푼 경로다.
      return <WorktreeImage path={worktreeDir && `${worktreeDir}${file.realPath}`} name={target.path} />;
    case "binary":
      return (
        <Notice icon={FileDigit} title="바이너리 파일" detail={`${fileSize(file.size)} · 글로 볼 수 없는 파일이에요.`} />
      );
    case "notUtf8":
      return (
        <Notice
          icon={FileType}
          title="UTF-8이 아닌 파일"
          detail={`${fileSize(file.size)} · UTF-8로 풀리지 않아 깨진 글자 대신 크기만 보여요.`}
        />
      );
    case "tooLarge":
      // 코어가 열지 않았다 — 크기만 안다(결정 35의 읽기 상한).
      return (
        <Notice icon={FileStack} title="너무 큰 파일" detail={`${fileSize(file.size)} · 5MB를 넘는 파일은 열지 않아요.`} />
      );
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

/**
 * 그림 — spec의 그림 보기와 **같은 길**이다: 홈 축약 경로를 펴서 asset URL로 건다(`ImageDoc`). 경로는 위에서 받은 워크트리
 * 자리에 코어가 푼 실제 경로를 이은 것이다 — 뿌리를 여기서 짓지 않는다. 홈을 아직 못 읽었으면 `ImageDoc`의 자리표시다.
 */
function WorktreeImage({ path, name }: { path: string | null; name: string }) {
  const { data: home } = useHomeDir();
  return <ImageDoc path={home && path ? expandHome(path, home) : null} name={name} />;
}

/** 가운데 안내 — 제목과 까닭 한 줄. 큰 빈 화면 부품(`Empty`)을 그대로 쓴다. */
function Notice({ icon: Icon, title, detail }: { icon: LucideIcon; title: string; detail: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-10">
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
  );
}

export default CodeView;
