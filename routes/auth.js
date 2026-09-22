const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");

const router = express.Router();


// ===============================
// LOGIN
// ===============================

router.post("/login", async (req, res) => {
    try {

        const { identifier, password } = req.body;

        if (!identifier || !password) {
            return res.status(400).json({
                success: false,
                message: "Email/phone and password are required."
            });
        }

        const value = identifier.trim();

        const result = await pool.query(
            `
            SELECT
                id,
                full_name,
                phone,
                email,
                password_hash,
                account_status,
                registration_paid,
                created_at
            FROM users
            WHERE LOWER(email) = LOWER($1)
               OR phone = $1
            LIMIT 1
            `,
            [value]
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
                message: "Account password is not configured."
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

        if (
            user.account_status &&
            user.account_status.toLowerCase() === "suspended"
        ) {
            return res.status(403).json({
                success: false,
                message: "Your account has been suspended."
            });
        }

        if (!process.env.JWT_SECRET) {
            console.error("JWT_SECRET is missing.");

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

        res.json({
            success: true,
            message: "Login successful.",
            token,
            user: {
                id: user.id,
                full_name: user.full_name,
                phone: user.phone,
                email: user.email,
                account_status: user.account_status,
                registration_paid: user.registration_paid,
                created_at: user.created_at
            }
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
