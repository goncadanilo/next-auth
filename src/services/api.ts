import axios, { AxiosError } from "axios";
import { parseCookies, setCookie } from "nookies";

import { cookieOptions } from "../common/cookiesOptions";
import { signOut } from "../context/AuthContext";

type ApiError = {
  code?: string;
};

type FailedRequestsQueue = {
  onSuccess: (token: string) => void;
  onFailure: (error: AxiosError<unknown, any>) => void;
};

let cookies = parseCookies();
let isRefreshing = false;
let failedRequestsQueue: FailedRequestsQueue[] = [];

export const api = axios.create({
  baseURL: "http://localhost:3333",
  headers: {
    Authorization: `Bearer ${cookies["auth.token"]}`,
  },
});

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiError>) => {
    if (error.response?.status === 401) {
      if (error.response.data?.code === "token.expired") {
        cookies = parseCookies();

        const { "auth.refreshToken": refreshToken } = cookies;
        const originalConfig = error.config;

        if (!isRefreshing) {
          isRefreshing = true;

          api
            .post("/refresh", { refreshToken })
            .then((response) => {
              const { token, refreshToken: newRefreshToken } = response.data;

              setCookie(undefined, "auth.token", token, cookieOptions);
              setCookie(undefined, "auth.refreshToken", newRefreshToken, {
                ...cookieOptions,
              });

              api.defaults.headers["Authorization"] = `Bearer ${token}`;

              failedRequestsQueue.forEach((req) => req.onSuccess(token));
              failedRequestsQueue = [];
            })
            .catch((error) => {
              failedRequestsQueue.forEach((req) => req.onFailure(error));
              failedRequestsQueue = [];
            })
            .finally(() => {
              isRefreshing = false;
            });
        }

        return new Promise((resolve, reject) => {
          failedRequestsQueue.push({
            onSuccess: (token: string) => {
              if (!originalConfig?.headers) return;

              originalConfig.headers["Authorization"] = `Bearer ${token}`;
              resolve(api(originalConfig));
            },
            onFailure: (error: AxiosError) => reject(error),
          });
        });
      } else {
        signOut();
      }
    }

    return Promise.reject(error);
  }
);
