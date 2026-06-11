type SecretName =
  | "DATABASE_URL"
  | "SESSION_SECRET"
  | "JWT_SECRET"
  | "AZURE_CLIENT_SECRET"
  | "MICROSOFT_CONNECTOR_TOKEN"
  | "SENDGRID_API_KEY"
  | "THIRD_PARTY_SERVICE_TOKEN";

type SecretResolution = {
  envName: SecretName;
  vaultName: string;
  requiredInStrictRuntime: boolean;
};

const SECRET_RESOLUTIONS: SecretResolution[] = [
  { envName: "DATABASE_URL", vaultName: "app-database-url", requiredInStrictRuntime: true },
  { envName: "SESSION_SECRET", vaultName: "app-session-secret", requiredInStrictRuntime: true },
  { envName: "JWT_SECRET", vaultName: "app-jwt-signing-secret", requiredInStrictRuntime: true },
  { envName: "AZURE_CLIENT_SECRET", vaultName: "ms-graph-client-secret", requiredInStrictRuntime: true },
  { envName: "MICROSOFT_CONNECTOR_TOKEN", vaultName: "microsoft-connector-token", requiredInStrictRuntime: false },
  { envName: "SENDGRID_API_KEY", vaultName: "email-provider-api-key", requiredInStrictRuntime: false },
  { envName: "THIRD_PARTY_SERVICE_TOKEN", vaultName: "third-party-service-token", requiredInStrictRuntime: false },
];

const strictRuntime = process.env.NODE_ENV === "production" || process.env.NODE_ENV === "staging";

/**
 * Cache of credential expiry dates read from Key Vault `properties.expiresOn`
 * during preload. Lets the integration-health monitor count down to a client
 * secret's expiry on Azure-hosted deploys. On Replit (env-only) this stays
 * empty and the monitor falls back to the configured *_EXPIRES_ON date.
 */
const secretExpiries = new Map<SecretName, Date | null>();

let secretClient: any = null;

async function getVaultClient(): Promise<any | null> {
  if (secretClient) return secretClient;

  const keyVaultUri = process.env.KEY_VAULT_URI;
  if (!keyVaultUri) return null;

  try {
    const { SecretClient } = await import("@azure/keyvault-secrets");
    const { DefaultAzureCredential } = await import("@azure/identity");
    const credential = new DefaultAzureCredential();
    secretClient = new SecretClient(keyVaultUri, credential);
    return secretClient;
  } catch {
    if (strictRuntime) {
      throw new Error("[Secrets] @azure/keyvault-secrets or @azure/identity packages not installed.");
    }
    return null;
  }
}

async function readVaultSecret(
  client: any,
  vaultName: string,
): Promise<{ value: string | null; expiresOn: Date | null }> {
  const response = await client.getSecret(vaultName);
  const rawExpiry = response?.properties?.expiresOn ?? null;
  const expiresOn = rawExpiry ? new Date(rawExpiry) : null;
  return { value: response.value || null, expiresOn };
}

export async function preloadRuntimeSecrets(): Promise<void> {
  const client = await getVaultClient();
  if (!client) {
    if (strictRuntime) {
      const requiredSecrets = SECRET_RESOLUTIONS.filter((s) => s.requiredInStrictRuntime);
      const allPresent = requiredSecrets.every((s) => !!process.env[s.envName]);
      if (allPresent) {
        console.log("[Secrets] KEY_VAULT_URI not set, but all required secrets found in environment. Skipping vault.");
        return;
      }
      throw new Error("[Secrets] KEY_VAULT_URI must be configured in staging/production, or set all required secrets as environment variables.");
    }
    return;
  }

  for (const secret of SECRET_RESOLUTIONS) {
    if (process.env[secret.envName]) continue;

    try {
      const { value, expiresOn } = await readVaultSecret(client, secret.vaultName);
      if (value) {
        process.env[secret.envName] = value;
      }
      // Record the credential's expiry even when the value came from env —
      // the integration-health monitor uses it for the secret-expiry countdown.
      secretExpiries.set(secret.envName, expiresOn);
    } catch (err) {
      const e = err as Error;
      throw new Error(`[Secrets] Failed to retrieve required runtime secrets (name=${secret.vaultName}): ${e.message}`);
    }
  }

  const missingRequiredSecrets = SECRET_RESOLUTIONS.filter(
    (secret) => secret.requiredInStrictRuntime && !process.env[secret.envName],
  );

  if (strictRuntime && missingRequiredSecrets.length > 0) {
    const missingNames = missingRequiredSecrets.map((secret) => secret.envName).join(", ");
    throw new Error(`[Secrets] Missing required runtime secrets: ${missingNames}.`);
  }
}

export function getSecretFromEnv(name: SecretName): string | undefined {
  return process.env[name];
}

/**
 * Credential expiry date sourced from Key Vault `properties.expiresOn` during
 * preload, or null when unknown (e.g. env-only Replit deploys, where the
 * integration-health monitor falls back to the configured *_EXPIRES_ON date).
 */
export function getSecretExpiryFromVault(name: string): Date | null {
  return secretExpiries.get(name as SecretName) ?? null;
}
