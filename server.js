const express = require("express");
const axios = require("axios");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/user");

const app = express();


// ======================================================
// MIDDLEWARE
// ======================================================

app.use(cors());


// Keep raw body for Paylor webhook signature verification
app.use(
    "/paylor-callback",
    express.raw({ type: "*/*" })
);


// Normal JSON for all other routes
app.use(express.json());


// ======================================================
// AUTHENTICATION & USER ROUTES
// ======================================================

// Registration:
// POST /api/auth/register

// Login:
// POST /api/auth/login

app.use(
    "/api/auth",
    authRoutes
);


// User dashboard:
// GET /api/user/dashboard

app.use(
    "/api/user",
    userRoutes
);


// ======================================================
// PAGES
// ======================================================

app.get("/", (req, res) => {

    res.sendFile(
        path.join(__dirname, "index.html")
    );

});


app.get("/delivery.html", (req, res) => {

    res.sendFile(
        path.join(__dirname, "delivery.html")
    );

});


// ======================================================
// PAYLOR STK PUSH
// ======================================================

app.post("/stk-push", async (req, res) => {

    try {

        let {
            phone,
            amount
        } = req.body;


        console.log(
            "STK REQUEST FROM FRONTEND:",
            req.body
        );


        if (!phone || !amount) {

            return res.status(400).json({

                success: false,

                message:
                    "Phone number and amount are required"

            });

        }


        // ==========================================
        // NORMALIZE PHONE
        // ==========================================

        phone =
            String(phone)
                .replace(/\s+/g, "");


        if (phone.startsWith("0")) {

            phone =
                "254" +
                phone.substring(1);

        }


        if (phone.startsWith("+254")) {

            phone =
                phone.substring(1);

        }


        // ==========================================
        // VALIDATE AMOUNT
        // ==========================================

        const numericAmount =
            Number(amount);


        const stkAmount =
            numericAmount;


        if (
            !Number.isFinite(
                numericAmount
            ) ||
            numericAmount <= 0
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Invalid payment amount"

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
            "Phone:",
            phone
        );

        console.log(
            "Amount:",
            numericAmount
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
                        phone,

                    amount:
                        stkAmount,

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


        if (!transactionId) {

            return res.status(502).json({

                success: false,

                message:
                    "Paylor did not return a transaction ID",

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
                "Payment failed",

            data:
                error.response?.data ||
                null

        });

    }

});


// ======================================================
// PAYLOR WEBHOOK
// ======================================================

app.post(
    "/paylor-callback",
    (req, res) => {

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


            console.log(
                "Raw webhook body:",
                req.body.toString("utf8")
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


            const rawBody =
                req.body;


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
                    signature
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
                payment.status ===
                "COMPLETED"
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


                console.log(
                    "Provider:",
                    payment.provider
                );


                console.log(
                    "Provider Ref:",
                    payment.providerRef
                );

            }


            // ==========================================
            // FAILED / CANCELLED PAYMENT
            // ==========================================

            if (
                payment.status ===
                    "FAILED" ||
                payment.status ===
                    "CANCELLED"
            ) {

                console.log(
                    "PAYMENT NOT COMPLETED"
                );


                console.log(
                    "Status:",
                    payment.status
                );

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


            console.log(
                "RESOLVED TRANSACTION ID:",
                transactionId
            );


            if (!transactionId) {

                return res.status(400).json({

                    success: false,

                    message:
                        "transactionId is required"

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


            return res.json({

                success: true,

                status:
                    String(
                        paymentStatus
                    ).toLowerCase(),

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

    }
);
