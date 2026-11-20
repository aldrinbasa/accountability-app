/** A stand-in IntersectionObserver: nothing intersects until a test calls `intersectAll()`. */
export class FakeIntersectionObserver {
  static instances = new Set<FakeIntersectionObserver>()
  private targets = new Set<Element>()
  constructor(private callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.instances.add(this)
  }
  observe(target: Element): void {
    this.targets.add(target)
  }
  unobserve(target: Element): void {
    this.targets.delete(target)
  }
  disconnect(): void {
    this.targets.clear()
    FakeIntersectionObserver.instances.delete(this)
  }
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
  trigger(): void {
    const entries = [...this.targets].map(
      (target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry,
    )
    if (entries.length > 0) this.callback(entries, this as unknown as IntersectionObserver)
  }
}

/** Every observed element comes into view (e.g. the Feed's end-of-wall sentinel). */
export function intersectAll(): void {
  for (const observer of [...FakeIntersectionObserver.instances]) observer.trigger()
}
