import { MenuItem, MenuItemType } from '../types/menu.types';
import { MenuContext } from '../types/context.types';
import { IMenuProvider, MenuMergeStrategy, MenuMergeConfig } from '../types/provider.types';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('MenuBuilder');

type ProviderItems = {
  provider: IMenuProvider;
  items: MenuItem[];
};

const DEFAULT_MERGE_CONFIG: MenuMergeConfig = {
  strategy: MenuMergeStrategy.PRIORITY,
  deduplicate: true,
  keepSeparators: true
};

const isSeparator = (item: MenuItem): boolean => (
  item.type === MenuItemType.SEPARATOR || Boolean(item.separator)
);

const createSeparator = (id: string): MenuItem => ({
  id,
  label: '',
  type: MenuItemType.SEPARATOR,
  separator: true
});

const resolveConditionalFlag = <T>(
  value: T | ((context: MenuContext) => T) | undefined,
  context: MenuContext,
  fallback: T
): T => (
  typeof value === 'function'
    ? (value as (context: MenuContext) => T)(context)
    : value ?? fallback
);

export class MenuBuilder {
  private mergeConfig: MenuMergeConfig;

  constructor(mergeConfig?: Partial<MenuMergeConfig>) {
    this.mergeConfig = { ...DEFAULT_MERGE_CONFIG, ...mergeConfig };
  }

  async build(providers: IMenuProvider[], context: MenuContext): Promise<MenuItem[]> {
    const providerItems = await this.collectProviderItems(providers, context);
    const collections = providerItems.map(({ items }) => this.processItems(items, context));
    return this.postProcess(this.mergeItems(collections));
  }

  setMergeConfig(config: Partial<MenuMergeConfig>): void {
    this.mergeConfig = { ...this.mergeConfig, ...config };
  }

  getMergeConfig(): MenuMergeConfig {
    return { ...this.mergeConfig };
  }

  private async collectProviderItems(
    providers: IMenuProvider[],
    context: MenuContext
  ): Promise<ProviderItems[]> {
    return Promise.all(
      providers.map(async (provider) => {
        try {
          return { provider, items: await provider.getMenuItems(context) };
        } catch (error) {
          log.error('Failed to get menu items from provider', { providerId: provider.id, error });
          return { provider, items: [] };
        }
      })
    );
  }

  private processItems(items: MenuItem[], context: MenuContext): MenuItem[] {
    return items.flatMap((item) => {
      const processed = this.processItem(item, context);
      return processed ? [processed] : [];
    });
  }

  private processItem(item: MenuItem, context: MenuContext): MenuItem | null {
    if (!resolveConditionalFlag(item.visible, context, true)) {
      return null;
    }

    return {
      ...item,
      disabled: resolveConditionalFlag(item.disabled, context, false),
      checked: resolveConditionalFlag(item.checked, context, item.checked),
      submenu: item.submenu ? this.processItems(item.submenu, context) : undefined
    };
  }

  private mergeItems(collections: MenuItem[][]): MenuItem[] {
    if (collections.length <= 1) {
      return collections[0] ?? [];
    }

    const strategyHandlers: Partial<Record<MenuMergeStrategy, () => MenuItem[]>> = {
      [MenuMergeStrategy.APPEND]: () => this.mergeAppend(collections),
      [MenuMergeStrategy.PREPEND]: () => this.mergeAppend([...collections].reverse()),
      [MenuMergeStrategy.PRIORITY]: () => this.mergeAppend(collections),
      [MenuMergeStrategy.GROUP]: () => this.mergeByGroup(collections),
      [MenuMergeStrategy.CUSTOM]: () => (
        this.mergeConfig.customMerge?.(collections) ?? this.mergeAppend(collections)
      )
    };

    return strategyHandlers[this.mergeConfig.strategy]?.() ?? this.mergeAppend(collections);
  }

  private mergeAppend(collections: MenuItem[][]): MenuItem[] {
    return collections.reduce<MenuItem[]>((merged, items, index) => {
      if (items.length === 0) {
        return merged;
      }

      if (merged.length > 0 && this.mergeConfig.keepSeparators) {
        merged.push(createSeparator(`separator-${index}`));
      }
      merged.push(...items);
      return merged;
    }, []);
  }

  private mergeByGroup(collections: MenuItem[][]): MenuItem[] {
    const grouped = new Map<string, MenuItem[]>();
    const ungrouped: MenuItem[] = [];

    collections.flat().forEach((item) => {
      if (!item.group) {
        ungrouped.push(item);
        return;
      }

      grouped.set(item.group, [...(grouped.get(item.group) ?? []), item]);
    });

    const groupedItems = Array.from(grouped.entries()).reduce<MenuItem[]>(
      (items, [groupName, groupItems]) => this.appendSection(items, groupItems, `group-${groupName}-sep`),
      []
    );

    return this.appendSection(groupedItems, ungrouped, 'ungrouped-sep');
  }

  private appendSection(result: MenuItem[], section: MenuItem[], separatorId: string): MenuItem[] {
    if (section.length === 0) {
      return result;
    }

    if (result.length > 0 && this.mergeConfig.keepSeparators) {
      result.push(createSeparator(separatorId));
    }
    result.push(...section);
    return result;
  }

  private postProcess(items: MenuItem[]): MenuItem[] {
    const deduped = this.mergeConfig.deduplicate ? this.deduplicateItems(items) : [...items];
    return this.cleanupSeparators(deduped);
  }

  private deduplicateItems(items: MenuItem[]): MenuItem[] {
    const seen = new Set<string>();

    return items.filter((item) => {
      if (isSeparator(item)) {
        return true;
      }
      if (seen.has(item.id)) {
        return false;
      }
      seen.add(item.id);
      return true;
    });
  }

  private cleanupSeparators(items: MenuItem[]): MenuItem[] {
    const compacted = items.reduce<MenuItem[]>((result, item) => {
      if (isSeparator(item) && (result.length === 0 || isSeparator(result[result.length - 1]))) {
        return result;
      }

      result.push(item);
      return result;
    }, []);

    while (compacted.length > 0 && isSeparator(compacted[compacted.length - 1])) {
      compacted.pop();
    }

    return compacted;
  }
}

export const menuBuilder = new MenuBuilder();
