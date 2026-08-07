import { describe, expect, test } from 'bun:test';

import { parseConversation, toStored, type StoredConversation } from '../frontend/src/store/conversationRecord.ts';

/**
 * The third suite here that needs no server, and for `statements.test.ts`'
 * reason: this decides *what gets written to disk*, and the failure it guards
 * against is database rows landing in `squeal.db` — a table nothing encrypts the
 * way a password is, holding values that only ever left the process because
 * somebody asked a question about them once.
 *
 * A database could not be asked about it. By the time these bytes are written
 * the rows are already in the webview, and every case below is about the copy
 * that goes the other way.
 */

const rows = (callId: string, shape?: string): StoredConversation => ({
  messages: [
    { role: 'user', content: 'what is in that table' },
    { role: 'assistant', content: '', toolCalls: [{ id: callId, name: 'getTabResult', arguments: '{"tabId":"3"}' }] },
    {
      role: 'tool',
      toolCallId: callId,
      content: JSON.stringify({ columns: ['id', 'email'], rows: [['1', 'ada@example.com']], rowsReturned: 1 }),
    },
  ],
  tools: {
    [callId]: {
      name: 'getTabResult',
      target: 'users · local',
      outcome: 'ran',
      args: '{"tabId":"3"}',
      result: JSON.stringify({ columns: ['id', 'email'], rows: [['1', 'ada@example.com']], rowsReturned: 1 }),
      ...(shape === undefined ? {} : { stored: shape }),
    },
  },
});

describe('what a conversation is written down as', () => {
  test('a result is stored as its shape, in the message the model would be re-sent', () => {
    const stored = toStored(rows('call-1', '1 rows of users(id, email)'));

    expect(stored.messages[2]).toEqual({ role: 'tool', toolCallId: 'call-1', content: '1 rows of users(id, email)' });
  });

  test('and in the record the thread draws, which is the copy easiest to forget', () => {
    // Two places hold the same answer -- the wire message and the row the
    // disclosure expands -- and redacting only the first would put the values
    // back on disk under a different key.
    const stored = toStored(rows('call-1', '1 rows of users(id, email)'));

    expect(stored.tools['call-1']!.result).toBe('1 rows of users(id, email)');
  });

  test('no cell value survives anywhere in the written bytes', () => {
    // The assertion that actually means something: not "the field changed" but
    // "the value is not in the file". Serialised, because that is what is
    // written, and a value hiding in a field nobody thought to check would still
    // be in there.
    expect(JSON.stringify(toStored(rows('call-1', '1 rows of users(id, email)')))).not.toContain('ada@example.com');
  });

  test('the shape is not carried as a field of its own once it has been applied', () => {
    // It exists to survive the trip from the tool that made it to the write. On
    // disk it *is* the result, so keeping it beside one would be the same string
    // twice and a second place a reader could take the answer from.
    expect(toStored(rows('call-1', '1 rows of users(id, email)')).tools['call-1']).not.toHaveProperty('stored');
  });

  test('a call that never carried values is stored exactly as it answered', () => {
    // Schema, DDL, the tab listing, the user's own SQL: none of it is a database
    // *value*, and a redaction that reached them would leave a reopened
    // conversation unable to say what it had looked at.
    const schema = rows('call-1');
    const stored = toStored(schema);

    expect(stored.messages).toEqual(schema.messages);
    expect(stored.tools['call-1']!.result).toBe(schema.tools['call-1']!.result);
  });

  test('a tool message whose call is no longer recorded is left alone', () => {
    // The records are pruned with the tab and the messages are not, so a lookup
    // that finds nothing has to mean "store it as it stands" rather than throw
    // on the way to the disk.
    const orphan = rows('call-1', '1 rows of users(id, email)');
    orphan.tools = {};

    expect(toStored(orphan).messages[2]).toEqual(orphan.messages[2]!);
  });
});

describe('reading one back', () => {
  test('a round trip returns what went in', () => {
    const stored = toStored(rows('call-1', '1 rows of users(id, email)'));
    expect(parseConversation(JSON.stringify(stored))).toEqual(stored);
  });

  test('a body that does not parse reads as nothing to restore, not as a failure', () => {
    // `parseSnapshot`'s answer, and its reason: the store hands back the string
    // this side wrote, so this is only reachable across a format change -- where
    // an empty thread beats a tab that will not open.
    expect(parseConversation('{')).toBeNull();
    expect(parseConversation('{"messages":"not an array"}')).toBeNull();
  });

  test('a body with no tool records reads as a conversation with none', () => {
    expect(parseConversation('{"messages":[]}')).toEqual({ messages: [], tools: {} });
  });
});
