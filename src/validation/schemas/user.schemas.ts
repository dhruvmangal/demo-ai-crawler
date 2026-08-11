export const onboardingBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    gender: { type: 'string', maxLength: 30 },
    industry: { type: 'string', maxLength: 120 },
    roleTitle: { type: 'string', maxLength: 120 },
    usageIntent: { type: 'string', maxLength: 2000 },
    defaultTargetAudience: { type: 'string', maxLength: 2000 }
  }
} as const;
