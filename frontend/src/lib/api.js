import axios from 'axios'

const fallbackApiUrl = '/api'

export const API_BASE_URL = fallbackApiUrl

export const apiClient = axios.create({
  baseURL: API_BASE_URL
})

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`
  }
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
  if (error?.response) {
    const method = error.config?.method ? error.config.method.toUpperCase() : 'UNKNOWN'
    const configUrl = error.config?.url ?? ''
    const baseUrl = error.config?.baseURL ?? ''
    const url = baseUrl ? new URL(configUrl, baseUrl).toString() : configUrl
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
