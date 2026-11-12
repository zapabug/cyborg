// One questionnaire for a new business (English), replacing the separate daily-work form and setup-call form.
// Tick what you do: each ticked task opens its details, and the questions that belong to it appear below.
// A task you do not do asks nothing (a nail salon is never asked about vehicles). Only what is shown is sent.
// To tailor: copy intake/ to <business>/, give it a new storeKey, put the business name in the byline.
// The short labels are the ones the framework's intake import knows (packages/company/src/intake.ts); the
// follow-up questions are docs/13's questionnaire.
window.FORM = {
  storeKey: 'intake-tasks-v2',
  legacyStoreKeys: ['intake-tasks-v1', 'intake-call-v1'],
  pageTitle: 'Questionnaire',
  title: 'Your daily work: what could a bot take over?',
  byline: 'from the wazaa team',
  introHtml: 'We want to understand how much of your daily work a WhatsApp bot could do <strong>well and safely</strong>. The bot handles what is facts and rules; people keep everything that needs a decision. By default nothing goes to a customer until a person has approved it, and a task becomes automatic only when you choose. This is <strong>not an offer</strong>, just a way to understand your day.',
  hintHtml: 'Tick the tasks you do. Each one opens a few lines, and the questions that go with it appear below the list. Tasks you do not do ask nothing. A word or a short sentence is enough, and "not sure" is a fine answer. What you type stays in this browser until you send it. At the end, press <strong>Send</strong> at the bottom of the page.',
  whoLabel: 'Who is filling this in?',
  whoPlaceholder: 'Your name and the business name',
  tasksTitle: 'The tasks',
  tasksIntro: 'The grey line says what we mean by each task. Tick the ones you do; add missing ones in the questions at the end.',
  questionsTitle: '',
  messageTitle: 'Intake: answers',

  tasks: [
    ['Answering customer questions', 'Opening hours, prices, where you are, what is included'],
    ['Giving prices and quotes', 'Working out a price or a total for what the customer asks for'],
    ['Checking availability', 'Is there a free slot, seat, table, room or vehicle on that date?'],
    ['Taking a booking or an order', 'Collecting the details, then confirming it'],
    ['Questions nobody has written an answer for', 'Someone has to stop and answer by hand'],
    ['Following up customers who went quiet', 'A price was sent, no answer came back'],
    ['Reminders before the service or appointment', 'The day before: time, place, what to bring'],
    ['Changes and cancellations', 'Moving a date, cancelling, telling everyone affected'],
    ['Taking payment, invoices and receipts', ''],
    ['Reviews and complaints', 'Google, TripAdvisor, Booking, Facebook: replying, passing complaints on'],
    ['Messages after hours and at weekends', 'Who answers when the office is closed?'],
    ['Planning the day for the team', 'Who does what, the list for today, sent to staff'],
    ['Staff reporting something unusual', 'A breakdown, a customer who did not show up, a problem on the job'],
    ['Vehicle inspections, insurance and servicing', 'Inspection and insurance dates, oil changes and repairs, the drivers\' reports'],
    ['Licences, equipment checks and other due dates', 'Permits, certificates, safety checks, anything with an expiry date'],
    ['Keeping the website and listings up to date', 'Prices, times, what is on offer'],
  ],

  // Shown while a task it depends on is ticked (`when.tasks`: part of a task title), or always (`when: null`).
  sections: [
    {
      title: 'What you sell',
      intro: 'Because you answer questions, quote or take bookings.',
      when: { tasks: ['Answering customer questions', 'Giving prices and quotes', 'Checking availability', 'Taking a booking or an order'] },
      questions: [
        { key: 'c2', label: 'What do you sell? For each: the name, the price, per what (person, hour, day, item), and the most people or units it can take.', short: '2 What you sell' },
        { key: 'c3', label: 'On which days does each thing run, and which dates are you closed? Who confirms availability, and how long does that take?', short: '3 Days and availability' },
        { key: 'c5', label: 'The ten questions customers ask most, and the answers you give.', short: '5 Top questions' },
        { key: 'c6', label: 'What do you need to know from a customer before you can give a price or take a booking? (date, number of people, where…)', short: '6 Details needed' },
        { key: 'c7', label: 'What makes an enquiry a good fit, and what is not worth your time?', short: '7 Good fit' },
      ],
    },
    {
      title: 'Following up',
      intro: 'Because you follow up customers who went quiet.',
      when: { tasks: ['Following up customers'] },
      questions: [
        { key: 'c8', label: 'If a customer goes quiet, after how long do you follow up?', short: '8 Follow-up' },
      ],
    },
    {
      title: 'Reviews',
      intro: 'Because you reply to reviews and complaints.',
      when: { tasks: ['Reviews and complaints'] },
      questions: [
        { key: 'c12', label: 'Which review sites are you on, and what do you do with a complaint today?', short: '12 Reviews' },
      ],
    },
    {
      title: 'Your vehicles',
      intro: 'Because you look after vehicle inspections, insurance and servicing.',
      when: { tasks: ['Vehicle inspections'] },
      questions: [
        { key: 'c15', label: 'How many vehicles are there, and for each the make, model and plate?', short: '15 Vehicles' },
        { key: 'c16', label: 'How do your drivers name each one when they write (the letters of the plate, a number, a nickname)?', short: '16 Vehicle names' },
        { key: 'c17', label: 'Is there a WhatsApp group with the drivers? What do they write there when a service is done (oil, tyres, brakes) or when they give the distance? In their own words.', short: '17 Drivers group' },
        { key: 'c18', label: 'For each vehicle, the inspection date, the insurance date and any other deadline (road tax, licences). Who handles each, and how far ahead do you want to be told?', short: '18 Deadlines' },
        { key: 'c19', label: 'Which services do you track and at what interval (for example oil every so many km)? Where are the last ones written down (invoices, a sheet, a notebook)?', short: '19 Services' },
        { key: 'c20', label: 'Is there GPS or tracking? Which one? Can it give each vehicle\'s odometer at the end of the day (a report, an export)? Keep the login to yourself; do not write it here.', short: '20 GPS' },
      ],
    },
    {
      title: 'A few questions for everyone',
      intro: null,
      when: null,
      questions: [
        { key: 'c1', label: 'What is the business called to customers, and how do you talk to them? (formal or friendly)', short: '1 Name and tone' },
        { key: 'q1', label: 'Which tasks are missing from the list above?', short: 'Missing tasks' },
        { key: 'q2', label: 'Which task takes the most time, or annoys you the most?', short: 'Biggest time sink' },
        { key: 'q3', label: 'Where do customers reach you today? (WhatsApp, phone, email, website, Instagram or Facebook, booking sites, agencies…)', short: 'Where customers reach you' },
        { key: 'q4', label: 'Roughly how many customer messages do you get a day, in a busy week and in a quiet one?', short: 'Messages a day' },
        { key: 'q5', label: 'Which languages do your customers write in? Which language does your team prefer?', short: 'Languages' },
        { key: 'c9', label: 'Who answers customers today, and who should be allowed to give the bot instructions?', short: '9 Channel and people' },
        { key: 'c10', label: 'When a customer is waiting for a person, or something goes wrong, who should be told, and how? (a staff WhatsApp group, a screen in the office)', short: '10 Who is told' },
        { key: 'c11', label: 'When is the office staffed (hours, lunch, days off), and which days is it closed? Is the office computer on overnight, or could a small always-on machine be used?', short: '11 Office hours' },
        { key: 'c11b', label: 'Should the bot have a first name, and should customers be told up front that replies are automatic? (Usually not: it is only said if they ask.)', short: '11b Bot name' },
        { key: 'q6', label: 'Is there anything you never want to be automatic?', short: 'Never automatic' },
        { key: 'q7', label: 'What must the bot never say or promise? (confirm a booking, give a discount, take a payment…)', short: 'Never promise' },
        { key: 'c13', label: 'The bot uses an AI service that you pay for directly, with your own account (we never hold your key). Do you already have one, and what monthly spend would feel comfortable?', short: '13 AI service and budget' },
        { key: 'c14', label: 'What do customers tell you that must never be sent to an outside AI service? (ID numbers, health details, payment details…)', short: '14 Never send out' },
        { key: 'q8', label: 'If this works, what would be different for you a month from now?', short: 'What success looks like' },
      ],
    },
  ],

  // null to leave the section out
  pickups: null,

  ui: {
    opens: 'Adds questions below:',
    on: 'we do this',
    who: 'Who does it', whoPh: 'e.g. the office',
    time: 'Time it takes', timePh: 'e.g. 30 min/day',
    auto: 'Automate it?', choices: ['Yes', 'No', 'Maybe'],
    notes: 'Notes', notesPh: 'anything we should know',
    filledBy: 'Filled in by',
    send: 'Send by WhatsApp', copy: 'Copy answers',
    opening: 'Opening WhatsApp… pick our chat and press send.',
    tooLong: 'The answers are long: press "Copy answers" and paste them into our chat.',
    copied: 'Copied! Paste it into our WhatsApp chat.',
    copyFailed: 'Could not copy automatically.',
  },
};

// The framework's intake import reads `questions` as one flat list (packages/company/src/intake.ts).
window.FORM.questions = window.FORM.sections.flatMap((s) => s.questions);
