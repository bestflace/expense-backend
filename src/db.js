// src/db.js
const { Pool } = require("pg");
const dotenv = require("dotenv");

dotenv.config();

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "expense_db",
});

pool
  .connect()
  .then((client) => {
    console.log("✅ Connected to PostgreSQL");
    client.release();
  })
  .catch((err) => {
    console.error("❌ PostgreSQL connection error:", err.message);
  });

pool.on("error", (err) => {
  console.error("⚠️ Unexpected error on idle PostgreSQL client", err);
});

module.exports = pool;
