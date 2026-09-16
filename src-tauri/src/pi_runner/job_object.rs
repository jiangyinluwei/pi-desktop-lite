/// Windows Win32 Job Object 孤儿进程自动收割器
/// 确保当主进程崩溃或退出时，操作系统内核自动无条件级联终止所有衍生子进程

pub struct JobObjectManager {
    #[cfg(windows)]
    handle: windows_sys::Win32::Foundation::HANDLE,
}

// JobObjectManager 在线程间安全共享
unsafe impl Send for JobObjectManager {}
unsafe impl Sync for JobObjectManager {}

impl JobObjectManager {
    pub fn new() -> Result<Self, String> {
        #[cfg(windows)]
        {
            use std::mem::size_of;
            use std::ptr::null;
            use windows_sys::Win32::Foundation::{HANDLE, INVALID_HANDLE_VALUE};
            use windows_sys::Win32::System::JobObjects::{
                CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
                JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK,
            };

            unsafe {
                let handle: HANDLE = CreateJobObjectW(null(), null());
                if handle.is_null() || handle == INVALID_HANDLE_VALUE {
                    return Err("Failed to create Win32 Job Object".to_string());
                }

                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags =
                    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK;

                let success = SetInformationJobObject(
                    handle,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const _,
                    size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );

                if success == 0 {
                    windows_sys::Win32::Foundation::CloseHandle(handle);
                    return Err("Failed to set JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE".to_string());
                }

                log::info!("[JobObject] Initialized Win32 Job Object for child reaper successfully.");
                Ok(Self { handle })
            }
        }

        #[cfg(not(windows))]
        {
            Ok(Self {})
        }
    }

    /// 创建 Job Object 的统一入口（supervisor / host_pool 共用，杜绝逐字重复的伪容错）：
    /// 首次失败记录告警并重试一次；仍失败即 panic 终止 —— Job Object 是孤儿进程级联收割的
    /// 最后防线，缺失将导致主进程崩溃后内核子进程沦为孤儿，绝不静默降级运行。
    /// panic 消息携带组件名与两次失败原因，杜绝「容错」假象掩盖必然复现的确定性失败。
    pub fn create_or_panic(component: &str) -> Self {
        match Self::new() {
            Ok(mgr) => mgr,
            Err(first_err) => {
                log::warn!("[{}] JobObject init failed (1st attempt): {}", component, first_err);
                Self::new().unwrap_or_else(|second_err| {
                    panic!(
                        "[{}] JobObject init failed twice: {} / {}",
                        component, first_err, second_err
                    );
                })
            }
        }
    }

    /// 将进程句柄以 usize 整数形式传入并加入 Job Object
    pub fn assign_process_usize(&self, process_handle_usize: usize) -> Result<(), String> {
        #[cfg(windows)]
        {
            use windows_sys::Win32::Foundation::HANDLE;
            use windows_sys::Win32::System::JobObjects::AssignProcessToJobObject;

            let handle = process_handle_usize as HANDLE;
            unsafe {
                let res = AssignProcessToJobObject(self.handle, handle);
                if res == 0 {
                    return Err("Failed to assign process to Win32 Job Object".to_string());
                }
            }
            Ok(())
        }
        #[cfg(not(windows))]
        {
            let _ = process_handle_usize;
            Ok(())
        }
    }
}

impl Drop for JobObjectManager {
    fn drop(&mut self) {
        #[cfg(windows)]
        {
            if !self.handle.is_null() && self.handle != windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE {
                unsafe {
                    windows_sys::Win32::Foundation::CloseHandle(self.handle);
                }
            }
        }
    }
}
