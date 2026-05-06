import React, { useState } from 'react';
import { Bot, ChevronDown, ChevronUp } from 'lucide-react';
import { useI18n } from '@/infrastructure/i18n';
import { BaseToolCard, BaseToolCardProps } from '../BaseToolCard';
import './TaskCard.scss';

export interface TaskCardProps extends Omit<BaseToolCardProps, 'toolName' | 'displayName'> {
  taskType?: string;
  taskDescription?: string;
  taskResult?: string;
}

interface ResolvedTaskContent {
  type: string;
  description: string;
  result: string;
}

export const TaskCard: React.FC<TaskCardProps> = ({
  taskType,
  taskDescription,
  taskResult,
  input,
  result,
  status = 'pending',
  displayMode = 'compact',
  ...baseProps
}) => {
  const { t } = useI18n('components');
  const [isExpanded, setIsExpanded] = useState(false);

  const resolvedTask = resolveTaskContent({
    taskType,
    taskDescription,
    taskResult,
    input,
    result,
    t,
  });

  if (displayMode === 'compact') {
    return (
      <div className={`task-card task-card--compact task-card--${status}`}>
        <Bot className="task-card__icon" size={14} />
        <span className="task-card__action">{resolvedTask.type}:</span>
        <span className="task-card__description" title={resolvedTask.description}>
          {resolvedTask.description}
        </span>
      </div>
    );
  }

  return (
    <BaseToolCard
      toolName="Task"
      displayName={t('flowChatCards.taskCard.title')}
      icon={<Bot size={18} />}
      description={t('flowChatCards.taskCard.description')}
      status={status}
      displayMode={displayMode}
      input={input}
      result={result}
      primaryColor="#7c3aed"
      className="task-card"
      {...baseProps}
    >
      <div className="task-card__info">
        <TaskInfoRow label={t('flowChatCards.taskCard.taskType')} value={resolvedTask.type} />
        <TaskInfoRow
          label={t('flowChatCards.taskCard.taskDesc')}
          value={resolvedTask.description}
        />
      </div>

      {status === 'completed' && resolvedTask.result && (
        <TaskResultSection
          label={t('flowChatCards.taskCard.taskResult')}
          result={resolvedTask.result}
          isExpanded={isExpanded}
          onToggle={() => setIsExpanded((expanded) => !expanded)}
        />
      )}

      {(status === 'running' || status === 'streaming') && (
        <TaskExecuting label={t('flowChatCards.taskCard.processing')} />
      )}
    </BaseToolCard>
  );
};

interface ResolveTaskContentArgs {
  taskType?: string;
  taskDescription?: string;
  taskResult?: string;
  input?: Record<string, any>;
  result?: Record<string, any>;
  t: (key: string) => string;
}

function resolveTaskContent({
  taskType,
  taskDescription,
  taskResult,
  input,
  result,
  t,
}: ResolveTaskContentArgs): ResolvedTaskContent {
  return {
    type: taskType || input?.task_type || input?.type || t('flowChatCards.taskCard.defaultType'),
    description:
      taskDescription ||
      input?.description ||
      input?.task ||
      input?.prompt ||
      t('flowChatCards.taskCard.unspecifiedTask'),
    result: taskResult || result?.result || result?.output || '',
  };
}

const TaskInfoRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="task-card__info-row">
    <span className="task-card__label">{label}:</span>
    <span className="task-card__value">{value}</span>
  </div>
);

interface TaskResultSectionProps {
  label: string;
  result: string;
  isExpanded: boolean;
  onToggle: () => void;
}

const TaskResultSection: React.FC<TaskResultSectionProps> = ({
  label,
  result,
  isExpanded,
  onToggle,
}) => (
  <div className="task-card__result-section">
    <button className="task-card__result-header" onClick={onToggle}>
      <Bot size={14} />
      <span>{label}</span>
      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
    </button>

    {isExpanded && (
      <div className="task-card__result-content">
        <pre className="task-card__result-text">{result}</pre>
      </div>
    )}
  </div>
);

const TaskExecuting: React.FC<{ label: string }> = ({ label }) => (
  <div className="task-card__executing">
    <Bot className="task-card__executing-icon" size={14} />
    <span>{label}</span>
  </div>
);
