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
    // ADD MISSING USER COLUMNS
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


    // ==========================================
    // REGISTRATION PAYMENTS TABLE
    // ==========================================

    await pool.query(`
        CREATE TABLE IF NOT EXISTS registration_payments (
            id SERIAL PRIMARY KEY,

            user_id INTEGER NOT NULL,

            amount NUMERIC(12, 2) NOT NULL DEFAULT 200.00,

            status VARCHAR(20) NOT NULL DEFAULT 'PENDING',

            payment_reference VARCHAR(100) UNIQUE NOT NULL,

            phone VARCHAR(20),

            first_upline_amount NUMERIC(12, 2) NOT NULL DEFAULT 100.00,

            second_upline_amount NUMERIC(12, 2) NOT NULL DEFAULT 50.00,

            company_amount NUMERIC(12, 2) NOT NULL DEFAULT 50.00,

            gateway_response TEXT,

            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

            completed_at TIMESTAMP,

            CONSTRAINT registration_payments_user_fkey
                FOREIGN KEY (user_id)
                REFERENCES users(id)
                ON DELETE CASCADE
        );
    `);


    // ==========================================
    // PAYMENT LOOKUP INDEXES
    // ==========================================

    await pool.query(`
        CREATE INDEX IF NOT EXISTS registration_payments_user_index
        ON registration_payments(user_id);
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS registration_payments_status_index
        ON registration_payments(status);
    `);


    // ==========================================
    // COMMISSIONS TABLE
    // ==========================================

    await pool.query(`
        CREATE TABLE IF NOT EXISTS commissions (
            id SERIAL PRIMARY KEY,

            payment_id INTEGER NOT NULL,

            recipient_user_id INTEGER NOT NULL,

            source_user_id INTEGER NOT NULL,

            level INTEGER NOT NULL,

            amount NUMERIC(12, 2) NOT NULL,

            status VARCHAR(20) NOT NULL DEFAULT 'CREDITED',

            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

            CONSTRAINT commissions_payment_fkey
                FOREIGN KEY (payment_id)
                REFERENCES registration_payments(id)
                ON DELETE CASCADE,

            CONSTRAINT commissions_recipient_fkey
                FOREIGN KEY (recipient_user_id)
                REFERENCES users(id)
                ON DELETE CASCADE,

            CONSTRAINT commissions_source_fkey
                FOREIGN KEY (source_user_id)
                REFERENCES users(id)
                ON DELETE CASCADE,

            CONSTRAINT commissions_level_check
                CHECK (level IN (1, 2)),

            CONSTRAINT commissions_amount_check
                CHECK (amount > 0),

            CONSTRAINT commissions_unique_payment_level
                UNIQUE (payment_id, level)
        );
    `);


    // ==========================================
    // COMMISSION LOOKUP INDEXES
    // ==========================================

    await pool.query(`
        CREATE INDEX IF NOT EXISTS commissions_recipient_index
        ON commissions(recipient_user_id);
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS commissions_source_index
        ON commissions(source_user_id);
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
