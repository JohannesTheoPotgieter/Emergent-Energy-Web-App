// Transaction-safe SQL executor for Neon PostgreSQL
//
// Uses the Neon serverless driver's transaction() method, which sends all
// statements in a single HTTP request and runs them atomically server-side.
// All succeed or all roll back — no partial execution.
//
// Modes:
//   node run-sql-tx.cjs <file.sql>                  # atomic transaction (strips BEGIN/COMMIT)
//   node run-sql-tx.cjs --multi <file.sql>           # per-statement (for read-only diagnostics)
//   node run-sql-tx.cjs --query "SELECT 1"           # single inline query

const fs = require('fs');
const { ProxyAgent, setGlobalDispatcher } = require('undici');
const { neon } = require('@neondatabase/serverless');

// ---------------------------------------------------------------------------
// Proxy setup (required in this environment — curl works via HTTPS proxy,
// but Node's fetch does not pick it up by default)
// ---------------------------------------------------------------------------
const proxyUrl = process.env.https_proxy || process.env.HTTPS_PROXY;
if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
}

const CONN_STRING = 'postgresql://neondb_owner:npg_hpZAyitsFf93@ep-damp-dawn-ajbdpxyq.c-3.us-east-2.aws.neon.tech/neondb?sslmode=require';
const sql = neon(CONN_STRING, { fullResults: true });

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
let mode = 'tx';  // default: transaction-safe
let input = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--multi') { mode = 'multi'; input = args[i + 1]; i++; }
  else if (args[i] === '--query') { mode = 'query'; input = args[i + 1]; i++; }
  else if (!input) { input = args[i]; }
}

if (!input) {
  console.error('Usage:');
  console.error('  node run-sql-tx.cjs <file.sql>           # atomic transaction');
  console.error('  node run-sql-tx.cjs --multi <file.sql>   # per-statement (read-only)');
  console.error('  node run-sql-tx.cjs --query "SELECT 1"   # single query');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// SQL loading
// ---------------------------------------------------------------------------
let rawSql;
if (mode === 'query') {
  rawSql = input;
} else if (fs.existsSync(input)) {
  rawSql = fs.readFileSync(input, 'utf8');
} else {
  console.error(`File not found: ${input}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Statement parser
//
// Handles: single-line comments (--), multi-line comments (/* */),
// string literals ('...'), dollar-quoted strings ($$...$$), semicolons.
// ---------------------------------------------------------------------------
function parseStatements(text) {
  const stmts = [];
  let current = '';
  let i = 0;

  while (i < text.length) {
    // Single-line comment
    if (text[i] === '-' && text[i + 1] === '-') {
      const end = text.indexOf('\n', i);
      i = end === -1 ? text.length : end + 1;
      continue;
    }

    // Multi-line comment
    if (text[i] === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }

    // String literal
    if (text[i] === "'") {
      current += text[i++];
      while (i < text.length) {
        if (text[i] === "'" && text[i + 1] === "'") {
          current += "''"; i += 2;
        } else if (text[i] === "'") {
          current += text[i++]; break;
        } else {
          current += text[i++];
        }
      }
      continue;
    }

    // Dollar-quoted string ($$...$$, $tag$...$tag$)
    if (text[i] === '$') {
      let tag = '$';
      let j = i + 1;
      while (j < text.length && (text[j] === '_' || (text[j] >= 'a' && text[j] <= 'z') || (text[j] >= 'A' && text[j] <= 'Z') || (text[j] >= '0' && text[j] <= '9'))) {
        tag += text[j++];
      }
      if (j < text.length && text[j] === '$') {
        tag += '$';
        j++;
        // Found opening dollar-quote tag, find closing
        current += tag;
        const closeIdx = text.indexOf(tag, j);
        if (closeIdx === -1) {
          current += text.slice(j);
          i = text.length;
        } else {
          current += text.slice(j, closeIdx + tag.length);
          i = closeIdx + tag.length;
        }
        continue;
      }
      // Not a dollar quote, just a $ character
      current += text[i++];
      continue;
    }

    // Semicolon — statement boundary
    if (text[i] === ';') {
      const trimmed = current.trim();
      if (trimmed.length > 0) stmts.push(trimmed);
      current = '';
      i++;
      continue;
    }

    current += text[i++];
  }

  // Last statement (no trailing semicolon)
  const trimmed = current.trim();
  if (trimmed.length > 0) stmts.push(trimmed);

  return stmts;
}

// ---------------------------------------------------------------------------
// Filter out BEGIN/COMMIT/ROLLBACK (transaction() handles these)
// ---------------------------------------------------------------------------
function stripTransactionControl(statements) {
  return statements.filter(s => {
    const upper = s.toUpperCase().trim();
    return upper !== 'BEGIN' && upper !== 'COMMIT' && upper !== 'ROLLBACK'
        && upper !== 'BEGIN TRANSACTION' && upper !== 'END'
        && upper !== 'START TRANSACTION';
  });
}

// ---------------------------------------------------------------------------
// Result formatting
// ---------------------------------------------------------------------------
function formatResultSet(result, label) {
  // Error object
  if (result && result.message && result.code) {
    console.log(`\n--- ${label} ERROR ---`);
    console.log(`${result.message} (${result.code})`);
    if (result.hint) console.log(`Hint: ${result.hint}`);
    if (result.detail) console.log(`Detail: ${result.detail}`);
    return false;
  }

  // fullResults format: { rows, fields, command, rowCount }
  const rows = result.rows || result;
  const fields = result.fields;
  const command = result.command;
  const rowCount = result.rowCount;

  if (!fields || !rows || rows.length === 0) {
    if (command) {
      console.log(`[${command}]${rowCount != null ? ' ' + rowCount + ' row(s)' : ''}`);
    }
    return true;
  }

  // Table output
  const allRows = rows.map(r =>
    fields.map(f => {
      const v = r[f.name];
      return v !== null && v !== undefined ? String(v) : 'NULL';
    })
  );
  const columns = fields.map((f, fi) => {
    const vals = allRows.map(r => r[fi]);
    const w = Math.max(f.name.length, ...vals.map(v => v.length));
    return { width: Math.min(w, 60), header: f.name, values: vals };
  });

  const hdr = columns.map(c => c.header.padEnd(c.width)).join(' | ');
  const sep = columns.map(c => '-'.repeat(c.width)).join('-+-');
  console.log(`\n${hdr}`);
  console.log(sep);
  allRows.forEach((_, r) => {
    console.log(columns.map((c, ci) => {
      const val = c.values[r];
      return val.length > c.width ? val.slice(0, c.width - 1) + '~' : val.padEnd(c.width);
    }).join(' | '));
  });
  console.log(`(${rows.length} row${rows.length !== 1 ? 's' : ''})`);
  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  try {
    if (mode === 'query') {
      const result = await sql.query(rawSql, [], { fullResults: true });
      formatResultSet(result, 'Query');
      return;
    }

    const allStatements = parseStatements(rawSql);

    if (mode === 'multi') {
      // Per-statement mode — for read-only diagnostics
      console.log(`[MULTI] Running ${allStatements.length} statement(s) individually`);
      console.log(`[MULTI] WARNING: No transaction atomicity. Use for read-only diagnostics only.\n`);

      let hasError = false;
      for (let i = 0; i < allStatements.length; i++) {
        const stmt = allStatements[i];
        const upper = stmt.toUpperCase().trim();
        if (upper === 'BEGIN' || upper === 'COMMIT' || upper === 'ROLLBACK') continue;

        try {
          const result = await sql.query(stmt, [], { fullResults: true });
          formatResultSet(result, `Statement ${i + 1}`);
        } catch (err) {
          console.log(`\n--- Statement ${i + 1} ERROR ---`);
          console.log(err.message);
          hasError = true;
        }
      }

      if (hasError) {
        console.log('\n*** Some statements had errors ***');
        process.exit(1);
      }
      return;
    }

    // ---------------------------------------------------------------------------
    // TX MODE: atomic transaction execution
    // ---------------------------------------------------------------------------
    const statements = stripTransactionControl(allStatements);
    console.log(`[TX] File: ${input}`);
    console.log(`[TX] Total statements parsed: ${allStatements.length}`);
    console.log(`[TX] Statements after stripping BEGIN/COMMIT: ${statements.length}`);
    console.log(`[TX] Executing ALL statements in a single atomic transaction...`);
    console.log(`[TX] If ANY statement fails, ALL changes are rolled back.\n`);

    // Build the transaction query array using sql tagged templates
    // neon().transaction() takes an array of tagged template queries
    const txQueries = statements.map(stmt => sql.query(stmt, [], { fullResults: true }));

    // sql.transaction() requires tagged-template functions, not promises.
    // Instead, we'll use the batch approach: send queries via transaction callback
    const sqlSimple = neon(CONN_STRING);
    const results = await sqlSimple.transaction(
      statements.map(stmt => sqlSimple.query(stmt))
    );

    console.log(`[TX] Transaction committed successfully. ${results.length} result(s).\n`);

    // Print results for SELECT statements
    for (let i = 0; i < results.length; i++) {
      const rows = results[i];
      if (Array.isArray(rows) && rows.length > 0) {
        // This is a SELECT result — print it
        const fields = Object.keys(rows[0]).map(name => ({ name }));
        formatResultSet({ rows, fields }, `Result ${i + 1}`);
      }
    }

    console.log('\n*** TRANSACTION COMMITTED SUCCESSFULLY ***');

  } catch (err) {
    console.error(`\n*** TRANSACTION FAILED — ALL CHANGES ROLLED BACK ***`);
    console.error(`Error: ${err.message}`);
    if (err.code) console.error(`Code: ${err.code}`);
    if (err.detail) console.error(`Detail: ${err.detail}`);
    if (err.hint) console.error(`Hint: ${err.hint}`);

    // Try to identify which statement failed
    const match = err.message.match(/statement (\d+)/i);
    if (match) console.error(`Failed at statement: ${match[1]}`);

    process.exit(1);
  }
}

main();
