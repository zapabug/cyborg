// feat WZP-63: the words of a reminder and of a cancelled day, made by code from the booking and the business's own first line. English here is the fallback the
// brain spec keeps ("Guard fails or LLM off → the fixed message + the team note"); a person reads and sends it, in the customer's language if they know it.

export interface NoticeBooking {
  ref: string;
  service: string;
  date: string;
  partySize: number;
}

/** The evening-before reminder: the business's line, then the booking, the team's note as written, and the following consecutive day(s) when the customer has them. */
export function reminderText(template: string, b: NoticeBooking, options: { note?: string; following?: NoticeBooking[] } = {}): string {
  const lines = [template.trim(), `${b.ref}: ${b.service}, ${b.date}, ${b.partySize} ${b.partySize === 1 ? 'person' : 'people'}.`];
  if (options.note && options.note.trim() !== '') lines.push(options.note.trim());
  for (const f of options.following ?? []) lines.push(`Then: ${f.service}, ${f.date} (${f.ref}).`);
  return lines.join('\n');
}

/** A cancelled day: the business's line, the booking, and the reason as the office wrote it. What happens next is the business's to say (its FAQ), never the code's. */
export function cancellationText(template: string, b: NoticeBooking, reason: string): string {
  return [template.trim(), `${b.ref}: ${b.service}, ${b.date}, ${b.partySize} ${b.partySize === 1 ? 'person' : 'people'} is cancelled.`, `Reason: ${reason.trim()}`].join('\n');
}
