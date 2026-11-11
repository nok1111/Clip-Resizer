//! SQLite persistence (rusqlite, bundled): settings today; presets and
//! render history arrive with their phases. Migrations are append-only.

mod migrations;
mod settings;

pub use settings::Settings;

use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid {field}: {reason}")]
    Invalid {
        field: &'static str,
        reason: String,
    },
    #[error("database schema v{found} is newer than supported v{supported}")]
    UnsupportedSchema { found: i64, supported: i64 },
    #[error("store lock poisoned")]
    Poisoned,
}

pub type Result<T> = std::result::Result<T, StoreError>;

pub struct Store {
    conn: Mutex<Connection>,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        Self::from_connection(Connection::open(path)?)
    }

    #[cfg(test)]
    fn open_in_memory() -> Result<Self> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(mut conn: Connection) -> Result<Self> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        migrations::run(&mut conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn settings(&self) -> Result<Settings> {
        let conn = self.conn.lock().map_err(|_| StoreError::Poisoned)?;
        let raw: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                [settings::SETTINGS_KEY],
                |r| r.get(0),
            )
            .ok();
        drop(conn);
        Ok(match raw {
            Some(raw) => Settings::from_json_lenient(&raw),
            None => Settings::default(),
        })
    }

    pub fn save_settings(&self, settings: &Settings) -> Result<Settings> {
        settings.validate()?;
        let conn = self.conn.lock().map_err(|_| StoreError::Poisoned)?;
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [
                settings::SETTINGS_KEY,
                serde_json::to_string(settings)?.as_str(),
            ],
        )?;
        drop(conn);
        self.settings()
    }

    /// Insert a finished render into history (per-item row).
    pub fn insert_render(
        &self,
        input: &str,
        output: &str,
        status: &str,
        bytes: i64,
        finished_at: i64,
    ) -> Result<()> {
        let meta = serde_json::json!({ "input": input, "output": output, "status": status });
        let out_dir = std::path::Path::new(output)
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();
        let conn = self.conn.lock().map_err(|_| StoreError::Poisoned)?;
        conn.execute(
            "INSERT INTO render_history (at, inputs, ok, failed, bytes_out, output_dir, meta)
             VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                finished_at,
                if status == "done" { 1 } else { 0 },
                if status == "done" { 0 } else { 1 },
                bytes,
                out_dir,
                meta.to_string(),
            ],
        )?;
        Ok(())
    }

    /// Latest finished renders, newest first.
    pub fn recent_renders(&self, limit: u32) -> Result<Vec<cr_model::HistoryRow>> {
        let conn = self.conn.lock().map_err(|_| StoreError::Poisoned)?;
        let mut st = conn.prepare(
            "SELECT id, at, ok, bytes_out, meta
             FROM render_history ORDER BY id DESC LIMIT ?1",
        )?;
        let rows = st
            .query_map([limit], |r| {
                let meta: String = r.get(4)?;
                let m: serde_json::Value =
                    serde_json::from_str(&meta).unwrap_or(serde_json::json!({}));
                let ok: i64 = r.get(2)?;
                Ok(cr_model::HistoryRow {
                    id: r.get(0)?,
                    input: m["input"].as_str().unwrap_or("").to_string(),
                    output: m["output"].as_str().unwrap_or("").to_string(),
                    status: if ok > 0 { "done" } else { "failed" }.to_string(),
                    bytes: r.get(3)?,
                    finished_at: r.get(1)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Save a named preset (spec JSON). Returns its id.
    pub fn save_preset(&self, name: &str, spec_json: &str) -> Result<i64> {
        let name = name.trim();
        if name.is_empty() || name.len() > 60 {
            return Err(StoreError::Invalid {
                field: "preset.name",
                reason: "1-60 chars".into(),
            });
        }
        let at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let conn = self.conn.lock().map_err(|_| StoreError::Poisoned)?;
        conn.execute(
            "INSERT INTO presets (name, spec, created_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(name) DO UPDATE SET spec = excluded.spec",
            rusqlite::params![name, spec_json, at],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn delete_preset(&self, name: &str) -> Result<bool> {
        let conn = self.conn.lock().map_err(|_| StoreError::Poisoned)?;
        Ok(conn.execute("DELETE FROM presets WHERE name = ?1", [name])? > 0)
    }

    /// (name, spec_json) pairs ordered by name.
    pub fn list_presets(&self) -> Result<Vec<(String, String)>> {
        let conn = self.conn.lock().map_err(|_| StoreError::Poisoned)?;
        let mut st = conn.prepare("SELECT name, spec FROM presets ORDER BY name")?;
        let rows = st
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn reset_settings(&self) -> Result<Settings> {
        let conn = self.conn.lock().map_err(|_| StoreError::Poisoned)?;
        conn.execute(
            "DELETE FROM settings WHERE key = ?1",
            [settings::SETTINGS_KEY],
        )?;
        drop(conn);
        self.settings()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_roundtrip_and_reset() {
        let store = Store::open_in_memory().unwrap();
        let mut s = store.settings().unwrap();
        assert_eq!(s, Settings::default());
        s.onboarding_done = true;
        s.concurrent_renders = 2;
        let saved = store.save_settings(&s).unwrap();
        assert!(saved.onboarding_done);
        assert_eq!(saved.concurrent_renders, 2);
        let reset = store.reset_settings().unwrap();
        assert_eq!(reset, Settings::default());
    }

    #[test]
    fn invalid_settings_rejected() {
        let store = Store::open_in_memory().unwrap();
        let s = Settings {
            concurrent_renders: 99,
            ..Default::default()
        };
        assert!(store.save_settings(&s).is_err());
    }
}
