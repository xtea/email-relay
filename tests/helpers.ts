import type { KVNamespace } from '@cloudflare/workers-types';
import type { Env } from '../src/types';

export interface MockKVStore {
  data: Map<string, { value: string; metadata?: unknown; expirationTtl?: number }>;
}

export function mockKv(store?: MockKVStore): KVNamespace {
  const data = store?.data ?? new Map();
  if (store) store.data = data;
  return {
    get: async (key: string) => data.get(key)?.value ?? null,
    put: async (
      key: string,
      value: string,
      opts?: { metadata?: unknown; expirationTtl?: number },
    ) => {
      data.set(key, { value, metadata: opts?.metadata, expirationTtl: opts?.expirationTtl });
    },
    delete: async (key: string) => {
      data.delete(key);
    },
    list: async ({ prefix = '' }: { prefix?: string; cursor?: string } = {}) => {
      const keys = [...data.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([name, { metadata }]) => ({ name, metadata }));
      return { keys, list_complete: true, cursor: '' };
    },
    getWithMetadata: async () => ({ value: null, metadata: null }),
  } as unknown as KVNamespace;
}

export function mockEnv(opts?: { token?: string }): { env: Env; kvStore: MockKVStore } {
  const kvStore: MockKVStore = { data: new Map() };
  const env: Env = {
    INBOX: mockKv(kvStore),
    INBOX_TOKEN: opts?.token ?? 'test-token',
  };
  return { env, kvStore };
}

export const AUTH = { authorization: 'Bearer test-token' };
