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
import { useI18n } from '@/infrastructure/i18n';
import './AgentPermissionsConfig.scss';

type SettingsT = (key: string, options?: Record<string, unknown>) => string;

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

function decisionBadge(decision: PermissionDecision, t: SettingsT) {
  if (decision === 'allow') return <Badge variant="success">{t('agentPermissions.decision.allow', { defaultValue: '允许' })}</Badge>;
  if (decision === 'deny') return <Badge variant="error">{t('agentPermissions.decision.deny', { defaultValue: '拒绝' })}</Badge>;
  return <Badge variant="warning">{t('agentPermissions.decision.ask', { defaultValue: '询问' })}</Badge>;
}

function riskBadge(risk: PermissionRiskLevel, t: SettingsT) {
  if (risk === 'high') return <Badge variant="error">{t('agentPermissions.risk.high', { defaultValue: '高风险' })}</Badge>;
  if (risk === 'medium') return <Badge variant="warning">{t('agentPermissions.risk.medium', { defaultValue: '中风险' })}</Badge>;
  return <Badge variant="success">{t('agentPermissions.risk.low', { defaultValue: '低风险' })}</Badge>;
}

function summarizeMatchers(rule: PermissionRule, t: SettingsT): string {
  const parts = [
    rule.agentName ? `${t('agentPermissions.fields.agent', { defaultValue: '智能体' })}=${rule.agentName}` : null,
    rule.toolName ? `${t('agentPermissions.fields.tool', { defaultValue: '工具' })}=${rule.toolName}` : null,
    rule.pathPrefix ? `${t('agentPermissions.fields.pathPrefix', { defaultValue: '路径前缀' })}=${rule.pathPrefix}` : null,
    rule.commandContains ? `${t('agentPermissions.fields.commandContains', { defaultValue: '命令包含' })}=${rule.commandContains}` : null,
    rule.mcpServer ? `${t('agentPermissions.fields.mcpServer', { defaultValue: 'MCP 服务' })}=${rule.mcpServer}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' / ') : t('agentPermissions.allTools', { defaultValue: '适用于所有工具调用' });
}

function formatTimestamp(ms: number, t: SettingsT): string {
  if (!Number.isFinite(ms) || ms <= 0) return t('agentPermissions.unknownTime', { defaultValue: '未知时间' });
  return new Date(ms).toLocaleString();
}

const AgentPermissionsConfig: React.FC = () => {
  const { t } = useI18n('settings');
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
      notification.error(message, { title: t('agentPermissions.notifications.loadFailed', { defaultValue: '权限数据不可用' }) });
    } finally {
      setLoading(false);
    }
  }, [notification, t]);

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
      notification.warning(t('agentPermissions.notifications.needMatcher', { defaultValue: '保存前请填写规则 ID，并至少添加一个匹配条件。' }));
      return;
    }

    try {
      setSaving(true);
      const nextRules = await agentService.upsertPermissionRule(toPermissionRule(draft));
      setRules(nextRules);
      setDraft(emptyDraft());
      notification.success(t('agentPermissions.notifications.saved', { defaultValue: '权限规则已保存。' }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notification.error(message, { title: t('agentPermissions.notifications.saveFailed', { defaultValue: '规则保存失败' }) });
    } finally {
      setSaving(false);
    }
  };

  const deleteRule = async (ruleId: string) => {
    try {
      const nextRules = await agentService.removePermissionRule(ruleId);
      setRules(nextRules);
      notification.success(t('agentPermissions.notifications.removed', { defaultValue: '权限规则已移除。' }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notification.error(message, { title: t('agentPermissions.notifications.removeFailed', { defaultValue: '规则移除失败' }) });
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
        reason: approved
          ? t('agentPermissions.approval.approvedReason', { defaultValue: '从权限设置中批准' })
          : t('agentPermissions.approval.deniedReason', { defaultValue: '从权限设置中拒绝' }),
      });
      await loadAll();
      notification.success(approved
        ? t('agentPermissions.notifications.approved', { defaultValue: '工具调用已允许。' })
        : t('agentPermissions.notifications.denied', { defaultValue: '工具调用已拒绝。' }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notification.error(message, { title: t('agentPermissions.notifications.approvalFailed', { defaultValue: '审批响应失败' }) });
    } finally {
      setRespondingToolId(null);
    }
  };

  return (
    <ConfigPageLayout className="openharness-agent-permissions">
      <ConfigPageHeader
        title={t('agentPermissions.title', { defaultValue: '智能体权限' })}
        subtitle={t('agentPermissions.subtitle', { defaultValue: '查看工具审批、规则匹配、Shell 风险决策和智能体工具执行审计记录。' })}
        extra={
          <Button
            variant="secondary"
            size="small"
            onClick={() => void loadAll()}
            disabled={loading}
          >
            <RefreshCw size={14} />
            {t('agentPermissions.refresh', { defaultValue: '刷新' })}
          </Button>
        }
      />

      <ConfigPageContent>
        <ConfigPageSection
          title={t('agentPermissions.pending.title', { defaultValue: '待审批' })}
          description={t('agentPermissions.pending.description', { defaultValue: '等待你明确允许或拒绝的工具调用。' })}
        >
          <div className="openharness-agent-permissions__list">
            {pending.length === 0 ? (
              <p className="openharness-agent-permissions__empty">{t('agentPermissions.pending.empty', { defaultValue: '当前没有等待审批的工具调用。' })}</p>
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
                      {riskBadge(request.riskLevel, t)}
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
                      {t('agentPermissions.decision.allow', { defaultValue: '允许' })}
                    </Button>
                    <Button
                      variant="danger"
                      size="small"
                      disabled={respondingToolId === request.toolCallId}
                      onClick={() => void respondApproval(request, false)}
                    >
                      <XCircle size={14} />
                      {t('agentPermissions.decision.deny', { defaultValue: '拒绝' })}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </ConfigPageSection>

        <ConfigPageSection
          title={t('agentPermissions.rules.title', { defaultValue: '规则' })}
          description={t('agentPermissions.rules.description', { defaultValue: '规则会在工具运行前匹配。拒绝规则优先于询问和允许。' })}
        >
          <div className="openharness-agent-permissions__form">
            <ConfigPageRow
              label={t('agentPermissions.fields.ruleId', { defaultValue: '规则 ID' })}
              description={t('agentPermissions.fields.ruleIdDescription', { defaultValue: '使用稳定 ID，后续可以更新同一条规则。' })}
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
              label={t('agentPermissions.fields.decision', { defaultValue: '决策' })}
              description={t('agentPermissions.fields.decisionDescription', { defaultValue: '当所有已填写的匹配条件命中时，选择对应处理方式。' })}
              balanced
            >
              <div className="openharness-agent-permissions__inline-fields">
                <Select
                  value={draft.decision}
                  options={[
                    { value: 'ask', label: t('agentPermissions.decision.ask', { defaultValue: '询问' }) },
                    { value: 'allow', label: t('agentPermissions.decision.allow', { defaultValue: '允许' }) },
                    { value: 'deny', label: t('agentPermissions.decision.deny', { defaultValue: '拒绝' }) },
                  ]}
                  onChange={(value) => updateDraft('decision', value as PermissionDecision)}
                />
                <Select
                  value={draft.riskLevel}
                  options={[
                    { value: 'low', label: t('agentPermissions.risk.low', { defaultValue: '低风险' }) },
                    { value: 'medium', label: t('agentPermissions.risk.medium', { defaultValue: '中风险' }) },
                    { value: 'high', label: t('agentPermissions.risk.high', { defaultValue: '高风险' }) },
                  ]}
                  onChange={(value) => updateDraft('riskLevel', value as PermissionRiskLevel)}
                />
              </div>
            </ConfigPageRow>

            <ConfigPageRow
              label={t('agentPermissions.fields.matchers', { defaultValue: '匹配条件' })}
              description={t('agentPermissions.fields.matchersDescription', { defaultValue: '填写一个或多个字段，空字段会被忽略。' })}
              multiline
            >
              <div className="openharness-agent-permissions__matcher-grid">
                <Input
                  data-testid="agent-permissions-agent-name"
                  label={t('agentPermissions.fields.agent', { defaultValue: '智能体' })}
                  value={draft.agentName}
                  onChange={(event) => updateDraft('agentName', event.target.value)}
                  placeholder="default"
                />
                <Input
                  data-testid="agent-permissions-tool-name"
                  label={t('agentPermissions.fields.tool', { defaultValue: '工具' })}
                  value={draft.toolName}
                  onChange={(event) => updateDraft('toolName', event.target.value)}
                  placeholder="Bash"
                />
                <Input
                  data-testid="agent-permissions-path-prefix"
                  label={t('agentPermissions.fields.pathPrefix', { defaultValue: '路径前缀' })}
                  value={draft.pathPrefix}
                  onChange={(event) => updateDraft('pathPrefix', event.target.value)}
                  placeholder="F:\\G\\demo\\OpenHarness-V2"
                />
                <Input
                  data-testid="agent-permissions-command-contains"
                  label={t('agentPermissions.fields.commandContains', { defaultValue: '命令包含' })}
                  value={draft.commandContains}
                  onChange={(event) => updateDraft('commandContains', event.target.value)}
                  placeholder="rm -rf"
                />
                <Input
                  data-testid="agent-permissions-mcp-server"
                  label={t('agentPermissions.fields.mcpServer', { defaultValue: 'MCP 服务' })}
                  value={draft.mcpServer}
                  onChange={(event) => updateDraft('mcpServer', event.target.value)}
                  placeholder="github"
                />
                <Input
                  data-testid="agent-permissions-reason"
                  label={t('agentPermissions.fields.reason', { defaultValue: '原因' })}
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
                {t('agentPermissions.rules.save', { defaultValue: '保存规则' })}
              </Button>
              <Button
                data-testid="agent-permissions-reset-rule"
                variant="ghost"
                size="small"
                onClick={() => setDraft(emptyDraft())}
              >
                {t('agentPermissions.rules.reset', { defaultValue: '重置' })}
              </Button>
            </div>
          </div>

          <div className="openharness-agent-permissions__list">
            {rules.length === 0 ? (
              <p className="openharness-agent-permissions__empty">{t('agentPermissions.rules.empty', { defaultValue: '还没有配置权限规则。' })}</p>
            ) : (
              rules.map((rule) => (
                <div key={rule.ruleId} className="openharness-agent-permissions__item">
                  <div className="openharness-agent-permissions__item-main">
                    <div className="openharness-agent-permissions__item-title">
                      <span>{rule.ruleId}</span>
                      {decisionBadge(rule.decision, t)}
                      {riskBadge(rule.riskLevel, t)}
                    </div>
                    <p className="openharness-agent-permissions__item-meta">
                      {summarizeMatchers(rule, t)}
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
                    {t('agentPermissions.rules.remove', { defaultValue: '移除' })}
                  </Button>
                </div>
              ))
            )}
          </div>
        </ConfigPageSection>

        <ConfigPageSection
          title={t('agentPermissions.audit.title', { defaultValue: '审计记录' })}
          description={t('agentPermissions.audit.description', { defaultValue: '最近的权限决策，包括规则命中、审批和 Shell 风险检查。' })}
        >
          <div className="openharness-agent-permissions__list">
            {audits.length === 0 ? (
              <p className="openharness-agent-permissions__empty">{t('agentPermissions.audit.empty', { defaultValue: '还没有记录权限决策。' })}</p>
            ) : (
              audits.map((record) => (
                <div key={record.auditId} className="openharness-agent-permissions__item">
                  <div className="openharness-agent-permissions__item-main">
                    <div className="openharness-agent-permissions__item-title">
                      <span>{record.toolName}</span>
                      {decisionBadge(record.effectiveDecision, t)}
                      {riskBadge(record.riskLevel, t)}
                    </div>
                    <p className="openharness-agent-permissions__item-meta">
                      {record.action} / {formatTimestamp(record.timestampMs, t)}
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
