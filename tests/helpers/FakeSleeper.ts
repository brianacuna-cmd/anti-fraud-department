/** Records sleep requests and resolves immediately (no real delay). */
export class FakeSleeper {
  readonly sleeps: number[] = [];

  async sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
  }
}
