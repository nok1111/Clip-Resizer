use crate::StoreError;
use cr_model::{Language, Theme};
use serde::{Deserialize, Serialize};
use std::path::Path;
use ts_rs::TS;

pub(crate) const SETTINGS_KEY: &str = "app";
/// 0 = automatic (1 render at a time). Hard cap keeps the UI honest.
pub const MAX_CONCURRENT_RENDERS: u32 = 3;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(default, rename_all = "camelCase")]
#[ts(export)]
pub struct Settings {
    pub theme: Theme,
    pub language: Language,
    /// Default output folder for renders; None = ask each time.
    pub default_output_dir: Option<String>,
    /// Concurrent FFmpeg renders (0 = auto → 1). FFmpeg already uses all
    /// cores internally, so values above ~3 rarely help.
    pub concurrent_renders: u32,
    /// First-run wizard was finished or skipped.
    pub onboarding_done: bool,
    /// Activated license key (verified against the publisher public key on
    /// each read). A valid key unlocks the Pro policy; absent or invalid
    /// keys leave the app in Free.
    #[ts(type = "string | null")]
    pub license_key: Option<String>,
}

impl Settings {
    pub fn validate(&self) -> Result<(), StoreError> {
        if self.concurrent_renders > MAX_CONCURRENT_RENDERS {
            return Err(StoreError::Invalid {
                field: "concurrentRenders",
                reason: format!("must be between 0 (auto) and {MAX_CONCURRENT_RENDERS}"),
            });
        }
        if let Some(dir) = &self.default_output_dir {
            if dir.trim().is_empty() || !Path::new(dir).is_absolute() {
                return Err(StoreError::Invalid {
                    field: "defaultOutputDir",
                    reason: "must be an absolute path".into(),
                });
            }
        }
        Ok(())
    }

    /// Parses stored JSON field by field: unknown/invalid fields take their
    /// default value, and an invalid result as a whole yields defaults.
    pub(crate) fn from_json_lenient(raw: &str) -> Self {
        let Ok(serde_json::Value::Object(map)) = serde_json::from_str::<serde_json::Value>(raw)
        else {
            return Self::default();
        };
        let mut merged = serde_json::to_value(Self::default()).expect("defaults serialize");
        if let serde_json::Value::Object(base) = &mut merged {
            for (k, v) in map {
                if base.contains_key(&k) {
                    let mut probe = base.clone();
                    probe.insert(k.clone(), v.clone());
                    if serde_json::from_value::<Self>(serde_json::Value::Object(probe)).is_ok() {
                        base.insert(k, v);
                    }
                }
            }
        }
        serde_json::from_value::<Self>(merged)
            .ok()
            .filter(|s| s.validate().is_ok())
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lenient_parse_keeps_valid_fields_and_drops_garbage() {
        let s = Settings::from_json_lenient(
            r#"{"theme":"light","language":"es","concurrentRenders":2,"unknownField":1,"defaultOutputDir":123}"#,
        );
        assert_eq!(s.theme, Theme::Light);
        assert_eq!(s.language, Language::Es);
        assert_eq!(s.concurrent_renders, 2);
        assert_eq!(s.default_output_dir, None);
    }

    #[test]
    fn rejects_relative_output_dir() {
        let s = Settings {
            default_output_dir: Some("relative/dir".into()),
            ..Default::default()
        };
        assert!(s.validate().is_err());
    }
}
