import axios from 'axios'

const rawApiUrl = import.meta.env.VITE_API_URL
const fallbackApiUrl =
  import.meta.env.MODE === 'development'
    ? 'http://localhost:8002'
    : 'https://bookitgy.onrender.com'

export const API_BASE_URL =
  rawApiUrl && rawApiUrl.trim() ? rawApiUrl.trim() : fallbackApiUrl

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
    const configUrl = error.config?.url ?? ''
    const baseUrl = error.config?.baseURL ?? ''
    const url = baseUrl ? new URL(configUrl, baseUrl).toString() : configUrl
    console.error({
      url,
      status: error.response.status,
      responseText: normalizeResponseText(error.response.data)
    })
    return
  }
  console.error(error)
}
