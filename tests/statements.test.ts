import { describe, expect, test } from 'bun:test';

import { splitStatements } from '../frontend/src/common/db/splitStatements.ts';

/**
 * The one suite here that needs no server, deliberately.
 *
 * Everything else in this project runs against a real database because a mock
 * would have agreed with whatever it was told. This is the opposite kind of
 * thing: it decides *what gets sent*, before any connection exists, and a wrong
 * cut is a statement torn in half — which is the one failure no database can be
 * asked about, because each half would arrive looking like something the user
 * typed.
 *
 * Every case below is one where a plain `sql.split(';')` is wrong.
 */

describe('splitting a tab into statements', () => {
  test('one statement stays one, with or without its terminator', () => {
    expect(splitStatements('SELECT 1', 'pgsql')).toEqual(['SELECT 1']);
    expect(splitStatements('SELECT 1;', 'pgsql')).toEqual(['SELECT 1']);
    expect(splitStatements('  SELECT 1 ;  \n', 'pgsql')).toEqual(['SELECT 1']);
  });

  test('several come back in order, each without its terminator', () => {
    expect(splitStatements('SELECT 1;\nSELECT 2;\nSELECT 3', 'pgsql'))
      .toEqual(['SELECT 1', 'SELECT 2', 'SELECT 3']);
  });

  test('nothing to run is an empty list, never a blank statement', () => {
    expect(splitStatements('', 'pgsql')).toEqual([]);
    expect(splitStatements('   \n\t ', 'pgsql')).toEqual([]);
    expect(splitStatements(';;;', 'pgsql')).toEqual([]);
    expect(splitStatements('-- just a note\n', 'pgsql')).toEqual([]);
    expect(splitStatements('/* nothing but this */', 'pgsql')).toEqual([]);
  });

  test('a semicolon inside a string literal does not end a statement', () => {
    expect(splitStatements("SELECT 'a;b'", 'pgsql')).toEqual(["SELECT 'a;b'"]);
    expect(splitStatements("INSERT INTO t VALUES ('x;y'); SELECT 1", 'pgsql'))
      .toEqual(["INSERT INTO t VALUES ('x;y')", 'SELECT 1']);
  });

  test("a doubled quote is a quote, not the end of the literal", () => {
    expect(splitStatements("SELECT 'O''Hara; still inside'", 'pgsql'))
      .toEqual(["SELECT 'O''Hara; still inside'"]);
  });

  test('a semicolon inside a quoted identifier does not end a statement', () => {
    expect(splitStatements('SELECT "a;b" FROM t', 'pgsql')).toEqual(['SELECT "a;b" FROM t']);
    expect(splitStatements('SELECT `a;b` FROM t', 'mysql')).toEqual(['SELECT `a;b` FROM t']);
  });

  test('a semicolon inside a comment does not end a statement', () => {
    expect(splitStatements('SELECT 1 -- ; not the end\n, 2', 'pgsql')).toEqual(['SELECT 1 -- ; not the end\n, 2']);
    expect(splitStatements('SELECT /* ; */ 1', 'pgsql')).toEqual(['SELECT /* ; */ 1']);
  });

  test('a comment before a statement stays with it; one after it is not a statement', () => {
    expect(splitStatements('-- what this does\nSELECT 1;\n-- done', 'pgsql'))
      .toEqual(['-- what this does\nSELECT 1']);
  });

  /*
   * The engine-specific rules. Each is a case where reading the text by another
   * engine's rules cuts in the wrong place, which is the whole reason the
   * splitter is told the dialect at all.
   */
  test("MySQL's # comment hides a semicolon; the other engines have no such comment", () => {
    expect(splitStatements('SELECT 1 # ; not the end\n, 2', 'mysql')).toEqual(['SELECT 1 # ; not the end\n, 2']);
    expect(splitStatements('SELECT 1 # a\n; SELECT 2', 'mysql')).toEqual(['SELECT 1 # a', 'SELECT 2']);
  });

  test("MySQL's -- needs whitespace after it, so `1--;2` is arithmetic and not a comment", () => {
    expect(splitStatements('SELECT 1--;\nSELECT 2', 'mysql')).toEqual(['SELECT 1--', 'SELECT 2']);
    expect(splitStatements('SELECT 1--;\nSELECT 2', 'pgsql')).toEqual(['SELECT 1--;\nSELECT 2']);
  });

  test('MySQL reads a backslash-escaped quote; standard SQL does not', () => {
    // The backslash escapes the quote, so the literal runs on past the semicolon.
    expect(splitStatements("SELECT 'a\\'; b'", 'mysql')).toEqual(["SELECT 'a\\'; b'"]);
    // Standard SQL closes at that same quote, so the semicolon after it is real.
    expect(splitStatements("SELECT 'a\\'; b'", 'pgsql')).toEqual(["SELECT 'a\\'", "b'"]);
  });

  test("Postgres' E'' string is the one there that does read a backslash", () => {
    expect(splitStatements("SELECT E'a\\'; b'", 'pgsql')).toEqual(["SELECT E'a\\'; b'"]);
    // The E has to be a word of its own -- a name ending in one is not a prefix.
    expect(splitStatements("SELECT type'a\\'; b'", 'pgsql')).toEqual(["SELECT type'a\\'", "b'"]);
  });

  test("a dollar-quoted body's semicolons are inside it", () => {
    const fn = [
      'CREATE FUNCTION f() RETURNS int AS $$',
      'BEGIN',
      '  PERFORM 1;',
      '  RETURN 2;',
      'END;',
      '$$ LANGUAGE plpgsql',
    ].join('\n');
    expect(splitStatements(`${fn};\nSELECT f()`, 'pgsql')).toEqual([fn, 'SELECT f()']);
  });

  test('a tagged dollar quote closes on its own tag, not on a bare $$', () => {
    expect(splitStatements("SELECT $tag$ a; $$ b; $tag$, 1", 'pgsql')).toEqual(["SELECT $tag$ a; $$ b; $tag$, 1"]);
  });

  test('a positional parameter is not a dollar quote', () => {
    expect(splitStatements('SELECT $1; SELECT $2', 'pgsql')).toEqual(['SELECT $1', 'SELECT $2']);
  });

  test('Postgres nests block comments; MySQL closes on the first end marker', () => {
    expect(splitStatements('SELECT /* a /* b */ ; */ 1', 'pgsql')).toEqual(['SELECT /* a /* b */ ; */ 1']);
    expect(splitStatements('SELECT /* a /* b */ ; 1', 'mysql')).toEqual(['SELECT /* a /* b */', '1']);
  });

  /*
   * MySQL's `DELIMITER`, which is the only way to write a routine body there --
   * Postgres dollar-quotes one and SQLite has none to write. The directive is
   * never SQL: the server has not heard of it, so it is consumed here and the
   * body arrives as the one statement the server always thought it was.
   */
  describe('DELIMITER', () => {
    const routine = [
      'DELIMITER //',
      'CREATE FUNCTION square(x INT) RETURNS INT DETERMINISTIC',
      'BEGIN',
      '  RETURN x * x;',
      'END//',
      'DELIMITER ;',
      'SELECT square(3)',
    ].join('\n');

    test('a routine body is one statement, and the directive is not one at all', () => {
      expect(splitStatements(routine, 'mysql')).toEqual([
        'CREATE FUNCTION square(x INT) RETURNS INT DETERMINISTIC\nBEGIN\n  RETURN x * x;\nEND',
        'SELECT square(3)',
      ]);
    });

    test('without it the same text is cut on the body\'s own semicolons', () => {
      // The behaviour before this was handled, kept as a test because it is what
      // every other engine still does with the word: nothing.
      expect(splitStatements(routine, 'pgsql').length).toBeGreaterThan(2);
    });

    test('it is MySQL-only, so the word is ordinary text elsewhere', () => {
      expect(splitStatements('SELECT delimiter FROM t', 'pgsql')).toEqual(['SELECT delimiter FROM t']);
      expect(splitStatements('DELIMITER //\nSELECT 1', 'pgsql')).toEqual(['DELIMITER //\nSELECT 1']);
    });

    test('a column honestly named delimiter is not the directive', () => {
      // Mid-statement, so neither guard passes: `significant` is already set.
      expect(splitStatements('SELECT\ndelimiter x\nFROM t', 'mysql')).toEqual(['SELECT\ndelimiter x\nFROM t']);
    });

    test('the delimiter goes back, and a `;` is ordinary text while it is away', () => {
      expect(splitStatements('DELIMITER //\nSELECT 1; SELECT 2//\nDELIMITER ;\nSELECT 3', 'mysql'))
        .toEqual(['SELECT 1; SELECT 2', 'SELECT 3']);
    });

    test('it may be quoted, and anything after it on the line is ignored', () => {
      expect(splitStatements('DELIMITER "//"\nSELECT 1//', 'mysql')).toEqual(['SELECT 1']);
      expect(splitStatements('DELIMITER // -- switch\nSELECT 1//', 'mysql')).toEqual(['SELECT 1']);
    });

    test('a bare DELIMITER is not a directive, the same as the CLI reads it', () => {
      expect(splitStatements('DELIMITER\nSELECT 1', 'mysql')).toEqual(['DELIMITER\nSELECT 1']);
    });

    test('a multi-character delimiter still loses to a comment that opens the same way', () => {
      // `//` is the delimiter and `/*` opens a comment: the comment check runs
      // first, so the `;` inside it stays hidden.
      expect(splitStatements('DELIMITER //\nSELECT 1 /* ; */ //', 'mysql')).toEqual(['SELECT 1 /* ; */']);
    });

    test('a delimiter never carries over from one run to the next', () => {
      // Each call starts on `;`, the same as opening a fresh session -- so text
      // that ran after a `DELIMITER //` last time is not read by it this time.
      expect(splitStatements('SELECT 1; SELECT 2', 'mysql')).toEqual(['SELECT 1', 'SELECT 2']);
    });
  });

  /*
   * Unterminated text is the state a query being typed is in most of the time.
   * The rule is that it fails toward *fewer* statements: the tail stays inside
   * whatever was left open, so the worst case is one statement the server
   * rejects rather than fragments it accepts.
   */
  test('an unterminated literal or comment swallows the rest rather than cutting it', () => {
    expect(splitStatements("SELECT 'a; b", 'pgsql')).toEqual(["SELECT 'a; b"]);
    expect(splitStatements('SELECT /* a; b', 'pgsql')).toEqual(['SELECT /* a; b']);
    expect(splitStatements('SELECT $$ a; b', 'pgsql')).toEqual(['SELECT $$ a; b']);
  });
});
