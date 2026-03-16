import { beforeEach, describe, expect, it, vi } from "vitest";

const getSecretMock = vi.fn();

vi.mock("@azure/keyvault-secrets", () => ({
  SecretClient: class {
    constructor(_vaultUri: string, _credential: unknown) {}
    getSecret = getSecretMock;
  },
}));

vi.mock("@azure/identity", () => ({
  DefaultAzureCredential: class {},
}));

describe("vault-backed secret preloading", () => {
  beforeEach(() => {
    vi.resetModules();
    getSecretMock.mockReset();
    process.env.NODE_ENV = "production";
    process.env.KEY_VAULT_URI = "https://vault.example.vault.azure.net";
    delete process.env.DATABASE_URL;
    delete process.env.SESSION_SECRET;
    delete process.env.JWT_SECRET;
    delete process.env.AZURE_CLIENT_SECRET;
  });

  it("accepts strict-runtime secrets that are already present in the host env without requiring Key Vault", async () => {
    delete process.env.KEY_VAULT_URI;
    process.env.DATABASE_URL = "postgres://direct-env";
    process.env.SESSION_SECRET = "session-secret-from-env";
    process.env.JWT_SECRET = "jwt-secret-from-env";
    process.env.AZURE_CLIENT_SECRET = "client-secret-from-env";

    const { preloadRuntimeSecrets } = await import("../../../server/secrets/vault");

    await expect(preloadRuntimeSecrets()).resolves.toBeUndefined();
    expect(getSecretMock).not.toHaveBeenCalled();
  });

  it("hydrates required secrets into process.env without logging values", async () => {
    getSecretMock.mockImplementation(async (name: string) => {
      const values: Record<string, string> = {
        "app-database-url": "postgres://redacted",
        "app-session-secret": "session-secret-redacted",
        "app-jwt-signing-secret": "jwt-secret-redacted",
        "ms-graph-client-secret": "client-secret-redacted",
      };
      return { value: values[name] };
    });

    const { preloadRuntimeSecrets } = await import("../../../server/secrets/vault");
    await preloadRuntimeSecrets();

    expect(process.env.DATABASE_URL).toBe("postgres://redacted");
    expect(process.env.SESSION_SECRET).toBe("session-secret-redacted");
    expect(process.env.JWT_SECRET).toBe("jwt-secret-redacted");
    expect(process.env.AZURE_CLIENT_SECRET).toBe("client-secret-redacted");
  });

  it("fails with a clear missing-secret error that does not include values", async () => {
    getSecretMock.mockResolvedValue({ value: null });
    const { preloadRuntimeSecrets } = await import("../../../server/secrets/vault");

    await expect(preloadRuntimeSecrets()).rejects.toThrow(/Missing required runtime secrets/);
  });

  it("explains that strict runtime can use host env vars when Key Vault is not configured", async () => {
    delete process.env.KEY_VAULT_URI;
    const { preloadRuntimeSecrets } = await import("../../../server/secrets/vault");

    await expect(preloadRuntimeSecrets()).rejects.toThrow(/Replit Secrets|environment variables|KEY_VAULT_URI/);
  });
});
