export interface SafetyCheckResult {
  safe: boolean;
  reason?: string;
}

export class SafetyEngine {
  private static DESTRUCTIVE_KEYWORDS = [
    'delete', 'remove', 'destroy', 'refund', 'disable', 'deactivate',
    'cancel', 'reset', 'void', 'terminate', 'clear', 'wipe'
  ];

  /**
   * Evaluates if a given UI element/action is safe to interact with (e.g. click).
   * It inspects the element label, the HTML selector, and optionally extra attributes.
   */
  public static checkAction(label: string, selector: string, actionType?: string): SafetyCheckResult {
    const combinedText = `${label} ${selector} ${actionType || ''}`.toLowerCase();

    // Check if any destructive keywords are present in the text, label, or selector
    for (const keyword of this.DESTRUCTIVE_KEYWORDS) {
      if (combinedText.includes(keyword)) {
        return {
          safe: false,
          reason: `Interaction matched forbidden keyword: "${keyword}" in "${label}" (selector: ${selector})`
        };
      }
    }

    // Default mode is READ-ONLY/INSPECTION. Standard navigations, button clicks to open/view are allowed.
    return { safe: true };
  }

  /**
   * Filter forms and check if submitting them is safe.
   */
  public static checkFormSubmission(formLabel: string, actionUrl?: string): SafetyCheckResult {
    const combined = `${formLabel} ${actionUrl || ''}`.toLowerCase();
    for (const keyword of this.DESTRUCTIVE_KEYWORDS) {
      if (combined.includes(keyword)) {
        return {
          safe: false,
          reason: `Form submission is flagged as destructive due to keyword: "${keyword}"`
        };
      }
    }
    return { safe: true };
  }
}
