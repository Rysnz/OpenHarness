import { useCallback, useEffect, useMemo, useState } from 'react';
import { ModelConfig } from '../shared/types';
import { modelConfigManager } from '../infrastructure/config/services/modelConfigs';

const CURRENT_CONFIG_KEY = 'wing_coder_current_model_config';

function persistCurrentConfig(config: ModelConfig | null) {
  if (config) {
    localStorage.setItem(CURRENT_CONFIG_KEY, config.id);
  } else {
    localStorage.removeItem(CURRENT_CONFIG_KEY);
  }

  window.dispatchEvent(new StorageEvent('storage', {
    key: CURRENT_CONFIG_KEY,
    newValue: config?.id || null,
    storageArea: localStorage
  }));
}

function findConfig(configs: ModelConfig[], configId?: string | null) {
  return configId ? configs.find(config => config.id === configId) ?? null : null;
}

export const useModelConfigs = () => {
  const [configs, setConfigs] = useState<ModelConfig[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setConfigs(modelConfigManager.getAllConfigs());
    setLoading(false);
    
    const unsubscribe = modelConfigManager.addListener((updatedConfigs) => {
      setConfigs(updatedConfigs);
      setLoading(false);
    });
    
    return unsubscribe;
  }, []);

  const refresh = useCallback(() => {
    setConfigs(modelConfigManager.getAllConfigs());
  }, []);

  return {
    configs,
    loading,
    refresh
  };
};

export const useCurrentModelConfig = (initialConfigId?: string) => {
  const { configs } = useModelConfigs();
  const [currentConfig, setCurrentConfig] = useState<ModelConfig | null>(null);

  const setCurrentConfigWithPersistence = useCallback((config: ModelConfig | null) => {
    setCurrentConfig(config);
    persistCurrentConfig(config);
  }, []);

  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === CURRENT_CONFIG_KEY && e.storageArea === localStorage) {
        if (e.newValue) {
          const targetConfig = findConfig(configs, e.newValue);
          if (targetConfig && targetConfig.id !== currentConfig?.id) {
            setCurrentConfig(targetConfig);
          }
        } else if (currentConfig) {
          setCurrentConfig(null);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [configs, currentConfig]);

  useEffect(() => {
    const chooseFallback = () => configs[0] ?? null;

    if (configs.length === 0) {
      setCurrentConfig(null);
      return;
    }

    if (!currentConfig) {
      const savedConfigId = localStorage.getItem(CURRENT_CONFIG_KEY);
      const targetConfigId = initialConfigId || savedConfigId;
      const requestedConfig = findConfig(configs, targetConfigId);

      if (requestedConfig) {
        setCurrentConfig(requestedConfig);
        localStorage.setItem(CURRENT_CONFIG_KEY, requestedConfig.id);
        return;
      }

      const firstConfig = chooseFallback();
      if (firstConfig) {
        setCurrentConfig(firstConfig);
        localStorage.setItem(CURRENT_CONFIG_KEY, firstConfig.id);
      }
      return;
    }

    const currentConfigExists = findConfig(configs, currentConfig.id);
    if (!currentConfigExists) {
      const firstConfig = chooseFallback();
      if (firstConfig) {
        setCurrentConfig(firstConfig);
        localStorage.setItem(CURRENT_CONFIG_KEY, firstConfig.id);
      } else {
        setCurrentConfig(null);
        localStorage.removeItem(CURRENT_CONFIG_KEY);
      }
    } else {
      const updatedConfig = findConfig(configs, currentConfig.id);
      if (updatedConfig && JSON.stringify(updatedConfig) !== JSON.stringify(currentConfig)) {
        setCurrentConfig(updatedConfig);
      }
    }
  }, [configs, currentConfig, initialConfigId]);

  return useMemo(() => ({
    currentConfig,
    setCurrentConfig: setCurrentConfigWithPersistence,
    availableConfigs: configs
  }), [configs, currentConfig, setCurrentConfigWithPersistence]);
};
