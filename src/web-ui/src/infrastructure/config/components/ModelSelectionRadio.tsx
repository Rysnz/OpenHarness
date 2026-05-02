import React, { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from '@/component-library';
import type { AIModelConfig } from '../types';
import { getModelDisplayName } from '../services/modelConfigs';
import './ModelSelectionRadio.scss';

export interface ModelSelectionRadioProps {
  value: string;
  models: AIModelConfig[];
  onChange: (modelId: string) => void;
  disabled?: boolean;
  layout?: 'horizontal' | 'vertical';
  size?: 'small' | 'medium';
}

const isSpecialModel = (value: string): value is 'primary' | 'fast' => {
  return value === 'primary' || value === 'fast';
};

type SelectionType = 'primary' | 'fast' | 'custom';

function getSelectionType(value: string): SelectionType {
  if (value === 'primary') return 'primary';
  if (value === 'fast') return 'fast';
  return 'custom';
}

function getSelectValue(modelId: string | number | (string | number)[]): string {
  return String(Array.isArray(modelId) ? modelId[0] : modelId);
}

export const ModelSelectionRadio: React.FC<ModelSelectionRadioProps> = ({
  value,
  models,
  onChange,
  disabled = false,
  layout = 'horizontal',
  size = 'medium',
}) => {
  const { t } = useTranslation('settings/default-model');
  const uniqueId = useId();
  const radioName = `model-selection-${uniqueId}`;

  const selectionType = useMemo(() => getSelectionType(value), [value]);

  const customModelId = useMemo(() => {
    return isSpecialModel(value) ? undefined : value;
  }, [value]);

  const handleSelectionChange = (selection: 'primary' | 'fast' | 'custom') => {
    if (selection === 'custom') {
      const newModelId = customModelId || models[0]?.id || 'primary';
      onChange(newModelId);
    } else {
      onChange(selection);
    }
  };

  const handleCustomModelChange = (modelId: string | number | (string | number)[]) => {
    onChange(getSelectValue(modelId));
  };

  const enabledModelOptions = useMemo(() => {
    return models
      .filter(model => model.enabled)
      .map(model => ({
        label: getModelDisplayName(model),
        value: model.id!,
      }));
  }, [models]);

  const renderChoice = (choice: SelectionType, label: string, extraClass = '') => (
    <label
      className={`model-selection-radio__option ${extraClass} ${selectionType === choice ? 'model-selection-radio__option--selected' : ''}`}
    >
      <input
        type="radio"
        name={radioName}
        value={choice}
        checked={selectionType === choice}
        onChange={() => handleSelectionChange(choice)}
        disabled={disabled}
        className="model-selection-radio__input"
      />
      <span className="model-selection-radio__label">
        {label}
      </span>
    </label>
  );

  return (
    <div
      className={`model-selection-radio model-selection-radio--${layout} model-selection-radio--${size}`}
    >
      {renderChoice('primary', t('selection.primary'))}
      {renderChoice('fast', t('selection.fast'))}

      <label
        className={`model-selection-radio__option model-selection-radio__option--custom ${selectionType === 'custom' ? 'model-selection-radio__option--selected' : ''}`}
      >
        <input
          type="radio"
          name={radioName}
          value="custom"
          checked={selectionType === 'custom'}
          onChange={() => handleSelectionChange('custom')}
          disabled={disabled}
          className="model-selection-radio__input"
        />
        <span className="model-selection-radio__label">
          {t('selection.custom')}
        </span>

        {selectionType === 'custom' && (
          <div className="model-selection-radio__dropdown">
            <Select
              value={customModelId || ''}
              onChange={handleCustomModelChange}
              disabled={disabled}
              placeholder={t('selection.selectModel')}
              options={enabledModelOptions}
              size="small"
            />
          </div>
        )}
      </label>
    </div>
  );
};

export default ModelSelectionRadio;
