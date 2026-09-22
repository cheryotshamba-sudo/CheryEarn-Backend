const express = require("express");
const jwt = require("jsonwebtoken");
const pool = require("../db");

const router = express.Router();


// ===============================
// AUTHENTICATION MIDDLEWARE
// ===============================

function authenticateToken(req, res, next) {

    const authHeader =
        req.headers.authorization;

    if (!authHeader) {
        return res.status(401).json({
            success: false,
            message: "Authorization token is required."
        });
    }

    const parts =
        authHeader.split(" ");

    if (
        parts.length !== 2 ||
        parts[0] !== "Bearer"
    ) {
        return res.status(401).json({
            success: false,
            message: "Invalid authorization format."
        });
    }

    const token = parts[1];

    try {

        const decoded =
            jwt.verify(
                token,
                process.env.JWT_SECRET
            );

        req.user = decoded;

        next();

    } catch (error) {

        return res.status(401).json({
            success: false,
            message: "Invalid or expired token."
        });

    }
}


// ===============================
// USER DASHBOARD
// ===============================

router.get(
    "/dashboard",
    authenticateToken,
    async (req, res) => {

        try {

            const userId =
                req.user.id;


            const result =
                await pool.query(
                    `
                    SELECT
                        id,
                        full_name,
                        phone,
                        email,
                        account_status,
                        registration_paid,
                        referral_code,
                        created_at
                    FROM users
                    WHERE id = $1
                    LIMIT 1
                    `,
                    [userId]
                );


            if (result.rows.length === 0) {

                return res.status(404).json({
                    success: false,
                    message: "User account not found."
                });

            }


            const user =
                result.rows[0];


            res.json({

                success: true,

                user: {

                    id:
                        user.id,

                    full_name:
                        user.full_name,

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

                    created_at:
                        user.created_at,

                    balance:
                        0,

                    totalEarnings:
                        0,

                    pendingEarnings:
                        0,

                    totalReferrals:
                        0

                }

            });

        } catch (error) {

            console.error(
                "Dashboard error:",
                error
            );

            res.status(500).json({
                success: false,
                message: "Unable to load dashboard."
            });

        }

    }
);


module.exports = router;
