/** Minimal LRU map: reads refresh recency, writes evict the least recently used entry. */
export class Lru<K, V> {
  private map = new Map<K, V>();

  constructor(
    readonly capacity: number,
    private readonly onEvict?: (key: K, value: V) => void,
  ) {}

  get size(): number {
    return this.map.size;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.capacity) {
      const [oldKey, oldValue] = this.map.entries().next().value as [K, V];
      this.map.delete(oldKey);
      this.onEvict?.(oldKey, oldValue);
    }
  }

  delete(key: K): void {
    this.map.delete(key);
  }

  keys(): IterableIterator<K> {
    return this.map.keys();
  }
}
