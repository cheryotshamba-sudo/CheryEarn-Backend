const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");

const router = express.Router();

/* =========================
   REGISTER
========================= */

router.post("/register", async (req, res) => {
    try {
        const {
            full_name,
            phone,
            email,
            password
        } = req.body;

        // Validate required fields
        if (!full_name || !phone || !email || !password) {
            return res.status(400).json({
                success: false,
                message: "Full name, phone, email and password are required."
            });
        }

        // Password validation
        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 6 characters."
            });
        }

        const cleanName = full_name.trim();
        const cleanPhone = phone.trim();
        const cleanEmail = email.trim().toLowerCase();

        // Check if user already exists
        const existingUser = await pool.query(
            `SELECT id
             FROM users
             WHERE phone = $1 OR email = $2`,
            [cleanPhone, cleanEmail]
        );

        if (existingUser.rows.length > 0) {
            return res.status(409).json({
                success: false,
                message: "A user with that phone number or email already exists."
            });
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 12);

        /*
         * Register user.
         *
         * Referral code is intentionally NOT required.
         */
        const result = await pool.query(
            `INSERT INTO users
             (full_name, phone, email, password_hash)
             VALUES ($1, $2, $3, $4)
             RETURNING
                id,
                full_name,
                phone,
                email,
                account_status,
                registration_paid,
                created_at`,
            [
                cleanName,
                cleanPhone,
                cleanEmail,
                passwordHash
            ]
        );

        return res.status(201).json({
            success: true,
            message: "Registration successful.",
            user: result.rows[0]
        });

    } catch (error) {
        console.error("Registration error:", error);

        return res.status(500).json({
            success: false,
            message: "Server error. Please try again."
        });
    }
});


/* =========================
   LOGIN
========================= */

router.post("/login", async (req, res) => {
    try {
        const {
            identifier,
            password
        } = req.body;

        if (!identifier || !password) {
            return res.status(400).json({
                success: false,
                message: "Email/phone and password are required."
            });
        }

        const cleanIdentifier = identifier.trim().toLowerCase();

        // Find user by email OR phone
        const result = await pool.query(
            `SELECT
                id,
                full_name,
                phone,
                email,
                password_hash,
                account_status,
                registration_paid,
                created_at
             FROM users
             WHERE LOWER(email) = $1
                OR phone = $1
             LIMIT 1`,
            [cleanIdentifier]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({
                success: false,
                message: "Invalid email/phone or password."
            });
        }

        const user = result.rows[0];

        // Make sure password exists
        if (!user.password_hash) {
            return res.status(500).json({
                success: false,
                message: "This account does not have a valid password."
            });
        }

        // Check password
        const passwordMatch = await bcrypt.compare(
            password,
            user.password_hash
        );

        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                message: "Invalid email/phone or password."
            });
        }

        // Check account status
        if (user.account_status === "suspended") {
            return res.status(403).json({
                success: false,
                message: "Your account has been suspended."
            });
        }

        // JWT secret
        const jwtSecret = process.env.JWT_SECRET;

        if (!jwtSecret) {
            console.error("JWT_SECRET is not configured.");

            return res.status(500).json({
                success: false,
                message: "Server configuration error."
            });
        }

        // Create token
        const token = jwt.sign(
            {
                id: user.id,
                email: user.email,
                phone: user.phone
            },
            jwtSecret,
            {
                expiresIn: "7d"
            }
        );

        // Never send password hash to frontend
        delete user.password_hash;

        return res.status(200).json({
            success: true,
            message: "Login successful.",
            token,
            user
        });

    } catch (error) {
        console.error("Login error:", error);

        return res.status(500).json({
            success: false,
            message: "Server error. Please try again."
        });
    }
});


module.exports = router;

Also change your "db.js"

Your current "db.js" tries to create a table containing referral fields, but your existing table doesn't have them. For now, use this simpler version:

:::writing{variant="standard" id="74106" title="New db.js"}

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

        // Add missing columns safely to an existing users table
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

        console.log("Database initialized successfully.");

    } catch (error) {
        console.error("Database initialization error:", error);
    }
}

initializeDatabase();

module.exports = pool;

Keep your "server.js"

Your current "server.js" can stay as it is:

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

const authRoutes = require("./routes/auth");
app.use("/api/auth", authRoutes);

app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "CheryEarn Backend is running",
        status: "online"
    });
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
    console.log(`CheryEarn backend running on port ${PORT}`);
});

After replacing the two files

1. Save "routes/auth.js".
2. Save "db.js".
3. Push/commit the changes to GitHub.
4. Let Render redeploy.
5. Check the logs.
6. Try registration first.
7. Then try login.

You should no longer get the:

column "referral_code" does not exist

error.

One important point: this assumes your existing "users" table has "full_name", "phone", "email", and "password_hash" (the last one is added automatically by "db.js"). If registration gives another database-column error, send me that exact Render log and we'll fix the next mismatch.
