// Shape of Playwright's BrowserContext.storageState() output: what a caller exports after
// logging in themselves, so the crawler can start already authenticated instead of hitting
// a login wall. Kept permissive (additionalProperties left open on the nested items) since
// this is just passed through to Playwright's newContext({ storageState }), not interpreted.
const storageStateSchema = {
  type: 'object',
  properties: {
    cookies: { type: 'array', items: { type: 'object' } },
    origins: { type: 'array', items: { type: 'object' } }
  }
} as const;

const credentialsSchema = {
  type: 'object',
  required: ['username', 'password'],
  properties: {
    username: { type: 'string', minLength: 1, maxLength: 255 },
    password: { type: 'string', minLength: 1, maxLength: 255 }
  }
} as const;

export const crawlBodySchema = {
  type: 'object',
  required: ['targetUrl'],
  additionalProperties: false,
  properties: {
    targetUrl: { type: 'string', format: 'uri', minLength: 1, maxLength: 2048 },
    projectId: { type: 'string', format: 'uuid' },
    storageState: storageStateSchema,
    credentials: credentialsSchema,
    autoRegister: {
      type: 'boolean',
      description: 'If the site requires login and these credentials do not already work, fall back to creating a new account with them.'
    },
    connectCdpUrl: {
      type: 'string',
      format: 'uri',
      maxLength: 2048,
      description: 'Attach to an already-running, already-authenticated browser over CDP instead of launching a headless one. Host must be in the operator-configured CDP_ALLOWED_HOSTS allowlist.'
    }
  }
} as const;

export const credentialsBodySchema = {
  type: 'object',
  required: ['username', 'password'],
  additionalProperties: false,
  properties: {
    username: { type: 'string', minLength: 1, maxLength: 255 },
    password: { type: 'string', minLength: 1, maxLength: 255 },
    autoRegister: { type: 'boolean' }
  }
} as const;

export const sessionBodySchema = {
  type: 'object',
  required: ['storageState'],
  additionalProperties: false,
  properties: {
    storageState: storageStateSchema
  }
} as const;
