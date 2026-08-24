export const narrationPreviewBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    jobRole: { type: 'string', maxLength: 200 },
    targetAudience: { type: 'string', maxLength: 500 },
    functionalityFocus: { type: 'string', maxLength: 500 }
  }
} as const;
