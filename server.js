const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

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
