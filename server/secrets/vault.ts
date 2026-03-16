import { SecretClient } from "@azure/keyvault-secrets";
import { DefaultAzureCredential } from "@azure/identity";

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

let secretClient: SecretClient | null = null;

function getVaultClient(): SecretClient | null {
  if (secretClient) return secretClient;

  const keyVaultUri = process.env.KEY_VAULT_URI;
  if (!keyVaultUri) return null;

  const credential = new DefaultAzureCredential();
  secretClient = new SecretClient(keyVaultUri, credential);
  return secretClient;
}

async function readVaultSecret(vaultName: string): Promise<string | null> {
  const client = getVaultClient();
  if (!client) return null;

  const response = await client.getSecret(vaultName);
  return response.value || null;
}

export async function preloadRuntimeSecrets(): Promise<void> {
  const client = getVaultClient();
  if (!client) {
    if (strictRuntime) {
      throw new Error("[Secrets] KEY_VAULT_URI must be configured in staging/production.");
    }
    return;
  }

  for (const secret of SECRET_RESOLUTIONS) {
    if (process.env[secret.envName]) continue;

    try {
      const value = await readVaultSecret(secret.vaultName);
      if (value) {
        process.env[secret.envName] = value;
      }
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

