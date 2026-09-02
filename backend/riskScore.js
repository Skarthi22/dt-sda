// ============================================================
// DT-SDA - Risk Score Engine
// ============================================================

const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(
  path.join(__dirname, "verification-log.db")
);

// ============================================================
// SETTINGS
// ============================================================

const RISK_WINDOW_MS = 60 * 1000; // 60 seconds
const BLOCK_DURATION_MS = 60 * 1000; // 60 seconds

// ============================================================
// DATABASE
// ============================================================

db.exec(`
  CREATE TABLE IF NOT EXISTS verification_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    twinId TEXT NOT NULL,
    ip TEXT,
    time INTEGER NOT NULL,
    result TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS risk_blocks (
    twinId TEXT PRIMARY KEY,
    blockedUntil INTEGER NOT NULL
  )
`);

// ============================================================
// LOG VERIFICATION
// ============================================================

function logVerification(twinId, ip, result) {
  db.prepare(`
    INSERT INTO verification_log
    (twinId, ip, time, result)
    VALUES (?, ?, ?, ?)
  `).run(
    String(twinId),
    ip || "unknown",
    Date.now(),
    String(result || "unknown").toLowerCase()
  );
}

// ============================================================
// CHECK CURRENT BLOCK
// ============================================================

function getBlockInfo(twinId) {
  const row = db
    .prepare(`
      SELECT blockedUntil
      FROM risk_blocks
      WHERE twinId = ?
    `)
    .get(String(twinId));

  if (!row) {
    return {
      blocked: false,
      blockedUntil: null,
      remainingSeconds: 0
    };
  }

  const now = Date.now();

  // Block expired
  if (row.blockedUntil <= now) {
    db.prepare(`
      DELETE FROM risk_blocks
      WHERE twinId = ?
    `).run(String(twinId));

    return {
      blocked: false,
      blockedUntil: null,
      remainingSeconds: 0
    };
  }

  const remainingSeconds =
    Math.ceil(
      (row.blockedUntil - now) / 1000
    );

  return {
    blocked: true,
    blockedUntil: row.blockedUntil,
    remainingSeconds
  };
}

// ============================================================
// CREATE 60 SECOND BLOCK
// ============================================================

function blockTwin(twinId) {
  const blockedUntil =
    Date.now() + BLOCK_DURATION_MS;

  db.prepare(`
    INSERT INTO risk_blocks
    (twinId, blockedUntil)
    VALUES (?, ?)

    ON CONFLICT(twinId)
    DO UPDATE SET blockedUntil = excluded.blockedUntil
  `).run(
    String(twinId),
    blockedUntil
  );

  return {
    blocked: true,
    blockedUntil,
    remainingSeconds: 60
  };
}

// ============================================================
// COMPUTE RISK SCORE
// ============================================================

function computeRiskScore(twinId) {

  const now = Date.now();

  const windowStart =
    now - RISK_WINDOW_MS;

  // ----------------------------------------------------------
  // Recent verification attempts
  // ----------------------------------------------------------

  const recent =
    db.prepare(`
      SELECT *
      FROM verification_log
      WHERE twinId = ?
      AND time > ?
      ORDER BY time DESC
    `).all(
      String(twinId),
      windowStart
    );

  // ----------------------------------------------------------
  // Count invalid attempts
  // ----------------------------------------------------------

  const invalidAttempts =
    recent.filter(
      (item) =>
        String(item.result).toLowerCase() ===
        "invalid"
    ).length;

  // ----------------------------------------------------------
  // Unique sources / IPs
  // ----------------------------------------------------------

  const uniqueIPs =
    new Set(
      recent.map(
        (item) =>
          item.ip || "unknown"
      )
    );

  // ==========================================================
  // RISK CALCULATION
  // ==========================================================

  let score = 0;

  // ----------------------------------------------------------
  // Frequency risk
  // ----------------------------------------------------------

  if (recent.length >= 3) {
    score += 20;
  }

  if (recent.length >= 5) {
    score += 20;
  }

  // ----------------------------------------------------------
  // Invalid verification risk
  // ----------------------------------------------------------

  if (invalidAttempts >= 2) {
    score += 20;
  }

  if (invalidAttempts >= 4) {
    score += 20;
  }

  // ----------------------------------------------------------
  // Source diversity risk
  // ----------------------------------------------------------

  if (uniqueIPs.size >= 2) {
    score += 10;
  }

  if (uniqueIPs.size >= 4) {
    score += 10;
  }

  // ----------------------------------------------------------
  // Maximum score
  // ----------------------------------------------------------

  score = Math.min(score, 100);

  // ==========================================================
  // BLOCK WHEN SCORE = 100
  // ==========================================================

  let blockInfo =
    getBlockInfo(twinId);

  if (
    score >= 100 &&
    !blockInfo.blocked
  ) {
    blockInfo =
      blockTwin(twinId);
  }

  // ==========================================================
  // RETURN
  // ==========================================================

  return {
    score,

    riskScore: score,

    flagged:
      score >= 70,

    highRisk:
      score >= 100,

    recentAttempts:
      recent.length,

    invalidAttempts:
      invalidAttempts,

    uniqueSources:
      uniqueIPs.size,

    blocked:
      blockInfo.blocked,

    blockedUntil:
      blockInfo.blockedUntil,

    remainingSeconds:
      blockInfo.remainingSeconds
  };
}

// ============================================================
// EXPORT
// ============================================================

module.exports = {
  logVerification,
  computeRiskScore,
  getBlockInfo,
  blockTwin
};