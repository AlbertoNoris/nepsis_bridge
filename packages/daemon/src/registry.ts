import { Session } from './session';
import { SessionInfo } from '@nepsis/shared';

export class Registry {
  private sessions = new Map<string, Session>();

  add(session: Session): void {
    this.sessions.set(session.id, session);
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  remove(id: string): boolean {
    const session = this.sessions.get(id);
    if (session) {
      session.dispose();
      this.sessions.delete(id);
      return true;
    }
    return false;
  }

  list(): SessionInfo[] {
    return Array.from(this.sessions.values()).map((s) => s.toInfo());
  }

  all(): Session[] {
    return Array.from(this.sessions.values());
  }

  size(): number {
    return this.sessions.size;
  }
}
