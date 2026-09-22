const express = require("express");
const axios = require("axios");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");

const pool = require("./db");

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/user");

const app = express();


// ======================================================
// TEMPORARY REGISTRATION PAYMENT SETTINGS
// ======================================================
//
// TEST MODE:
// Registration = KSh 10
// 1st upline = KSh 5
// 2nd upline = KSh 2.50
// Company = KSh 2.50
//
// Later we will change this back to:
// Registration = KSh 200
// 1st upline = KSh 100
// 2nd upline = KSh 50
// Company = KSh 50
// ======================================================

const REGISTRATION_FEE = 10.00;

const FIRST_UPLINE_AMOUNT = 5.00;

const SECOND_UPLINE_AMOUNT = 2.50;

const COMPANY_AMOUNT = 2.50;


// ======================================================
// MIDDLEWARE
// ======================================================

app.use(cors());


// Keep raw body for Paylor webhook signature verification

app.use(
    "/paylor-callback",
    express.raw({
        type: "*/*"
    })
);


// Normal JSON for all other routes

app.use(express.json());


// ======================================================
// AUTHENTICATION & USER ROUTES
// ======================================================

// POST /api/auth/register

app.use(
    "/api/auth",
    authRoutes
);


// GET /api/user/dashboard

app.use(
    "/api/user",
    userRoutes
);


// ======================================================
// PAGES
// ======================================================

app.get(
    "/",
    (req, res) => {

        res.sendFile(
            path.join(
                __dirname,
                "index.html"
            )
        );

    }
);


app.get(
    "/delivery.html",
    (req, res) => {

        res.sendFile(
            path.join(
                __dirname,
                "delivery.html"
            )
        );

    }
);


// ======================================================
// NORMALIZE KENYAN PHONE
// ======================================================

function normalizePhone(phone) {

    let cleanPhone =
        String(phone || "")
            .replace(/\s+/g, "");


    if (
        cleanPhone.startsWith("0")
    ) {

        cleanPhone =
            "254" +
            cleanPhone.substring(1);

    }


    if (
        cleanPhone.startsWith("+254")
    ) {

        cleanPhone =
            cleanPhone.substring(1);

    }


    return cleanPhone;

}


// ======================================================
// VALIDATE KENYAN PHONE
// ======================================================

function isValidKenyanPhone(phone) {

    return (
        /^2547\d{8}$/.test(phone) ||
        /^2541\d{8}$/.test(phone)
    );

}


// ======================================================
// CHECK IF PAYMENT IS COMPLETED
// ======================================================

function isCompletedStatus(status) {

    const value =
        String(status || "")
            .trim()
            .toUpperCase();


    return (
        value === "COMPLETED" ||
        value === "SUCCESS" ||
        value === "SUCCESSFUL" ||
        value === "PAID"
    );

}


// ======================================================
// PROCESS COMPLETED REGISTRATION PAYMENT
// ======================================================
//
// This function is deliberately idempotent.
//
// If Paylor sends the same successful callback more
// than once, the commissions will NOT be credited twice.
// ======================================================

async function processCompletedRegistrationPayment(
    paymentReference,
    gatewayPayment
) {

    if (!paymentReference) {

        throw new Error(
            "Payment reference is missing."
        );

    }


    const client =
        await pool.connect();


    try {

        await client.query(
            "BEGIN"
        );


        // ==============================================
        // LOCK PAYMENT RECORD
        // ==============================================

        const paymentResult =
            await client.query(
                `
                SELECT
                    id,
                    user_id,
                    amount,
                    status,
                    first_upline_amount,
                    second_upline_amount,
                    company_amount
                FROM registration_payments
                WHERE payment_reference = $1
                FOR UPDATE
                `,
                [
                    paymentReference
                ]
            );


        if (
            paymentResult.rows.length === 0
        ) {

            throw new Error(
                "Registration payment record was not found."
            );

        }


        const payment =
            paymentResult.rows[0];


        // ==============================================
        // ALREADY COMPLETED
        // ==============================================

        if (
            String(payment.status)
                .toUpperCase() ===
            "COMPLETED"
        ) {

            await client.query(
                "COMMIT"
            );


            return {
                alreadyProcessed: true,
                paymentId: payment.id,
                userId: payment.user_id
            };

        }


        // ==============================================
        // VERIFY AMOUNT
        // ==============================================

        const gatewayAmount =
            Number(
                gatewayPayment?.amount
            );


        const databaseAmount =
            Number(
                payment.amount
            );


        if (
            Number.isFinite(gatewayAmount) &&
            gatewayAmount !== databaseAmount
        ) {

            throw new Error(
                `Payment amount mismatch. Expected ${databaseAmount}, received ${gatewayAmount}.`
            );

        }


        // ==============================================
        // GET USER + REFERRAL CHAIN
        // ==============================================

        const userResult =
            await client.query(
                `
                SELECT
                    id,
                    full_name,
                    referred_by,
                    registration_paid
                FROM users
                WHERE id = $1
                FOR UPDATE
                `,
                [
                    payment.user_id
                ]
            );


        if (
            userResult.rows.length === 0
        ) {

            throw new Error(
                "User associated with payment was not found."
            );

        }


        const user =
            userResult.rows[0];


        const firstUplineId =
            user.referred_by ||
            null;


        let secondUplineId =
            null;


        if (firstUplineId) {

            const firstUplineResult =
                await client.query(
                    `
                    SELECT
                        referred_by
                    FROM users
                    WHERE id = $1
                    LIMIT 1
                    `,
                    [
                        firstUplineId
                    ]
                );


            if (
                firstUplineResult.rows.length > 0
            ) {

                secondUplineId =
                    firstUplineResult.rows[0]
                        .referred_by ||
                    null;

            }

        }


        // ==============================================
        // MARK PAYMENT COMPLETED
        // ==============================================

        await client.query(
            `
            UPDATE registration_payments
            SET
                status = 'COMPLETED',
                gateway_response = $1,
                completed_at = CURRENT_TIMESTAMP
            WHERE id = $2
            `,
            [
                JSON.stringify(
                    gatewayPayment || {}
                ),
                payment.id
            ]
        );


        // ==============================================
        // MARK USER REGISTRATION AS PAID
        // ==============================================

        await client.query(
            `
            UPDATE users
            SET
                registration_paid = TRUE,
                account_status = 'active'
            WHERE id = $1
            `,
            [
                payment.user_id
            ]
        );


        // ==============================================
        // LEVEL 1 COMMISSION
        // ==============================================

        if (firstUplineId) {

            await client.query(
                `
                INSERT INTO commissions
                (
                    payment_id,
                    recipient_user_id,
                    source_user_id,
                    level,
                    amount,
                    status
                )
                VALUES
                (
                    $1,
                    $2,
                    $3,
                    1,
                    $4,
                    'CREDITED'
                )
                ON CONFLICT
                (
                    payment_id,
                    level
                )
                DO NOTHING
                `,
                [
                    payment.id,
                    firstUplineId,
                    payment.user_id,
                    Number(
                        payment.first_upline_amount
                    )
                ]
            );

        }


        // ==============================================
        // LEVEL 2 COMMISSION
        // ==============================================

        if (secondUplineId) {

            await client.query(
                `
                INSERT INTO commissions
                (
                    payment_id,
                    recipient_user_id,
                    source_user_id,
                    level,
                    amount,
                    status
                )
                VALUES
                (
                    $1,
                    $2,
                    $3,
                    2,
                    $4,
                    'CREDITED'
                )
                ON CONFLICT
                (
                    payment_id,
                    level
                )
                DO NOTHING
                `,
                [
                    payment.id,
                    secondUplineId,
                    payment.user_id,
                    Number(
                        payment.second_upline_amount
                    )
                ]
            );

        }


        // ==============================================
        // COMPLETE TRANSACTION
        // ==============================================

        await client.query(
            "COMMIT"
        );


        console.log("");
        console.log(
            "=========================================="
        );
        console.log(
            " CHERYEARN REGISTRATION PAYMENT COMPLETED"
        );
        console.log(
            "=========================================="
        );

        console.log(
            "Payment ID:",
            payment.id
        );

        console.log(
            "User ID:",
            payment.user_id
        );

        console.log(
            "Amount:",
            databaseAmount
        );

        console.log(
            "1st Upline:",
            firstUplineId
        );

        console.log(
            "1st Upline Amount:",
            payment.first_upline_amount
        );

        console.log(
            "2nd Upline:",
            secondUplineId
        );

        console.log(
            "2nd Upline Amount:",
            payment.second_upline_amount
        );

        console.log(
            "Company Amount:",
            payment.company_amount
        );

        console.log(
            "=========================================="
        );


        return {
            alreadyProcessed: false,
            paymentId: payment.id,
            userId: payment.user_id,
            firstUplineId,
            secondUplineId
        };


    } catch (error) {

        await client.query(
            "ROLLBACK"
        );

        throw error;


    } finally {

        client.release();

    }

}


// ======================================================
// PAYLOR STK PUSH
// ======================================================

app.post(
    "/stk-push",
    async (req, res) => {

        try {

            const {
                userId,
                phone
            } = req.body;


            console.log(
                "CHERYEARN STK REQUEST:",
                req.body
            );


            // ==========================================
            // VALIDATE USER ID
            // ==========================================

            if (!userId) {

                return res.status(400).json({

                    success: false,

                    message:
                        "User ID is required."

                });

            }


            const numericUserId =
                Number(userId);


            if (
                !Number.isInteger(
                    numericUserId
                ) ||
                numericUserId <= 0
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Invalid user ID."

                });

            }


            // ==========================================
            // VALIDATE PHONE
            // ==========================================

            if (!phone) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Phone number is required."

                });

            }


            const normalizedPhone =
                normalizePhone(phone);


            if (
                !isValidKenyanPhone(
                    normalizedPhone
                )
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Invalid Kenyan M-Pesa phone number."

                });

            }


            // ==========================================
            // GET USER
            // ==========================================

            const userResult =
                await pool.query(
                    `
                    SELECT
                        id,
                        phone,
                        registration_paid
                    FROM users
                    WHERE id = $1
                    LIMIT 1
                    `,
                    [
                        numericUserId
                    ]
                );


            if (
                userResult.rows.length === 0
            ) {

                return res.status(404).json({

                    success: false,

                    message:
                        "User account not found."

                });

            }


            const user =
                userResult.rows[0];


            // ==========================================
            // CHECK ALREADY PAID
            // ==========================================

            if (
                user.registration_paid ===
                true
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Registration payment has already been completed."

                });

            }


            // ==========================================
            // CHECK EXISTING PENDING PAYMENT
            // ==========================================

            const pendingPaymentResult =
                await pool.query(
                    `
                    SELECT
                        id,
                        payment_reference,
                        status
                    FROM registration_payments
                    WHERE user_id = $1
                      AND status = 'PENDING'
                    ORDER BY id DESC
                    LIMIT 1
                    `,
                    [
                        numericUserId
                    ]
                );


            if (
                pendingPaymentResult.rows.length > 0
            ) {

                return res.status(409).json({

                    success: false,

                    message:
                        "You already have a pending registration payment. Please complete it before creating another payment."

                });

            }


            // ==========================================
            // GENERATE PAYMENT REFERENCE
            // ==========================================

            const reference =
                "CHERY-" +
                Date.now() +
                "-" +
                Math.floor(
                    Math.random() * 10000
                );


            // ==========================================
            // CREATE PAYMENT RECORD FIRST
            // ==========================================

            const paymentRecord =
                await pool.query(
                    `
                    INSERT INTO registration_payments
                    (
                        user_id,
                        amount,
                        status,
                        payment_reference,
                        phone,
                        first_upline_amount,
                        second_upline_amount,
                        company_amount
                    )
                    VALUES
                    (
                        $1,
                        $2,
                        'PENDING',
                        $3,
                        $4,
                        $5,
                        $6,
                        $7
                    )
                    RETURNING
                        id,
                        payment_reference
                    `,
                    [
                        numericUserId,
                        REGISTRATION_FEE,
                        reference,
                        normalizedPhone,
                        FIRST_UPLINE_AMOUNT,
                        SECOND_UPLINE_AMOUNT,
                        COMPANY_AMOUNT
                    ]
                );


            const paymentId =
                paymentRecord.rows[0].id;


            // ==========================================
            // CALLBACK URL
            // ==========================================

            const callbackUrl =
                `${process.env.BACKEND_URL}/paylor-callback`;


            console.log("");
            console.log(
                "================================="
            );
            console.log(
                "       CHERYEARN PAYLOR STK"
            );
            console.log(
                "================================="
            );

            console.log(
                "Payment ID:",
                paymentId
            );

            console.log(
                "User ID:",
                numericUserId
            );

            console.log(
                "Phone:",
                normalizedPhone
            );

            console.log(
                "Amount:",
                REGISTRATION_FEE
            );

            console.log(
                "Reference:",
                reference
            );

            console.log(
                "Channel:",
                process.env.PAYLOR_CHANNEL_ID
            );

            console.log(
                "Callback:",
                callbackUrl
            );

            console.log(
                "================================="
            );


            // ==========================================
            // SEND STK TO PAYLOR
            // ==========================================

            const response =
                await axios.post(

                    "https://api.paylorke.com/api/v1/merchants/payments/stk-push",

                    {

                        phone:
                            normalizedPhone,

                        // IMPORTANT:
                        // Server controls the amount.
                        amount:
                            REGISTRATION_FEE,

                        reference:
                            reference,

                        channelId:
                            process.env.PAYLOR_CHANNEL_ID,

                        description:
                            "CheryEarn Registration Payment",

                        callbackUrl:
                            callbackUrl

                    },

                    {

                        headers: {

                            Authorization:
                                `Bearer ${process.env.PAYLOR_API_KEY}`,

                            "Content-Type":
                                "application/json",

                            Accept:
                                "application/json",

                            "Idempotency-Key":
                                reference

                        }

                    }

                );


            console.log("");
            console.log(
                "===== PAYLOR RESPONSE ====="
            );

            console.log(
                response.data
            );


            // ==========================================
            // GET TRANSACTION ID
            // ==========================================

            const transactionId =
                response.data?.transactionId;


            const status =
                response.data?.status;


            // ==========================================
            // SAVE GATEWAY RESPONSE
            // ==========================================

            await pool.query(
                `
                UPDATE registration_payments
                SET
                    gateway_response = $1
                WHERE id = $2
                `,
                [
                    JSON.stringify(
                        response.data || {}
                    ),
                    paymentId
                ]
            );


            // ==========================================
            // PAYLOR DID NOT RETURN TRANSACTION ID
            // ==========================================

            if (!transactionId) {

                await pool.query(
                    `
                    UPDATE registration_payments
                    SET
                        status = 'FAILED',
                        gateway_response = $1
                    WHERE id = $2
                    `,
                    [
                        JSON.stringify(
                            response.data || {}
                        ),
                        paymentId
                    ]
                );


                return res.status(502).json({

                    success: false,

                    message:
                        "Paylor did not return a transaction ID.",

                    data:
                        response.data

                });

            }


            // ==========================================
            // SUCCESS RESPONSE
            // ==========================================

            return res.json({

                success: true,

                paid: false,

                transactionId:
                    transactionId,

                checkout_request_id:
                    transactionId,

                reference:
                    reference,

                status:
                    status,

                data:
                    response.data

            });


        } catch (error) {

            console.log("");
            console.log(
                "===== PAYLOR STK ERROR ====="
            );


            console.log(
                error.response?.data ||
                error.message
            );


            console.log("");


            return res.status(

                error.response?.status ||
                500

            ).json({

                success: false,

                message:
                    error.response?.data?.message ||
                    "Payment failed.",

                data:
                    error.response?.data ||
                    null

            });

        }

    }
);


// ======================================================
// PAYLOR WEBHOOK
// ======================================================

app.post(
    "/paylor-callback",
    async (req, res) => {

        try {

            const signature =
                req.headers[
                    "x-webhook-signature"
                ];


            console.log(
                "===== WEBHOOK DEBUG ====="
            );


            console.log(
                "Webhook signature:",
                signature
            );


            console.log(
                "Webhook headers:",
                req.headers
            );


            const rawBody =
                req.body;


            console.log(
                "Raw webhook body:",
                rawBody.toString("utf8")
            );


            console.log(
                "========================="
            );


            // ==========================================
            // CHECK SIGNATURE
            // ==========================================

            if (!signature) {

                console.log(
                    "Paylor webhook: missing signature"
                );


                return res.status(401).json({

                    success: false,

                    message:
                        "Missing webhook signature"

                });

            }


            if (
                !process.env.PAYLOR_WEBHOOK_SECRET
            ) {

                console.log(
                    "Paylor webhook secret is missing."
                );


                return res.status(500).json({

                    success: false,

                    message:
                        "Webhook configuration error."

                });

            }


            const expectedSignature =
                crypto
                    .createHmac(
                        "sha256",
                        process.env
                            .PAYLOR_WEBHOOK_SECRET
                    )
                    .update(rawBody)
                    .digest("hex");


            const receivedBuffer =
                Buffer.from(
                    String(signature)
                );


            const expectedBuffer =
                Buffer.from(
                    expectedSignature
                );


            if (
                receivedBuffer.length !==
                expectedBuffer.length
            ) {

                console.log(
                    "Paylor webhook: invalid signature"
                );


                return res.status(401).json({

                    success: false,

                    message:
                        "Invalid signature"

                });

            }


            if (
                !crypto.timingSafeEqual(
                    receivedBuffer,
                    expectedBuffer
                )
            ) {

                console.log(
                    "Paylor webhook: invalid signature"
                );


                return res.status(401).json({

                    success: false,

                    message:
                        "Invalid signature"

                });

            }


            // ==========================================
            // PARSE PAYMENT
            // ==========================================

            const payment =
                JSON.parse(
                    rawBody.toString("utf8")
                );


            console.log("");
            console.log(
                "================================="
            );

            console.log(
                "       PAYLOR WEBHOOK"
            );

            console.log(
                "================================="
            );

            console.log(
                payment
            );

            console.log(
                "================================="
            );


            // ==========================================
            // COMPLETED PAYMENT
            // ==========================================

            if (
                isCompletedStatus(
                    payment.status
                )
            ) {

                console.log(
                    "PAYMENT SUCCESSFUL"
                );


                console.log(
                    "Transaction ID:",
                    payment.transactionId ||
                    payment.id
                );


                console.log(
                    "Reference:",
                    payment.reference
                );


                console.log(
                    "Amount:",
                    payment.amount
                );


                try {

                    const result =
                        await processCompletedRegistrationPayment(
                            payment.reference,
                            payment
                        );


                    console.log(
                        "Registration payment processed:",
                        result
                    );


                } catch (processingError) {

                    console.error(
                        "Payment processing error:",
                        processingError
                    );


                    return res.status(500).json({

                        success: false,

                        message:
                            "Payment received but processing failed."

                    });

                }

            }


            // ==========================================
            // FAILED / CANCELLED
            // ==========================================

            if (
                String(payment.status)
                    .toUpperCase() ===
                    "FAILED" ||
                String(payment.status)
                    .toUpperCase() ===
                    "CANCELLED" ||
                String(payment.status)
                    .toUpperCase() ===
                    "CANCELED"
            ) {

                console.log(
                    "PAYMENT NOT COMPLETED"
                );


                console.log(
                    "Status:",
                    payment.status
                );


                if (payment.reference) {

                    await pool.query(
                        `
                        UPDATE registration_payments
                        SET
                            status = $1,
                            gateway_response = $2
                        WHERE payment_reference = $3
                          AND status = 'PENDING'
                        `,
                        [
                            String(
                                payment.status
                            ).toUpperCase(),

                            JSON.stringify(
                                payment
                            ),

                            payment.reference
                        ]
                    );

                }

            }


            // ==========================================
            // ACKNOWLEDGE WEBHOOK
            // ==========================================

            return res.status(200).json({

                success: true

            });


        } catch (error) {

            console.log(
                "Paylor webhook error:",
                error.message
            );


            return res.status(500).json({

                success: false

            });

        }

    }
);


// ======================================================
// PAYMENT STATUS
// ======================================================

app.post(
    "/payment-status",
    async (req, res) => {

        console.log(
            "PAYMENT STATUS REQUEST:",
            req.body
        );


        try {

            const transactionId =

                req.body?.transactionId ||

                req.body?.checkout_request_id ||

                req.body?.transaction_id ||

                req.query?.transactionId ||

                req.query?.checkout_request_id;


            const reference =
                req.body?.reference ||
                req.body?.paymentReference ||
                req.query?.reference;


            const userId =
                req.body?.userId;


            console.log(
                "RESOLVED TRANSACTION ID:",
                transactionId
            );


            console.log(
                "RESOLVED REFERENCE:",
                reference
            );


            // ==========================================
            // REQUIRE TRANSACTION ID
            // ==========================================

            if (!transactionId) {

                return res.status(400).json({

                    success: false,

                    message:
                        "transactionId is required."

                });

            }


            // ==========================================
            // QUERY PAYLOR
            // ==========================================

            const response =
                await axios.get(

                    `https://api.paylorke.com/api/v1/merchants/payments/transactions/${encodeURIComponent(transactionId)}`,

                    {

                        headers: {

                            Authorization:
                                `Bearer ${process.env.PAYLOR_API_KEY}`,

                            Accept:
                                "application/json"

                        }

                    }

                );


            console.log("");
            console.log(
                "===== PAYLOR PAYMENT STATUS ====="
            );


            console.log(
                response.data
            );


            // ==========================================
            // NORMALIZE STATUS
            // ==========================================

            const paymentStatus =

                response.data?.status ||

                response.data?.data?.status ||

                response.data?.transaction?.status ||

                response.data?.payment?.status ||

                response.data?.result?.status ||

                "";


            console.log(
                "NORMALIZED PAYMENT STATUS:",
                paymentStatus
            );


            // ==========================================
            // COMPLETED
            // ==========================================

            if (
                isCompletedStatus(
                    paymentStatus
                )
            ) {

                let paymentReference =
                    reference;


                // ======================================
                // TRY TO GET REFERENCE FROM PAYLOR
                // ======================================

                if (
                    !paymentReference
                ) {

                    paymentReference =
                        response.data?.reference ||
                        response.data?.data?.reference ||
                        response.data?.transaction?.reference ||
                        response.data?.payment?.reference ||
                        response.data?.result?.reference ||
                        null;

                }


                if (
                    paymentReference
                ) {

                    try {

                        const processingResult =
                            await processCompletedRegistrationPayment(
                                paymentReference,
                                {
                                    ...response.data,
                                    status:
                                        paymentStatus,
                                    transactionId:
                                        transactionId
                                }
                            );


                        console.log(
                            "Payment status processing result:",
                            processingResult
                        );


                    } catch (processingError) {

                        console.error(
                            "Payment completion processing error:",
                            processingError
                        );


                        return res.status(500).json({

                            success: false,

                            message:
                                "Payment is completed but registration processing failed.",

                            status:
                                String(
                                    paymentStatus
                                ).toLowerCase()

                        });

                    }

                } else {

                    console.log(
                        "Payment completed but reference was not available."
                    );

                }

            }


            // ==========================================
            // FAILED / CANCELLED
            // ==========================================

            if (
                String(paymentStatus)
                    .toUpperCase() ===
                    "FAILED" ||
                String(paymentStatus)
                    .toUpperCase() ===
                    "CANCELLED" ||
                String(paymentStatus)
                    .toUpperCase() ===
                    "CANCELED"
            ) {

                if (
                    reference
                ) {

                    await pool.query(
                        `
                        UPDATE registration_payments
                        SET
                            status = $1,
                            gateway_response = $2
                        WHERE payment_reference = $3
                          AND status = 'PENDING'
                        `,
                        [
                            String(
                                paymentStatus
                            ).toUpperCase(),

                            JSON.stringify(
                                response.data
                            ),

                            reference
                        ]
                    );

                }

            }


            // ==========================================
            // RETURN STATUS
            // ==========================================

            return res.json({

                success: true,

                status:
                    String(
                        paymentStatus
                    ).toLowerCase(),

                paid:
                    isCompletedStatus(
                        paymentStatus
                    ),

                userId:
                    userId ||
                    null,

                reference:
                    reference ||
                    null,

                data:
                    response.data

            });


        } catch (error) {

            console.log(
                "Payment status error:",
                error.response?.data ||
                error.message
            );


            return res.status(

                error.response?.status ||
                500

            ).json({

                success: false,

                message:
                    "Unable to check payment status",

                data:
                    error.response?.data ||
                    null

            });

        }

    }
);


// ======================================================
// HEALTH CHECK
// ======================================================

app.get(
    "/health",
    (req, res) => {

        res.json({

            success: true,

            service:
                "CheryEarn Backend",

            paymentGateway:
                "Paylor",

            registrationFee:
                REGISTRATION_FEE,

            firstUpline:
                FIRST_UPLINE_AMOUNT,

            secondUpline:
                SECOND_UPLINE_AMOUNT,

            company:
                COMPANY_AMOUNT,

            status:
                "online"

        });

    }
);


// ======================================================
// SERVER
// ======================================================

const PORT =
    process.env.PORT || 3000;


app.listen(
    PORT,
    () => {

        console.log("");

        console.log(
            `CheryEarn Backend running on port ${PORT}`
        );

        console.log(
            `Registration test fee: KSh ${REGISTRATION_FEE}`
        );

        console.log(
            `1st upline: KSh ${FIRST_UPLINE_AMOUNT}`
        );

        console.log(
            `2nd upline: KSh ${SECOND_UPLINE_AMOUNT}`
        );

        console.log(
            `Company: KSh ${COMPANY_AMOUNT}`
        );

    }
);
