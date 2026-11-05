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

    /// Insert a finished render into history.
    pub fn insert_render(
        &self,
        input: &str,
        output: &str,
        status: &str,
        bytes: i64,
        finished_at: i64,
    ) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| StoreError::Poisoned)?;
        conn.execute(
            "INSERT INTO render_history (input, output, status, bytes, finished_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![input, output, status, bytes, finished_at],
        )?;
        Ok(())
    }

    /// Latest finished renders, newest first.
    pub fn recent_renders(&self, limit: u32) -> Result<Vec<cr_model::HistoryRow>> {
        let conn = self.conn.lock().map_err(|_| StoreError::Poisoned)?;
        let mut st = conn.prepare(
            "SELECT id, input, output, status, bytes, finished_at
             FROM render_history ORDER BY id DESC LIMIT ?1",
        )?;
        let rows = st
            .query_map([limit], |r| {
                Ok(cr_model::HistoryRow {
                    id: r.get(0)?,
                    input: r.get(1)?,
                    output: r.get(2)?,
                    status: r.get(3)?,
                    bytes: r.get(4)?,
                    finished_at: r.get(5)?,
                })
            })?
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
