//! A Windows Job Object that owns one engine process tree (Story 1.2).
//!
//! The job is created with `KILL_ON_JOB_CLOSE`, so closing its handle (on `Drop`, or when the
//! shell itself dies) kills every process in it: `uv`, the venv launcher, the interpreter and
//! anything they spawned. Children join their parent's job automatically.

use std::io;
use std::os::windows::io::AsRawHandle;
use std::process::Child;
use std::ptr;
use std::thread;
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectBasicAccountingInformation,
    JobObjectExtendedLimitInformation, QueryInformationJobObject, SetInformationJobObject,
    TerminateJobObject, JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

const POLL: Duration = Duration::from_millis(10);

pub struct Job(HANDLE);

// A job handle is a kernel handle; the job APIs may be called from any thread.
unsafe impl Send for Job {}
unsafe impl Sync for Job {}

impl Job {
    /// Creates an unnamed, non-inheritable job that kills its processes when its handle closes.
    pub fn new() -> io::Result<Job> {
        // SAFETY: null attributes and name are allowed; the handle is checked before use.
        let handle = unsafe { CreateJobObjectW(ptr::null(), ptr::null()) };
        if handle.is_null() {
            return Err(io::Error::last_os_error());
        }
        let job = Job(handle);
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        // SAFETY: `info` is the structure the information class names, with its exact size.
        let ok = unsafe {
            SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const core::ffi::c_void,
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(job)
    }

    /// Puts `child` (and so everything it spawns from now on) into the job.
    pub fn assign(&self, child: &Child) -> io::Result<()> {
        // SAFETY: both handles are valid for the duration of the call.
        let ok = unsafe { AssignProcessToJobObject(self.0, child.as_raw_handle() as HANDLE) };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    /// Number of processes in the job that are still running.
    pub fn active_processes(&self) -> io::Result<u32> {
        let mut info = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
        // SAFETY: `info` is the structure the information class names, with its exact size.
        let ok = unsafe {
            QueryInformationJobObject(
                self.0,
                JobObjectBasicAccountingInformation,
                &mut info as *mut _ as *mut core::ffi::c_void,
                size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                ptr::null_mut(),
            )
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(info.ActiveProcesses)
    }

    /// Kills every process in the job, then polls until none is left.
    /// Returns false if processes are still alive after `timeout` (or the job can't be queried).
    pub fn terminate_and_wait(&self, timeout: Duration) -> bool {
        // SAFETY: valid job handle. A failure here is caught by the count check below.
        unsafe { TerminateJobObject(self.0, 1) };
        let deadline = Instant::now() + timeout;
        loop {
            match self.active_processes() {
                Ok(0) => return true,
                Ok(_) => {}
                Err(_) => return false,
            }
            if Instant::now() >= deadline {
                return false;
            }
            thread::sleep(POLL);
        }
    }
}

impl Drop for Job {
    fn drop(&mut self) {
        // SAFETY: the handle is owned by this value and closed exactly once.
        unsafe { CloseHandle(self.0) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::{Command, Stdio};

    fn sleeper() -> Child {
        Command::new("cmd")
            .args(["/c", "ping -n 30 127.0.0.1 >nul"])
            .stdout(Stdio::null())
            .spawn()
            .expect("cmd starts")
    }

    fn exits_within(child: &mut Child, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if child.try_wait().expect("try_wait").is_some() {
                return true;
            }
            thread::sleep(POLL);
        }
        false
    }

    #[test]
    fn terminate_and_wait_kills_the_tree_and_empties_the_job() {
        let job = Job::new().unwrap();
        let mut child = sleeper();
        job.assign(&child).unwrap();
        // cmd starts ping.exe, so the job soon holds two processes.
        thread::sleep(Duration::from_millis(300));
        assert!(job.active_processes().unwrap() >= 1);
        assert!(job.terminate_and_wait(Duration::from_secs(5)));
        assert_eq!(job.active_processes().unwrap(), 0);
        assert!(exits_within(&mut child, Duration::from_secs(1)));
    }

    #[test]
    fn dropping_the_job_kills_its_processes() {
        let job = Job::new().unwrap();
        let mut child = sleeper();
        job.assign(&child).unwrap();
        drop(job);
        assert!(exits_within(&mut child, Duration::from_secs(5)));
    }
}
