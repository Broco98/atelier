//! **워크트리 읽기 — 파일 읽기**(git-integration 판 01). 파일 탭의 본문이 읽는 것이다.
//!
//! work slug와 프로젝트 slug로 워크트리를 찾는다 — work 목록이 쓰는 자리(`works::worktrees_dir`)와 같은 길이다. 화면에는
//! 좁힌 뷰 타입만 보낸다(결정 「git 호출은 Rust」). 파일이 없거나 워크트리가 없는 것은 `Err`가 아니라 **답의 갈래**다 — 화면이
//! 탭 안에 그 까닭을 그린다(스토리 61). `Err`는 부른 쪽이 틀렸을 때(밖을 가리키는 slug · `..` · 절대 경로)뿐이다.

use std::path::Path;

use serde::Serialize;

use crate::worktree::worktree_dir;
use crate::Result;

/// 파일 읽기의 답 — 갈래마다 화면의 몸이 하나다(구현 스펙 「파일 읽기」 표). 글이 아닌 것(그림 · 바이너리 · UTF-8 아님 ·
/// 너무 큼)은 내용 없이 크기만 싣는다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WorktreeFile {
    /// 내용과 줄 수. 줄 수는 끝의 줄바꿈 뒤 빈 줄을 세지 않는다.
    Text { content: String, lines: usize },
    /// 그림 — 확장자로 가른다(S5). **내용을 싣지 않는다**: 화면이 워크트리 절대 경로로 asset URL을 지어 건다(spec의 그림
    /// 보기와 같은 길). 크기는 바이트다.
    ///
    /// `real_path`는 그 그림을 **거는 자리**다 — 워크트리 기준, 링크를 푼 실제 경로(조각은 `/`). 링크가 아니면 부른 경로
    /// 그대로다. 화면은 부른 경로가 아니라 이것으로 건다: asset 프로토콜은 마지막 조각이 상대 링크면 그 대상을 앱의 현재
    /// 폴더 기준으로 풀어 막는다(git은 저장소 안 링크를 흔히 상대 경로로 둔다). 「워크트리 안」이라 판정한 자리와 화면이
    /// 거는 자리도 이것으로 하나다.
    Image { size: u64, real_path: String },
    /// 앞 8KB에 NUL이 있다(git과 같은 판정, 결정 36) — 깨진 글자 대신 「바이너리 파일 · 크기」만 뜬다(스토리 74).
    Binary { size: u64 },
    /// NUL은 없는데 내용이 UTF-8로 풀리지 않는다(EUC-KR 같은 옛 인코딩) — 바이너리처럼 안내만 뜬다(스토리 75).
    NotUtf8 { size: u64 },
    /// 5MB를 넘는다 — **읽기 전에 크기로 가른다**(스토리 76). 앱이 멈추지 않게 내용을 열지 않는다.
    TooLarge { size: u64 },
    /// 파일이 없다 — 지워졌거나 주소가 없는 경로를 가리킨다. 탭은 남고 「지워진 파일」이 뜬다.
    Missing,
    /// 그 프로젝트의 워크트리 폴더가 없다(그 work에 없는 프로젝트도 같다).
    WorktreeMissing,
    /// 심링크의 실제 대상이 워크트리 밖이다 — **읽지 않는다**(스토리 78). 대상은 `~` 축약 표기다.
    OutsideLink { target: String },
    /// 있는데 읽지 못했다 — 폴더이거나 · 보통 파일이 아니거나(명명 파이프 · 소켓) · 디스크가 거절했다.
    Unreadable { reason: String },
}

/// 워크트리 파일 하나를 읽는다(구현 스펙 「코어 — 워크트리 읽기 › 파일 읽기」).
///
/// **경로 가드가 두 겹이다.** 먼저 글자로 — 상대 경로이고 일반 조각만이어야 한다(spec 읽기의 `safe_rel`과 같은 규칙,
/// `..` · 절대 경로는 `Err`). 그 위에 **실제 경로를 풀어 워크트리 안인지 본다** — 글자 가드는 심링크를 막지 못해서, 안쪽
/// 이름이 밖을 가리키면 그 대상을 읽게 된다. 밖이면 읽지 않고 「바깥 링크 + 대상」이다. 워크트리 안을 가리키는 링크는
/// 그대로 따라가 읽는다.
///
/// **가르는 차례**: 그림(확장자) → 너무 큼(5MB 초과) → 바이너리(앞 8000바이트의 NUL) → UTF-8 아님 → 텍스트. 앞의 둘은
/// 내용을 열지 않는다 — 그림은 화면이 asset URL로 걸고, 너무 큰 것은 열면 앱이 멈춘다. 그래서 큰 스크린샷도 그림이다.
pub fn read_worktree_file(works_root: &Path, slug: &str, project: &str, rel_path: &str) -> Result<WorktreeFile> {
    let rel = crate::works::safe_rel(rel_path)?;
    let dir = worktree_dir(works_root, slug, project)?;
    if !dir.is_dir() {
        return Ok(WorktreeFile::WorktreeMissing);
    }
    // 양쪽을 다 푼다 — macOS 임시 폴더(`/var/…` → `/private/var/…`)처럼 뿌리 자체가 링크를 지나면 한쪽만 푼 비교는
    // 늘 「밖」이다.
    let root = match dir.canonicalize() {
        Ok(root) => root,
        Err(e) => return Ok(WorktreeFile::Unreadable { reason: e.to_string() }),
    };
    let real = match dir.join(rel).canonicalize() {
        Ok(real) => real,
        // 끊긴 링크도 여기로 온다 — 가리키는 것이 없으니 읽을 것도 없다.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(WorktreeFile::Missing),
        Err(e) => return Ok(WorktreeFile::Unreadable { reason: e.to_string() }),
    };
    if !real.starts_with(&root) {
        return Ok(WorktreeFile::OutsideLink { target: crate::paths::collapse_home(&real) });
    }
    let meta = match std::fs::metadata(&real) {
        Ok(meta) => meta,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(WorktreeFile::Missing),
        Err(e) => return Ok(WorktreeFile::Unreadable { reason: e.to_string() }),
    };
    if meta.is_dir() {
        return Ok(WorktreeFile::Unreadable { reason: "is a directory".to_string() });
    }
    // 보통 파일이 아니면(명명 파이프 · 소켓 · 장치) **열지 않는다.** 걸린 폴더의 한 겹은 디스크 그대로라 그것도 파일 행으로
    // 서는데, 파이프는 여는 순간 쓰는 쪽이 올 때까지 막혀 그 읽기 스레드가 돌아오지 않는다. 그림 확장자여도 같다 — 그림은
    // 화면이 asset URL로 그 파일을 연다.
    if !meta.is_file() {
        return Ok(WorktreeFile::Unreadable { reason: "not a regular file".to_string() });
    }
    // 내용을 열지 않고 가를 수 있는 것부터 — 그림(확장자)과 너무 큼(크기)은 메타데이터로 끝난다.
    let size = meta.len();
    if is_image(rel) {
        // 위에서 뿌리 안임을 보았다 — 뿌리를 뗀 나머지가 워크트리 기준 실제 경로다.
        let inside = real.strip_prefix(&root).unwrap_or(&real);
        let real_path = inside.iter().map(|part| part.to_string_lossy()).collect::<Vec<_>>().join("/");
        return Ok(WorktreeFile::Image { size, real_path });
    }
    if size > READ_LIMIT {
        return Ok(WorktreeFile::TooLarge { size });
    }
    let bytes = match std::fs::read(&real) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(WorktreeFile::Missing),
        Err(e) => return Ok(WorktreeFile::Unreadable { reason: e.to_string() }),
    };
    if bytes[..bytes.len().min(BINARY_SNIFF_LEN)].contains(&0) {
        return Ok(WorktreeFile::Binary { size });
    }
    Ok(match String::from_utf8(bytes) {
        Ok(content) => WorktreeFile::Text { lines: content.lines().count(), content },
        Err(_) => WorktreeFile::NotUtf8 { size },
    })
}

/// 그림으로 거는 확장자(S5) — WKWebView가 그리는 것. **svg는 없다**: 결정 36대로 원문을 읽는 코드다. 대소문자는 가리지
/// 않는다(스크린샷은 흔히 `.PNG`다).
const IMAGE_EXTENSIONS: [&str; 7] = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico"];

fn is_image(rel: &Path) -> bool {
    rel.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| IMAGE_EXTENSIONS.iter().any(|one| one.eq_ignore_ascii_case(ext)))
}

/// 읽기 상한(결정 35) — 이것을 넘는 파일은 열지 않는다. 그림은 내용을 싣지 않아 이 상한 앞에서 갈린다.
const READ_LIMIT: u64 = 5 * 1024 * 1024;

/// 바이너리를 가르는 창 — 앞의 이만큼에 NUL이 있으면 바이너리다. git이 diff · grep에서 쓰는 창(`FIRST_FEW_BYTES`)과 같은
/// 8000바이트라, 같은 파일을 git과 다르게 부르지 않는다(결정 36 「git과 같은 판정」).
const BINARY_SNIFF_LEN: usize = 8000;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Error;
    use std::path::PathBuf;
    use std::process::Command;

    fn run_git(dir: &Path, args: &[&str]) {
        let out = Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
        assert!(out.status.success(), "git {args:?} failed: {}", String::from_utf8_lossy(&out.stderr));
    }

    /// works 테스트의 저장소 만들기를 본뜬다 — 저장소 `fe`(커밋된 `a.txt` 하나)를 프로젝트로 등록하고, work `w`를 시작해
    /// 진짜 git 워크트리를 만든다. 돌려주는 것은 임시 폴더(살아 있어야 한다) · works 루트 · 워크트리 자리다.
    fn setup() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let works = tmp.path().join("works");
        let projects = tmp.path().join("projects");
        let repo = tmp.path().join("fe");
        std::fs::create_dir_all(&repo).unwrap();
        run_git(&repo, &["init", "-b", "main"]);
        run_git(&repo, &["config", "user.email", "t@t.t"]);
        run_git(&repo, &["config", "user.name", "t"]);
        std::fs::write(repo.join("a.txt"), "x").unwrap();
        run_git(&repo, &["add", "."]);
        run_git(&repo, &["commit", "-m", "init"]);
        crate::create_project(&projects, &repo).unwrap();
        crate::start_work(
            &works,
            &tmp.path().join("archive"),
            &projects,
            "files",
            Some("w"),
            &["fe".to_string()],
            Some("feat/files"),
        )
        .unwrap();
        let worktree = works.join("w").join("trees").join("fe");
        assert!(worktree.join(".git").is_file(), "워크트리가 서지 않았다 — 뿌리의 `.git`이 연결 파일이 아니다");
        (tmp, works, worktree)
    }

    fn write(root: &Path, rel: &str, body: &[u8]) {
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }

    fn read(works: &Path, rel: &str) -> WorktreeFile {
        read_worktree_file(works, "w", "fe", rel).unwrap()
    }

    #[test]
    fn a_text_file_comes_with_its_content_and_line_count() {
        let (_tmp, works, worktree) = setup();
        write(&worktree, "src/main.ts", "const a = 1;\nconst b = 2;\n// 끝\n".as_bytes());

        assert_eq!(
            read(&works, "src/main.ts"),
            WorktreeFile::Text { content: "const a = 1;\nconst b = 2;\n// 끝\n".to_string(), lines: 3 }
        );
        // 끝에 줄바꿈이 없어도 마지막 줄을 센다 — 빈 파일은 0줄이다
        write(&worktree, "one.txt", b"only");
        assert_eq!(read(&works, "one.txt"), WorktreeFile::Text { content: "only".to_string(), lines: 1 });
        write(&worktree, "empty.txt", b"");
        assert_eq!(read(&works, "empty.txt"), WorktreeFile::Text { content: String::new(), lines: 0 });
    }

    /// 그림 답 — 링크가 아니면 거는 자리가 부른 경로 그대로다.
    fn image(size: u64, real_path: &str) -> WorktreeFile {
        WorktreeFile::Image { size, real_path: real_path.to_string() }
    }

    #[test]
    fn an_image_comes_with_its_size_only() {
        let (_tmp, works, worktree) = setup();
        // PNG 머리 — 앞에 NUL이 있어도 바이너리가 아니라 그림이다. 확장자로 가른다(S5).
        let png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";
        write(&worktree, "shots/home.png", png);
        assert_eq!(read(&works, "shots/home.png"), image(png.len() as u64, "shots/home.png"));
        // 스크린샷은 흔히 대문자 확장자다
        write(&worktree, "Shot.JPG", b"jpg");
        assert_eq!(read(&works, "Shot.JPG"), image(3, "Shot.JPG"));
        for name in ["a.jpeg", "a.gif", "a.webp", "a.bmp", "favicon.ico"] {
            write(&worktree, name, b"img!");
            assert_eq!(read(&works, name), image(4, name), "{name}");
        }
    }

    /// 워크트리 안을 가리키는 그림 링크는 **푼 자리**로 건다 — 화면의 asset 프로토콜은 마지막 조각이 상대 링크면 그 대상을
    /// 앱의 현재 폴더 기준으로 풀어 막는다. git은 저장소 안 링크를 흔히 상대 경로로 둔다.
    #[test]
    #[cfg(unix)]
    fn an_image_link_inside_the_worktree_comes_with_its_real_path() {
        let (_tmp, works, worktree) = setup();
        write(&worktree, "assets/logo.png", b"logo");
        std::fs::create_dir_all(worktree.join("docs")).unwrap();
        std::os::unix::fs::symlink("../assets/logo.png", worktree.join("docs/logo.png")).unwrap();
        // 폴더 링크를 지나는 경로도 같다
        std::os::unix::fs::symlink("assets", worktree.join("pics")).unwrap();

        assert_eq!(read(&works, "docs/logo.png"), image(4, "assets/logo.png"));
        assert_eq!(read(&works, "pics/logo.png"), image(4, "assets/logo.png"));
    }

    #[test]
    fn an_svg_is_text() {
        let (_tmp, works, worktree) = setup();
        let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\">\n  <circle r=\"4\"/>\n</svg>\n";
        write(&worktree, "icon.svg", svg.as_bytes());

        // 결정 36 — svg는 그림 확장자이기도 하지만 원문을 읽는 코드다
        assert_eq!(read(&works, "icon.svg"), WorktreeFile::Text { content: svg.to_string(), lines: 3 });
    }

    #[test]
    fn a_nul_in_the_first_8kb_is_binary() {
        let (_tmp, works, worktree) = setup();
        write(&worktree, "build/app.wasm", b"\0asm\x01\0\0\0");
        assert_eq!(read(&works, "build/app.wasm"), WorktreeFile::Binary { size: 8 });

        // NUL이 git의 판정 창(앞 8000바이트) 밖에만 있으면 바이너리로 보지 않는다 — 글로 읽는다
        let mut late = vec![b'a'; 8000];
        late.push(0);
        write(&worktree, "late.txt", &late);
        assert!(matches!(read(&works, "late.txt"), WorktreeFile::Text { .. }), "앞 8000바이트 밖의 NUL은 바이너리가 아니다");
    }

    #[test]
    fn text_that_is_not_utf8_is_not_utf8() {
        let (_tmp, works, worktree) = setup();
        // EUC-KR 「한글」 — NUL은 없지만 UTF-8로 풀리지 않는다
        write(&worktree, "legacy.txt", b"\xc7\xd1\xb1\xdb\n");
        assert_eq!(read(&works, "legacy.txt"), WorktreeFile::NotUtf8 { size: 5 });
    }

    /// 큰 파일을 실제로 쓰지 않는다 — 길이만 늘린 성긴 파일이다(구멍은 NUL로 읽힌다).
    fn sparse(root: &Path, rel: &str, len: u64) {
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::File::create(&path).unwrap().set_len(len).unwrap();
    }

    #[test]
    fn a_file_over_5mb_is_too_large() {
        let (_tmp, works, worktree) = setup();
        let five_mb = 5 * 1024 * 1024;
        sparse(&worktree, "logs/huge.log", five_mb + 1);
        assert_eq!(read(&works, "logs/huge.log"), WorktreeFile::TooLarge { size: five_mb + 1 });

        // 꼭 5MB는 넘지 않았다 — 읽는다(구멍이 NUL이라 바이너리로 온다)
        sparse(&worktree, "edge.bin", five_mb);
        assert_eq!(read(&works, "edge.bin"), WorktreeFile::Binary { size: five_mb });
    }

    #[test]
    #[cfg(unix)]
    fn too_large_is_decided_without_reading_the_content() {
        use std::os::unix::fs::PermissionsExt;
        let (_tmp, works, worktree) = setup();
        let size = 6 * 1024 * 1024;
        sparse(&worktree, "dump.sql", size);
        // 열 수 없는 파일 — 내용을 읽으려 들면 「읽지 못함」이 된다. 크기는 메타데이터라 읽힌다.
        std::fs::set_permissions(worktree.join("dump.sql"), std::fs::Permissions::from_mode(0o000)).unwrap();
        let answer = read(&works, "dump.sql");
        std::fs::set_permissions(worktree.join("dump.sql"), std::fs::Permissions::from_mode(0o644)).unwrap();

        assert_eq!(answer, WorktreeFile::TooLarge { size });
    }

    #[test]
    fn an_image_over_5mb_is_still_an_image() {
        let (_tmp, works, worktree) = setup();
        // 그림은 내용을 싣지 않으니 읽기 상한에 걸릴 것이 없다 — 큰 스크린샷도 그림으로 뜬다
        sparse(&worktree, "shots/full.png", 6 * 1024 * 1024);
        assert_eq!(read(&works, "shots/full.png"), image(6 * 1024 * 1024, "shots/full.png"));
    }

    #[test]
    fn a_missing_file_is_missing_not_an_error() {
        let (_tmp, works, worktree) = setup();
        write(&worktree, "gone.txt", b"x");
        std::fs::remove_file(worktree.join("gone.txt")).unwrap();

        assert_eq!(read(&works, "gone.txt"), WorktreeFile::Missing);
        assert_eq!(read(&works, "no/such/dir.txt"), WorktreeFile::Missing);
    }

    #[test]
    fn a_project_without_a_worktree_is_worktree_missing() {
        let (_tmp, works, _worktree) = setup();
        // 그 work에 없는 프로젝트 — 주소가 가리킬 수 있다(티켓 04)
        assert_eq!(read_worktree_file(&works, "w", "be", "a.txt").unwrap(), WorktreeFile::WorktreeMissing);
    }

    #[test]
    fn dot_dot_and_absolute_paths_are_refused() {
        let (_tmp, works, _worktree) = setup();
        for bad in ["../fe/a.txt", "src/../../a.txt", "/etc/hosts", "", "./a.txt"] {
            assert!(
                matches!(read_worktree_file(&works, "w", "fe", bad), Err(Error::Validation(_))),
                "{bad:?}가 거절되지 않았다"
            );
        }
        // 프로젝트 · work slug도 경로 조각이다
        assert!(matches!(read_worktree_file(&works, "w", "../fe", "a.txt"), Err(Error::Validation(_))));
        assert!(matches!(read_worktree_file(&works, "../w", "fe", "a.txt"), Err(Error::WorkNotFound(_))));
    }

    #[test]
    #[cfg(unix)]
    fn a_link_out_of_the_worktree_is_not_read() {
        let (tmp, works, worktree) = setup();
        let secret = tmp.path().join("secret.txt");
        std::fs::write(&secret, "do not read").unwrap();
        std::os::unix::fs::symlink(&secret, worktree.join("out.txt")).unwrap();
        // 폴더 링크를 지나 밖으로 나가는 경로도 같다
        std::os::unix::fs::symlink(tmp.path(), worktree.join("up")).unwrap();

        let target = crate::paths::collapse_home(&secret.canonicalize().unwrap());
        assert_eq!(read(&works, "out.txt"), WorktreeFile::OutsideLink { target: target.clone() });
        assert_eq!(read(&works, "up/secret.txt"), WorktreeFile::OutsideLink { target });
    }

    /// 명명 파이프 — 걸린 폴더의 한 겹 읽기가 디스크 그대로라 파일 행으로 선다(S22). 열면 쓰는 쪽이 올 때까지 막힌다.
    #[cfg(unix)]
    fn fifo(root: &Path, rel: &str) {
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let out = Command::new("mkfifo").arg(&path).output().unwrap();
        assert!(out.status.success(), "mkfifo failed: {}", String::from_utf8_lossy(&out.stderr));
    }

    /// 다른 스레드에서 읽고 시한 안에 답을 받는다 — 막히는 읽기가 검사를 끝없이 붙잡지 않고 빨갛게 끝나게.
    #[cfg(unix)]
    fn read_within(works: &Path, rel: &str) -> WorktreeFile {
        let (works, rel) = (works.to_path_buf(), rel.to_string());
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || tx.send(read(&works, &rel)).unwrap());
        rx.recv_timeout(std::time::Duration::from_secs(5)).expect("읽기가 5초 안에 돌아오지 않았다 — 파일을 열고 막혔다")
    }

    #[test]
    #[cfg(unix)]
    fn a_named_pipe_is_unreadable_without_opening_it() {
        let (_tmp, works, worktree) = setup();
        fifo(&worktree, "tmp/agent.fifo");
        // 그림 확장자여도 같다 — 그림 갈래는 화면이 asset URL로 그 파일을 연다
        fifo(&worktree, "tmp/shot.png");

        for rel in ["tmp/agent.fifo", "tmp/shot.png"] {
            assert_eq!(
                read_within(&works, rel),
                WorktreeFile::Unreadable { reason: "not a regular file".to_string() },
                "{rel}"
            );
        }
    }

    #[test]
    #[cfg(unix)]
    fn a_link_inside_the_worktree_is_read_as_text() {
        let (_tmp, works, worktree) = setup();
        write(&worktree, "docs/real.md", b"# real\n");
        std::os::unix::fs::symlink("docs/real.md", worktree.join("alias.md")).unwrap();

        assert_eq!(read(&works, "alias.md"), WorktreeFile::Text { content: "# real\n".to_string(), lines: 1 });
    }
}
