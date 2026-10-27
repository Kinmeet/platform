/** One line in an error summary (#15): the text, and the field it links to. */
export interface ErrorSummaryItem {
  /** The id of the field, or of the first input in a group of choices. */
  target: string
  text: string
}

/** The DOM id for an API field name, such as `checks.over_18` → `field-checks-over_18`. */
export function fieldId(field: string): string {
  return `field-${field.replace(/\./g, '-')}`
}
