use std::io::{self, IsTerminal, Write};
use std::path::PathBuf;
use std::process::ExitCode;

use anyhow::Context;
use atelier_core::{projects_dir, ProjectPatch, ProjectView};
use clap::{Parser, Subcommand};

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
    /// 설명/baseBranch 수정
    Edit {
        slug: String,
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

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            match e.downcast_ref::<atelier_core::Error>() {
                Some(atelier_core::Error::NotFound(_)) => ExitCode::from(2),
                _ => ExitCode::from(1),
            }
        }
    }
}

fn run() -> anyhow::Result<()> {
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
            ProjectCmd::Edit { slug, description, base_branch, json } => {
                if description.is_none() && base_branch.is_none() {
                    anyhow::bail!("--description 또는 --base-branch 중 하나 이상이 필요합니다");
                }
                let view = atelier_core::update_project(
                    &root,
                    &slug,
                    ProjectPatch { description, base_branch },
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
                            return Ok(());
                        }
                    } else {
                        anyhow::bail!("확인이 필요합니다. --yes 플래그를 사용하세요");
                    }
                }
                atelier_core::delete_project(&root, &slug)?;
                println!("제거됨: {slug}");
            }
        },
    }
    Ok(())
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
