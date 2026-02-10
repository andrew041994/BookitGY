import axios from "axios";
import {
  clearAllAuthTokens,
  loadRefreshToken,
  loadToken,
  saveRefreshToken,
  saveToken,
} from "../components/tokenStorage";

export const createApiClient = ({ baseURL, onUnauthorized }) => {
  const client = axios.create({ baseURL });
  let isRefreshing = false;
  let refreshPromise = null;

  client.interceptors.request.use(async (config) => {
    const token = await loadToken();
    if (token) {
      config.headers = {
        ...config.headers,
        Authorization: `Bearer ${token}`,
      };
    }
    return config;
  });

  const refreshAccessToken = async () => {
    const refreshToken = await loadRefreshToken();
    if (!refreshToken) {
      const error = new Error("Missing refresh token");
      error.code = "SESSION_EXPIRED";
      throw error;
    }

    const response = await axios.post(`${baseURL}/auth/refresh`, {
      refresh_token: refreshToken,
    });

    const newAccessToken = response?.data?.access_token;
    const newRefreshToken = response?.data?.refresh_token;
    if (!newAccessToken || !newRefreshToken) {
      const error = new Error("Invalid refresh response");
      error.code = "SESSION_EXPIRED";
      throw error;
    }

    await saveToken(newAccessToken);
    await saveRefreshToken(newRefreshToken);
    return newAccessToken;
  };

  client.interceptors.response.use(
    (response) => response,
    async (error) => {
      const status = error?.response?.status;
      const originalRequest = error?.config || {};

      if (status !== 401 || originalRequest._retry) {
        return Promise.reject(error);
      }

      originalRequest._retry = true;

      try {
        if (!isRefreshing) {
          isRefreshing = true;
          refreshPromise = refreshAccessToken().finally(() => {
            isRefreshing = false;
          });
        }

        const newAccessToken = await refreshPromise;
        originalRequest.headers = {
          ...(originalRequest.headers || {}),
          Authorization: `Bearer ${newAccessToken}`,
        };
        return client(originalRequest);
      } catch (refreshError) {
        const code =
          refreshError?.response?.data?.code ||
          refreshError?.response?.data?.detail?.code ||
          refreshError?.code;

        await clearAllAuthTokens();

        if (typeof onUnauthorized === "function") {
          await onUnauthorized({ sessionExpired: code === "SESSION_EXPIRED" });
        }

        return Promise.reject(refreshError);
      }
    }
  );

  return client;
};
