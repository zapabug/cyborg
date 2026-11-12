import type { HandlerRegistry } from './registry.ts';
import type { AnyHandler, CyborgEvent } from './types.ts';
import { triggerKey } from './types.ts';

/**
 * Deterministic trigger selection (HR-3, BEH-9): a pure function of the event and
 * the registry. It has no model dependency, so it cannot call one.
 */
export function selectHandlers(registry: HandlerRegistry, event: CyborgEvent): AnyHandler[] {
  return registry
    .all()
    .filter((handler) => registry.triggersOf(handler).some((t) => triggerKey(t) === event.kind));
}
