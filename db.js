const { Pool } = require("pg");
const dotenv = require("dotenv");

dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : false
});

pool.on("error", (err) => {
    console.error("Unexpected PostgreSQL error:", err);
});

async function initializeDatabase() {
    try {
        // Create users table if it does not already exist
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                full_name VARCHAR(100) NOT NULL,
                phone VARCHAR(20) UNIQUE NOT NULL,
                email VARCHAR(150) UNIQUE NOT NULL,
                password_hash TEXT,
                referral_code VARCHAR(20) UNIQUE NOT NULL,
                referred_by VARCHAR(20),
                account_status VARCHAR(20) DEFAULT 'pending',
                registration_paid BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Safely add password_hash if the existing table does not have it
        await pool.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS password_hash TEXT;
        `);

        console.log("Database initialized successfully.");

    } catch (error) {
        console.error("Database initialization error:", error);
    }
}

initializeDatabase();

module.exports = pool;
