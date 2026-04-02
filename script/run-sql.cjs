// Runs SQL files against Neon PostgreSQL via their HTTP SQL API
// This bypasses the TCP proxy limitation since it works over HTTPS
const fs = require('fs');
const { execSync } = require('child_process');

const NEON_HOST = 'ep-damp-dawn-ajbdpxyq.c-3.us-east-2.aws.neon.tech';
const CONN_STRING = `postgresql://neondb_owner:npg_hpZAyitsFf93@${NEON_HOST}/neondb?sslmode=require`;
const SQL_ENDPOINT = `https://${NEON_HOST}/sql`;

const input = process.argv[2];
if (!input) {
  console.error('Usage: node run-sql.cjs <sql-file-or-inline-query>');
  process.exit(1);
}

// Read SQL from file or use inline
let sql;
if (fs.existsSync(input)) {
  sql = fs.readFileSync(input, 'utf8');
} else {
  sql = input;
}

// Split SQL into individual statements for the API
// Remove comments and split on semicolons
function splitStatements(sqlText) {
  // Remove single-line comments
  let cleaned = sqlText.replace(/--[^\n]*/g, '');
  // Remove multi-line comments
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');
  // Split on semicolons, filter empty
  return cleaned
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

const statements = splitStatements(sql);

async function runStatement(stmt, index) {
  const payload = JSON.stringify({ query: stmt });
  const tmpFile = `/tmp/neon_sql_payload_${index}.json`;
  fs.writeFileSync(tmpFile, payload);

  try {
    const result = execSync(
      `curl -s -X POST "${SQL_ENDPOINT}" ` +
      `-H "Content-Type: application/json" ` +
      `-H "Neon-Connection-String: ${CONN_STRING}" ` +
      `-d @${tmpFile}`,
      { timeout: 60000, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
    );
    return JSON.parse(result);
  } catch (err) {
    return { error: err.message, stderr: err.stderr };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch(e) {}
  }
}

function formatRow(row, fields) {
  return fields.map(f => {
    const val = row[f.name];
    return val !== null && val !== undefined ? String(val) : 'NULL';
  });
}

function padColumn(values, header) {
  const maxLen = Math.max(header.length, ...values.map(v => v.length));
  return { width: maxLen, header, values };
}

function printResult(result, stmtNum) {
  if (result.error) {
    console.log(`\n--- Statement ${stmtNum} ERROR ---`);
    console.log(result.error);
    if (result.stderr) console.log(result.stderr);
    return false;
  }

  if (result.message) {
    // Neon error format
    console.log(`\n--- Statement ${stmtNum} ERROR ---`);
    console.log(result.message);
    if (result.code) console.log(`Code: ${result.code}`);
    return false;
  }

  if (!result.fields || !result.rows) {
    console.log(`\n--- Statement ${stmtNum} ---`);
    console.log(`[${result.command || 'OK'}]`);
    return true;
  }

  if (result.rows.length === 0) {
    console.log(`\n--- Statement ${stmtNum} ---`);
    console.log(`(0 rows)`);
    return true;
  }

  // Format as table
  const fields = result.fields;
  const allRows = result.rows.map(r => formatRow(r, fields));
  const columns = fields.map((f, i) => {
    const colVals = allRows.map(r => r[i]);
    return padColumn(colVals, f.name);
  });

  const headerLine = columns.map(c => c.header.padEnd(c.width)).join(' | ');
  const sepLine = columns.map(c => '-'.repeat(c.width)).join('-+-');

  console.log(`\n${headerLine}`);
  console.log(sepLine);
  for (let r = 0; r < allRows.length; r++) {
    const line = columns.map((c, ci) => c.values[r].padEnd(c.width)).join(' | ');
    console.log(line);
  }
  console.log(`(${result.rows.length} row${result.rows.length !== 1 ? 's' : ''})`);
  return true;
}

async function main() {
  console.log(`Running ${statements.length} statement(s)...`);
  let allOk = true;

  for (let i = 0; i < statements.length; i++) {
    const result = await runStatement(statements[i], i + 1);
    const ok = printResult(result, i + 1);
    if (!ok) allOk = false;
  }

  if (!allOk) {
    console.log('\n*** Some statements had errors ***');
    process.exit(1);
  }
}

main();
