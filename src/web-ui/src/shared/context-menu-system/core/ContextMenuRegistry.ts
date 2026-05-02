import { createLogger } from '@/shared/utils/logger';
import { MenuContext } from '../types/context.types';
import { MenuItem } from '../types/menu.types';
import {
  IMenuProvider,
  MenuProviderConfig,
  ProviderGroup,
  ProviderMetadata,
  ProviderRegistrationOptions,
} from '../types/provider.types';

const log = createLogger('ContextMenuRegistry');

class SimpleMenuProvider implements IMenuProvider {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly priority: number;
  readonly scope?: string | string[];

  private matcher: (context: MenuContext) => boolean;
  private menuBuilder: (context: MenuContext) => MenuItem[] | Promise<MenuItem[]>;
  private enabled: boolean | (() => boolean);

  constructor(config: MenuProviderConfig) {
    this.id = config.id;
    this.name = config.name;
    this.description = config.description;
    this.priority = config.priority || 0;
    this.scope = config.scope;
    this.matcher = config.matcher;
    this.menuBuilder = config.menuBuilder;
    this.enabled = config.enabled ?? true;
  }

  matches(context: MenuContext): boolean {
    return this.matcher(context);
  }

  async getMenuItems(context: MenuContext): Promise<MenuItem[]> {
    return this.menuBuilder(context);
  }

  isEnabled(): boolean {
    return typeof this.enabled === 'function' ? this.enabled() : this.enabled;
  }
}

function isProviderConfig(provider: IMenuProvider | MenuProviderConfig): provider is MenuProviderConfig {
  return 'matcher' in provider && 'menuBuilder' in provider;
}

function createMetadata(provider: IMenuProvider, options: ProviderRegistrationOptions): ProviderMetadata {
  return {
    id: provider.id,
    name: provider.name,
    description: provider.description,
    priority: provider.priority,
    scope: provider.scope,
    enabled: options.enabled ?? true,
    registeredAt: Date.now(),
    invocationCount: 0,
  };
}

export class ContextMenuRegistry {
  private providers = new Map<string, IMenuProvider>();
  private metadata = new Map<string, ProviderMetadata>();
  private groups = new Map<string, ProviderGroup>();

  register(
    provider: IMenuProvider | MenuProviderConfig,
    options: ProviderRegistrationOptions = {}
  ): void {
    const actualProvider = isProviderConfig(provider)
      ? new SimpleMenuProvider(provider)
      : provider;

    if (this.providers.has(actualProvider.id) && !options.override) {
      throw new Error(`Menu provider with id "${actualProvider.id}" already exists`);
    }

    this.providers.set(actualProvider.id, actualProvider);
    this.metadata.set(actualProvider.id, createMetadata(actualProvider, options));
  }

  unregister(providerId: string): boolean {
    const deleted = this.providers.delete(providerId);
    this.metadata.delete(providerId);
    this.removeProviderFromAllGroups(providerId);
    return deleted;
  }

  getProvider(providerId: string): IMenuProvider | undefined {
    return this.providers.get(providerId);
  }

  getAllProviders(): IMenuProvider[] {
    return Array.from(this.providers.values());
  }

  getMetadata(providerId: string): ProviderMetadata | undefined {
    return this.metadata.get(providerId);
  }

  findMatchingProviders(context: MenuContext): IMenuProvider[] {
    return Array.from(this.providers.values())
      .filter((provider) => this.canUseProvider(provider, context))
      .sort((a, b) => b.priority - a.priority);
  }

  setProviderEnabled(providerId: string, enabled: boolean): void {
    const meta = this.metadata.get(providerId);
    if (meta) {
      meta.enabled = enabled;
    }
  }

  createGroup(group: ProviderGroup): void {
    this.groups.set(group.id, group);
  }

  getGroup(groupId: string): ProviderGroup | undefined {
    return this.groups.get(groupId);
  }

  addToGroup(groupId: string, providerId: string): void {
    const group = this.groups.get(groupId);
    if (group && !group.providers.includes(providerId)) {
      group.providers.push(providerId);
    }
  }

  removeFromGroup(groupId: string, providerId: string): void {
    const group = this.groups.get(groupId);
    if (!group) {
      return;
    }

    group.providers = group.providers.filter((id) => id !== providerId);
  }

  getProvidersInGroup(groupId: string): IMenuProvider[] {
    const group = this.groups.get(groupId);
    if (!group) {
      return [];
    }

    return group.providers
      .map((id) => this.providers.get(id))
      .filter(Boolean) as IMenuProvider[];
  }

  clear(): void {
    this.providers.clear();
    this.metadata.clear();
    this.groups.clear();
  }

  getStats() {
    const metadata = Array.from(this.metadata.values());

    return {
      totalProviders: this.providers.size,
      enabledProviders: metadata.filter((meta) => meta.enabled).length,
      totalGroups: this.groups.size,
      metadata,
    };
  }

  private canUseProvider(provider: IMenuProvider, context: MenuContext): boolean {
    try {
      const meta = this.metadata.get(provider.id);
      if (provider.isEnabled && !provider.isEnabled()) {
        return false;
      }
      if (meta && !meta.enabled) {
        return false;
      }
      if (provider.scope && !this.matchesScope(provider.scope, context)) {
        return false;
      }
      if (!provider.matches(context)) {
        return false;
      }

      if (meta) {
        meta.invocationCount++;
      }
      return true;
    } catch (error) {
      log.error('Error matching provider', { providerId: provider.id, error });
      return false;
    }
  }

  private removeProviderFromAllGroups(providerId: string): void {
    this.groups.forEach((group) => {
      group.providers = group.providers.filter((id) => id !== providerId);
    });
  }

  private matchesScope(scope: string | string[], context: MenuContext): boolean {
    const contextArea = context.metadata?.area;
    return contextArea ? (Array.isArray(scope) ? scope : [scope]).includes(contextArea) : true;
  }
}

export const contextMenuRegistry = new ContextMenuRegistry();
