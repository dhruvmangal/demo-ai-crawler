export const createAdminBodySchema = {
  type: 'object',
  required: ['email', 'password', 'name'],
  additionalProperties: false,
  properties: {
    email: { type: 'string', format: 'email', maxLength: 255 },
    password: { type: 'string', minLength: 8, maxLength: 200 },
    name: { type: 'string', minLength: 1, maxLength: 255 }
  }
} as const;

export const updateAdminBodySchema = {
  type: 'object',
  required: ['isActive'],
  additionalProperties: false,
  properties: {
    isActive: { type: 'boolean' }
  }
} as const;

export const grantPermissionBodySchema = {
  type: 'object',
  required: ['key'],
  additionalProperties: false,
  properties: {
    key: { type: 'string', minLength: 1, maxLength: 100 }
  }
} as const;
