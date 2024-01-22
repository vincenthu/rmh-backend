const express = require("express");
const app = express();
var logger = require("morgan");
const cors = require("cors");

require("dotenv").config();

const port = process.env.PORT || 8080;
const indexRouter = require("./routes/index");
const datingRouter = require("./routes/dating");
const webhookRouter = require("./webhook/webhook")


//middleware
app.use(logger("dev"));
app.use(function (req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  next();
});

app.use("/webhook", webhookRouter);
app.use(express.json({ limit: "50mb" })); // 50mb for contacts
app.use("/", indexRouter);
app.use("/dating", datingRouter);
// app.use(express.urlencoded({ extended: true, limit: "1mb" })); // put urlencoded data in req.body

// add react app routes

// add API routes
app.listen(port);

module.exports = app;