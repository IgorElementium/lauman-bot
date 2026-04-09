import xmlrpc from 'xmlrpc';

function getOdooConfig() {
  const baseUrl = process.env.ODOO_URL;
  const db = process.env.ODOO_DB;
  const user = process.env.ODOO_USERNAME;
  const key = process.env.ODOO_API_KEY;
  if (!baseUrl || !db || !user || !key) {
    throw new Error('Odoo environment variables are not configured');
  }
  return { baseUrl, db, user, key };
}

function createXmlRpcClient(path: string, baseUrl: string) {
  const url = new URL(path, baseUrl);
  const isSecure = url.protocol === 'https:';
  const create = isSecure ? xmlrpc.createSecureClient : xmlrpc.createClient;
  return create({
    host: url.hostname,
    port: parseInt(url.port) || (isSecure ? 443 : 80),
    path: url.pathname,
  });
}

const RPC_TIMEOUT_MS = 30_000; // 30 seconds

function callRpc(
  client: xmlrpc.Client,
  method: string,
  params: unknown[]
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Odoo XML-RPC timeout after ${RPC_TIMEOUT_MS}ms (${method})`
        )
      );
    }, RPC_TIMEOUT_MS);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client.methodCall(method, params, (err: any, value: any) => {
      clearTimeout(timer);
      if (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Odoo returned HTML instead of XML-RPC (e.g. error page, login page)
        if (
          msg.includes('Unknown XML-RPC tag') ||
          msg.includes('Unexpected close tag')
        ) {
          reject(
            new Error(
              `Odoo returned HTML instead of XML-RPC (${msg}). Server may be down or session expired.`
            )
          );
        } else {
          reject(err);
        }
      } else {
        resolve(value);
      }
    });
  });
}

let uidCache: number | null = null;

async function authenticate(): Promise<number> {
  if (uidCache) return uidCache;
  const { baseUrl, db, user, key } = getOdooConfig();
  const common = createXmlRpcClient('/xmlrpc/2/common', baseUrl);
  const uid = (await callRpc(common, 'authenticate', [
    db,
    user,
    key,
    {},
  ])) as number;
  if (!uid) throw new Error('Odoo authentication failed');
  uidCache = uid;
  return uid;
}

export async function executeKw(
  model: string,
  method: string,
  args: unknown[],
  kwargs: Record<string, unknown> = {}
): Promise<unknown> {
  const { baseUrl, db, key } = getOdooConfig();
  const uid = await authenticate();
  const object = createXmlRpcClient('/xmlrpc/2/object', baseUrl);
  try {
    return await callRpc(object, 'execute_kw', [
      db,
      uid,
      key,
      model,
      method,
      args,
      kwargs,
    ]);
  } catch (err) {
    // If Odoo returned HTML, the session may be stale — retry once with fresh auth
    if (
      err instanceof Error &&
      err.message.includes('HTML instead of XML-RPC')
    ) {
      uidCache = null;
      const freshUid = await authenticate();
      const freshObject = createXmlRpcClient('/xmlrpc/2/object', baseUrl);
      return callRpc(freshObject, 'execute_kw', [
        db,
        freshUid,
        key,
        model,
        method,
        args,
        kwargs,
      ]);
    }
    throw err;
  }
}

// Convenience helpers
export async function searchRead(
  model: string,
  domain: unknown[][],
  fields: string[],
  options: { limit?: number; offset?: number; order?: string } = {}
) {
  return (await executeKw(model, 'search_read', [domain], {
    fields,
    ...options,
  })) as Record<string, unknown>[];
}

export async function write(
  model: string,
  ids: number[],
  values: Record<string, unknown>
) {
  return executeKw(model, 'write', [ids, values]);
}

export async function read(
  model: string,
  ids: number[],
  fields: string[]
) {
  return (await executeKw(model, 'read', [ids], {
    fields,
  })) as Record<string, unknown>[];
}
