pub(crate) mod agent_memory_impl;
pub mod capture;
pub mod consolidation;
pub mod models;
pub mod search;
pub mod storage;

pub(crate) use agent_memory_impl::{
    build_scoped_agent_memory_prompt, build_workspace_agent_memory_prompt,
};
