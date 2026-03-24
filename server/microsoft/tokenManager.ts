export async function graphWithResilience<T = any>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
  let retries = 0;
  let token = accessToken;
  while (retries < 4) {
    try {
      const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(init?.headers || {}),
        },
      });
      if (!response.ok) {
        const error: any = new Error(`Graph request failed (${response.status})`);
        error.status = response.status;
        throw error;
      }
      const result = await response.json();
      return result as T;
    } catch (error: any) {
      const status = Number(error?.status || 0);
      if (status === 401) {
        console.info(`[MS TokenManager] Refreshing token after 401 for ${path}`);
        token = accessToken;
      }
      if (status === 429 || status === 503) {
        const waitMs = Math.pow(2, retries) * 500;
        await new Promise((r) => setTimeout(r, waitMs));
        retries += 1;
        continue;
      }
      throw error;
    }
  }
  throw new Error(`Graph request failed after retries: ${path}`);
}
