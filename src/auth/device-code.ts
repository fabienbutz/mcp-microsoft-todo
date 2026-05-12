import { LogLevel, PublicClientApplication } from "@azure/msal-node";
import type { AccountInfo, AuthenticationResult } from "@azure/msal-node";
import { fileCachePlugin } from "./token-cache";
import { AppError } from "../graph/errors";
import type { AppConfig } from "../config";
import type { Logger } from "../lib/logger";

/** The bits of MSAL's device-code response we surface (a subset of `DeviceCodeResponse`). */
export interface DeviceCodeInfo {
  userCode: string;
  verificationUri: string;
  message: string;
  /** Seconds until the code expires. */
  expiresIn: number;
}

export function createPca(config: AppConfig, logger: Logger): PublicClientApplication {
  if (!config.clientId) {
    throw new AppError(
      "config_error",
      "No Microsoft Entra client ID configured. Register an app (see docs/ENTRA-APP-SETUP.md) and set MS_TODO_CLIENT_ID.",
    );
  }
  return new PublicClientApplication({
    auth: { clientId: config.clientId, authority: config.authority },
    cache: { cachePlugin: fileCachePlugin(config.tokenCachePath) },
    system: {
      loggerOptions: {
        piiLoggingEnabled: false,
        logLevel: LogLevel.Warning,
        loggerCallback: (_level, message, containsPii) => {
          if (!containsPii) logger.debug("msal", { msal: message });
        },
      },
    },
  });
}

/**
 * Run the device-code flow. `onDeviceCode` fires once, early, with the code/URL/message;
 * the returned promise then polls until the user completes the sign-in (or it times out).
 */
export async function acquireByDeviceCode(
  pca: PublicClientApplication,
  scopes: string[],
  onDeviceCode: (info: DeviceCodeInfo) => void,
): Promise<AuthenticationResult> {
  const result = await pca.acquireTokenByDeviceCode({ scopes, deviceCodeCallback: onDeviceCode });
  if (!result) throw new AppError("auth_required", "Device-code sign-in did not return a token.");
  return result;
}

export async function getCachedAccount(pca: PublicClientApplication): Promise<AccountInfo | null> {
  const accounts = await pca.getTokenCache().getAllAccounts();
  return accounts[0] ?? null;
}
