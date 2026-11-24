class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();

  public get length(): number {
    return this.data.size;
  }

  public clear(): void {
    this.data.clear();
  }

  public getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  public key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }

  public removeItem(key: string): void {
    this.data.delete(key);
  }

  public setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
}

if (
  typeof window !== "undefined" &&
  (!window.localStorage || typeof window.localStorage.clear !== "function")
) {
  const mem = new MemoryStorage();
  Object.defineProperty(window, "localStorage", {
    value: mem,
    configurable: true,
    writable: true,
  });
}
