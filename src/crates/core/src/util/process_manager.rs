use std::process::Command;
use std::sync::LazyLock;
use tokio::process::Command as TokioCommand;

#[cfg(windows)]
use log::warn;

#[cfg(windows)]
use std::sync::{Arc, Mutex};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
use win32job::Job;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

static GLOBAL_PROCESS_MANAGER: LazyLock<ProcessManager> = LazyLock::new(ProcessManager::new);

pub struct ProcessManager {
    #[cfg(windows)]
    job: Arc<Mutex<Option<Job>>>,
}

impl ProcessManager {
    fn new() -> Self {
        let manager = Self {
            #[cfg(windows)]
            job: Arc::new(Mutex::new(None)),
        };

        #[cfg(windows)]
        {
            if let Err(e) = manager.initialize_job() {
                warn!("Failed to initialize Windows Job object: {}", e);
            }
        }

        manager
    }

    #[cfg(windows)]
    fn initialize_job(&self) -> Result<(), Box<dyn std::error::Error>> {
        let job = create_process_job()?;
        assign_current_process(&job);

        let mut job_guard = lock_process_job(&self.job)?;
        *job_guard = Some(job);

        Ok(())
    }

    pub fn cleanup_all(&self) {
        #[cfg(windows)]
        {
            let mut job_guard = recover_process_job_lock(&self.job);
            job_guard.take();
        }
    }
}

#[cfg(windows)]
fn create_process_job() -> Result<Job, Box<dyn std::error::Error>> {
    use win32job::ExtendedLimitInfo;

    let job = Job::create()?;
    let mut limits = ExtendedLimitInfo::new();
    limits.limit_kill_on_job_close();
    job.set_extended_limit_info(&limits)?;

    Ok(job)
}

#[cfg(windows)]
fn assign_current_process(job: &Job) {
    if let Err(error) = job.assign_current_process() {
        warn!("Failed to assign current process to job: {}", error);
    }
}

#[cfg(windows)]
fn lock_process_job(
    job: &Mutex<Option<Job>>,
) -> Result<std::sync::MutexGuard<'_, Option<Job>>, std::io::Error> {
    job.lock().map_err(|error| {
        std::io::Error::other(format!("Failed to lock process manager job mutex: {error}"))
    })
}

#[cfg(windows)]
fn recover_process_job_lock(job: &Mutex<Option<Job>>) -> std::sync::MutexGuard<'_, Option<Job>> {
    match job.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            warn!("Process manager job mutex was poisoned during cleanup, recovering lock");
            poisoned.into_inner()
        }
    }
}

pub fn create_command<S: AsRef<std::ffi::OsStr>>(program: S) -> Command {
    let cmd = Command::new(program.as_ref());

    #[cfg(windows)]
    {
        let mut cmd = cmd;
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    }

    #[cfg(not(windows))]
    cmd
}

pub fn create_tokio_command<S: AsRef<std::ffi::OsStr>>(program: S) -> TokioCommand {
    let cmd = TokioCommand::new(program.as_ref());

    #[cfg(windows)]
    {
        let mut cmd = cmd;
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    }

    #[cfg(not(windows))]
    cmd
}

pub fn cleanup_all_processes() {
    GLOBAL_PROCESS_MANAGER.cleanup_all();
}
