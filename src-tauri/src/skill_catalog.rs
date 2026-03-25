use crate::workspace_paths;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{Manager, Runtime};

const SKILL_FILE_NAMES: [&str; 2] = ["SKILL.md", "skill.md"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SkillEntryPayload {
    pub name: String,
    pub description: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SkillCatalogPayload {
    pub root_path: String,
    pub skills: Vec<SkillEntryPayload>,
}

fn authorize_workspace_path<R: Runtime, M: Manager<R>>(
    manager: &M,
    workspace_path: &str,
) -> Result<PathBuf, String> {
    let authorized = workspace_paths::authorize_workspace_path(manager, Path::new(workspace_path))
        .map_err(|error| error.to_string())?;
    Ok(PathBuf::from(authorized.canonical_path))
}

fn system_skill_root<R: Runtime, M: Manager<R>>(manager: &M) -> Result<PathBuf, String> {
    manager
        .path()
        .app_data_dir()
        .map(|path| path.join("skills"))
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))
}

fn workspace_skill_root(workspace_path: &Path) -> PathBuf {
    workspace_path.join(".agent").join("skills")
}

fn parse_frontmatter(text: &str) -> HashMap<String, String> {
    let mut lines = text.lines();
    if lines.next().map(str::trim) != Some("---") {
        return HashMap::new();
    }

    let mut values = HashMap::new();

    for line in lines {
        let trimmed = line.trim();
        if trimmed == "---" {
            break;
        }

        let Some((key, value)) = trimmed.split_once(':') else {
            continue;
        };

        values.insert(
            key.trim().to_string(),
            value.trim().trim_matches(['"', '\'']).to_string(),
        );
    }

    values
}

fn skill_fallback_name(skill_path: &Path) -> String {
    skill_path
        .parent()
        .and_then(Path::file_name)
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| skill_path.to_string_lossy().into_owned())
}

fn collect_skill_files(root_path: &Path, discovered: &mut Vec<PathBuf>) -> Result<(), String> {
    let entries = fs::read_dir(root_path).map_err(|error| {
        format!(
            "Failed to read skills directory {}: {error}",
            root_path.display()
        )
    })?;

    for entry in entries {
        let Ok(entry) = entry else {
            continue;
        };

        let Ok(file_type) = entry.file_type() else {
            continue;
        };

        if file_type.is_symlink() {
            continue;
        }

        let path = entry.path();
        if file_type.is_dir() {
            let _ = collect_skill_files(&path, discovered);
            continue;
        }

        if !file_type.is_file() {
            continue;
        }

        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();
        if SKILL_FILE_NAMES.contains(&file_name.as_ref()) {
            discovered.push(path);
        }
    }

    Ok(())
}

fn build_skill_entry(skill_path: PathBuf) -> Option<SkillEntryPayload> {
    let raw = fs::read_to_string(&skill_path).ok()?;
    let frontmatter = parse_frontmatter(&raw);

    Some(SkillEntryPayload {
        name: frontmatter
            .get("name")
            .cloned()
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| skill_fallback_name(&skill_path)),
        description: frontmatter.get("description").cloned().unwrap_or_default(),
        path: skill_path.to_string_lossy().into_owned(),
    })
}

fn scan_skill_root(root_path: PathBuf) -> Result<SkillCatalogPayload, String> {
    if !root_path.exists() || !root_path.is_dir() {
        return Ok(SkillCatalogPayload {
            root_path: root_path.to_string_lossy().into_owned(),
            skills: Vec::new(),
        });
    }

    let mut skill_files = Vec::new();
    collect_skill_files(&root_path, &mut skill_files)?;

    let mut skills: Vec<_> = skill_files
        .into_iter()
        .filter_map(build_skill_entry)
        .collect();

    skills.sort_by(|left, right| {
        left.name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.path.cmp(&right.path))
    });

    Ok(SkillCatalogPayload {
        root_path: root_path.to_string_lossy().into_owned(),
        skills,
    })
}

pub fn scan_system_skills<R: Runtime, M: Manager<R>>(
    manager: &M,
) -> Result<SkillCatalogPayload, String> {
    let root_path = system_skill_root(manager)?;
    scan_skill_root(root_path)
}

pub fn scan_workspace_skills<R: Runtime, M: Manager<R>>(
    manager: &M,
    workspace_path: &str,
) -> Result<SkillCatalogPayload, String> {
    let workspace_path = authorize_workspace_path(manager, workspace_path)?;
    scan_skill_root(workspace_skill_root(&workspace_path))
}

#[cfg(test)]
mod tests {
    use super::{parse_frontmatter, scan_skill_root};
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn parses_name_and_description_from_frontmatter() {
        let content = "---\nname: repo-helper\ndescription: Helpful workspace skill\n---\n# Skill";
        let frontmatter = parse_frontmatter(content);

        assert_eq!(
            frontmatter.get("name").map(String::as_str),
            Some("repo-helper")
        );
        assert_eq!(
            frontmatter.get("description").map(String::as_str),
            Some("Helpful workspace skill")
        );
    }

    #[test]
    fn scans_nested_skill_directories() {
        let temp = tempdir().expect("temp dir");
        let skills_root = temp.path().join("skills");
        let nested_dir = skills_root.join("repo-helper");
        let second_dir = skills_root.join("nested").join("deploy-checks");

        fs::create_dir_all(&nested_dir).expect("repo helper dir");
        fs::create_dir_all(&second_dir).expect("deploy checks dir");
        fs::write(
            nested_dir.join("SKILL.md"),
            "---\nname: repo-helper\ndescription: Workspace helper\n---\n# Repo helper",
        )
        .expect("repo helper skill");
        fs::write(second_dir.join("skill.md"), "# Deploy checks").expect("deploy checks skill");

        let catalog = scan_skill_root(skills_root.clone()).expect("skill catalog");

        assert_eq!(catalog.root_path, skills_root.to_string_lossy());
        assert_eq!(catalog.skills.len(), 2);
        assert_eq!(catalog.skills[0].name, "deploy-checks");
        assert_eq!(catalog.skills[1].name, "repo-helper");
    }
}
