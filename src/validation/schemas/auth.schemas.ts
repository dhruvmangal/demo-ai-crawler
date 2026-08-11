export const signupBodySchema = {
  type: 'object',
  required: ['email', 'password', 'name'],
  additionalProperties: false,
  properties: {
    email: { type: 'string', format: 'email', maxLength: 255 },
    password: { type: 'string', minLength: 8, maxLength: 200 },
    name: { type: 'string', minLength: 1, maxLength: 255 }
  }
} as const;

export const loginBodySchema = {
  type: 'object',
  required: ['email', 'password'],
  additionalProperties: false,
  properties: {
    email: { type: 'string', format: 'email' },
    password: { type: 'string', minLength: 1 }
  }
} as const;

export const refreshBodySchema = {
  type: 'object',
  required: ['refreshToken'],
  additionalProperties: false,
  properties: { refreshToken: { type: 'string', minLength: 10 } }
} as const;

export const logoutBodySchema = refreshBodySchema;

export const passwordResetRequestBodySchema = {
  type: 'object',
  required: ['email'],
  additionalProperties: false,
  properties: { email: { type: 'string', format: 'email' } }
} as const;

export const passwordResetConfirmBodySchema = {
  type: 'object',
  required: ['token', 'newPassword'],
  additionalProperties: false,
  properties: {
    token: { type: 'string', minLength: 10 },
    newPassword: { type: 'string', minLength: 8, maxLength: 200 }
  }
} as const;

export const verifyEmailQuerySchema = {
  type: 'object',
  required: ['token'],
  properties: { token: { type: 'string', minLength: 10 } }
} as const;

export const resendVerificationBodySchema = {
  type: 'object',
  required: ['email'],
  additionalProperties: false,
  properties: { email: { type: 'string', format: 'email' } }
} as const;

export const googleAuthBodySchema = {
  type: 'object',
  required: ['idToken'],
  additionalProperties: false,
  properties: { idToken: { type: 'string', minLength: 10 } }
} as const;

export const githubAuthBodySchema = {
  type: 'object',
  required: ['code', 'redirectUri'],
  additionalProperties: false,
  properties: {
    code: { type: 'string', minLength: 1 },
    redirectUri: { type: 'string', format: 'uri' }
  }
} as const;

export const adminLoginBodySchema = loginBodySchema;
