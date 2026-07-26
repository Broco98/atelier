use std::io::{self, IsTerminal, Write};
use std::path::PathBuf;
use std::process::ExitCode;

use anyhow::Context;
use atelier_core::{projects_dir, works_dir, ProjectPatch, ProjectView, WorkView};
use clap::{Parser, Subcommand};

mod mcp;

#[derive(Parser)]
#[command(name = "atelier", version, about = "Atelier 로컬 데이터 CLI")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// 프로젝트 관리
    #[command(subcommand)]
    Project(ProjectCmd),
    /// 작업(여러 프로젝트에 걸친 기능 단위) 관리
    #[command(subcommand)]
    Work(WorkCmd),
    /// AI 스킬 관리
    #[command(subcommand)]
    Skill(SkillCmd),
    /// 표준입출력 MCP 서버 실행 (MCP 호스트가 서브프로세스로 띄운다)
    Mcp,
}

#[derive(Subcommand)]
enum WorkCmd {
    /// 작업 시작 — 메타·spec 폴더·프로젝트별 워크트리 생성
    Start {
        title: String,
        /// 참여 프로젝트 slug (반복 지정, 1개 이상)
        #[arg(long = "project", required = true)]
        projects: Vec<String>,
        /// 공유 브랜치명 (생략 시 작업 slug)
        #[arg(long)]
        branch: Option<String>,
        #[arg(long)]
        json: bool,
    },
    /// 모든 작업 나열
    List {
        #[arg(long)]
        json: bool,
    },
    /// 작업 상세 보기 (워크트리·spec 파일 파생 정보 포함)
    Show {
        slug: String,
        #[arg(long)]
        json: bool,
    },
    /// 상태 변경 (active | review | done)
    Edit {
        slug: String,
        #[arg(long)]
        status: String,
        #[arg(long)]
        json: bool,
    },
    /// 기존 작업에 프로젝트 추가 (워크트리 생성)
    Attach {
        slug: String,
        project: String,
        #[arg(long)]
        json: bool,
    },
    /// 작업 제거 — 워크트리 정리, 브랜치는 유지
    Remove {
        slug: String,
        #[arg(long)]
        yes: bool,
        /// 커밋 안 된 변경이 있어도 강제 제거
        #[arg(long)]
        force: bool,
    },
}

#[derive(Subcommand)]
enum ProjectCmd {
    /// 모든 프로젝트 나열
    List {
        #[arg(long)]
        json: bool,
    },
    /// 프로젝트 상세 보기
    Show {
        slug: String,
        #[arg(long)]
        json: bool,
    },
    /// 코드 폴더를 프로젝트로 등록
    Add {
        path: PathBuf,
        #[arg(long)]
        json: bool,
    },
    /// 이름/설명/baseBranch 수정
    Edit {
        slug: String,
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        description: Option<String>,
        #[arg(long)]
        base_branch: Option<String>,
        #[arg(long)]
        json: bool,
    },
    /// 프로젝트 제거 (코드 폴더는 삭제되지 않음)
    Remove {
        slug: String,
        #[arg(long)]
        yes: bool,
    },
}

#[derive(Subcommand)]
enum SkillCmd {
    /// AI 에이전트용 스킬 문서를 ~/.claude/skills/에 설치
    Install,
}

fn main() -> ExitCode {
    match run() {
        Ok(code) => code,
        Err(e) => {
            eprintln!("error: {e}");
            match e.downcast_ref::<atelier_core::Error>() {
                Some(atelier_core::Error::NotFound(_))
                | Some(atelier_core::Error::WorkNotFound(_)) => ExitCode::from(2),
                _ => ExitCode::from(1),
            }
        }
    }
}

fn run() -> anyhow::Result<ExitCode> {
    let cli = Cli::parse();
    let root = projects_dir();
    match cli.command {
        Command::Project(cmd) => match cmd {
            ProjectCmd::List { json } => {
                let views = atelier_core::list_projects(&root)?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&views)?);
                } else if views.is_empty() {
                    println!("프로젝트가 없습니다. `atelier project add <path>`로 추가하세요.");
                } else {
                    for v in &views {
                        print_row(v);
                    }
                }
            }
            ProjectCmd::Show { slug, json } => {
                let view = atelier_core::get_project(&root, &slug)?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&view)?);
                } else {
                    print_detail(&view);
                }
            }
            ProjectCmd::Add { path, json } => {
                let view = atelier_core::create_project(&root, &path)?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&view)?);
                } else {
                    println!("등록됨: {}", view.project.slug);
                }
            }
            ProjectCmd::Edit { slug, name, description, base_branch, json } => {
                if name.is_none() && description.is_none() && base_branch.is_none() {
                    anyhow::bail!("--name, --description, --base-branch 중 하나 이상이 필요합니다");
                }
                let view = atelier_core::update_project(
                    &root,
                    &slug,
                    ProjectPatch { name, description, base_branch },
                )?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&view)?);
                } else {
                    println!("수정됨: {}", view.project.slug);
                }
            }
            ProjectCmd::Remove { slug, yes } => {
                if !yes {
                    if io::stdin().is_terminal() {
                        print!("프로젝트 '{slug}' 를 제거할까요? 코드 폴더는 삭제되지 않습니다. [y/N] ");
                        io::stdout().flush()?;
                        let mut line = String::new();
                        io::stdin().read_line(&mut line)?;
                        if !matches!(line.trim(), "y" | "Y") {
                            println!("취소됨");
                            return Ok(ExitCode::SUCCESS);
                        }
                    } else {
                        anyhow::bail!("확인이 필요합니다. --yes 플래그를 사용하세요");
                    }
                }
                atelier_core::delete_project(&root, &slug)?;
                println!("제거됨: {slug}");
            }
        },
        Command::Work(cmd) => {
            let works_root = works_dir();
            match cmd {
                WorkCmd::Start { title, projects, branch, json } => {
                    let report = atelier_core::start_work(
                        &works_root,
                        &root,
                        &title,
                        &projects,
                        branch.as_deref(),
                    )?;
                    if json {
                        println!("{}", serde_json::to_string_pretty(&report)?);
                    } else {
                        println!("시작됨: {}", report.view.work.slug);
                        for t in &report.view.trees {
                            if t.exists {
                                println!("  {}  {}", t.project, t.path);
                            }
                        }
                    }
                    if !report.errors.is_empty() {
                        for e in &report.errors {
                            eprintln!("error: {}: {}", e.project, e.message);
                        }
                        return Ok(ExitCode::from(1));
                    }
                }
                WorkCmd::List { json } => {
                    let views = atelier_core::list_works(&works_root)?;
                    if json {
                        println!("{}", serde_json::to_string_pretty(&views)?);
                    } else if views.is_empty() {
                        println!("작업이 없습니다. `atelier work start <제목> --project <slug>`로 시작하세요.");
                    } else {
                        for v in &views {
                            print_work_row(v);
                        }
                    }
                }
                WorkCmd::Show { slug, json } => {
                    let view = atelier_core::get_work(&works_root, &slug)?;
                    if json {
                        println!("{}", serde_json::to_string_pretty(&view)?);
                    } else {
                        print_work_detail(&view);
                    }
                }
                WorkCmd::Edit { slug, status, json } => {
                    let status: atelier_core::WorkStatus = status.parse()?;
                    let view = atelier_core::update_work_status(&works_root, &slug, status)?;
                    if json {
                        println!("{}", serde_json::to_string_pretty(&view)?);
                    } else {
                        println!("수정됨: {}", view.work.slug);
                    }
                }
                WorkCmd::Attach { slug, project, json } => {
                    let report = atelier_core::attach_project(&works_root, &root, &slug, &project)?;
                    if json {
                        println!("{}", serde_json::to_string_pretty(&report)?);
                    } else {
                        println!("추가됨: {} → {}", project, report.view.work.slug);
                    }
                    if !report.errors.is_empty() {
                        for e in &report.errors {
                            eprintln!("error: {}: {}", e.project, e.message);
                        }
                        return Ok(ExitCode::from(1));
                    }
                }
                WorkCmd::Remove { slug, yes, force } => {
                    if !yes {
                        if io::stdin().is_terminal() {
                            print!("작업 '{slug}' 를 제거할까요? 워크트리가 정리되고 브랜치는 유지됩니다. [y/N] ");
                            io::stdout().flush()?;
                            let mut line = String::new();
                            io::stdin().read_line(&mut line)?;
                            if !matches!(line.trim(), "y" | "Y") {
                                println!("취소됨");
                                return Ok(ExitCode::SUCCESS);
                            }
                        } else {
                            anyhow::bail!("확인이 필요합니다. --yes 플래그를 사용하세요");
                        }
                    }
                    atelier_core::remove_work(&works_root, &slug, force)?;
                    println!("제거됨: {slug}");
                }
            }
        }
        Command::Skill(SkillCmd::Install) => {
            let skills = dirs::home_dir()
                .context("홈 디렉토리를 찾을 수 없습니다")?
                .join(".claude/skills");
            // 구버전(projects 전용) 설치가 남아 있으면 스킬 중복을 막기 위해 정리
            let old = skills.join("atelier-projects");
            if old.exists() {
                std::fs::remove_dir_all(&old)?;
            }
            let dir = skills.join("atelier");
            std::fs::create_dir_all(&dir)?;
            std::fs::write(dir.join("SKILL.md"), include_str!("../assets/SKILL.md"))?;
            std::fs::write(
                dir.join("manual-editing.md"),
                include_str!("../assets/manual-editing.md"),
            )?;
            println!("설치됨: {}", dir.display());
        }
        Command::Mcp => mcp::run()?,
    }
    Ok(ExitCode::SUCCESS)
}

fn print_work_row(v: &WorkView) {
    println!(
        "{}  [{}]  {}  {}",
        v.work.slug,
        v.work.status.as_str(),
        v.work.branch,
        v.work.projects.join(",")
    );
}

fn print_work_detail(v: &WorkView) {
    println!("{}", v.work.title);
    println!("  slug:    {}", v.work.slug);
    println!("  상태:    {}", v.work.status.as_str());
    println!("  브랜치:  {}", v.work.branch);
    println!("  생성일:  {}", v.work.created_at);
    println!("  워크트리:");
    for t in &v.trees {
        let mark = if !t.exists {
            "  [없음]"
        } else if t.dirty {
            "  [변경 있음]"
        } else {
            ""
        };
        println!("    {}  {}{}", t.project, t.path, mark);
    }
    if !v.spec_files.is_empty() {
        println!("  spec:");
        for f in &v.spec_files {
            println!("    spec/{f}");
        }
    }
}

fn print_row(v: &ProjectView) {
    let missing = if v.missing { "  [누락]" } else { "" };
    let git = v
        .git
        .as_ref()
        .and_then(|g| g.remote_slug.clone())
        .map(|r| format!("  {r}"))
        .unwrap_or_default();
    println!("{}  {}{}{}", v.project.slug, v.project.path, git, missing);
}

fn print_detail(v: &ProjectView) {
    println!("{}", v.project.name);
    println!("  slug:        {}", v.project.slug);
    println!("  경로:        {}{}", v.project.path, if v.missing { "  [누락]" } else { "" });
    if let Some(remote) = v.git.as_ref().and_then(|g| g.remote_slug.as_deref()) {
        println!("  원격:        {remote}");
    }
    println!("  baseBranch:  {}", v.project.base_branch);
    println!("  생성일:      {}", v.project.created_at);
    if !v.project.description.is_empty() {
        println!("\n{}", v.project.description);
    }
}
