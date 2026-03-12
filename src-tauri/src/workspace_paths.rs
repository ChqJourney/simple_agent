use serde::Serialize;
use std::fmt;
use std::path::{Path, PathBuf};
use tauri::{Manager, Runtime};
use tauri_plugin_fs::FsExt;

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum WorkspacePrepareOutcome {
    Existing {
        canonical_path: String,
        existing_index: usize,
    },
    Created {
        canonical_path: String,
    },
}

#[derive(Debug, PartialEq, Eq)]
pub enum WorkspacePrepareError {
    NotFound(String),
    NotDirectory(String),
    CanonicalizeFailed(String),
    ScopeAuthorizationFailed(String),
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct AuthorizedWorkspacePath {
    pub canonical_path: String,
}

fn stringify_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(windows)]
fn normalize_canonical_path(path: PathBuf) -> PathBuf {
    let raw = path.to_string_lossy();

    if let Some(stripped) = raw.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{}", stripped))
    } else if let Some(stripped) = raw.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        path
    }
}

#[cfg(not(windows))]
fn normalize_canonical_path(path: PathBuf) -> PathBuf {
    path
}

fn canonicalize_workspace_path(path: &Path) -> Result<PathBuf, WorkspacePrepareError> {
    if !path.exists() {
        return Err(WorkspacePrepareError::NotFound(stringify_path(path)));
    }

    if !path.is_dir() {
        return Err(WorkspacePrepareError::NotDirectory(stringify_path(path)));
    }

    std::fs::canonicalize(path)
        .map(normalize_canonical_path)
        .map_err(|error| WorkspacePrepareError::CanonicalizeFailed(format!("{}: {}", stringify_path(path), error)))
}

fn canonicalize_existing_workspace(existing_path: &str) -> Option<String> {
    canonicalize_workspace_path(Path::new(existing_path))
        .ok()
        .map(|path| stringify_path(&path))
}

pub fn prepare_workspace_path(
    selected_path: &Path,
    existing_paths: &[String],
) -> Result<WorkspacePrepareOutcome, WorkspacePrepareError> {
    let canonical_path = stringify_path(&canonicalize_workspace_path(selected_path)?);

    for (existing_index, existing_path) in existing_paths.iter().enumerate() {
        if canonicalize_existing_workspace(existing_path).as_deref() == Some(canonical_path.as_str()) {
            return Ok(WorkspacePrepareOutcome::Existing {
                canonical_path,
                existing_index,
            });
        }
    }

    Ok(WorkspacePrepareOutcome::Created { canonical_path })
}

pub fn authorize_workspace_path<R: Runtime, M: Manager<R>>(
    manager: &M,
    selected_path: &Path,
) -> Result<AuthorizedWorkspacePath, WorkspacePrepareError> {
    let canonical_path = canonicalize_workspace_path(selected_path)?;

    manager
        .fs_scope()
        .allow_directory(&canonical_path, true)
        .map_err(|error| WorkspacePrepareError::ScopeAuthorizationFailed(error.to_string()))?;

    Ok(AuthorizedWorkspacePath {
        canonical_path: stringify_path(&canonical_path),
    })
}

impl fmt::Display for WorkspacePrepareError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            WorkspacePrepareError::NotFound(path) => {
                write!(f, "Workspace path does not exist: {}", path)
            }
            WorkspacePrepareError::NotDirectory(path) => {
                write!(f, "Workspace path is not a directory: {}", path)
            }
            WorkspacePrepareError::CanonicalizeFailed(details) => {
                write!(f, "Failed to resolve workspace path: {}", details)
            }
            WorkspacePrepareError::ScopeAuthorizationFailed(details) => {
                write!(f, "Failed to authorize workspace directory access: {}", details)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{prepare_workspace_path, WorkspacePrepareError, WorkspacePrepareOutcome};
    use std::fs;
    use tempfile::tempdir;

    fn expected_canonical_path(path: &std::path::Path) -> String {
        super::normalize_canonical_path(path.canonicalize().expect("canonical workspace path"))
            .to_string_lossy()
            .into_owned()
    }

    #[test]
    fn workspace_paths_matches_equivalent_paths_after_canonicalization() {
        let temp = tempdir().expect("temp dir");
        let workspace_dir = temp.path().join("workspace");
        let nested_dir = workspace_dir.join("nested");

        fs::create_dir_all(&nested_dir).expect("workspace directory");

        let existing_paths = vec![nested_dir.join("..").to_string_lossy().into_owned()];
        let selected_path = workspace_dir.join(".");

        let outcome = prepare_workspace_path(&selected_path, &existing_paths).expect("workspace outcome");

        assert_eq!(
            outcome,
            WorkspacePrepareOutcome::Existing {
                canonical_path: expected_canonical_path(&workspace_dir),
                existing_index: 0,
            }
        );
    }

    #[test]
    fn workspace_paths_rejects_file_paths() {
        let temp = tempdir().expect("temp dir");
        let file_path = temp.path().join("workspace.txt");

        fs::write(&file_path, "workspace").expect("workspace file");

        let outcome = prepare_workspace_path(&file_path, &[]);

        assert_eq!(
            outcome,
            Err(WorkspacePrepareError::NotDirectory(
                file_path.to_string_lossy().into_owned()
            ))
        );
    }

    #[test]
    fn workspace_paths_returns_created_for_new_directories() {
        let temp = tempdir().expect("temp dir");
        let workspace_dir = temp.path().join("workspace");

        fs::create_dir_all(&workspace_dir).expect("workspace directory");

        let outcome = prepare_workspace_path(&workspace_dir, &[]).expect("workspace outcome");

        assert_eq!(
            outcome,
            WorkspacePrepareOutcome::Created {
                canonical_path: expected_canonical_path(&workspace_dir),
            }
        );
    }
}
