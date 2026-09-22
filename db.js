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
                id TEXT PRIMARY KEY,

                full_name VARCHAR(100) NOT NULL,

                username VARCHAR(50) UNIQUE,

                phone VARCHAR(20) UNIQUE NOT NULL,

                email VARCHAR(150) UNIQUE NOT NULL,

                password_hash TEXT,

                account_status VARCHAR(20)
                DEFAULT 'pending',

                registration_paid BOOLEAN
                DEFAULT FALSE,

                referral_code VARCHAR(30) UNIQUE,

                referred_by TEXT,

                cheryearn_number INTEGER UNIQUE,

                created_at TIMESTAMP
                DEFAULT CURRENT_TIMESTAMP
            );
        `);


        // ==========================================
        // ADD MISSING USER COLUMNS
        // ==========================================

        await pool.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS username VARCHAR(50);
        `);

        await pool.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS password_hash TEXT;
        `);

        await pool.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS account_status VARCHAR(20)
            DEFAULT 'pending';
        `);

        await pool.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS registration_paid BOOLEAN
            DEFAULT FALSE;
        `);

        await pool.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS referral_code VARCHAR(30);
        `);

        await pool.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS referred_by TEXT;
        `);

        await pool.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS cheryearn_number INTEGER;
        `);

        await pool.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMP
            DEFAULT CURRENT_TIMESTAMP;
        `);


        // ==========================================
        // REMOVE OLD REFERRAL FOREIGN KEY
        // ==========================================

        await pool.query(`
            ALTER TABLE users
            DROP CONSTRAINT IF EXISTS users_referred_by_fkey;
        `);


        // ==========================================
        // MAKE REFERRED_BY TEXT
        // ==========================================

        const referredByType =
            await pool.query(`
                SELECT data_type
                FROM information_schema.columns
                WHERE table_name = 'users'
                AND column_name = 'referred_by'
                LIMIT 1;
            `);


        if (
            referredByType.rows.length > 0 &&
            referredByType.rows[0].data_type !== "text"
        ) {

            await pool.query(`
                ALTER TABLE users
                ALTER COLUMN referred_by TYPE TEXT
                USING referred_by::text;
            `);

        }


        // ==========================================
        // UNIQUE INDEXES
        // ==========================================

        await pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS
            users_username_unique
            ON users(username)
            WHERE username IS NOT NULL;
        `);

        await pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS
            users_cheryearn_number_unique
            ON users(cheryearn_number)
            WHERE cheryearn_number IS NOT NULL;
        `);

        await pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS
            users_referral_code_unique
            ON users(referral_code)
            WHERE referral_code IS NOT NULL;
        `);


        // ==========================================
        // CHERYEARN COUNTER
        // ==========================================

        await pool.query(`
            CREATE TABLE IF NOT EXISTS cheryearn_counter (
                id INTEGER PRIMARY KEY
                CHECK (id = 1),

                last_number INTEGER NOT NULL
                DEFAULT 0
            );
        `);

        await pool.query(`
            INSERT INTO cheryearn_counter
                (id, last_number)
            VALUES
                (1, 0)
            ON CONFLICT (id) DO NOTHING;
        `);


        // ==========================================
        // BACKFILL CHERYEARN NUMBERS
        // ==========================================

        const missingNumbersResult =
            await pool.query(`
                SELECT COUNT(*) AS count
                FROM users
                WHERE cheryearn_number IS NULL;
            `);

        const missingNumbers =
            Number(
                missingNumbersResult.rows[0].count
            );


        if (missingNumbers > 0) {

            const maxNumberResult =
                await pool.query(`
                    SELECT COALESCE(
                        MAX(cheryearn_number),
                        0
                    ) AS max_number
                    FROM users;
                `);

            let nextNumber =
                Number(
                    maxNumberResult.rows[0].max_number
                ) + 1;


            const usersWithoutNumbers =
                await pool.query(`
                    SELECT id
                    FROM users
                    WHERE cheryearn_number IS NULL
                    ORDER BY created_at ASC;
                `);


            for (
                const user
                of usersWithoutNumbers.rows
            ) {

                await pool.query(`
                    UPDATE users
                    SET cheryearn_number = $1
                    WHERE id = $2;
                `, [
                    nextNumber,
                    user.id
                ]);

                nextNumber++;
            }

        }


        // ==========================================
        // SYNCHRONIZE COUNTER
        // ==========================================

        await pool.query(`
            UPDATE cheryearn_counter
            SET last_number = COALESCE(
                (
                    SELECT MAX(cheryearn_number)
                    FROM users
                ),
                0
            )
            WHERE id = 1;
        `);


        // ==========================================
        // REFERRAL INDEX
        // ==========================================

        await pool.query(`
            CREATE INDEX IF NOT EXISTS
            users_referred_by_index
            ON users(referred_by);
        `);


        // ==========================================
        // REGISTRATION PAYMENTS
        // ==========================================

        await pool.query(`
            CREATE TABLE IF NOT EXISTS registration_payments (
                id SERIAL PRIMARY KEY,

                user_id TEXT NOT NULL,

                amount NUMERIC(12, 2)
                NOT NULL DEFAULT 200.00,

                status VARCHAR(20)
                NOT NULL DEFAULT 'PENDING',

                payment_reference VARCHAR(100)
                UNIQUE NOT NULL,

                phone VARCHAR(20),

                first_upline_amount NUMERIC(12, 2)
                NOT NULL DEFAULT 100.00,

                second_upline_amount NUMERIC(12, 2)
                NOT NULL DEFAULT 50.00,

                company_amount NUMERIC(12, 2)
                NOT NULL DEFAULT 50.00,

                gateway_response TEXT,

                created_at TIMESTAMP
                DEFAULT CURRENT_TIMESTAMP,

                completed_at TIMESTAMP,

                CONSTRAINT registration_payments_user_fkey
                FOREIGN KEY (user_id)
                REFERENCES users(id)
                ON DELETE CASCADE
            );
        `);


        // ==========================================
        // PAYMENT INDEXES
        // ==========================================

        await pool.query(`
            CREATE INDEX IF NOT EXISTS
            registration_payments_user_index
            ON registration_payments(user_id);
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS
            registration_payments_status_index
            ON registration_payments(status);
        `);


        // ==========================================
        // COMMISSIONS
        // ==========================================

        await pool.query(`
            CREATE TABLE IF NOT EXISTS commissions (
                id SERIAL PRIMARY KEY,

                payment_id INTEGER NOT NULL,

                recipient_user_id TEXT NOT NULL,

                source_user_id TEXT NOT NULL,

                level INTEGER NOT NULL,

                amount NUMERIC(12, 2) NOT NULL,

                status VARCHAR(20)
                NOT NULL DEFAULT 'CREDITED',

                created_at TIMESTAMP
                DEFAULT CURRENT_TIMESTAMP,

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
        // COMMISSION INDEXES
        // ==========================================

        await pool.query(`
            CREATE INDEX IF NOT EXISTS
            commissions_recipient_index
            ON commissions(recipient_user_id);
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS
            commissions_source_index
            ON commissions(source_user_id);
        `);


        // ==========================================
        // SUCCESS
        // ==========================================

        console.log(
            "Database initialized successfully."
        );

    } catch (error) {

        console.error(
            "Database initialization error:",
            error
        );

    }

}


initializeDatabase();

module.exports = pool;
