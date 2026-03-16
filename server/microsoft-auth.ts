import { ConfidentialClientApplication, Configuration, AuthorizationCodeRequest, AuthorizationUrlRequest, SilentFlowRequest, AccountInfo } from "@azure/msal-node";

function getMicrosoftAuthConfig(): { tenantId: string; clientId: string; clientSecret: string } {
  return {
    tenantId: process.env.AZURE_TENANT_ID || "",
    clientId: process.env.AZURE_CLIENT_ID || "",
    clientSecret: process.env.AZURE_CLIENT_SECRET || "",
  };
}

const SCOPES = [
  "User.Read",
  "Mail.ReadWrite",
  "Mail.Send",
  "Calendars.ReadWrite",
  "Sites.Read.All",
  "Files.ReadWrite.All",
  "Chat.Read",
  "Team.ReadBasic.All",
  "Channel.ReadBasic.All",
  "ChannelMessage.Read.All",
  "offline_access",
];

function getRedirectUri(): string {
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0]
    || process.env.REPLIT_DEV_DOMAIN
    || `localhost:${process.env.PORT || 5000}`;
  const protocol = domain.includes("localhost") ? "http" : "https";
  return `${protocol}://${domain}/api/auth/microsoft/callback`;
}

function createMsalConfig(): Configuration {
  const config = getMicrosoftAuthConfig();
  return {
    auth: {
      clientId: config.clientId,
      authority: `https://login.microsoftonline.com/${config.tenantId}`,
      clientSecret: config.clientSecret,
    },
  };
}

let msalClient: ConfidentialClientApplication | null = null;

function getMsalClient(): ConfidentialClientApplication {
  if (!msalClient) {
    msalClient = new ConfidentialClientApplication(createMsalConfig());
  }
  return msalClient;
}

export function isMicrosoftAuthConfigured(): boolean {
  const config = getMicrosoftAuthConfig();
  return !!(config.tenantId && config.clientId && config.clientSecret);
}

export async function getAuthorizationUrl(state?: string): Promise<string> {
  const client = getMsalClient();
  const authUrlRequest: AuthorizationUrlRequest = {
    scopes: SCOPES,
    redirectUri: getRedirectUri(),
    state: state || "",
    prompt: "select_account",
  };
  return client.getAuthCodeUrl(authUrlRequest);
}

export async function handleCallback(code: string): Promise<{
  accessToken: string;
  expiresOn: Date | null;
  account: any;
  msProfile: { id: string; displayName: string; mail: string; userPrincipalName: string } | null;
  tokenCache: string | null;
}> {
  const client = getMsalClient();
  const tokenRequest: AuthorizationCodeRequest = {
    code,
    scopes: SCOPES,
    redirectUri: getRedirectUri(),
  };

  const response = await client.acquireTokenByCode(tokenRequest);

  let tokenCache: string | null = null;
  try {
    tokenCache = client.getTokenCache().serialize();
  } catch (err) {
    console.error("[MS Auth] Failed to serialize token cache:", err);
  }

  let msProfile = null;
  if (response.accessToken) {
    try {
      const profileRes = await fetch("https://graph.microsoft.com/v1.0/me", {
        headers: { Authorization: `Bearer ${response.accessToken}` },
      });
      if (profileRes.ok) {
        const p = await profileRes.json() as any;
        msProfile = {
          id: p.id,
          displayName: p.displayName,
          mail: p.mail || p.userPrincipalName,
          userPrincipalName: p.userPrincipalName,
        };
      }
    } catch (err) {
      console.error("[MS Auth] Failed to fetch profile:", err);
    }
  }

  return {
    accessToken: response.accessToken,
    expiresOn: response.expiresOn,
    account: response.account,
    msProfile,
    tokenCache,
  };
}

export async function refreshTokenSilent(serializedCache: string, msUserId: string): Promise<{
  accessToken: string;
  expiresOn: Date | null;
  tokenCache: string;
} | null> {
  if (!isMicrosoftAuthConfigured()) return null;

  try {
    const refreshClient = new ConfidentialClientApplication(createMsalConfig());
    refreshClient.getTokenCache().deserialize(serializedCache);

    const accounts = await refreshClient.getTokenCache().getAllAccounts();
    let account = accounts.find((a: AccountInfo) => a.localAccountId === msUserId);
    if (!account && accounts.length > 0) {
      account = accounts[0];
    }
    if (!account) {
      console.log("[MS Auth] No cached account found for refresh, user needs to re-authenticate");
      return null;
    }

    const silentRequest: SilentFlowRequest = {
      account,
      scopes: SCOPES,
      forceRefresh: true,
    };

    const response = await refreshClient.acquireTokenSilent(silentRequest);
    const updatedCache = refreshClient.getTokenCache().serialize();

    return {
      accessToken: response.accessToken,
      expiresOn: response.expiresOn,
      tokenCache: updatedCache,
    };
  } catch (err: any) {
    console.error("[MS Auth] Silent token refresh failed:", err.message);
    return null;
  }
}
