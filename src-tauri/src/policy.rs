//! Declarative edition policy: Free vs Pro limits, enforced in the backend.
//! License activation (Phase 6) will replace `settings.edition` as the source.

use cr_model::{Background, RenderSpec, VideoCodec};
use cr_store::Edition;

use crate::error::{CommandError, CommandResult};

/// Free edition canvas ceiling: any standard 1080p preset fits
/// (1080x1920 = 2,073,600 px is exactly the boundary).
const FREE_MAX_CANVAS_PX: u64 = 1080 * 1920;
/// Free edition may enqueue at most this many items at once.
const FREE_MAX_BATCH: usize = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Policy {
    Free,
    Pro,
}

impl Policy {
    pub fn for_edition(e: Edition) -> Self {
        match e {
            Edition::Free => Self::Free,
            Edition::Pro => Self::Pro,
        }
    }

    pub fn id(&self) -> &'static str {
        match self {
            Self::Free => "free",
            Self::Pro => "pro",
        }
    }

    fn deny(code: &'static str, message: impl Into<String>) -> CommandError {
        CommandError::new("pro_required", format!("{code}: {}", message.into()))
    }

    /// Checks a single render. `Ok` means allowed.
    pub fn check_render(&self, spec: &RenderSpec) -> CommandResult<()> {
        if self == &Self::Pro {
            return Ok(());
        }
        let px = spec.canvas.width as u64 * spec.canvas.height as u64;
        if px > FREE_MAX_CANVAS_PX {
            return Err(Self::deny(
                "canvas",
                format!(
                    "Free edition renders up to 1080×1920 ({}×{} requested)",
                    spec.canvas.width, spec.canvas.height
                ),
            ));
        }
        if spec.export.codec == VideoCodec::H265 {
            return Err(Self::deny("codec", "H.265 export requires Pro"));
        }
        if spec.export.bitrate_kbps.is_some() {
            return Err(Self::deny("bitrate", "custom bitrate requires Pro"));
        }
        if let Background::Image { .. } = spec.background {
            return Err(Self::deny("background", "image backgrounds require Pro"));
        }
        if spec.guides.export {
            return Err(Self::deny("guides", "burned-in guides require Pro"));
        }
        Ok(())
    }

    /// Batch limits on top of the per-render checks.
    pub fn check_batch(&self, specs: &[RenderSpec]) -> CommandResult<()> {
        if self == &Self::Free && specs.len() > FREE_MAX_BATCH {
            return Err(Self::deny(
                "batch",
                format!("Free edition renders one video at a time ({} queued)", specs.len()),
            ));
        }
        for s in specs {
            self.check_render(s)?;
        }
        Ok(())
    }

    /// Custom presets are a Pro feature.
    pub fn check_preset_save(&self) -> CommandResult<()> {
        if self == &Self::Free {
            return Err(Self::deny("presets", "custom presets require Pro"));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cr_model::*;

    fn spec() -> RenderSpec {
        RenderSpec {
            input: "a.mp4".into(),
            canvas: Canvas { width: 1080, height: 1920 },
            fit: FitSpec::Fit { zoom: 1.0 },
            background: Background::Solid { color: "#000".into() },
            margin: 0.0,
            border: (0.0, "#fff".into()),
            guides: Guides { safe: true, thirds: false, center: false, export: false },
            export: ExportSpec {
                codec: VideoCodec::H264,
                quality: QualityPreset::Balanced,
                bitrate_kbps: None,
                fps: None,
                audio: AudioMode::Copy,
            },
        }
    }

    #[test]
    fn free_allows_1080p_h264() {
        assert!(Policy::Free.check_render(&spec()).is_ok());
    }

    #[test]
    fn free_denies_pro_paths() {
        let mut s = spec();
        s.canvas = Canvas { width: 1080, height: 2560 };
        assert!(Policy::Free.check_render(&s).is_err());
        let mut s = spec();
        s.export.codec = VideoCodec::H265;
        assert!(Policy::Free.check_render(&s).is_err());
        let mut s = spec();
        s.export.bitrate_kbps = Some(10_000);
        assert!(Policy::Free.check_render(&s).is_err());
        let mut s = spec();
        s.background = Background::Image { path: "x.png".into(), blur: 0.0 };
        assert!(Policy::Free.check_render(&s).is_err());
        let mut s = spec();
        s.guides.export = true;
        assert!(Policy::Free.check_render(&s).is_err());
        // batching >1 is Pro
        assert!(Policy::Free.check_batch(&[spec(), spec()]).is_err());
        assert!(Policy::Free.check_batch(&[spec()]).is_ok());
        // Pro allows everything
        let mut s = spec();
        s.export.codec = VideoCodec::H265;
        s.canvas = Canvas { width: 2160, height: 3840 };
        s.background = Background::Image { path: "x.png".into(), blur: 0.0 };
        assert!(Policy::Pro.check_batch(&[s.clone(), s]).is_ok());
    }
}
