import axios, { AxiosError } from "axios";
import { GetServerSidePropsContext } from "next";
import { parseCookies, setCookie } from "nookies";

import { signOut } from "../context/AuthContext";
import { cookieOptions } from "../utils/cookiesOptions";
import { AuthTokenError } from "./errors/AuthTokenError";

type ApiError = {
  code?: string;
};

type FailedRequestsQueue = {
  onSuccess: (token: string) => void;
  onFailure: (error: AxiosError<unknown, any>) => void;
};

type Context = GetServerSidePropsContext | undefined;

let isRefreshing = false;
let failedRequestsQueue: FailedRequestsQueue[] = [];

export function setupAPIClient(ctx: Context = undefined) {
  let cookies = parseCookies(ctx);

  const api = axios.create({
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
          cookies = parseCookies(ctx);

          const { "auth.refreshToken": refreshToken } = cookies;
          const originalConfig = error.config;

          if (!isRefreshing) {
            isRefreshing = true;

            api
              .post("/refresh", { refreshToken })
              .then((response) => {
                const { token, refreshToken: refresh } = response.data;

                setCookie(ctx, "auth.token", token, cookieOptions);
                setCookie(ctx, "auth.refreshToken", refresh, cookieOptions);

                api.defaults.headers["Authorization"] = `Bearer ${token}`;

                failedRequestsQueue.forEach((req) => req.onSuccess(token));
                failedRequestsQueue = [];
              })
              .catch((error) => {
                failedRequestsQueue.forEach((req) => req.onFailure(error));
                failedRequestsQueue = [];

                if (typeof window !== "undefined") {
                  signOut();
                }
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
          if (typeof window !== "undefined") {
            signOut();
          } else {
            return Promise.reject(new AuthTokenError());
          }
        }
      }

      return Promise.reject(error);
    }
  );

  return api;
}
