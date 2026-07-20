import { KintoneRestAPIClient } from '@kintone/rest-api-client';

export interface KintoneAdminConfig {
  subdomain: string;
  username: string;
  password: string;
}

/** Pass-through to the SDK's addFormFields `properties` shape; narrowed per-app in src/apps/schema.ts. */
export type KintoneFieldProperties = Record<string, Record<string, unknown>>;

export interface WaitForDeployOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

const DEFAULT_DEPLOY_TIMEOUT_MS = 60_000;
const DEFAULT_DEPLOY_POLL_INTERVAL_MS = 3_000;

export class KintoneAdminClient {
  private readonly client: KintoneRestAPIClient;

  constructor(config: KintoneAdminConfig) {
    this.client = new KintoneRestAPIClient({
      baseUrl: `https://${config.subdomain}.cybozu.com`,
      auth: { username: config.username, password: config.password },
    });
  }

  async createApp(name: string): Promise<number> {
    const result = await this.client.app.addApp({ name });
    return Number(result.app);
  }

  /** Exact-name lookup (kintone's getApps only supports partial match, so we filter client-side). */
  async findAppByName(name: string): Promise<number | undefined> {
    const { apps } = await this.client.app.getApps({ name });
    const match = apps.find((app) => app.name === name);
    return match ? Number(match.appId) : undefined;
  }

  async addFields(appId: number, properties: KintoneFieldProperties): Promise<void> {
    await this.client.app.addFormFields({ app: appId, properties });
  }

  async deployApp(appId: number): Promise<void> {
    await this.client.app.deployApp({ apps: [{ app: appId }] });
  }

  async waitForDeploy(appId: number, opts: WaitForDeployOptions = {}): Promise<void> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_DEPLOY_TIMEOUT_MS;
    const intervalMs = opts.intervalMs ?? DEFAULT_DEPLOY_POLL_INTERVAL_MS;
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const { apps } = await this.client.app.getDeployStatus({ apps: [appId] });
      const status = apps[0]?.status;
      if (status === 'SUCCESS') return;
      if (status === 'FAIL' || status === 'CANCEL') {
        throw new Error(`Deploy failed for app ${appId}: status=${status}`);
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(`Deploy timed out for app ${appId} after ${timeoutMs}ms`);
  }

  /**
   * Composed helper: create + addFields + deploy + wait, in one call.
   * Idempotent by exact app name — reruns against a live kintone space must not create duplicate apps.
   */
  async createAndDeployApp(name: string, properties: KintoneFieldProperties): Promise<number> {
    const existingAppId = await this.findAppByName(name);
    if (existingAppId !== undefined) {
      return existingAppId;
    }

    const appId = await this.createApp(name);
    await this.addFields(appId, properties);
    await this.deployApp(appId);
    await this.waitForDeploy(appId);
    return appId;
  }

  async getFormFields(
    appId: number,
    opts: { preview?: boolean } = {},
  ): Promise<Record<string, unknown>> {
    const result = await this.client.app.getFormFields({
      app: appId,
      preview: opts.preview ?? false,
    });
    return result.properties;
  }

  /** Unused in phase 1; built now for phase 3 (business-card upload) reuse. */
  async uploadFile(fileName: string, data: Buffer | string): Promise<string> {
    const result = await this.client.file.uploadFile({ file: { name: fileName, data } });
    return result.fileKey;
  }

  /** Unused in phase 1; built now for phase 2+ (chat UI customize JS) reuse. */
  async setCustomize(
    appId: number,
    customize: Omit<Parameters<KintoneRestAPIClient['app']['updateAppCustomize']>[0], 'app'>,
  ): Promise<void> {
    await this.client.app.updateAppCustomize({ app: appId, ...customize });
  }
}
