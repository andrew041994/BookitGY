import axios from 'axios'

const fallbackApiUrl = '/api'

export const API_BASE_URL = fallbackApiUrl

const isAbsoluteUrl = (value) => /^https?:\/\//i.test(value)

const resolveRequestUrl = (configUrl = '', baseUrl = '') => {
  if (!baseUrl) return configUrl
  if (isAbsoluteUrl(baseUrl)) {
    return new URL(configUrl, baseUrl).toString()
  }

  const normalizedBase = `/${String(baseUrl).replace(/^\/+/, '').replace(/\/+$/, '')}`
  const normalizedPath = String(configUrl).replace(/^\/+/, '')
  const combined = `${normalizedBase}/${normalizedPath}`
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${combined}`
  }
  return combined
}

export const apiClient = axios.create({
  baseURL: API_BASE_URL
})

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  const headers = config.headers ?? {}
  if (token && !headers.Authorization) {
    headers.Authorization = `Bearer ${token}`
  }
  const method = String(config.method || '').toLowerCase()
  const hasBody = config.data !== undefined && config.data !== null
  const isFormPayload =
    typeof FormData !== 'undefined' && config.data instanceof FormData
  const isUrlEncoded = config.data instanceof URLSearchParams
  if (hasBody && method && method !== 'get' && !headers['Content-Type'] && !isFormPayload && !isUrlEncoded) {
    headers['Content-Type'] = 'application/json'
  }
  config.headers = headers
  return config
})

const normalizeResponseText = (data) => {
  if (typeof data === 'string') return data
  try {
    return JSON.stringify(data)
  } catch (error) {
    return String(data)
  }
}

export const logApiError = (error) => {
  if (!error || error.__logged) return
  error.__logged = true
  if (error?.response) {
    const method = error.config?.method ? error.config.method.toUpperCase() : 'UNKNOWN'
    const configUrl = error.config?.url ?? ''
    const baseUrl = error.config?.baseURL ?? ''
    const url = resolveRequestUrl(configUrl, baseUrl)
    const responseText = normalizeResponseText(error.response.data)
    console.error({
      method,
      url,
      status: error.response.status,
      responseText
    })
    return
  }
  console.error(error)
}

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status >= 400) {
      logApiError(error)
    }
    return Promise.reject(error)
  }
)
