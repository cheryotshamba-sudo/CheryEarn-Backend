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

                username VARCHAR(50) UNIQUE,

                phone VARCHAR(20) UNIQUE NOT NULL,

                email VARCHAR(150) UNIQUE NOT NULL,

                password_hash TEXT,

                account_status VARCHAR(20) DEFAULT 'pending',

                registration_paid BOOLEAN DEFAULT FALSE,

                referral_code VARCHAR(30) UNIQUE,

                referred_by INTEGER,

                cheryearn_number INTEGER UNIQUE,

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);


        // ==========================================
        // REMOVE OLD REFERRAL FOREIGN KEY
        // ==========================================

        await pool.query(`
            ALTER TABLE users
            DROP CONSTRAINT IF EXISTS users_referred_by_fkey;
        `);


        // ==========================================
        // CHECK USERS.ID TYPE
        // ==========================================

        const idTypeResult = await pool.query(`
            SELECT data_type
            FROM information_schema.columns
            WHERE table_name = 'users'
              AND column_name = 'id'
            LIMIT 1;
        `);


        if (
            idTypeResult.rows.length > 0 &&
            idTypeResult.rows[0].data_type !== "integer"
        ) {

            console.log(
                "Converting users.id to INTEGER..."
            );


            // Check that existing IDs are numeric
            const invalidIdsResult =
                await pool.query(`
                    SELECT id
                    FROM users
                    WHERE id IS NOT NULL
                      AND id::text !~ '^[0-9]+$'
                    LIMIT 1;
                `);


            if (
                invalidIdsResult.rows.length > 0
            ) {

                throw new Error(
                    "Existing users.id contains non-numeric values. Cannot safely convert IDs to INTEGER."
                );

            }


            await pool.query(`
                ALTER TABLE users
                ALTER COLUMN id TYPE INTEGER
                USING id::integer;
            `);


            console.log(
                "users.id converted to INTEGER."
            );

        }


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

        await pool.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS username VARCHAR(50);
        `);

        await pool.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS cheryearn_number INTEGER;
        `);


        // ==========================================
        // MAKE REFERRED_BY INTEGER
        // ==========================================

        const referredByTypeResult =
            await pool.query(`
                SELECT data_type
                FROM information_schema.columns
                WHERE table_name = 'users'
                  AND column_name = 'referred_by'
                LIMIT 1;
            `);


        if (
            referredByTypeResult.rows.length > 0 &&
            referredByTypeResult.rows[0].data_type !== "integer"
        ) {

            console.log(
                "Converting users.referred_by to INTEGER..."
            );


            const invalidReferralResult =
                await pool.query(`
                    SELECT referred_by
                    FROM users
                    WHERE referred_by IS NOT NULL
                      AND referred_by::text !~ '^[0-9]+$'
                    LIMIT 1;
                `);


            if (
                invalidReferralResult.rows.length > 0
            ) {

                throw new Error(
                    "Existing users.referred_by contains non-numeric values. Cannot safely convert it."
                );

            }


            await pool.query(`
                ALTER TABLE users
                ALTER COLUMN referred_by TYPE INTEGER
                USING NULLIF(
                    referred_by::text,
                    ''
                )::integer;
            `);

        }


        // ==========================================
        // UNIQUE INDEXES
        // ==========================================

        await pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique
            ON users(username)
            WHERE username IS NOT NULL;
        `);


        await pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS users_cheryearn_number_unique
            ON users(cheryearn_number)
            WHERE cheryearn_number IS NOT NULL;
        `);


        await pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code_unique
            ON users(referral_code)
            WHERE referral_code IS NOT NULL;
        `);


        // ==========================================
        // REFERRAL FOREIGN KEY
        // ==========================================

        await pool.query(`
            ALTER TABLE users
            ADD CONSTRAINT users_referred_by_fkey
            FOREIGN KEY (referred_by)
            REFERENCES users(id)
            ON DELETE SET NULL;
        `);


        // ==========================================
        // OLD PASSWORD COLUMN
        // ==========================================

        await pool.query(`
            DO $$
            BEGIN

                IF EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_name = 'users'
                    AND column_name = 'password'
                ) THEN

                    ALTER TABLE users
                    ALTER COLUMN password DROP NOT NULL;

                END IF;

            END
            $$;
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
                COALESCE(
                    (SELECT MAX(id) FROM users),
                    0
                ) + 1,
                false
            );
        `);


        // ==========================================
        // CHERYEARN NUMBER COUNTER
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

        const existingUsersResult =
            await pool.query(`
                SELECT COUNT(*) AS count
                FROM users
                WHERE cheryearn_number IS NULL;
            `);


        const existingUsersWithoutNumber =
            Number(
                existingUsersResult.rows[0].count
            );


        if (existingUsersWithoutNumber > 0) {

            const usersWithNumbersResult =
                await pool.query(`
                    SELECT COUNT(*) AS count
                    FROM users
                    WHERE cheryearn_number IS NOT NULL;
                `);


            const usersWithNumbers =
                Number(
                    usersWithNumbersResult.rows[0].count
                );


            if (usersWithNumbers === 0) {

                await pool.query(`
                    WITH numbered_users AS (
                        SELECT
                            id,
                            ROW_NUMBER() OVER (
                                ORDER BY
                                    created_at ASC,
                                    id ASC
                            ) AS new_number
                        FROM users
                    )
                    UPDATE users u
                    SET cheryearn_number =
                        n.new_number
                    FROM numbered_users n
                    WHERE u.id = n.id;
                `);

            } else {

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


                const usersToNumberResult =
                    await pool.query(`
                        SELECT id
                        FROM users
                        WHERE cheryearn_number IS NULL
                        ORDER BY
                            created_at ASC,
                            id ASC;
                    `);


                for (
                    const user
                    of usersToNumberResult.rows
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
        // REFERRAL LOOKUP INDEX
        // ==========================================

        await pool.query(`
            CREATE INDEX IF NOT EXISTS users_referred_by_index
            ON users(referred_by);
        `);


        // ==========================================
        // REGISTRATION PAYMENTS
        // ==========================================

        await pool.query(`
            CREATE TABLE IF NOT EXISTS registration_payments (
                id SERIAL PRIMARY KEY,

                user_id INTEGER NOT NULL,

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
