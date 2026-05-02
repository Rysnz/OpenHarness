/**
 * IconButton component usage examples
 * Show various variants and states
 */

import React from 'react';
import { IconButton, type IconButtonProps } from './IconButton';
import { useI18n } from '@/infrastructure/i18n';

type IconSpec = {
  variant: NonNullable<IconButtonProps['variant']>;
  size?: NonNullable<IconButtonProps['size']>;
  shape?: NonNullable<IconButtonProps['shape']>;
  disabled?: boolean;
  icon?: 'plus' | 'heart';
};

const pageStyle: React.CSSProperties = { padding: '24px', background: '#1a1a1a', minHeight: '100vh' };
const titleStyle: React.CSSProperties = { color: '#fff', marginBottom: '24px' };
const sectionStyle: React.CSSProperties = { marginBottom: '32px' };
const sectionTitleStyle: React.CSSProperties = { color: '#a0a0a0', marginBottom: '16px' };
const rowStyle: React.CSSProperties = { display: 'flex', gap: '12px', alignItems: 'center' };
const usageStyle: React.CSSProperties = {
  marginTop: '48px',
  padding: '16px',
  background: 'rgba(255,255,255,0.05)',
  borderRadius: '8px',
};
const usageListStyle: React.CSSProperties = { color: '#a0a0a0', lineHeight: '1.8' };

const BASIC_BUTTONS: IconSpec[] = [
  { variant: 'default', size: 'small' },
  { variant: 'default', size: 'medium' },
  { variant: 'default', size: 'large' },
  { variant: 'default', size: 'medium', disabled: true },
];

const GHOST_BUTTONS: IconSpec[] = [
  { variant: 'ghost', size: 'small', icon: 'heart' },
  { variant: 'ghost', size: 'medium', icon: 'heart' },
  { variant: 'ghost', size: 'large', icon: 'heart' },
];

const PRIMARY_BUTTONS: IconSpec[] = [
  { variant: 'primary', size: 'small' },
  { variant: 'primary', size: 'medium' },
  { variant: 'primary', size: 'large' },
  { variant: 'primary', size: 'medium', disabled: true },
];

const SHAPE_BUTTONS: IconSpec[] = [
  { variant: 'default', shape: 'circle', size: 'medium' },
  { variant: 'primary', shape: 'circle', size: 'medium', icon: 'heart' },
];

const TONE_BUTTONS: IconSpec[] = [
  { variant: 'danger', size: 'medium' },
  { variant: 'success', size: 'medium' },
  { variant: 'warning', size: 'medium' },
  { variant: 'ai', size: 'medium' },
];

const PlusIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const HeartIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 14s-6-4-6-8c0-2.5 2-4 4-4 1.5 0 2.5 1 2 2 0 0-.5-1 0-2 1.5 0 4 1.5 4 4 0 4-4 8-4 8z" />
  </svg>
);

const DemoIcon = ({ name = 'plus' }: { name?: IconSpec['icon'] }) =>
  name === 'heart' ? <HeartIcon /> : <PlusIcon />;

function IconButtonRow({ specs }: { specs: IconSpec[] }) {
  return (
    <div style={rowStyle}>
      {specs.map((spec, index) => (
        <IconButton
          key={`${spec.variant}-${spec.size ?? 'medium'}-${spec.shape ?? 'square'}-${index}`}
          variant={spec.variant}
          size={spec.size}
          shape={spec.shape}
          disabled={spec.disabled}
        >
          <DemoIcon name={spec.icon} />
        </IconButton>
      ))}
    </div>
  );
}

export const IconButtonExample: React.FC = () => {
  const { t } = useI18n('components');
  const sections = [
    { key: 'basic', specs: BASIC_BUTTONS },
    { key: 'ghost', specs: GHOST_BUTTONS },
    { key: 'primary', specs: PRIMARY_BUTTONS },
    { key: 'shape', specs: SHAPE_BUTTONS },
    { key: 'other', specs: TONE_BUTTONS },
  ] as const;
  const usageItems = ['defaultGhost', 'primary', 'disabled', 'theme'] as const;

  return (
    <div style={pageStyle}>
      <h2 style={titleStyle}>
        {t('componentLibrary.iconButtonExample.title')}
      </h2>

      {sections.map((section) => (
        <div key={section.key} style={sectionStyle}>
          <h3 style={sectionTitleStyle}>
            {t(`componentLibrary.iconButtonExample.sections.${section.key}`)}
          </h3>
          <IconButtonRow specs={section.specs} />
        </div>
      ))}

      <div style={usageStyle}>
        <h3 style={{ ...titleStyle, marginBottom: '12px' }}>
          {t('componentLibrary.iconButtonExample.sections.usage')}
        </h3>
        <ul style={usageListStyle}>
          {usageItems.map((item) => (
            <li key={item}>
              <strong>{t(`componentLibrary.iconButtonExample.usage.${item}.label`)}</strong>
              {t(`componentLibrary.iconButtonExample.usage.${item}.text`)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default IconButtonExample;

