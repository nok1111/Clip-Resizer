use crate::error::{CommandError, CommandResult};
use crate::policy;
use crate::state::AppState;
use cr_license::LicenseStatus;
use tauri::State;

fn status_for(state: &AppState) -> CommandResult<LicenseStatus> {
    let settings = state.store.settings()?;
    let info = settings.license_key.as_deref().map(cr_license::verify).transpose().ok().flatten();
    Ok(LicenseStatus {
        activated: info.is_some(),
        key_id: info.map(|i| i.key_id),
        edition: policy::edition_for(&settings),
    })
}

#[tauri::command]
pub fn license_status(state: State<'_, AppState>) -> CommandResult<LicenseStatus> {
    status_for(&state)
}

#[tauri::command]
pub fn license_activate(state: State<'_, AppState>, key: String) -> CommandResult<LicenseStatus> {
    cr_license::verify(&key).map_err(|e| CommandError::new("invalid_license", e.to_string()))?;
    let mut settings = state.store.settings()?;
    settings.license_key = Some(key.trim().to_string());
    state.store.save_settings(&settings)?;
    status_for(&state)
}

#[tauri::command]
pub fn license_deactivate(state: State<'_, AppState>) -> CommandResult<LicenseStatus> {
    let mut settings = state.store.settings()?;
    settings.license_key = None;
    state.store.save_settings(&settings)?;
    status_for(&state)
}
