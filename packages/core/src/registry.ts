import { z } from 'zod';
import { isDataClass, PROMPT_SAFE_CLASSES } from './data-class.ts';
import type { AnyHandler, Trigger } from './types.ts';

export class RegistrationError extends Error {
  constructor(
    readonly handlerId: string,
    readonly rule: string,
    message: string,
  ) {
    super(`handler "${handlerId}" rejected (${rule}): ${message}`);
    this.name = 'RegistrationError';
  }
}

export interface RegistryConfig {
  /** Handler ids the adapter allows to auto-reply (HR-1, HDL-3). */
  autoReplyHandlers: readonly string[];
  /** Adapter config overrides a handler's own triggers (BEH-9). */
  triggerOverrides?: Readonly<Record<string, Trigger[]>>;
}

/** HDL-2 (HR-3): the model never selects what runs, so none of these may appear on a handler. */
const FORBIDDEN_KEYS = ['tools', 'tool_choice', 'functions', 'function_call'] as const;

const SLOT = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

export class HandlerRegistry {
  private readonly handlers: AnyHandler[] = [];

  constructor(readonly config: RegistryConfig) {}

  /** Registration order is the selection order (BEH-9). */
  registerHandler(handler: AnyHandler): void {
    const id = typeof handler?.id === 'string' ? handler.id : '(no id)';
    const fail = (rule: string, message: string): never => {
      throw new RegistrationError(id, rule, message);
    };

    for (const key of FORBIDDEN_KEYS) {
      if (key in handler) fail('HDL-2', `declares "${key}"; the model must not select what runs`);
    }
    if (handler.kind === 'model') {
      for (const key of FORBIDDEN_KEYS) {
        if (key in handler.model) fail('HDL-2', `model declares "${key}"`);
      }
    }

    if (!handler.id) fail('HDL contract', 'missing id');
    if (!handler.version) fail('HDL contract', 'missing version');
    if (!Array.isArray(handler.trigger) || handler.trigger.length === 0) {
      fail('HDL contract', 'missing trigger');
    }
    if (!handler.input?.schema || !(handler.input.schema instanceof z.ZodObject)) {
      fail('HDL contract', 'input.schema must be a zod object');
    }
    if (typeof handler.input.fromEvent !== 'function') fail('HDL contract', 'missing input.fromEvent');
    if (!Array.isArray(handler.profileKeys)) fail('HDL contract', 'missing profileKeys');
    if (!Array.isArray(handler.packFacts)) fail('HDL contract', 'missing packFacts');
    if (!handler.limits || typeof handler.limits !== 'object') fail('HDL contract', 'missing limits');
    if (handler.effect !== 'proposal' && handler.effect !== 'auto_reply') {
      fail('HDL contract', 'effect must be "proposal" or "auto_reply"');
    }
    if (typeof handler.commitment !== 'boolean') fail('HDL contract', 'missing commitment flag');
    if (this.handlers.some((h) => h.id === handler.id)) fail('HDL contract', 'duplicate handler id');

    // HDL-1, PRV-1: every input field declares exactly one data class.
    const fields = Object.keys(handler.input.schema.shape);
    for (const field of fields) {
      const cls = handler.input.classes?.[field];
      if (!isDataClass(cls)) fail('HDL-1', `input field "${field}" has no valid data class`);
    }
    for (const declared of Object.keys(handler.input.classes ?? {})) {
      if (!fields.includes(declared)) fail('HDL-1', `data class declared for unknown field "${declared}"`);
    }

    // HDL-3: auto_reply only with adapter opt-in, never for commitments.
    if (handler.effect === 'auto_reply') {
      if (!this.config.autoReplyHandlers.includes(handler.id)) {
        fail('HDL-3', 'auto_reply is not enabled for this handler by the adapter');
      }
      if (handler.commitment) fail('HDL-3', 'auto_reply is never allowed for outputs that contain a commitment');
    }

    if (handler.kind === 'model') {
      if (!handler.prompt?.template) fail('HDL contract', 'missing prompt template');
      if (!handler.output) fail('HDL contract', 'missing output schema');
      if (typeof handler.checks !== 'function') fail('HDL contract', 'missing checks');
      if (typeof handler.toProposal !== 'function') fail('HDL contract', 'missing toProposal');
      if (handler.model?.level !== 'strict_schema' && handler.model?.level !== 'json_object') {
        fail('HDL contract', 'model.level must be "strict_schema" or "json_object"');
      }
      if (!handler.model.name) fail('HDL contract', 'missing default model name');

      // Slots: every placeholder maps to exactly one prompt-safe source (HR-2, PRV-3, PRF-4, PRF-56).
      const factSlots = handler.prompt.factSlots ?? {};
      const packSlots = handler.prompt.packSlots ?? {};
      const used = [...handler.prompt.template.matchAll(SLOT)].map((m) => m[1] as string);
      for (const slot of used) {
        const sources = [slot in handler.prompt.slots, slot in factSlots, slot in packSlots, slot === handler.prompt.lessonsSlot].filter(Boolean).length;
        if (sources === 0) fail('HDL contract', `prompt slot "${slot}" has no mapping`);
        if (sources > 1) fail('HDL contract', `prompt slot "${slot}" is mapped more than once`);
        const field = handler.prompt.slots[slot];
        if (field === undefined) continue;
        const cls = handler.input.classes[field];
        if (cls === undefined) fail('HDL contract', `prompt slot "${slot}" maps to unknown field "${field}"`);
        if (!PROMPT_SAFE_CLASSES.includes(cls!)) {
          fail('HR-2', `prompt slot "${slot}" maps to a "${cls}" field; only ${PROMPT_SAFE_CLASSES.join(', ')} may reach a prompt`);
        }
      }
      for (const [slot, key] of Object.entries(factSlots)) {
        if (!handler.profileKeys.includes(key)) fail('PRF-4', `fact slot "${slot}" uses "${key}", which is not in profileKeys`);
      }
      for (const [slot, key] of Object.entries(packSlots)) {
        if (!handler.packFacts.some((p) => p.key === key)) fail('PRF-4', `pack slot "${slot}" uses "${key}", which is not in packFacts`);
      }
    } else if (handler.kind === 'deterministic') {
      if (typeof handler.run !== 'function') fail('HDL contract', 'missing run');
    } else {
      fail('HDL contract', 'kind must be "model" or "deterministic"');
    }

    this.handlers.push(handler);
  }

  /** MOD-16: used when a module is unloaded. Stored proposals and audit rows are not touched. */
  unregister(id: string): boolean {
    const index = this.handlers.findIndex((h) => h.id === id);
    if (index < 0) return false;
    this.handlers.splice(index, 1);
    return true;
  }

  all(): readonly AnyHandler[] {
    return this.handlers;
  }

  get(id: string): AnyHandler | undefined {
    return this.handlers.find((h) => h.id === id);
  }

  triggersOf(handler: AnyHandler): Trigger[] {
    return this.config.triggerOverrides?.[handler.id] ?? handler.trigger;
  }
}
