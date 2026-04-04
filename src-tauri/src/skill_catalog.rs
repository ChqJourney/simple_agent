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
    pub root_paths: Vec<String>,
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

fn system_skill_roots<R: Runtime, M: Manager<R>>(manager: &M) -> Result<Vec<PathBuf>, String> {
    let mut roots = Vec::new();

    if let Ok(executable_path) = std::env::current_exe() {
        if let Some(executable_dir) = executable_path.parent() {
            roots.push(executable_dir.join("skills"));
        }
    }

    let app_data_root = manager
        .path()
        .app_data_dir()
        .map(|path| path.join("skills"))
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;

    if !roots.iter().any(|root| root == &app_data_root) {
        roots.push(app_data_root);
    }

    Ok(roots)
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

fn scan_skill_entries(root_path: &Path) -> Result<Vec<SkillEntryPayload>, String> {
    if !root_path.exists() || !root_path.is_dir() {
        return Ok(Vec::new());
    }

    let mut skill_files = Vec::new();
    collect_skill_files(root_path, &mut skill_files)?;

    Ok(skill_files
        .into_iter()
        .filter_map(build_skill_entry)
        .collect())
}

fn build_catalog(root_paths: Vec<PathBuf>) -> Result<SkillCatalogPayload, String> {
    let mut resolved_by_name: HashMap<String, SkillEntryPayload> = HashMap::new();

    for root_path in &root_paths {
        for skill in scan_skill_entries(root_path)? {
            resolved_by_name.insert(skill.name.to_lowercase(), skill);
        }
    }

    let mut skills: Vec<_> = resolved_by_name.into_values().collect();

    skills.sort_by(|left, right| {
        left.name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.path.cmp(&right.path))
    });

    let normalized_root_paths = root_paths
        .into_iter()
        .map(|root_path| root_path.to_string_lossy().into_owned())
        .collect::<Vec<_>>();

    Ok(SkillCatalogPayload {
        root_path: normalized_root_paths.first().cloned().unwrap_or_default(),
        root_paths: normalized_root_paths,
        skills,
    })
}

pub fn scan_system_skills<R: Runtime, M: Manager<R>>(
    manager: &M,
) -> Result<SkillCatalogPayload, String> {
    let root_paths = system_skill_roots(manager)?;
    build_catalog(root_paths)
}

pub fn scan_workspace_skills<R: Runtime, M: Manager<R>>(
    manager: &M,
    workspace_path: &str,
) -> Result<SkillCatalogPayload, String> {
    let workspace_path = authorize_workspace_path(manager, workspace_path)?;
    build_catalog(vec![workspace_skill_root(&workspace_path)])
}

#[cfg(test)]
mod tests {
    use super::{build_catalog, parse_frontmatter};
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

        let catalog = build_catalog(vec![skills_root.clone()]).expect("skill catalog");

        assert_eq!(catalog.root_path, skills_root.to_string_lossy());
        assert_eq!(catalog.root_paths, vec![skills_root.to_string_lossy()]);
        assert_eq!(catalog.skills.len(), 2);
        assert_eq!(catalog.skills[0].name, "deploy-checks");
        assert_eq!(catalog.skills[1].name, "repo-helper");
    }

    #[test]
    fn later_system_roots_override_duplicate_skill_names() {
        let temp = tempdir().expect("temp dir");
        let app_dir_root = temp.path().join("portable-skills");
        let app_data_root = temp.path().join("app-data-skills");
        let shared_app_dir = app_dir_root.join("repo-helper");
        let shared_app_data = app_data_root.join("repo-helper");

        fs::create_dir_all(&shared_app_dir).expect("portable dir");
        fs::create_dir_all(&shared_app_data).expect("app data dir");
        fs::write(
            shared_app_dir.join("SKILL.md"),
            "---\nname: repo-helper\ndescription: Portable bundled skill\n---\n# Portable",
        )
        .expect("portable skill");
        fs::write(
            shared_app_data.join("SKILL.md"),
            "---\nname: repo-helper\ndescription: User override skill\n---\n# Override",
        )
        .expect("override skill");

        let catalog = build_catalog(vec![app_dir_root.clone(), app_data_root.clone()])
            .expect("skill catalog");

        assert_eq!(
            catalog.root_paths,
            vec![
                app_dir_root.to_string_lossy().into_owned(),
                app_data_root.to_string_lossy().into_owned()
            ]
        );
        assert_eq!(catalog.skills.len(), 1);
        assert_eq!(catalog.skills[0].description, "User override skill");
        assert_eq!(
            catalog.skills[0].path,
            shared_app_data.join("SKILL.md").to_string_lossy()
        );
    }
}
