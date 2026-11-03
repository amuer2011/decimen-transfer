/** Active transfer time, excluding pauses, shared by progress and final speed. */
export class TransferClock {
  private startedAt = 0;
  private pausedAt: number | null = null;
  private pausedMs = 0;

  constructor(private readonly now: () => number = () => performance.now()) {}

  reset(): void {
    this.startedAt = this.now();
    this.pausedAt = null;
    this.pausedMs = 0;
  }

  pause(): void {
    this.pausedAt ??= this.now();
  }

  resume(): void {
    if (this.pausedAt === null) return;
    this.pausedMs += this.now() - this.pausedAt;
    this.pausedAt = null;
  }

  get seconds(): number {
    return Math.max(0, ((this.pausedAt ?? this.now()) - this.startedAt - this.pausedMs) / 1000);
  }
}
