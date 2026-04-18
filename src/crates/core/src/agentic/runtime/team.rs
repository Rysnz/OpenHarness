use super::agent_task::{AgentTaskId, AgentTaskStatus};
use super::patch_store::AgentPatchSummary;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentTeam {
    pub team_id: String,
    pub name: String,
    pub objective: String,
    pub members: Vec<AgentTaskId>,
    pub mailbox_id: String,
}

impl AgentTeam {
    pub fn new(name: String, objective: String, members: Vec<AgentTaskId>) -> Self {
        Self {
            team_id: format!("agteam-{}", uuid::Uuid::new_v4()),
            mailbox_id: format!("agmailbox-{}", uuid::Uuid::new_v4()),
            name,
            objective,
            members,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentTeamMemberStatus {
    pub task_id: AgentTaskId,
    pub status: AgentTaskStatus,
    pub result_summary: Option<String>,
    pub failure_reason: Option<String>,
    pub patch_summary: AgentPatchSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentTeamStatus {
    pub team_id: String,
    pub name: String,
    pub objective: String,
    pub total_members: usize,
    pub queued: usize,
    pub running: usize,
    pub waiting_approval: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub cancelled: usize,
    pub interrupted: usize,
    pub patch_summary: AgentPatchSummary,
    pub members: Vec<AgentTeamMemberStatus>,
    pub succeeded_members: Vec<AgentTaskId>,
    pub failed_members: Vec<AgentTaskId>,
    pub failed_reasons: Vec<String>,
    pub recommended_next_step: String,
}

#[derive(Default)]
pub struct AgentTeamStore {
    teams: RwLock<HashMap<String, AgentTeam>>,
}

impl AgentTeamStore {
    pub async fn upsert(&self, team: AgentTeam) {
        self.teams.write().await.insert(team.team_id.clone(), team);
    }

    pub async fn get(&self, team_id: &str) -> Option<AgentTeam> {
        self.teams.read().await.get(team_id).cloned()
    }

    pub async fn list(&self) -> Vec<AgentTeam> {
        self.teams.read().await.values().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn upsert_and_get_team() {
        let store = AgentTeamStore::default();
        let team = AgentTeam::new(
            "runtime-team".to_string(),
            "finish migration".to_string(),
            vec![AgentTaskId::from("agtask-1")],
        );
        let team_id = team.team_id.clone();

        store.upsert(team).await;

        let loaded = store.get(&team_id).await.expect("team should exist");
        assert_eq!(loaded.name, "runtime-team");
        assert_eq!(loaded.objective, "finish migration");
        assert_eq!(loaded.members.len(), 1);
    }
}
