const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD_LENGTH = 8

class AuthError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'AuthError'
    this.code = code
  }
}

function authFailure(error) {
  if (error instanceof AuthError) {
    return { code: error.code, message: error.message }
  }
  return { code: 'AUTH_FAILED', message: '认证操作失败，请稍后再试。' }
}

function sanitizeUser(user) {
  if (!user) return null
  const sanitized = {
    id: user.id,
    email: user.email,
    created_at: user.created_at
  }
  if (user.last_sign_in_at) {
    sanitized.last_sign_in_at = user.last_sign_in_at
  }
  return sanitized
}

function validateCredentials(email, password) {
  const normalizedEmail = String(email || '').trim().toLowerCase()
  if (!EMAIL_PATTERN.test(normalizedEmail)) {
    throw new AuthError('INVALID_EMAIL', '请输入有效的邮箱地址。')
  }
  const normalizedPassword = String(password || '')
  if (normalizedPassword.length < MIN_PASSWORD_LENGTH) {
    throw new AuthError('WEAK_PASSWORD', `密码至少需要 ${MIN_PASSWORD_LENGTH} 位。`)
  }
  return { email: normalizedEmail, password: normalizedPassword }
}

function assertAuthenticatedSession(session) {
  if (!session?.authenticated || !session.user) {
    throw new AuthError('UNAUTHENTICATED', '请先登录后再使用剪贴板功能。')
  }
  return session.user
}

function mapSupabaseAuthError(error, action) {
  const code = String(error?.code || error?.name || '')
  if (code === 'email_not_confirmed') {
    return new AuthError('EMAIL_NOT_CONFIRMED', '邮箱尚未确认，请先查收确认邮件。')
  }
  if (code === 'invalid_credentials') {
    return new AuthError('INVALID_CREDENTIALS', '邮箱或密码不正确。')
  }
  if (code === 'weak_password') {
    return new AuthError('WEAK_PASSWORD', `密码至少需要 ${MIN_PASSWORD_LENGTH} 位。`)
  }
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit') {
    return new AuthError('RATE_LIMITED', '请求过于频繁，请稍后再试。')
  }
  if (action === 'signUp' && (code === 'user_already_exists' || code === 'email_exists')) {
    return new AuthError('SIGNUP_FAILED', '注册失败，请检查输入后重试。')
  }
  if (action === 'resetPassword' && code === 'user_not_found') {
    return new AuthError('RESET_REQUEST_FAILED', '如果邮箱可重置，重置邮件已发送。')
  }
  return new AuthError(`${action.toUpperCase()}_FAILED`, '认证操作失败，请稍后再试。')
}

function createSessionStorage({ safeStorage, persistentStore }) {
  let encryptionAvailable = false
  try {
    encryptionAvailable = typeof safeStorage?.isEncryptionAvailable === 'function'
      && safeStorage.isEncryptionAvailable() === true
  } catch {
    encryptionAvailable = false
  }
  const canPersist = encryptionAvailable
    && typeof safeStorage?.encryptString === 'function'
    && typeof safeStorage?.decryptString === 'function'

  return {
    persistable: canPersist,
    getItem(key) {
      if (!canPersist) return null
      try {
        const encrypted = persistentStore.get(key)
        if (!encrypted) return null
        return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
      } catch {
        try { persistentStore.delete(key) } catch {}
        return null
      }
    },
    setItem(key, value) {
      if (!canPersist || value == null) return
      const encrypted = safeStorage.encryptString(String(value))
      persistentStore.set(key, encrypted.toString('base64'))
    },
    removeItem(key) {
      try { persistentStore.delete(key) } catch {}
    }
  }
}

function createAuthService({
  supabaseUrl,
  supabaseAnonKey,
  createClient,
  storage,
  onAuthChanged = () => {}
}) {
  const configured = Boolean(supabaseUrl && supabaseAnonKey && typeof createClient === 'function')
  const client = configured
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          storage,
          persistSession: Boolean(storage),
          autoRefreshToken: true,
          detectSessionInUrl: false
        }
      })
    : null

  const emitAuthChanged = (event, user) => {
    try { onAuthChanged({ event, user: sanitizeUser(user) }) } catch {}
  }

  if (client && typeof client.auth.onAuthStateChange === 'function') {
    client.auth.onAuthStateChange((event, session) => {
      emitAuthChanged(event, session?.user || null)
    })
  }

  const unconfiguredState = () => ({
    authenticated: false,
    configured: false,
    user: null,
    error: {
      code: 'AUTH_NOT_CONFIGURED',
      message: '认证服务未配置，请设置 CLIPFAST_SUPABASE_URL 和 CLIPFAST_SUPABASE_ANON_KEY。'
    }
  })

  async function signIn(email, password) {
    if (!client) return { ok: false, error: unconfiguredState().error }
    try {
      const credentials = validateCredentials(email, password)
      const { data, error } = await client.auth.signInWithPassword(credentials)
      if (error) throw mapSupabaseAuthError(error, 'signIn')
      const user = sanitizeUser(data.session?.user || data.user)
      emitAuthChanged('SIGNED_IN', user)
      return { ok: true, user }
    } catch (error) {
      return { ok: false, error: authFailure(error) }
    }
  }

  async function signUp(email, password) {
    if (!client) return { ok: false, error: unconfiguredState().error }
    try {
      const credentials = validateCredentials(email, password)
      const { data, error } = await client.auth.signUp(credentials)
      if (error) throw mapSupabaseAuthError(error, 'signUp')

      if (!data.session) {
        return { ok: true, status: 'confirmation_required', user: null }
      }

      const user = sanitizeUser(data.session.user || data.user)
      emitAuthChanged('SIGNED_IN', user)
      return { ok: true, status: 'authenticated', user }
    } catch (error) {
      return { ok: false, error: authFailure(error) }
    }
  }

  async function signOut() {
    if (!client) return { ok: false, error: unconfiguredState().error }
    try {
      const { error } = await client.auth.signOut()
      if (error) throw mapSupabaseAuthError(error, 'signOut')
      emitAuthChanged('SIGNED_OUT', null)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: authFailure(error) }
    }
  }

  async function getSession() {
    if (!client) return unconfiguredState()
    try {
      const { data, error } = await client.auth.getSession()
      const user = sanitizeUser(data?.session?.user)
      if (error || !user) {
        return { authenticated: false, configured: true, user: null }
      }
      return { authenticated: true, configured: true, user }
    } catch {
      return { authenticated: false, configured: true, user: null }
    }
  }

  async function requestPasswordReset(email) {
    if (!client) return { ok: false, error: unconfiguredState().error }
    try {
      const normalizedEmail = String(email || '').trim().toLowerCase()
      if (!EMAIL_PATTERN.test(normalizedEmail)) {
        throw new AuthError('INVALID_EMAIL', '请输入有效的邮箱地址。')
      }
      const { error } = await client.auth.resetPasswordForEmail(normalizedEmail)
      if (error) throw mapSupabaseAuthError(error, 'resetPassword')
      return { ok: true }
    } catch (error) {
      return { ok: false, error: authFailure(error) }
    }
  }

  return { signIn, signUp, signOut, getSession, requestPasswordReset }
}

module.exports = {
  AuthError,
  assertAuthenticatedSession,
  createAuthService,
  createSessionStorage,
  sanitizeUser,
  validateCredentials
}
