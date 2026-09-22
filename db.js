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

    // ==========================================
    // USERS TABLE
    // ==========================================

    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            full_name VARCHAR(100) NOT NULL,
            phone VARCHAR(20) UNIQUE NOT NULL,
            email VARCHAR(150) UNIQUE NOT NULL,
            password_hash TEXT,
            account_status VARCHAR(20) DEFAULT 'pending',
            registration_paid BOOLEAN DEFAULT FALSE,
            referral_code VARCHAR(30) UNIQUE,
            referred_by INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);


    // ==========================================
    // ADD MISSING COLUMNS TO OLD DATABASES
    // ==========================================

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

    await pool.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS referral_code VARCHAR(30);
    `);

    // New referral relationship
    await pool.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS referred_by INTEGER;
    `);


    // ==========================================
    // REFERRAL CODE UNIQUE INDEX
    // ==========================================

    await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code_unique
        ON users(referral_code)
        WHERE referral_code IS NOT NULL;
    `);


    // ==========================================
    // REFERRAL RELATIONSHIP
    // ==========================================

    await pool.query(`
        DO $$
        BEGIN

            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'users_referred_by_fkey'
            ) THEN

                ALTER TABLE users
                ADD CONSTRAINT users_referred_by_fkey
                FOREIGN KEY (referred_by)
                REFERENCES users(id)
                ON DELETE SET NULL;

            END IF;

        END
        $$;
    `);


    // ==========================================
    // OLD PASSWORD COLUMN
    // ==========================================

    await pool.query(`
        ALTER TABLE users
        ALTER COLUMN password DROP NOT NULL;
    `);


    // ==========================================
    // USER ID SEQUENCE
    // ==========================================

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

    await pool.query(`
        SELECT setval(
            'users_id_seq',
            COALESCE((SELECT MAX(id) FROM users), 0) + 1,
            false
        );
    `);


    // ==========================================
    // REFERRAL LOOKUP INDEX
    // ==========================================

    await pool.query(`
        CREATE INDEX IF NOT EXISTS users_referred_by_index
        ON users(referred_by);
    `);


    console.log("Database initialized successfully.");

} catch (error) {

    console.error(
        "Database initialization error:",
        error
    );

}

}

initializeDatabase();

module.exports = pool;
