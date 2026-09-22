const express = require("express");
const bcrypt = require("bcryptjs");
const pool = require("../db");

const router = express.Router();

function generateReferralCode() {
    return "CHERY" + Math.random().toString(36).substring(2, 8).toUpperCase();
}

router.post("/register", async (req, res) => {
    try {
        const {
            full_name,
            phone,
            email,
            password,
            referral_code
        } = req.body;

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

        const cleanEmail = email.toLowerCase().trim();
        const cleanPhone = phone.trim();

        const existingUser = await pool.query(
            "SELECT id FROM users WHERE phone = $1 OR email = $2",
            [cleanPhone, cleanEmail]
        );

        if (existingUser.rows.length > 0) {
            return res.status(409).json({
                success: false,
                message: "A user with that phone number or email already exists."
            });
        }

        let newReferralCode;
        let referralExists = true;

        while (referralExists) {
            newReferralCode = generateReferralCode();

            const checkCode = await pool.query(
                "SELECT id FROM users WHERE referral_code = $1",
                [newReferralCode]
            );

            referralExists = checkCode.rows.length > 0;
        }

        let referredBy = null;

        if (referral_code && referral_code.trim() !== "") {
            const cleanReferralCode = referral_code.trim().toUpperCase();

            const referrer = await pool.query(
                "SELECT referral_code FROM users WHERE referral_code = $1",
                [cleanReferralCode]
            );

            if (referrer.rows.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid referral code."
                });
            }

            referredBy = referrer.rows[0].referral_code;
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const result = await pool.query(
            `INSERT INTO users
            (full_name, phone, email, password_hash, referral_code, referred_by)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, full_name, phone, email, referral_code,
                      referred_by, account_status, registration_paid, created_at`,
            [
                full_name.trim(),
                cleanPhone,
                cleanEmail,
                passwordHash,
                newReferralCode,
                referredBy
            ]
        );

        return res.status(201).json({
            success: true,
            message: "Registration successful. Please complete the KSh 200 registration payment.",
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

module.exports = router;
