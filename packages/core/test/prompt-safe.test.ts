import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPrompt, PromptSafe, PromptSafetyError } from '../src/index.ts';

// M2-EC1: these functions are never called. They exist so `tsc -b` proves that passing an
// identity or secret value, or a plain string, where a prompt-safe value is required does
// not compile. If one of the errors disappears, `@ts-expect-error` itself fails the build.
export function typeLevelProof(secretText: string) {
  // @ts-expect-error a plain string (for example an identity value) is not prompt-safe
  buildPrompt('Hello {{name}}', { name: secretText });
  // @ts-expect-error the identity class is not a class this constructor accepts
  PromptSafe.ofPublicOrDeal('identity', secretText);
  // @ts-expect-error the secret class is not a class this constructor accepts
  PromptSafe.ofPublicOrDeal('secret', secretText);
  // @ts-expect-error the constructor is private: a prompt-safe value cannot be forged
  new PromptSafe(secretText);
  // The accepted path compiles.
  buildPrompt('Hello {{name}}', { name: PromptSafe.ofPublicOrDeal('deal', secretText) });
}

test('PRV-3: the builder fills a template only from prompt-safe values', () => {
  const text = buildPrompt('a={{a}} b={{b}}', {
    a: PromptSafe.ofPublicOrDeal('public', 'one'),
    b: PromptSafe.ofPublicOrDeal('deal', { n: 2 }),
  });
  assert.equal(text, 'a=one b={"n":2}');
});

// M2-EC2
test('PRV-3: at run time identity, secret and undeclared fields throw', () => {
  for (const cls of ['identity', 'secret', undefined] as const) {
    assert.throws(() => PromptSafe.fromField(cls, 'field', 'x'), PromptSafetyError);
  }
});

test('PRV-3: a value cast past the type system is refused by the builder', () => {
  assert.throws(() => buildPrompt('{{a}}', { a: 'plain' as never }), PromptSafetyError);
  assert.throws(() => buildPrompt('{{a}}', {}), PromptSafetyError);
  assert.throws(() => buildPrompt('{{a}}', { a: { text: 'forged' } as never }), PromptSafetyError);
});

test('PRV-6: freetext is prompt-safe only if the scrubber finds nothing', () => {
  const clean = PromptSafe.fromField('freetext', 'note', 'two bedrooms near the sea');
  assert.ok(PromptSafe.is(clean));
  const dirty = PromptSafe.fromField('freetext', 'note', 'call +351 912 345 678');
  assert.ok(!PromptSafe.is(dirty) && 'hits' in dirty);
  assert.throws(() => PromptSafe.fromField('freetext', 'note', 42), PromptSafetyError);
});
