import React from 'react';
import { useTranslation } from 'react-i18next';
import { ConfigPageHeader } from './ConfigPageHeader';
import { ConfigPageLayout, ConfigPageContent } from './ConfigPageLayout';
import { Button } from '../../../../component-library/components';

const ExampleShell: React.FC<{
  title: string;
  subtitle?: string;
  extra?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}> = ({ title, subtitle, extra, className, children }) => (
  <ConfigPageLayout className={className}>
    <ConfigPageHeader title={title} subtitle={subtitle} extra={extra} />
    <ConfigPageContent>{children}</ConfigPageContent>
  </ConfigPageLayout>
);

const HeaderActions: React.FC<{ items: Array<{ key: string; variant: 'primary' | 'secondary'; label: string }> }> = ({
  items
}) => (
  <>
    {items.map(({ key, variant, label }) => (
      <Button key={key} variant={variant} size="sm">
        {label}
      </Button>
    ))}
  </>
);

export const BasicHeaderExample: React.FC = () => {
  const { t } = useTranslation('settings');
  return (
    <ExampleShell title={t('configPageHeaderExample.basic.title')} />
  );
};

export const HeaderWithIconExample: React.FC = () => {
  const { t } = useTranslation('settings');
  return (
    <ExampleShell
      title={t('configPageHeaderExample.apiNetwork.title')}
      subtitle={t('configPageHeaderExample.apiNetwork.subtitle')}
    />
  );
};

export const HeaderWithActionsExample: React.FC = () => {
  const { t } = useTranslation('settings');
  return (
    <ExampleShell
      title={t('configPageHeaderExample.learning.title')}
      subtitle={t('configPageHeaderExample.learning.subtitle')}
      extra={
        <HeaderActions
          items={[
            {
              key: 'import',
              variant: 'secondary',
              label: t('configPageHeaderExample.learning.import')
            },
            {
              key: 'add-memory',
              variant: 'primary',
              label: t('configPageHeaderExample.learning.addMemory')
            }
          ]}
        />
      }
    />
  );
};

export const CompleteConfigPageExample: React.FC = () => {
  const { t } = useTranslation('settings');
  return (
    <ExampleShell
      className="my-custom-config-page"
      title={t('configPageHeaderExample.agents.title')}
      subtitle={t('configPageHeaderExample.agents.subtitle')}
      extra={
        <Button variant="primary" size="sm">
          {t('configPageHeaderExample.agents.create')}
        </Button>
      }
    >
      <div className="config-toolbar" />
      <div className="config-items" />
    </ExampleShell>
  );
};

export const ThemeConfigExample: React.FC = () => {
  const { t } = useTranslation('settings');
  return (
    <ExampleShell
      title={t('configPageHeaderExample.theme.title')}
      subtitle={t('configPageHeaderExample.theme.subtitle')}
      extra={
        <HeaderActions
          items={[
            {
              key: 'import',
              variant: 'secondary',
              label: t('configPageHeaderExample.theme.import')
            },
            {
              key: 'export',
              variant: 'secondary',
              label: t('configPageHeaderExample.theme.export')
            }
          ]}
        />
      }
    />
  );
};

