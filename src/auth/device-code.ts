import { LogLevel, PublicClientApplication } from "@azure/msal-node";
import type { AccountInfo, AuthenticationResult } from "@azure/msal-node";
import { fileCachePlugin } from "./token-cache";
import { AppError } from "../graph/errors";
import type { AppConfig } from "../config";
import type { Logger } from "../lib/logger";

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

/** Runs the device-code flow interactively. Only ever called from the `login` CLI command. */
export async function loginInteractive(pca: PublicClientApplication, scopes: string[]): Promise<AuthenticationResult> {
  const result = await pca.acquireTokenByDeviceCode({
    scopes,
    deviceCodeCallback: (response) => {
      // `response.message` is the human instruction ("open https://microsoft.com/devicelogin and enter CODE").
      process.stdout.write(`\n${response.message}\n\n`);
    },
  });
  if (!result) throw new AppError("auth_required", "Device-code login did not return a token.");
  return result;
}

export async function getCachedAccount(pca: PublicClientApplication): Promise<AccountInfo | null> {
  const accounts = await pca.getTokenCache().getAllAccounts();
  return accounts[0] ?? null;
}
