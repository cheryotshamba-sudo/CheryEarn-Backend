const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");

const router = express.Router();

router.post("/register", async (req, res) => {
    try {
        const { full_name, phone, email, password } = req.body;

        if (!full_name || !phone || !email || !password) {
            return res.status(400).json({
                success: false,
                message: "Full name, phone, email and password are required."
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 6 characters."
            });
        }

        const cleanName = full_name.trim();
        const cleanPhone = phone.trim();
        const cleanEmail = email.trim().toLowerCase();

        const existingUser = await pool.query(
            `SELECT id FROM users
             WHERE phone = $1 OR email = $2`,
            [cleanPhone, cleanEmail]
        );

        if (existingUser.rows.length > 0) {
            return res.status(409).json({
                success: false,
                message: "A user with that phone number or email already exists."
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);

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
            [cleanName, cleanPhone, cleanEmail, passwordHash]
        );

        res.status(201).json({
            success: true,
            message: "Registration successful.",
            user: result.rows[0]
        });

    } catch (error) {
        console.error("Registration error:", error);

        res.status(500).json({
            success: false,
            message: "Server error. Please try again."
        });
    }
});


router.post("/login", async (req, res) => {
    try {
        const { identifier, password } = req.body;

        if (!identifier || !password) {
            return res.status(400).json({
                success: false,
                message: "Email/phone and password are required."
            });
        }

        const cleanIdentifier = identifier.trim().toLowerCase();

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

        if (!user.password_hash) {
            return res.status(500).json({
                success: false,
                message: "This account does not have a valid password."
            });
        }

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

        if (user.account_status === "suspended") {
            return res.status(403).json({
                success: false,
                message: "Your account has been suspended."
            });
        }

        if (!process.env.JWT_SECRET) {
            console.error("JWT_SECRET is not configured.");

            return res.status(500).json({
                success: false,
                message: "Server configuration error."
            });
        }

        const token = jwt.sign(
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

        delete user.password_hash;

        res.status(200).json({
            success: true,
            message: "Login successful.",
            token,
            user
        });

    } catch (error) {
        console.error("Login error:", error);

        res.status(500).json({
            success: false,
            message: "Server error. Please try again."
        });
    }
});


module.exports = router;
