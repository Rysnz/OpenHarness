/**
 * Context registry.
 *
 * Provides registration points for transforming, validating, and rendering
 * `ContextItem` payloads across the app (menus, drag-and-drop, tool inputs).
 */
import type { ContextType, ContextByType, ValidationResult, RenderOptions } from '../types/context';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('ContextRegistry');
type RegistryAction = 'register' | 'unregister';
type RegistryListener = (type: ContextType, action: RegistryAction) => void;

/**
 * Transforms a strongly-typed context payload into an adapter-specific format.
 */
export interface ContextTransformer<T extends ContextType> {
  readonly type: T;

  transform(context: ContextByType<T>): unknown;

  estimateSize?(context: ContextByType<T>): number;
}

/**
 * Validates context payloads before use (e.g. size, shape, required fields).
 */
export interface ContextValidator<T extends ContextType> {
  readonly type: T;

  validate(context: ContextByType<T>): Promise<ValidationResult>;

  quickValidate?(context: ContextByType<T>): ValidationResult;
}

export interface ContextCardRenderer<T extends ContextType> {
  readonly type: T;

  render(context: ContextByType<T>, options?: RenderOptions): React.ReactNode;
}

export interface ContextTypeDefinition<T extends ContextType> {
  readonly type: T;
  readonly displayName: string;
  readonly description?: string;
  readonly icon: React.ReactNode | string;
  readonly color: string;
  readonly category: 'file' | 'code' | 'diagram' | 'reference' | 'media' | 'other';

  readonly transformer: ContextTransformer<T>;
  readonly validator: ContextValidator<T>;
  readonly renderer: ContextCardRenderer<T>;

  readonly config?: {
    maxSize?: number;
    requiresNetwork?: boolean;
    cacheable?: boolean;
    priority?: number;
  };
}

export class ContextTypeRegistry {
  private static instance: ContextTypeRegistry;
  private definitions = new Map<ContextType, ContextTypeDefinition<any>>();
  private listeners = new Set<RegistryListener>();

  private constructor() {}

  static getInstance(): ContextTypeRegistry {
    if (!this.instance) {
      this.instance = new ContextTypeRegistry();
    }
    return this.instance;
  }

  register<T extends ContextType>(definition: ContextTypeDefinition<T>): void {
    if (this.definitions.has(definition.type)) {
      log.warn('Type already registered, will override', { type: definition.type });
    }

    this.validateDefinition(definition);
    this.definitions.set(definition.type, definition);
    this.notifyListeners(definition.type, 'register');
  }

  registerAll(definitions: ContextTypeDefinition<any>[]): void {
    definitions.forEach(def => this.register(def));
  }

  unregister(type: ContextType): boolean {
    const result = this.definitions.delete(type);
    if (result) {
      this.notifyListeners(type, 'unregister');
    }
    return result;
  }

  getDefinition<T extends ContextType>(type: T): ContextTypeDefinition<T> | undefined {
    return this.definitions.get(type);
  }

  getTransformer<T extends ContextType>(type: T): ContextTransformer<T> | undefined {
    return this.definitions.get(type)?.transformer;
  }

  getValidator<T extends ContextType>(type: T): ContextValidator<T> | undefined {
    return this.definitions.get(type)?.validator;
  }

  getRenderer<T extends ContextType>(type: T): ContextCardRenderer<T> | undefined {
    return this.definitions.get(type)?.renderer;
  }

  getAllTypes(): ContextType[] {
    return Array.from(this.definitions.keys());
  }

  getTypesByCategory(category: string): ContextType[] {
    return Array.from(this.definitions.values())
      .filter(def => def.category === category)
      .map(def => def.type);
  }

  hasType(type: ContextType): boolean {
    return this.definitions.has(type);
  }

  subscribe(listener: RegistryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private validateDefinition(definition: ContextTypeDefinition<any>): void {
    this.requireField(definition.type, 'type', '[ContextRegistry] Definition must have a type');
    this.requireField(
      definition.displayName,
      'displayName',
      `[ContextRegistry] Definition for type "${definition.type}" must have a displayName`
    );
    this.requireField(
      definition.transformer,
      'transformer',
      `[ContextRegistry] Definition for type "${definition.type}" must have a transformer`
    );
    this.requireField(
      definition.validator,
      'validator',
      `[ContextRegistry] Definition for type "${definition.type}" must have a validator`
    );
    this.requireField(
      definition.renderer,
      'renderer',
      `[ContextRegistry] Definition for type "${definition.type}" must have a renderer`
    );
  }

  private requireField(value: unknown, fieldName: string, message: string): void {
    if (!value) {
      log.debug('Invalid context definition', { fieldName });
      throw new Error(message);
    }
  }

  private notifyListeners(type: ContextType, action: RegistryAction): void {
    this.listeners.forEach(listener => {
      try {
        listener(type, action);
      } catch (error) {
        log.error('Error in listener', error);
      }
    });
  }
}

export const contextRegistry = ContextTypeRegistry.getInstance();
