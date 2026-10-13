const assert = require('node:assert/strict')
const { test } = require('node:test')

const {
  createAuthService,
  createSessionStorage
} = require('../src/auth')

const CONFIG = {
  supabaseUrl: 'https://example.supabase.co',
  supabaseAnonKey: 'public-anon-key'
}

function createClientStub(overrides = {}) {
  const calls = {
    signIn: [],
    signUp: [],
    signOut: 0,
    getSession: 0,
    resetPassword: []
  }
  const client = {
    auth: {
      signInWithPassword: async (credentials) => {
        calls.signIn.push(credentials)
        return overrides.signIn || { data: {}, error: null }
      },
      signUp: async (credentials) => {
        calls.signUp.push(credentials)
        return overrides.signUp || { data: {}, error: null }
      },
      signOut: async () => {
        calls.signOut += 1
        return overrides.signOut || { error: null }
      },
      getSession: async () => {
        calls.getSession += 1
        return overrides.getSession || { data: { session: null }, error: null }
      },
      resetPasswordForEmail: async (email, options) => {
        calls.resetPassword.push({ email, options })
        return overrides.resetPassword || { data: {}, error: null }
      },
      onAuthStateChange: (callback) => {
        calls.authChanged = callback
        return { data: { subscription: { unsubscribe() {} } } }
      }
    }
  }
  return { client, calls }
}

function createService(clientOverrides, authChanged) {
  const { client, calls } = createClientStub(clientOverrides)
  const service = createAuthService({
    ...CONFIG,
    createClient: () => client,
    onAuthChanged: authChanged || (() => {})
  })
  return { service, calls }
}

test('signIn rejects an invalid email without contacting Supabase', async () => {
  const { service, calls } = createService()
  const result = await service.signIn('not-an-email', '12345678')

  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'INVALID_EMAIL')
  assert.equal(calls.signIn.length, 0)
})

test('signIn rejects a short password without contacting Supabase', async () => {
  const { service, calls } = createService()
  const result = await service.signIn('user@example.com', '1234567')

  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'WEAK_PASSWORD')
  assert.equal(calls.signIn.length, 0)
})

test('signIn returns only a sanitized user and emits an auth change', async () => {
  const changes = []
  const { service, calls } = createService({
    signIn: {
      data: {
        session: {
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          user: {
            id: 'user-1',
            email: 'user@example.com',
            created_at: '2026-10-10T00:00:00Z',
            access_token: 'nested-token'
          }
        }
      },
      error: null
    }
  }, (event) => changes.push(event))

  const result = await service.signIn('user@example.com', '12345678')

  assert.equal(result.ok, true)
  assert.deepEqual(result.user, {
    id: 'user-1',
    email: 'user@example.com',
    created_at: '2026-10-10T00:00:00Z'
  })
  assert.equal(calls.signIn[0].email, 'user@example.com')
  assert.equal(changes[0].event, 'SIGNED_IN')
  assert.equal(changes[0].user.id, 'user-1')
})

test('signUp returns confirmation required when Supabase does not create a session', async () => {
  const changes = []
  const { service, calls } = createService({
    signUp: {
      data: { user: { id: 'user-2', email: 'new@example.com', created_at: 'date' } },
      error: null
    }
  }, (event) => changes.push(event))

  const result = await service.signUp('new@example.com', '12345678')

  assert.equal(result.ok, true)
  assert.equal(result.status, 'confirmation_required')
  assert.equal(result.user, null)
  assert.equal(changes.length, 0)
  assert.equal(calls.signUp[0].email, 'new@example.com')
})

test('requestPasswordReset sends a reset request with normalized email', async () => {
  const { service, calls } = createService()
  const result = await service.requestPasswordReset('User@Example.COM')

  assert.equal(result.ok, true)
  assert.equal(calls.resetPassword[0].email, 'user@example.com')
})

test('signOut clears the authenticated user and emits sign-out', async () => {
  const changes = []
  const { service } = createService({}, (event) => changes.push(event))

  const result = await service.signOut()

  assert.equal(result.ok, true)
  assert.equal(changes[0].event, 'SIGNED_OUT')
  assert.equal(changes[0].user, null)
})

test('createSessionStorage encrypts Supabase sessions before persistence', () => {
  const saved = new Map()
  const persistentStore = {
    get: (key) => saved.get(key),
    set: (key, value) => saved.set(key, value),
    delete: (key) => saved.delete(key)
  }
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`),
    decryptString: (value) => Buffer.from(value).toString().replace('encrypted:', '')
  }
  const storage = createSessionStorage({ safeStorage, persistentStore })
  const session = JSON.stringify({ access_token: 'access-token' })

  storage.setItem('session', session)

  assert.equal(saved.get('session'), Buffer.from('encrypted:' + session).toString('base64'))
  assert.equal(storage.getItem('session'), session)

  storage.removeItem('session')
  assert.equal(saved.has('session'), false)
})

test('createSessionStorage does not persist when encryption is unavailable', () => {
  const saved = new Map()
  const persistentStore = {
    get: (key) => saved.get(key),
    set: (key, value) => saved.set(key, value),
    delete: (key) => saved.delete(key)
  }
  const safeStorage = { isEncryptionAvailable: () => false }
  const storage = createSessionStorage({ safeStorage, persistentStore })

  storage.setItem('session', JSON.stringify({ access_token: 'access-token' }))

  assert.equal(saved.size, 0)
  assert.equal(storage.getItem('session'), null)
})

test('createSessionStorage treats a failing safeStorage probe as unavailable', () => {
  const saved = new Map()
  const persistentStore = {
    get: (key) => saved.get(key),
    set: (key, value) => saved.set(key, value),
    delete: (key) => saved.delete(key)
  }
  const safeStorage = {
    isEncryptionAvailable: () => {
      throw new Error('backend unavailable')
    }
  }
  const storage = createSessionStorage({ safeStorage, persistentStore })

  storage.setItem('session', JSON.stringify({ access_token: 'access-token' }))

  assert.equal(storage.persistable, false)
  assert.equal(saved.size, 0)
  assert.equal(storage.getItem('session'), null)
})
