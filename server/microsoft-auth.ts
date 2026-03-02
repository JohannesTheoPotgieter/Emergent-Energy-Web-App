import { ConfidentialClientApplication, Configuration, AuthorizationCodeRequest, AuthorizationUrlRequest } from "@azure/msal-node";

const TENANT_ID = process.env.AZURE_TENANT_ID || "";
const CLIENT_ID = process.env.AZURE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET || "";

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

const msalConfig: Configuration = {
  auth: {
    clientId: CLIENT_ID,
    authority: `https://login.microsoftonline.com/${TENANT_ID}`,
    clientSecret: CLIENT_SECRET,
  },
};

let msalClient: ConfidentialClientApplication | null = null;

function getMsalClient(): ConfidentialClientApplication {
  if (!msalClient) {
    msalClient = new ConfidentialClientApplication(msalConfig);
  }
  return msalClient;
}

export function isMicrosoftAuthConfigured(): boolean {
  return !!(TENANT_ID && CLIENT_ID && CLIENT_SECRET);
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
}> {
  const client = getMsalClient();
  const tokenRequest: AuthorizationCodeRequest = {
    code,
    scopes: SCOPES,
    redirectUri: getRedirectUri(),
  };

  const response = await client.acquireTokenByCode(tokenRequest);

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
  };
}
