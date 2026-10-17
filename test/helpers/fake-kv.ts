interface Entry {
  value: string;
  expiresAt?: number;
}

/** Minimal in-memory KVNamespace for tests. */
export class FakeKV {
  private readonly entries = new Map<string, Entry>();

  async get(key: string, type?: 'text' | 'json'): Promise<unknown> {
    const entry = this.entries.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return type === 'json' ? JSON.parse(entry.value) : entry.value;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    const expiresAt =
      options?.expirationTtl !== undefined
        ? Date.now() + options.expirationTtl * 1000
        : undefined;
    this.entries.set(key, { value, expiresAt });
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async list(): Promise<{ keys: { name: string }[]; list_complete: boolean }> {
    return {
      keys: Array.from(this.entries.keys(), (name) => ({ name })),
      list_complete: true,
    };
  }
}
