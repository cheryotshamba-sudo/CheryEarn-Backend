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

        // Create users table if it does not exist
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                full_name VARCHAR(100) NOT NULL,
                phone VARCHAR(20) UNIQUE NOT NULL,
                email VARCHAR(150) UNIQUE NOT NULL,
                password_hash TEXT,
                account_status VARCHAR(20) DEFAULT 'pending',
                registration_paid BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Add missing columns safely
        await pool.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS password_hash TEXT;
        `);

        await pool.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS account_status VARCHAR(20) DEFAULT 'pending';
        `);

        await pool.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS registration_paid BOOLEAN DEFAULT FALSE;
        `);

        await pool.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
        `);

        // Make sure the users ID automatically generates numbers
        await pool.query(`
            CREATE SEQUENCE IF NOT EXISTS users_id_seq;
        `);

        await pool.query(`
            ALTER SEQUENCE users_id_seq
            OWNED BY users.id;
        `);

        await pool.query(`
            ALTER TABLE users
            ALTER COLUMN id SET DEFAULT nextval('users_id_seq');
        `);

        // Make the sequence start after the highest existing user ID
        await pool.query(`
            SELECT setval(
                'users_id_seq',
                COALESCE((SELECT MAX(id) FROM users), 0) + 1,
                false
            );
        `);

        console.log("Database initialized successfully.");

    } catch (error) {
        console.error("Database initialization error:", error);
    }
}

initializeDatabase();

module.exports = pool;
