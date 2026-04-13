use crate::workspace_paths;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use tauri::{Manager, Runtime};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LockedModelRefPayload {
    pub profile_name: String,
    pub provider: String,
    pub model: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SessionMetaPayload {
    pub session_id: String,
    pub workspace_path: String,
    pub created_at: String,
    pub updated_at: String,
    pub title: Option<String>,
    pub locked_model: Option<LockedModelRefPayload>,
    pub scenario_id: Option<String>,
    pub scenario_version: Option<u32>,
    pub scenario_label: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SessionHistoryPayload {
    pub content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SessionMetadataPayload {
    created_at: Option<String>,
    updated_at: Option<String>,
    title: Option<String>,
    locked_model: Option<LockedModelRefPayload>,
    scenario_id: Option<String>,
    scenario_version: Option<u32>,
    scenario_label: Option<String>,
}

fn authorize_workspace_path<R: Runtime, M: Manager<R>>(
    manager: &M,
    workspace_path: &str,
) -> Result<PathBuf, String> {
    let authorized = workspace_paths::authorize_workspace_path(manager, Path::new(workspace_path))
        .map_err(|error| error.to_string())?;
    Ok(PathBuf::from(authorized.canonical_path))
}

fn validate_session_id(session_id: &str) -> Result<(), String> {
    if session_id.is_empty() {
        return Err("Session id cannot be empty.".to_string());
    }

    if session_id
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        Ok(())
    } else {
        Err(format!("Invalid session id: {session_id}"))
    }
}

fn sessions_dir(workspace_path: &Path) -> PathBuf {
    workspace_path.join(".agent").join("sessions")
}

fn session_file_path(workspace_path: &Path, session_id: &str) -> PathBuf {
    sessions_dir(workspace_path).join(format!("{session_id}.jsonl"))
}

fn metadata_file_path(workspace_path: &Path, session_id: &str) -> PathBuf {
    sessions_dir(workspace_path).join(format!("{session_id}.meta.json"))
}

fn read_transcript_timestamps(session_path: &Path) -> Option<(String, String)> {
    let content = fs::read_to_string(session_path).ok()?;
    let lines = content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty());
    let mut first_timestamp: Option<String> = None;
    let mut last_timestamp: Option<String> = None;

    for line in lines {
        let data = serde_json::from_str::<Value>(line).ok()?;
        let timestamp = data.get("timestamp")?.as_str()?.to_string();

        if first_timestamp.is_none() {
            first_timestamp = Some(timestamp.clone());
        }
        last_timestamp = Some(timestamp);
    }

    match (first_timestamp, last_timestamp) {
        (Some(created_at), Some(updated_at)) => Some((created_at, updated_at)),
        _ => None,
    }
}

fn read_session_metadata(metadata_path: &Path) -> Option<SessionMetadataPayload> {
    let content = fs::read_to_string(metadata_path).ok()?;
    serde_json::from_str::<SessionMetadataPayload>(&content).ok()
}

pub fn scan_workspace_sessions<R: Runtime, M: Manager<R>>(
    manager: &M,
    workspace_path: &str,
) -> Result<Vec<SessionMetaPayload>, String> {
    let workspace_path = authorize_workspace_path(manager, workspace_path)?;
    let sessions_dir = sessions_dir(&workspace_path);

    if !sessions_dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut sessions = Vec::new();

    for entry in fs::read_dir(&sessions_dir).map_err(|error| {
        format!(
            "Failed to read sessions directory {}: {error}",
            sessions_dir.display()
        )
    })? {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };

        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };

        if !file_type.is_file() {
            continue;
        }

        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();

        if !file_name.ends_with(".jsonl") {
            continue;
        }

        let session_id = file_name.trim_end_matches(".jsonl").to_string();
        let session_path = session_file_path(&workspace_path, &session_id);
        let metadata_path = metadata_file_path(&workspace_path, &session_id);

        let metadata = read_session_metadata(&metadata_path);
        let timestamps = match (
            metadata
                .as_ref()
                .and_then(|value| value.created_at.as_ref())
                .cloned(),
            metadata
                .as_ref()
                .and_then(|value| value.updated_at.as_ref())
                .cloned(),
        ) {
            (Some(created_at), Some(updated_at)) => Some((created_at, updated_at)),
            _ => read_transcript_timestamps(&session_path),
        };

        let Some((created_at, updated_at)) = timestamps else {
            continue;
        };

        sessions.push(SessionMetaPayload {
            session_id,
            workspace_path: workspace_path.to_string_lossy().into_owned(),
            created_at,
            updated_at,
            title: metadata.as_ref().and_then(|value| value.title.clone()),
            locked_model: metadata.as_ref().and_then(|value| value.locked_model.clone()),
            scenario_id: metadata.as_ref().and_then(|value| value.scenario_id.clone()),
            scenario_version: metadata.as_ref().and_then(|value| value.scenario_version),
            scenario_label: metadata.as_ref().and_then(|value| value.scenario_label.clone()),
        });
    }

    sessions.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    Ok(sessions)
}

pub fn read_session_history<R: Runtime, M: Manager<R>>(
    manager: &M,
    workspace_path: &str,
    session_id: &str,
) -> Result<SessionHistoryPayload, String> {
    validate_session_id(session_id)?;
    let workspace_path = authorize_workspace_path(manager, workspace_path)?;
    let session_path = session_file_path(&workspace_path, session_id);

    match fs::read_to_string(&session_path) {
        Ok(content) => Ok(SessionHistoryPayload {
            content: Some(content),
        }),
        Err(error) if error.kind() == ErrorKind::NotFound => {
            Ok(SessionHistoryPayload { content: None })
        }
        Err(error) => Err(format!(
            "Failed to read session history {}: {error}",
            session_path.display()
        )),
    }
}

pub fn delete_session_history<R: Runtime, M: Manager<R>>(
    manager: &M,
    workspace_path: &str,
    session_id: &str,
) -> Result<(), String> {
    validate_session_id(session_id)?;
    let workspace_path = authorize_workspace_path(manager, workspace_path)?;
    let session_path = session_file_path(&workspace_path, session_id);
    let metadata_path = metadata_file_path(&workspace_path, session_id);

    for path in [session_path, metadata_path] {
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "Failed to delete session file {}: {error}",
                    path.display()
                ))
            }
        }
    }

    Ok(())
}
