import React, { useState, useCallback, useMemo } from 'react';
import {
  FolderPlus,
  FolderOpen,
  FileText,
  FolderTree,
  AlertCircle,
  Check,
  X
} from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';
import { createLogger } from '@/shared/utils/logger';
import { Modal, Button, Input } from '@/component-library';
import './NewProjectDialog.scss';

const log = createLogger('NewProjectDialog');

export interface NewProjectDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (parentPath: string, projectName: string) => Promise<void>;
  defaultParentPath?: string;
}

interface ProjectFieldProps {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}

const normalizePreviewPath = (parentPath: string, projectName: string): string => {
  const trimmedName = projectName.trim();
  if (!parentPath || !trimmedName) {
    return '';
  }

  return `${parentPath.replace(/\\/g, '/')}/${trimmedName}`;
};

const ProjectField: React.FC<ProjectFieldProps> = ({ icon, label, children }) => (
  <div className="new-project-dialog__field">
    <label className="new-project-dialog__label">
      {icon}
      {label}
    </label>
    {children}
  </div>
);

const DialogHero: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => (
  <div className="new-project-dialog__hero">
    <div className="new-project-dialog__icon-wrapper">
      <FolderPlus size={24} />
    </div>
    <h2 className="new-project-dialog__title">{title}</h2>
    <p className="new-project-dialog__subtitle">{subtitle}</p>
  </div>
);

const FullPathPreview: React.FC<{ label: string; path: string }> = ({ label, path }) => {
  if (!path) {
    return null;
  }

  return (
    <div className="new-project-dialog__preview">
      <div className="new-project-dialog__preview-icon">
        <FolderTree size={14} />
      </div>
      <div className="new-project-dialog__preview-content">
        <span className="new-project-dialog__preview-label">{label}</span>
        <span className="new-project-dialog__preview-path">{path}</span>
      </div>
    </div>
  );
};

const ErrorMessage: React.FC<{ message: string }> = ({ message }) => (
  message ? (
    <div className="new-project-dialog__error">
      <AlertCircle size={14} />
      <span>{message}</span>
    </div>
  ) : null
);

const useNewProjectForm = ({
  defaultParentPath,
  onConfirm,
  onClose,
  t
}: {
  defaultParentPath?: string;
  onConfirm: NewProjectDialogProps['onConfirm'];
  onClose: NewProjectDialogProps['onClose'];
  t: (key: string) => string;
}) => {
  const [parentPath, setParentPath] = useState(defaultParentPath || '');
  const [projectName, setProjectName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');
  const fullPath = useMemo(
    () => normalizePreviewPath(parentPath, projectName),
    [parentPath, projectName]
  );

  const resetForm = useCallback(() => {
    setParentPath('');
    setProjectName('');
    setError('');
  }, []);

  const selectParentPath = useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('newProject.selectParentDirectory'),
        defaultPath: parentPath || defaultParentPath
      });

      if (selected && typeof selected === 'string') {
        setParentPath(selected);
        setError('');
      }
    } catch (error) {
      log.error('Failed to select directory', error);
    }
  }, [defaultParentPath, parentPath, t]);

  const updateProjectName = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setProjectName(event.target.value);
    setError('');
  }, []);

  const cancel = useCallback(() => {
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  const submit = useCallback(async () => {
    const trimmedParent = parentPath.trim();
    const trimmedName = projectName.trim();

    if (!trimmedParent) {
      setError(t('newProject.errorSelectParent'));
      return;
    }
    if (!trimmedName) {
      setError(t('newProject.errorEnterName'));
      return;
    }

    setIsCreating(true);
    setError('');

    try {
      await onConfirm(trimmedParent, trimmedName);
      resetForm();
      onClose();
    } catch (error) {
      log.error('Failed to create project', error);
      setError(error instanceof Error ? error.message : t('newProject.errorCreateFailed'));
    } finally {
      setIsCreating(false);
    }
  }, [onClose, onConfirm, parentPath, projectName, resetForm, t]);

  return {
    parentPath,
    projectName,
    fullPath,
    isCreating,
    error,
    selectParentPath,
    updateProjectName,
    submit,
    cancel
  };
};

export const NewProjectDialog: React.FC<NewProjectDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  defaultParentPath
}) => {
  const { t } = useTranslation('common');
  const form = useNewProjectForm({ defaultParentPath, onConfirm, onClose, t });

  return (
    <Modal
      isOpen={isOpen}
      onClose={form.cancel}
      title=""
      size="small"
      showCloseButton={true}
    >
      <div className="new-project-dialog">
        <DialogHero
          title={t('newProject.title')}
          subtitle={t('newProject.subtitle')}
        />

        <div className="new-project-dialog__content">
          <ProjectField icon={<FolderOpen size={14} />} label={t('newProject.parentDirectory')}>
            <div className="new-project-dialog__path-selector">
              <div className="new-project-dialog__path-input">
                <Input
                  type="text"
                  value={form.parentPath}
                  readOnly
                  placeholder={t('newProject.parentDirectoryPlaceholder')}
                />
              </div>
              <Button
                type="button"
                className="new-project-dialog__select-btn"
                variant="secondary"
                size="small"
                onClick={form.selectParentPath}
              >
                <FolderOpen size={14} />
                <span>{t('newProject.select')}</span>
              </Button>
            </div>
          </ProjectField>

          <ProjectField icon={<FileText size={14} />} label={t('newProject.projectName')}>
            <div className="new-project-dialog__name-input">
              <Input
                type="text"
                value={form.projectName}
                onChange={form.updateProjectName}
                placeholder={t('newProject.projectNamePlaceholder')}
                disabled={form.isCreating}
                autoFocus
              />
            </div>
          </ProjectField>

          <FullPathPreview label={t('newProject.fullPath')} path={form.fullPath} />
          <ErrorMessage message={form.error} />
        </div>

        <div className="new-project-dialog__footer">
          <Button
            type="button"
            className="new-project-dialog__btn new-project-dialog__btn--cancel"
            variant="ghost"
            size="small"
            onClick={form.cancel}
            disabled={form.isCreating}
          >
            <X size={14} />
            {t('newProject.cancel')}
          </Button>
          <Button
            type="button"
            className="new-project-dialog__btn new-project-dialog__btn--confirm"
            variant="primary"
            size="small"
            onClick={form.submit}
            disabled={form.isCreating}
            isLoading={form.isCreating}
          >
            {form.isCreating ? (
              t('newProject.creating')
            ) : (
              <>
                <Check size={14} />
                {t('newProject.create')}
              </>
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
