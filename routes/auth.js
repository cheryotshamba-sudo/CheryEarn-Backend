const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");

const router = express.Router();

// ===============================
// GENERATE UNIQUE REFERRAL CODE
// ===============================

async function generateReferralCode() {

    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    while (true) {

        let code = "CHERY";

        for (let i = 0; i < 6; i++) {

            code += characters.charAt(
                Math.floor(
                    Math.random() * characters.length
                )
            );

        }

        const result = await pool.query(
            `
            SELECT id
            FROM users
            WHERE referral_code = $1
            LIMIT 1
            `,
            [code]
        );

        if (result.rows.length === 0) {
            return code;
        }
    }
}


// ===============================
// GENERATE UNIQUE USERNAME
// ===============================

async function generateUsername(fullName) {

    let baseUsername =
        fullName
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]/g, "");

    // If name contains no usable characters
    if (!baseUsername) {
        baseUsername = "cheryuser";
    }

    // Keep username within database limit
    baseUsername =
        baseUsername.substring(0, 25);

    let username = baseUsername;
    let counter = 1;

    while (true) {

        const result = await pool.query(
            `
            SELECT id
            FROM users
            WHERE LOWER(username) = LOWER($1)
            LIMIT 1
            `,
            [username]
        );

        if (result.rows.length === 0) {
            return username;
        }

        counter++;

        username =
            `${baseUsername}${counter}`;

        username =
            username.substring(0, 50);
    }
}


// ===============================
// REGISTER
// ===============================

router.post("/register", async (req, res) => {

    const client = await pool.connect();

    try {

        const {
            full_name,
            phone,
            email,
            password,
            referral_code,
            username
        } = req.body;


        // ===============================
        // VALIDATION
        // ===============================

        if (
            !full_name ||
            !phone ||
            !email ||
            !password
        ) {

            return res.status(400).json({
                success: false,
                message:
                    "Full name, phone, email and password are required."
            });

        }


        if (password.length < 6) {

            return res.status(400).json({
                success: false,
                message:
                    "Password must be at least 6 characters."
            });

        }


        const cleanName =
            full_name.trim();

        const cleanPhone =
            phone.trim();

        const cleanEmail =
            email.trim().toLowerCase();

        const cleanReferralCode =
            referral_code
                ? referral_code.trim().toUpperCase()
                : null;


        // ===============================
        // CHECK EXISTING USER
        // ===============================

        const existingUser =
            await pool.query(
                `
                SELECT id
                FROM users
                WHERE phone = $1
                   OR LOWER(email) = LOWER($2)
                LIMIT 1
                `,
                [
                    cleanPhone,
                    cleanEmail
                ]
            );


        if (existingUser.rows.length > 0) {

            return res.status(409).json({
                success: false,
                message:
                    "Email or phone number is already registered."
            });

        }


        // ===============================
        // GENERATE USERNAME
        // ===============================

        let cleanUsername;

        if (username && username.trim()) {

            cleanUsername =
                username
                    .trim()
                    .toLowerCase()
                    .replace(/[^a-z0-9_]/g, "");

            if (
                cleanUsername.length < 4 ||
                cleanUsername.length > 50
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Username must be between 4 and 50 characters and may contain letters, numbers and underscores."
                });

            }


            const existingUsername =
                await pool.query(
                    `
                    SELECT id
                    FROM users
                    WHERE LOWER(username) = LOWER($1)
                    LIMIT 1
                    `,
                    [cleanUsername]
                );


            if (existingUsername.rows.length > 0) {

                return res.status(409).json({
                    success: false,
                    message:
                        "That username is already taken. Please choose another username."
                });

            }

        } else {

            cleanUsername =
                await generateUsername(
                    cleanName
                );

        }


        // ===============================
        // HASH PASSWORD
        // ===============================

        const passwordHash =
            await bcrypt.hash(
                password,
                12
            );


        // ===============================
        // GENERATE REFERRAL CODE
        // ===============================

        const referralCode =
            await generateReferralCode();


        // ===============================
        // START DATABASE TRANSACTION
        // ===============================

        await client.query("BEGIN");


        // ===============================
        // FIND REFERRER
        // ===============================

        let referredBy = null;


        if (cleanReferralCode) {

            const referrer =
                await client.query(
                    `
                    SELECT id
                    FROM users
                    WHERE referral_code = $1
                    LIMIT 1
                    `,
                    [cleanReferralCode]
                );


            if (referrer.rows.length === 0) {

                await client.query("ROLLBACK");

                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid referral code."
                });

            }


            referredBy =
                referrer.rows[0].id;

        }


        // ===============================
        // GET NEXT CHERYEARN NUMBER
        // ===============================

        const counterResult =
            await client.query(
                `
                UPDATE cheryearn_counter
                SET last_number = last_number + 1
                WHERE id = 1
                RETURNING last_number;
                `
            );


        if (counterResult.rows.length === 0) {

            await client.query("ROLLBACK");

            return res.status(500).json({
                success: false,
                message:
                    "Unable to generate CheryEarn number."
            });

        }


        const cheryearnNumber =
            Number(
                counterResult.rows[0].last_number
            );


        // ===============================
        // CREATE USER
        // ===============================

        const result =
            await client.query(
                `
                INSERT INTO users
                (
                    full_name,
                    username,
                    phone,
                    email,
                    password_hash,
                    account_status,
                    registration_paid,
                    referral_code,
                    referred_by,
                    cheryearn_number
                )
                VALUES
                (
                    $1,
                    $2,
                    $3,
                    $4,
                    $5,
                    'active',
                    FALSE,
                    $6,
                    $7,
                    $8
                )
                RETURNING
                    id,
                    full_name,
                    username,
                    phone,
                    email,
                    account_status,
                    registration_paid,
                    referral_code,
                    referred_by,
                    cheryearn_number,
                    created_at
                `,
                [
                    cleanName,
                    cleanUsername,
                    cleanPhone,
                    cleanEmail,
                    passwordHash,
                    referralCode,
                    referredBy,
                    cheryearnNumber
                ]
            );


        // ===============================
        // COMPLETE TRANSACTION
        // ===============================

        await client.query("COMMIT");


        const newUser =
            result.rows[0];


        // ===============================
        // SUCCESS
        // ===============================

        res.status(201).json({

            success: true,

            message:
                referredBy
                    ? "Account created successfully through referral."
                    : "Account created successfully.",

            user: {

                id:
                    newUser.id,

                full_name:
                    newUser.full_name,

                username:
                    newUser.username,

                phone:
                    newUser.phone,

                email:
                    newUser.email,

                account_status:
                    newUser.account_status,

                registration_paid:
                    newUser.registration_paid,

                referral_code:
                    newUser.referral_code,

                referred_by:
                    newUser.referred_by,

                cheryearn_number:
                    newUser.cheryearn_number,

                cheryearn_id:
                    `CheryEarn${String(
                        newUser.cheryearn_number
                    ).padStart(3, "0")}`,

                created_at:
                    newUser.created_at

            }

        });


    } catch (error) {

        try {
            await client.query("ROLLBACK");
        } catch (rollbackError) {
            console.error(
                "Rollback error:",
                rollbackError
            );
        }


        console.error(
            "Registration error:",
            error
        );


        // Handle duplicate username
        if (error.code === "23505") {

            return res.status(409).json({
                success: false,
                message:
                    "Some registration information is already in use. Please try another username, email or phone number."
            });

        }


        res.status(500).json({
            success: false,
            message:
                "Registration failed. Please try again."
        });

    } finally {

        client.release();

    }

});


// ===============================
// LOGIN
// ===============================

router.post("/login", async (req, res) => {

    try {

        const {
            identifier,
            password
        } = req.body;


        if (!identifier || !password) {

            return res.status(400).json({
                success: false,
                message:
                    "Email/phone/username and password are required."
            });

        }


        const value =
            identifier.trim();


        const result =
            await pool.query(
                `
                SELECT
                    id,
                    full_name,
                    username,
                    phone,
                    email,
                    password_hash,
                    account_status,
                    registration_paid,
                    referral_code,
                    referred_by,
                    cheryearn_number,
                    created_at
                FROM users
                WHERE LOWER(email) = LOWER($1)
                   OR phone = $1
                   OR LOWER(username) = LOWER($1)
                LIMIT 1
                `,
                [value]
            );


        if (result.rows.length === 0) {

            return res.status(401).json({
                success: false,
                message:
                    "Invalid email/phone/username or password."
            });

        }


        const user =
            result.rows[0];


        if (!user.password_hash) {

            return res.status(500).json({
                success: false,
                message:
                    "Account password is not configured. Please create a new account."
            });

        }


        const passwordMatch =
            await bcrypt.compare(
                password,
                user.password_hash
            );


        if (!passwordMatch) {

            return res.status(401).json({
                success: false,
                message:
                    "Invalid email/phone/username or password."
            });

        }


        if (
            user.account_status &&
            user.account_status.toLowerCase() ===
                "suspended"
        ) {

            return res.status(403).json({
                success: false,
                message:
                    "Your account has been suspended."
            });

        }


        if (!process.env.JWT_SECRET) {

            console.error(
                "JWT_SECRET is missing."
            );

            return res.status(500).json({
                success: false,
                message:
                    "Server configuration error."
            });

        }


        const token =
            jwt.sign(
                {
                    id: user.id,
                    email: user.email,
                    phone: user.phone
                },
                process.env.JWT_SECRET,
                {
                    expiresIn: "7d"
                }
            );


        res.json({

            success: true,

            message:
                "Login successful.",

            token,

            user: {

                id:
                    user.id,

                full_name:
                    user.full_name,

                username:
                    user.username,

                phone:
                    user.phone,

                email:
                    user.email,

                account_status:
                    user.account_status,

                registration_paid:
                    user.registration_paid,

                referral_code:
                    user.referral_code,

                referred_by:
                    user.referred_by,

                cheryearn_number:
                    user.cheryearn_number,

                cheryearn_id:
                    user.cheryearn_number
                        ? `CheryEarn${String(
                            user.cheryearn_number
                        ).padStart(3, "0")}`
                        : null,

                created_at:
                    user.created_at

            }

        });


    } catch (error) {

        console.error(
            "Login error:",
            error
        );


        res.status(500).json({
            success: false,
            message:
                "Server error. Please try again."
        });

    }

});


module.exports = router;
