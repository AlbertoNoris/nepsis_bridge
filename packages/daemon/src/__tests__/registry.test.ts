import { describe, it, expect, vi } from 'vitest';
import { Registry } from '../registry';
import { Session } from '../session';
import { SessionInfo } from '@nepsis/shared';

function mockSession(id: string): Session {
  const info: SessionInfo = {
    id,
    cmd: 'bash',
    args: [],
    cwd: '/tmp',
    createdAt: Date.now(),
    activeClientId: null,
    cols: 80,
    rows: 24,
  };

  return {
    id,
    dispose: vi.fn(),
    toInfo: () => info,
  } as unknown as Session;
}

describe('Registry', () => {
  it('add and get', () => {
    const reg = new Registry();
    const s = mockSession('abc');
    reg.add(s);
    expect(reg.get('abc')).toBe(s);
  });

  it('get returns undefined for unknown id', () => {
    const reg = new Registry();
    expect(reg.get('nope')).toBeUndefined();
  });

  it('remove calls dispose and deletes', () => {
    const reg = new Registry();
    const s = mockSession('abc');
    reg.add(s);
    const removed = reg.remove('abc');
    expect(removed).toBe(true);
    expect(s.dispose).toHaveBeenCalled();
    expect(reg.get('abc')).toBeUndefined();
  });

  it('remove returns false for unknown id', () => {
    const reg = new Registry();
    expect(reg.remove('nope')).toBe(false);
  });

  it('list returns SessionInfo for all sessions', () => {
    const reg = new Registry();
    reg.add(mockSession('a'));
    reg.add(mockSession('b'));
    const list = reg.list();
    expect(list.length).toBe(2);
    expect(list.map((s) => s.id).sort()).toEqual(['a', 'b']);
  });

  it('all returns Session instances', () => {
    const reg = new Registry();
    const s1 = mockSession('a');
    const s2 = mockSession('b');
    reg.add(s1);
    reg.add(s2);
    expect(reg.all()).toContain(s1);
    expect(reg.all()).toContain(s2);
  });

  it('size tracks count', () => {
    const reg = new Registry();
    expect(reg.size()).toBe(0);
    reg.add(mockSession('a'));
    expect(reg.size()).toBe(1);
    reg.add(mockSession('b'));
    expect(reg.size()).toBe(2);
    reg.remove('a');
    expect(reg.size()).toBe(1);
  });
});
