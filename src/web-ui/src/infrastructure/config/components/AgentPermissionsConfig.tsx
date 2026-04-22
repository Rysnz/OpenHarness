import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle, RefreshCw, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { Badge, Button, Input, Select } from '@/component-library';
import {
  ConfigPageContent,
  ConfigPageHeader,
  ConfigPageLayout,
  ConfigPageRow,
  ConfigPageSection,
} from './common';
import { useNotification } from '@/shared/notification-system';
import { agentService } from '@/shared/services/agent-service';
import type {
  PermissionApprovalRequest,
  PermissionAuditRecord,
  PermissionDecision,
  PermissionRiskLevel,
  PermissionRule,
} from '@/infrastructure/api/service-api/AgentAPI';
import './AgentPermissionsConfig.scss';

type DraftRule = {
  ruleId: string;
  agentName: string;
  toolName: string;
  pathPrefix: string;
  commandContains: string;
  mcpServer: string;
  decision: PermissionDecision;
  riskLevel: PermissionRiskLevel;
  reason: string;
};

const emptyDraft = (): DraftRule => ({
  ruleId: `rule-${Date.now()}`,
  agentName: '',
  toolName: '',
  pathPrefix: '',
  commandContains: '',
  mcpServer: '',
  decision: 'ask',
  riskLevel: 'medium',
  reason: 'Matched permission rule',
});

function clean(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toPermissionRule(draft: DraftRule): PermissionRule {
  return {
    ruleId: draft.ruleId.trim(),
    agentName: clean(draft.agentName),
    toolName: clean(draft.toolName),
    pathPrefix: clean(draft.pathPrefix),
    commandContains: clean(draft.commandContains),
    mcpServer: clean(draft.mcpServer),
    decision: draft.decision,
    riskLevel: draft.riskLevel,
    reason: draft.reason.trim() || 'Matched permission rule',
  };
}

function decisionBadge(decision: PermissionDecision) {
  if (decision === 'allow') return <Badge variant="success">Allow</Badge>;
  if (decision === 'deny') return <Badge variant="error">Deny</Badge>;
  return <Badge variant="warning">Ask</Badge>;
}

function riskBadge(risk: PermissionRiskLevel) {
  if (risk === 'high') return <Badge variant="error">High</Badge>;
  if (risk === 'medium') return <Badge variant="warning">Medium</Badge>;
  return <Badge variant="success">Low</Badge>;
}

function summarizeMatchers(rule: PermissionRule): string {
  const parts = [
    rule.agentName ? `agent=${rule.agentName}` : null,
    rule.toolName ? `tool=${rule.toolName}` : null,
    rule.pathPrefix ? `path starts ${rule.pathPrefix}` : null,
    rule.commandContains ? `command has ${rule.commandContains}` : null,
    rule.mcpServer ? `mcp=${rule.mcpServer}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' / ') : 'Applies to all tool calls';
}

function formatTimestamp(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'Unknown time';
  return new Date(ms).toLocaleString();
}

const AgentPermissionsConfig: React.FC = () => {
  const notification = useNotification();
  const [rules, setRules] = useState<PermissionRule[]>([]);
  const [pending, setPending] = useState<PermissionApprovalRequest[]>([]);
  const [audits, setAudits] = useState<PermissionAuditRecord[]>([]);
  const [draft, setDraft] = useState<DraftRule>(() => emptyDraft());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [respondingToolId, setRespondingToolId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);
      const [nextRules, nextPending, nextAudits] = await Promise.all([
        agentService.listPermissionRules(),
        agentService.listPendingApprovals(),
        agentService.listPermissionAudits(100),
      ]);
      setRules(nextRules);
      setPending(nextPending);
      setAudits(nextAudits);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notification.error(message, { title: 'Permission data unavailable' });
    } finally {
      setLoading(false);
    }
  }, [notification]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const hasMatcher = useMemo(() => {
    return Boolean(
      draft.agentName.trim() ||
      draft.toolName.trim() ||
      draft.pathPrefix.trim() ||
      draft.commandContains.trim() ||
      draft.mcpServer.trim()
    );
  }, [draft]);

  const canSave = draft.ruleId.trim().length > 0 && hasMatcher;

  const updateDraft = <K extends keyof DraftRule>(key: K, value: DraftRule[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const saveRule = async () => {
    if (!canSave) {
      notification.warning('Add a rule id and at least one matcher before saving.');
      return;
    }

    try {
      setSaving(true);
      const nextRules = await agentService.upsertPermissionRule(toPermissionRule(draft));
      setRules(nextRules);
      setDraft(emptyDraft());
      notification.success('Permission rule saved.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notification.error(message, { title: 'Rule save failed' });
    } finally {
      setSaving(false);
    }
  };

  const deleteRule = async (ruleId: string) => {
    try {
      const nextRules = await agentService.removePermissionRule(ruleId);
      setRules(nextRules);
      notification.success('Permission rule removed.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notification.error(message, { title: 'Rule removal failed' });
    }
  };

  const respondApproval = async (
    request: PermissionApprovalRequest,
    approved: boolean
  ) => {
    try {
      setRespondingToolId(request.toolCallId);
      await agentService.respondApproval({
        toolId: request.toolCallId,
        approved,
        reason: approved ? 'Approved from permission settings' : 'Denied from permission settings',
      });
      await loadAll();
      notification.success(approved ? 'Tool call approved.' : 'Tool call denied.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notification.error(message, { title: 'Approval response failed' });
    } finally {
      setRespondingToolId(null);
    }
  };

  return (
    <ConfigPageLayout className="openharness-agent-permissions">
      <ConfigPageHeader
        title="Agent permissions"
        subtitle="Review approvals, rule matching, shell risk decisions, and the audit trail used by agent tool execution."
        extra={
          <Button
            variant="secondary"
            size="small"
            onClick={() => void loadAll()}
            disabled={loading}
          >
            <RefreshCw size={14} />
            Refresh
          </Button>
        }
      />

      <ConfigPageContent>
        <ConfigPageSection
          title="Pending approvals"
          description="Tool calls waiting for an explicit allow or deny decision."
        >
          <div className="openharness-agent-permissions__list">
            {pending.length === 0 ? (
              <p className="openharness-agent-permissions__empty">No tool calls are waiting.</p>
            ) : (
              pending.map((request) => (
                <div
                  key={request.toolCallId}
                  className="openharness-agent-permissions__item"
                >
                  <div className="openharness-agent-permissions__item-main">
                    <div className="openharness-agent-permissions__item-title">
                      <ShieldCheck size={16} />
                      <span>{request.toolName}</span>
                      {riskBadge(request.riskLevel)}
                    </div>
                    <p className="openharness-agent-permissions__item-meta">
                      {request.reason}
                    </p>
                    <p className="openharness-agent-permissions__item-meta">
                      {request.sessionId} / {request.dialogTurnId}
                    </p>
                  </div>
                  <div className="openharness-agent-permissions__actions">
                    <Button
                      variant="success"
                      size="small"
                      disabled={respondingToolId === request.toolCallId}
                      onClick={() => void respondApproval(request, true)}
                    >
                      <CheckCircle size={14} />
                      Allow
                    </Button>
                    <Button
                      variant="danger"
                      size="small"
                      disabled={respondingToolId === request.toolCallId}
                      onClick={() => void respondApproval(request, false)}
                    >
                      <XCircle size={14} />
                      Deny
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </ConfigPageSection>

        <ConfigPageSection
          title="Rules"
          description="Rules are matched before a tool runs. Deny rules win over ask and allow."
        >
          <div className="openharness-agent-permissions__form">
            <ConfigPageRow
              label="Rule id"
              description="Use a stable id to update the same rule later."
              balanced
            >
              <Input
                data-testid="agent-permissions-rule-id"
                value={draft.ruleId}
                onChange={(event) => updateDraft('ruleId', event.target.value)}
                placeholder="rule-shell-risk"
              />
            </ConfigPageRow>

            <ConfigPageRow
              label="Decision"
              description="Choose the outcome when all filled matchers apply."
              balanced
            >
              <div className="openharness-agent-permissions__inline-fields">
                <Select
                  value={draft.decision}
                  options={[
                    { value: 'ask', label: 'Ask' },
                    { value: 'allow', label: 'Allow' },
                    { value: 'deny', label: 'Deny' },
                  ]}
                  onChange={(value) => updateDraft('decision', value as PermissionDecision)}
                />
                <Select
                  value={draft.riskLevel}
                  options={[
                    { value: 'low', label: 'Low risk' },
                    { value: 'medium', label: 'Medium risk' },
                    { value: 'high', label: 'High risk' },
                  ]}
                  onChange={(value) => updateDraft('riskLevel', value as PermissionRiskLevel)}
                />
              </div>
            </ConfigPageRow>

            <ConfigPageRow
              label="Matchers"
              description="Fill one or more fields. Empty fields are ignored."
              multiline
            >
              <div className="openharness-agent-permissions__matcher-grid">
                <Input
                  data-testid="agent-permissions-agent-name"
                  label="Agent"
                  value={draft.agentName}
                  onChange={(event) => updateDraft('agentName', event.target.value)}
                  placeholder="default"
                />
                <Input
                  data-testid="agent-permissions-tool-name"
                  label="Tool"
                  value={draft.toolName}
                  onChange={(event) => updateDraft('toolName', event.target.value)}
                  placeholder="Bash"
                />
                <Input
                  data-testid="agent-permissions-path-prefix"
                  label="Path prefix"
                  value={draft.pathPrefix}
                  onChange={(event) => updateDraft('pathPrefix', event.target.value)}
                  placeholder="F:\\G\\demo\\OpenHarness-V2"
                />
                <Input
                  data-testid="agent-permissions-command-contains"
                  label="Command contains"
                  value={draft.commandContains}
                  onChange={(event) => updateDraft('commandContains', event.target.value)}
                  placeholder="rm -rf"
                />
                <Input
                  data-testid="agent-permissions-mcp-server"
                  label="MCP server"
                  value={draft.mcpServer}
                  onChange={(event) => updateDraft('mcpServer', event.target.value)}
                  placeholder="github"
                />
                <Input
                  data-testid="agent-permissions-reason"
                  label="Reason"
                  value={draft.reason}
                  onChange={(event) => updateDraft('reason', event.target.value)}
                  placeholder="Matched permission rule"
                />
              </div>
            </ConfigPageRow>

            <div className="openharness-agent-permissions__form-actions">
              <Button
                data-testid="agent-permissions-save-rule"
                variant="primary"
                size="small"
                disabled={!canSave}
                isLoading={saving}
                onClick={() => void saveRule()}
              >
                Save rule
              </Button>
              <Button
                data-testid="agent-permissions-reset-rule"
                variant="ghost"
                size="small"
                onClick={() => setDraft(emptyDraft())}
              >
                Reset
              </Button>
            </div>
          </div>

          <div className="openharness-agent-permissions__list">
            {rules.length === 0 ? (
              <p className="openharness-agent-permissions__empty">No permission rules are configured.</p>
            ) : (
              rules.map((rule) => (
                <div key={rule.ruleId} className="openharness-agent-permissions__item">
                  <div className="openharness-agent-permissions__item-main">
                    <div className="openharness-agent-permissions__item-title">
                      <span>{rule.ruleId}</span>
                      {decisionBadge(rule.decision)}
                      {riskBadge(rule.riskLevel)}
                    </div>
                    <p className="openharness-agent-permissions__item-meta">
                      {summarizeMatchers(rule)}
                    </p>
                    <p className="openharness-agent-permissions__item-meta">
                      {rule.reason}
                    </p>
                  </div>
                  <Button
                    data-testid={`agent-permissions-remove-${rule.ruleId}`}
                    variant="danger"
                    size="small"
                    onClick={() => void deleteRule(rule.ruleId)}
                  >
                    <Trash2 size={14} />
                    Remove
                  </Button>
                </div>
              ))
            )}
          </div>
        </ConfigPageSection>

        <ConfigPageSection
          title="Audit trail"
          description="Recent permission decisions, including rule hits, approvals, and shell risk checks."
        >
          <div className="openharness-agent-permissions__list">
            {audits.length === 0 ? (
              <p className="openharness-agent-permissions__empty">No permission decisions recorded yet.</p>
            ) : (
              audits.map((record) => (
                <div key={record.auditId} className="openharness-agent-permissions__item">
                  <div className="openharness-agent-permissions__item-main">
                    <div className="openharness-agent-permissions__item-title">
                      <span>{record.toolName}</span>
                      {decisionBadge(record.effectiveDecision)}
                      {riskBadge(record.riskLevel)}
                    </div>
                    <p className="openharness-agent-permissions__item-meta">
                      {record.action} / {formatTimestamp(record.timestampMs)}
                    </p>
                    <p className="openharness-agent-permissions__item-meta">
                      {record.reason}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </ConfigPageSection>
      </ConfigPageContent>
    </ConfigPageLayout>
  );
};

export default AgentPermissionsConfig;
