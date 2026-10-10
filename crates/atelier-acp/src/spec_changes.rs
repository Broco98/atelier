//! 고친 곳 — 턴 앞뒤로 spec 폴더를 찍어 견준다(three-axes 결정 22). 비교는 호스트, 표시는 화면(티켓 26)이다.
//!
//! 편집 도구의 diff는 엔진마다 다르고 셸 편집을 놓친다. 그래서 무슨 도구로 고쳤든 폴더를 견준다 — 그 사이에
//! 함께 돈 다른 대화가 고친 것도 이 턴의 비교에 든다.
//!
//! - md · 텍스트 파일(UTF-8로 읽히는 것)은 내용을 찍는다. 그 밖의 파일과 1MB를 넘는 파일은 크기와 해시만 찍는다.
//! - md 파일의 바뀐 줄 범위는 옛 글 → 새 글 줄 diff의 새 글 쪽 범위다. 화면이 새 글을 그리므로 그 줄로 칠한다.
//!
//! 찍은 것은 메모리에만 둔다 — 그래서 해시는 표준 라이브러리의 것으로 족하다(판이 바뀌어 값이 달라져도 견주는 두
//! 값은 같은 프로세스의 것이다).

use std::collections::BTreeMap;
use std::hash::{DefaultHasher, Hasher};
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;

/// 내용을 찍는 크기의 한도 1MB(1024 × 1024바이트). 넘는 파일은 md여도 해시만 찍는다.
const CONTENT_LIMIT: u64 = 1024 * 1024;

/// 줄 diff가 따라가는 고침 수의 한도. 넘으면 앞뒤의 같은 줄을 뺀 가운데를 통째로 바뀐 범위로 친다 — 거의 다시 쓴
/// 글에서 diff가 시간과 메모리를 끝없이 먹지 않게.
const MAX_EDITS: usize = 1000;

/// 찍는 자리 — work 폴더와 그 spec 폴더. 목록은 스펙 트리와 같은 것(`atelier_core::spec_files`)을 걷는다.
#[derive(Debug, Clone)]
pub(crate) struct SpecPlace {
    /// works 루트와 work slug — work가 아직 그 자리에 있는지 본다.
    pub works_root: PathBuf,
    pub work: String,
    pub work_dir: PathBuf,
    pub spec_dir: PathBuf,
}

impl SpecPlace {
    /// work가 아직 그 자리에 있나 — 「work가 있다」의 판정은 코어의 것(`work.json`을 읽는다)을 쓴다.
    pub(crate) fn work_exists(&self) -> bool {
        atelier_core::read_work(&self.works_root, &self.work).is_ok()
    }
}

/// spec 폴더를 한 번 찍은 것 — 상대 경로(`/`로 이음)마다 그때의 파일.
pub(crate) struct Snapshot {
    files: BTreeMap<String, Shot>,
}

#[derive(PartialEq)]
enum Shot {
    /// md · 텍스트 — 내용 그대로.
    Text(String),
    /// 그 밖의 파일과 1MB를 넘는 파일 — 크기와 해시.
    Opaque { size: u64, hash: u64 },
}

/// `changes` 줄의 파일 하나.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub(crate) struct FileChange {
    /// spec 폴더 안의 상대 경로 — 스펙 트리의 경로와 같은 꼴이다.
    pub path: String,
    pub change: ChangeKind,
    /// md 파일이면 새 글 기준의 바뀐 줄 범위들. 옛 글이나 새 글을 내용으로 찍지 못했으면(1MB를 넘는다) 없다.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lines: Option<Vec<LineRange>>,
}

/// 바뀜 종류 — 새 문서 · 고침 · 지움.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum ChangeKind {
    Created,
    Modified,
    Deleted,
}

/// 새 글의 줄 범위 — 1부터 세고 끝 줄을 넣는다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub(crate) struct LineRange {
    pub start: usize,
    pub end: usize,
}

impl Snapshot {
    /// 지금의 spec 폴더를 찍는다. 목록과 읽기 사이에 사라진 파일 · 읽을 수 없는 파일은 없는 것으로 친다.
    pub(crate) fn take(place: &SpecPlace) -> Self {
        let files = atelier_core::spec_files(&place.work_dir)
            .into_iter()
            .filter_map(|rel| {
                let shot = shoot(&place.spec_dir.join(&rel))?;
                Some((rel, shot))
            })
            .collect();
        Self { files }
    }

    /// 이 찍음(턴 앞) → `after`(턴 끝)의 바뀐 파일들. 경로 순서다. 바뀐 것이 없으면 빈 목록이다.
    pub(crate) fn compare(&self, after: &Snapshot) -> Vec<FileChange> {
        let mut paths: Vec<&String> = self.files.keys().chain(after.files.keys()).collect();
        paths.sort();
        paths.dedup();
        paths
            .into_iter()
            .filter_map(|path| {
                let (before, now) = (self.files.get(path), after.files.get(path));
                let change = match (before, now) {
                    (Some(before), Some(now)) if before == now => return None,
                    (None, None) => return None,
                    (None, Some(_)) => ChangeKind::Created,
                    (Some(_), Some(_)) => ChangeKind::Modified,
                    (Some(_), None) => ChangeKind::Deleted,
                };
                let lines = match now {
                    Some(now) if is_markdown(path) => line_ranges(before, now),
                    _ => None,
                };
                Some(FileChange { path: path.clone(), change, lines })
            })
            .collect()
    }
}

/// md 파일의 새 글 기준 바뀐 범위. 새 문서는 옛 글이 빈 글이다. 어느 쪽이든 내용으로 찍지 못했으면 없다.
fn line_ranges(before: Option<&Shot>, now: &Shot) -> Option<Vec<LineRange>> {
    let old = match before {
        None => "",
        Some(shot) => text_of(shot)?,
    };
    Some(new_side_ranges(old, text_of(now)?))
}

fn text_of(shot: &Shot) -> Option<&str> {
    match shot {
        Shot::Text(text) => Some(text),
        Shot::Opaque { .. } => None,
    }
}

/// 화면이 마크다운으로 그리는 파일 — 확장자 `.md`(대소문자를 가리지 않는다, `doc-refs.ts`와 같다).
fn is_markdown(path: &str) -> bool {
    path.to_ascii_lowercase().ends_with(".md")
}

/// 파일 하나를 찍는다. 한도 안이고 UTF-8로 읽히면 내용, 아니면 크기와 해시다.
fn shoot(path: &Path) -> Option<Shot> {
    let size = std::fs::metadata(path).ok()?.len();
    if size <= CONTENT_LIMIT {
        let bytes = std::fs::read(path).ok()?;
        return Some(match String::from_utf8(bytes) {
            Ok(text) => Shot::Text(text),
            Err(error) => {
                let bytes = error.into_bytes();
                Shot::Opaque { size: bytes.len() as u64, hash: hash_of(&bytes) }
            }
        });
    }
    // 큰 파일은 통째로 들지 않고 흘려 읽으며 해시한다.
    let mut file = std::fs::File::open(path).ok()?;
    let mut hasher = DefaultHasher::new();
    let mut buffer = vec![0; 64 * 1024];
    let mut size = 0u64;
    loop {
        let read = file.read(&mut buffer).ok()?;
        if read == 0 {
            break;
        }
        hasher.write(&buffer[..read]);
        size += read as u64;
    }
    Some(Shot::Opaque { size, hash: hasher.finish() })
}

fn hash_of(bytes: &[u8]) -> u64 {
    let mut hasher = DefaultHasher::new();
    hasher.write(bytes);
    hasher.finish()
}

/// 옛 글 → 새 글 줄 diff에서 새 글 쪽의 바뀐 범위들. 줄은 줄바꿈까지 견준다 — 끝 줄의 줄바꿈만 붙거나 떨어져도
/// 그 줄이 바뀐 것이다. 새 글에 줄이 없는 덩이(지우기만 한 자리)는 새 글 쪽 범위가 없어 적히지 않는다.
fn new_side_ranges(old: &str, new: &str) -> Vec<LineRange> {
    let old: Vec<&str> = old.split_inclusive('\n').collect();
    let new: Vec<&str> = new.split_inclusive('\n').collect();
    let prefix = old.iter().zip(&new).take_while(|(a, b)| a == b).count();
    let suffix =
        old[prefix..].iter().rev().zip(new[prefix..].iter().rev()).take_while(|(a, b)| a == b).count();
    let old_mid = &old[prefix..old.len() - suffix];
    let new_mid = &new[prefix..new.len() - suffix];
    let kept = kept_new_lines(old_mid, new_mid).unwrap_or_else(|| vec![false; new_mid.len()]);

    let mut ranges: Vec<LineRange> = Vec::new();
    for (index, kept) in kept.into_iter().enumerate() {
        if kept {
            continue;
        }
        let line = prefix + index + 1;
        match ranges.last_mut() {
            Some(range) if range.end + 1 == line => range.end = line,
            _ => ranges.push(LineRange { start: line, end: line }),
        }
    }
    ranges
}

/// Myers의 최소 고침 diff로 새 글의 줄마다 옛 글과 짝지어 남았는지를 준다. 고침이 [`MAX_EDITS`]를 넘으면 `None`.
///
/// 대각선 `k = x - y`마다 고침 `d`번으로 닿는 가장 먼 `x`를 `d`마다 적어 두고(`trace[d][k + d]`, 닿지 못하면 -1),
/// 끝에서 거꾸로 짚어 대각선 이동(같은 줄)을 남은 줄로 친다.
fn kept_new_lines(old: &[&str], new: &[&str]) -> Option<Vec<bool>> {
    let (n, m) = (old.len() as isize, new.len() as isize);
    let mut kept = vec![false; new.len()];
    if n == 0 || m == 0 {
        return Some(kept);
    }
    let snake = |mut x: isize, mut y: isize| {
        while x < n && y < m && old[x as usize] == new[y as usize] {
            x += 1;
            y += 1;
        }
        x
    };

    let mut trace: Vec<Vec<isize>> = Vec::new();
    let mut end = None;
    'search: for d in 0..=(n + m).min(MAX_EDITS as isize) {
        let mut row = vec![-1; 2 * d as usize + 1];
        for k in (-d..=d).step_by(2) {
            let start = if d == 0 { Some(0) } else { step_start(&trace[d as usize - 1], d, k).map(|(_, x)| x) };
            let Some(x) = start else { continue };
            let y = x - k;
            if x > n || y > m || y < 0 {
                continue;
            }
            let x = snake(x, y);
            row[(k + d) as usize] = x;
            if x == n && x - k == m {
                trace.push(row);
                end = Some(d);
                break 'search;
            }
        }
        trace.push(row);
    }
    let end = end?;

    // 거꾸로 짚는다 — (x, y)에서 그 d의 이동 앞 자리로, 그 사이의 대각선은 같은 줄이다.
    let (mut x, mut y) = (n, m);
    for d in (1..=end).rev() {
        let k = x - y;
        let (down, mid_x) = step_start(&trace[d as usize - 1], d, k).expect("앞으로 걸은 자리다");
        let mid_y = mid_x - k;
        for line in mid_y..y {
            kept[line as usize] = true;
        }
        let from_k = if down { k + 1 } else { k - 1 };
        x = trace[d as usize - 1][(from_k + d - 1) as usize];
        y = x - from_k;
    }
    for line in 0..y {
        kept[line as usize] = true;
    }
    Some(kept)
}

/// 고침 `d`번째에 대각선 `k`로 들어서는 자리 — (아래로 왔나, 이동 뒤의 x). `prev`는 고침 `d - 1`번의 줄이다.
/// 아래(새 글에서 한 줄 더함)는 대각선 `k + 1`에서, 오른쪽(옛 글에서 한 줄 지움)은 `k - 1`에서 온다. 둘 다 닿았으면
/// 더 멀리 간 쪽을 잇는다. 앞으로 걷기와 거꾸로 짚기가 이 하나로 같은 길을 고른다.
fn step_start(prev: &[isize], d: isize, k: isize) -> Option<(bool, isize)> {
    let at = |diagonal: isize| -> Option<isize> {
        let index = diagonal + d - 1;
        (0..prev.len() as isize).contains(&index).then(|| prev[index as usize]).filter(|x| *x >= 0)
    };
    let from_above = at(k + 1);
    let from_left = at(k - 1);
    let down = match (from_left, from_above) {
        (None, None) => return None,
        (None, Some(_)) => true,
        (Some(_), None) => false,
        (Some(left), Some(above)) => left < above,
    };
    Some(if down { (true, from_above?) } else { (false, from_left? + 1) })
}
