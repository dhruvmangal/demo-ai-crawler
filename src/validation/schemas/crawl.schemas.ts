export const crawlBodySchema = {
  type: 'object',
  required: ['targetUrl'],
  additionalProperties: false,
  properties: {
    targetUrl: { type: 'string', format: 'uri', minLength: 1, maxLength: 2048 },
    projectId: { type: 'string', format: 'uuid' }
  }
} as const;

export const credentialsBodySchema = {
  type: 'object',
  required: ['username', 'password'],
  additionalProperties: false,
  properties: {
    username: { type: 'string', minLength: 1, maxLength: 255 },
    password: { type: 'string', minLength: 1, maxLength: 255 }
  }
} as const;
