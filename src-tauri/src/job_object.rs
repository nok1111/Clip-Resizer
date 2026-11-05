//! Windows Job Object: caps each ffmpeg child's committed memory and kills
//! every process in the job when the handle closes (no orphaned ffmpeg).
//! No-op off-Windows.

#[cfg(windows)]
mod imp {
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOB_OBJECT_LIMIT_PROCESS_MEMORY,
    };

    /// Per-render commit cap (4 GiB is generous even for 4K filters).
    const MEMORY_LIMIT: usize = 4 * 1024 * 1024 * 1024;

    /// Kernel handle as usize: job objects are process-wide kernel handles
    /// and safe to share across threads (`*mut c_void` is not Send/Sync).
    pub struct JobObject(usize);

    impl JobObject {
        /// Creates a job, sets the memory cap + kill-on-close, assigns `child`.
        pub fn for_child(child: &Child) -> std::io::Result<Self> {
            unsafe {
                let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if job.is_null() {
                    return Err(std::io::Error::last_os_error());
                }
                let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
                    BasicLimitInformation: std::mem::zeroed(),
                    IoInfo: std::mem::zeroed(),
                    ProcessMemoryLimit: MEMORY_LIMIT,
                    JobMemoryLimit: 0,
                    PeakProcessMemoryUsed: 0,
                    PeakJobMemoryUsed: 0,
                };
                info.BasicLimitInformation.LimitFlags =
                    JOB_OBJECT_LIMIT_PROCESS_MEMORY | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                if SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const _,
                    std::mem::size_of_val(&info) as u32,
                ) == 0
                {
                    let e = std::io::Error::last_os_error();
                    CloseHandle(job);
                    return Err(e);
                }
                if AssignProcessToJobObject(job, child.as_raw_handle() as HANDLE) == 0 {
                    let e = std::io::Error::last_os_error();
                    CloseHandle(job);
                    return Err(e);
                }
                Ok(Self(job as usize))
            }
        }
    }

    impl Drop for JobObject {
        fn drop(&mut self) {
            unsafe {
                TerminateJobObject(self.0 as HANDLE, 1);
                CloseHandle(self.0 as HANDLE);
            }
        }
    }
}

#[cfg(windows)]
pub use imp::JobObject;

/// Stub for non-Windows builds.
#[cfg(not(windows))]
pub struct JobObject;

#[cfg(not(windows))]
impl JobObject {
    pub fn for_child(_child: &std::process::Child) -> std::io::Result<Self> {
        Ok(Self)
    }
}
