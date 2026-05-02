/**
 * Alert component demo
 */

import React from 'react';
import { Alert, type AlertProps } from './Alert';
import { createLogger } from '@/shared/utils/logger';
import { useI18n } from '@/infrastructure/i18n';

const log = createLogger('AlertDemo');

const demoLayoutStyle: React.CSSProperties = {
  padding: '32px',
  maxWidth: '800px',
  display: 'flex',
  flexDirection: 'column',
  gap: '24px',
};

const titleStyle: React.CSSProperties = {
  color: '#e8e8e8',
  fontSize: '16px',
  fontWeight: '500',
  marginBottom: '4px',
};

const subtitleStyle: React.CSSProperties = {
  color: 'rgba(255,255,255,0.5)',
  fontSize: '13px',
};

const sectionTitleStyle: React.CSSProperties = {
  color: 'rgba(255,255,255,0.6)',
  fontSize: '13px',
  fontWeight: '500',
  marginBottom: '12px',
};

const stackStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
};

interface AlertExampleSectionProps {
  title: string;
  examples: AlertProps[];
}

const AlertExampleSection: React.FC<AlertExampleSectionProps> = ({ title, examples }) => (
  <section>
    <h3 style={sectionTitleStyle}>{title}</h3>
    <div style={stackStyle}>
      {examples.map((example, index) => (
        <Alert key={index} {...example} />
      ))}
    </div>
  </section>
);

export const AlertDemo: React.FC = () => {
  const { t } = useI18n('components');
  const sections: AlertExampleSectionProps[] = [
    {
      title: t('componentLibrary.alertDemo.sections.basic'),
      examples: [
        { type: 'success', message: t('componentLibrary.alertDemo.messages.operationSuccess') },
        { type: 'error', message: t('componentLibrary.alertDemo.messages.operationFailed') },
        { type: 'warning', message: t('componentLibrary.alertDemo.messages.operationRisk') },
        { type: 'info', message: t('componentLibrary.alertDemo.messages.infoMessage') },
      ],
    },
    {
      title: t('componentLibrary.alertDemo.sections.withTitle'),
      examples: [
        {
          type: 'success',
          title: t('componentLibrary.alertDemo.messages.deploySuccessTitle'),
          message: t('componentLibrary.alertDemo.messages.deploySuccessMessage'),
        },
        {
          type: 'error',
          title: t('componentLibrary.alertDemo.messages.deployFailedTitle'),
          message: t('componentLibrary.alertDemo.messages.deployFailedMessage'),
        },
      ],
    },
    {
      title: t('componentLibrary.alertDemo.sections.withDescription'),
      examples: [
        {
          type: 'warning',
          title: t('componentLibrary.alertDemo.messages.expiringTitle'),
          message: t('componentLibrary.alertDemo.messages.expiringMessage'),
          description: t('componentLibrary.alertDemo.messages.expiringDescription'),
        },
        {
          type: 'info',
          title: t('componentLibrary.alertDemo.messages.updateTitle'),
          message: t('componentLibrary.alertDemo.messages.updateMessage'),
          description: t('componentLibrary.alertDemo.messages.updateDescription'),
        },
      ],
    },
    {
      title: t('componentLibrary.alertDemo.sections.closable'),
      examples: [
        {
          type: 'success',
          message: t('componentLibrary.alertDemo.messages.closableMessage'),
          closable: true,
          onClose: () => log.debug('Alert closed'),
        },
        {
          type: 'info',
          title: t('componentLibrary.alertDemo.messages.closableInfoTitle'),
          message: t('componentLibrary.alertDemo.messages.closableInfoMessage'),
          closable: true,
        },
      ],
    },
    {
      title: t('componentLibrary.alertDemo.sections.noIcon'),
      examples: [
        {
          type: 'info',
          message: t('componentLibrary.alertDemo.messages.noIconMessage'),
          showIcon: false,
        },
      ],
    },
  ];

  return (
    <div style={demoLayoutStyle}>
      <div>
        <h2 style={titleStyle}>
          {t('componentLibrary.alertDemo.title')}
        </h2>
        <p style={subtitleStyle}>
          {t('componentLibrary.alertDemo.subtitle')}
        </p>
      </div>

      {sections.map((section) => (
        <AlertExampleSection key={section.title} {...section} />
      ))}
    </div>
  );
};

export default AlertDemo;
