// docs/10 ADM-57, ADM-59: what a module contributes to the morning sheet. The admin module assembles the sheet.

export interface MorningSection {
  /** Shown with the count at the top of the sheet, such as "Waiting on the office". */
  heading: string;
  /** One block per item, already in the Status layout (`Spec:` and `State:` lines, no table). Empty when nothing is open. */
  blocks(): string[];
}
