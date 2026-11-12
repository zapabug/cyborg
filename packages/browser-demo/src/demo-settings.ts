import type { DemoSettings } from './engine.ts';

// The same settings as the scaffold's demo base (packages/company/src/scaffold.ts): English, the topics the bot passes to the office, and the booking funnel
// with the previous bot's starting numbers. The business's own to change; made up for the demo like the facts.
export const DEMO_SETTINGS: DemoSettings = {
  sales: {
    conversationContext: true,
    defaultLanguage: 'en',
    officeTopics: [
      { label: 'pets and dogs', words: ['dog', 'dogs', 'pet', 'pets', 'puppy'] },
      { label: 'wheelchairs and reduced mobility', words: ['wheelchair', 'wheelchairs', 'mobility', 'disabled', 'disability'] },
      { label: 'food allergies and special diets', words: ['allergy', 'allergies', 'allergic', 'vegan', 'vegetarian', 'gluten', 'halal', 'kosher'] },
      { label: 'night tours and wildlife', words: ['night', 'wildlife', 'dolphin', 'dolphins', 'whale', 'whales'] },
    ],
  },
  bookings: {
    confirmWords: ['yes', 'yeah', 'ok', 'okay', 'sure', 'please do', 'go ahead', 'sim', 'claro', 'pode ser'],
    cancelWords: ['no', 'nope', 'cancel', 'never mind', 'forget it', 'não', 'nao', 'cancelar'],
    lastMinuteDays: 1,
    lastMinuteNote: 'It is last minute: any tour can be tried, but it needs manager approval and might not be possible. The team will reply as fast as it can.',
    alternativeDaysAhead: 14,
    maxGroup: 200,
    currency: 'EUR',
  },
};
