import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectLanguage, languageMismatch } from '../src/index.ts';

// ADM-74, ADM-75. Messages below are written the way tourists and locals write to a tour desk.
const lang = (text: string) => detectLanguage(text)?.lang ?? null;

test('ADM-74: Portuguese, English and the other four languages are told apart from ordinary desk messages', () => {
  assert.equal(lang('Gostava de saber quanto custa o passeio para amanhã'), 'pt');
  assert.equal(lang('How much is the tour tomorrow and can we book for four people?'), 'en');
  assert.equal(lang('Hola, cuánto cuesta el tour para mañana? Somos tres personas'), 'es');
  assert.equal(lang('Bonjour, combien coûte la visite pour demain? Nous sommes quatre personnes'), 'fr');
  assert.equal(lang('Guten Tag, wie viel kostet die Tour morgen? Wir sind drei Personen'), 'de');
  assert.equal(lang('Buongiorno, quanto costa il giro di domani? Siamo in quattro persone'), 'it');
});

test('ADM-74: a greeting in one language does not decide it; the substance does', () => {
  assert.equal(lang('Bom dia, do you have a tour tomorrow? We are two people and would like to book'), 'en');
  assert.equal(lang('Hello, quanto custa o passeio de amanhã? Somos duas pessoas'), 'pt');
});

test('ADM-74: too little to go on is unknown, not a guess', () => {
  assert.equal(detectLanguage('ok'), null);
  assert.equal(detectLanguage('Bom dia'), null);
  assert.equal(detectLanguage('12345'), null);
  assert.equal(detectLanguage(''), null);
});

test('ADM-75: a reply in another language than the customer\'s is a mismatch; an unclear side is never one', () => {
  assert.deepEqual(languageMismatch('Bom dia, do you have a tour tomorrow? We are two people', 'Bom dia! Temos passeios amanhã, o preço é de 35 por pessoa. Quantas pessoas são?'), { customer: 'en', draft: 'pt' });
  assert.equal(languageMismatch('Bom dia, do you have a tour tomorrow? We are two people', 'Yes, we have a tour tomorrow and the price is 35 per person. How many people are you?'), null);
  assert.equal(languageMismatch('ok', 'Temos passeios amanhã'), null);
  assert.equal(languageMismatch('Gostava de saber os preços', 'ok'), null);
});
