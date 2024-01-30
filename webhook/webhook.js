var express = require("express");
const sgMail = require("@sendgrid/mail");
const { ByteFlow } = require("@byteflow-inc/sdk");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { cleanPhoneNumber } = require("../services/dating");
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// TODO: DATING KEY -- need to clean up!
// also dating webhook!
const stripe = require("stripe")(
  process.env.STRIPE_KEY
);
// const stripe = require("stripe")(
//   "sk_test_51Nss04GHPuCVsE3X4VQ3KMTgVUQ0dtxMBxAkqXMM3F8lqJnQVLNx11yBxsWPgRCOdlDSrMUNtwuRsQ9ZgPSxE5AS00u8nxxXan"
// );

var router = express.Router();

router.post(
  "/stripe_payment",

  express.raw({ type: "application/json" }),
  async function (req, res, next) {
    let event;
    console.log("stripe webhook...");
    try {
      event = await stripe.webhooks.constructEvent(
        req.body,
        req.headers["stripe-signature"],
        process.env.STRIPE_WEBOOK_SECRET_PAYMENT
        // "whsec_gvAWzObw9v4N8TUb0Kft0q7rnQ0AX9Uc" // TEST
      );
      // Extract the object from the event.
      const dataObject = event.data.object;

      const payment_intent_id = dataObject["id"];
      const customer_id = dataObject["customer"];
      const customer_email = dataObject["receipt_email"];

      const customer = await stripe.customers.retrieve(customer_id);

      const userNonce = customer.metadata.userNonce;
      await updateMongoWithData(userNonce, payment_intent_id, customer_email);
      console.log(userNonce);
      // UPDATE MONGO WITH PAYMENT INTENT and timestamp for when it was paid
      res.json("OK");
    } catch (err) {
      console.log(err);
      res.status(500).json("error");
    }
  }
);

router.post(
  "/stripe_account",

  express.raw({ type: "application/json" }),
  async function (req, res, next) {
    let event;
    console.log("stripe webhook...");
    try {
      event = await stripe.webhooks.constructEvent(
        req.body,
        req.headers["stripe-signature"],
        process.env.STRIPE_WEBOOK_SECRET_ACCOUNT
      );
      // Extract the object from the event.
      const dataObject = event.data.object;
      // await updateMongoWithData(userNonce, payment_intent_id, customer_email);
      // UPDATE MONGO WITH PAYMENT INTENT and timestamp for when it was paid
      console.log("LINKED", dataObject.external_accounts)
      if (dataObject.external_accounts.data.length > 0) {
        await setPayoutsEnabled(dataObject.id);
      }
      res.json("OK");
    } catch (err) {
      console.log(err);
      res.status(500).json("error");
    }
  }
);

const setPayoutsEnabled = async (accountId) => {
  const uri = `mongodb+srv://clarify:${process.env.MONGO_PASSWORD}@cluster0.pjrqyk2.mongodb.net/?retryWrites=true&w=majority`;
  const client = new MongoClient(uri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });
  // Connect to the MongoDB server
  await client.connect();

  // Select the database
  const db = client.db("sherpa");

  // Define the collection
  const collection = db.collection("reviewers");

  const user = await collection.findOneAndUpdate(
    { stripeAccountId: accountId }, // Match the user based on userNonce
    {
      $set: {
        bankLinked: true
      },
    } // Add or update the userMessage field
  );
};

const updateMongoWithData = async (userNonce, payment_id, email) => {
  const uri = `mongodb+srv://clarify:${process.env.MONGO_PASSWORD}@cluster0.pjrqyk2.mongodb.net/?retryWrites=true&w=majority`;
  const client = new MongoClient(uri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });
  // Connect to the MongoDB server
  await client.connect();

  // Select the database
  const db = client.db("sherpa");

  // Define the collection
  const collection = db.collection("users");

  const user = await collection.findOneAndUpdate(
    { userNonce: userNonce }, // Match the user based on userNonce
    {
      $set: {
        email: email,
        payment_id: payment_id,
        paid: true,
        paid_at: new Date(),
      },
    } // Add or update the userMessage field
  );

  // const reviewerCollection = db.collection("reviewers");
  // const reviewer = await reviewerCollection.findOne({
  //   _id: user.reviewerId,
  // });
  // const reveiwerPhone = reviewer.phoneNumber;
  // const sdk = new ByteFlow(process.env.SMS_KEY);

  // await sdk.sendMessage({
  //   message_content: `You have a new Hinge to review. Review and get paid $${user.priceTier.price}. Use link https://reviewmyhinge.com/reviewer/rate/${userNonce}`,
  //   destination_number: `+1${cleanPhoneNumber(reveiwerPhone)}`,
  // });

  const msg = {
    to: "vincenthuusa@gmail.com", // Change to your recipient
    from: "vincenthuusa@gmail.com", // Change to your verified sender
    subject: "New order placed for Review My Hinge!",
    html: `
          <div>
          <strong>new order: ${userNonce} ${email}</strong>
          <br></br>
          </div>`,
  };

  await sgMail.send(msg);
  await sendUserEmail(email);
  client.close();
  return "OK"; // Return the found document or null if not found
};

const sendUserEmail = async (email) => {
  const msg = {
    to: email, // Change to your recipient
    from: "Hingereviewteam@gmail.com", // Change to your verified sender
    subject: "Your ReviewMyHinge order is being processed",
    html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Payment Confirmation</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    line-height: 1.6;
                    background-color: #f9f9f9;
                    text-align: center;
                    margin: 0;
                    padding: 20px;
                }
                h1 {
                    color: #333;
                }
                p {
                    color: #555;
                }
            </style>
        </head>
        <body>
            <h1>Thank you for your payment!</h1>
            <p>We got your request for the Hinge review and we're on it!</p>
            <p>Your report will be processed and sent to you shortly.</p>
            <p>Thank you for choosing our services!</p>
            <p>Best regards,<br>ReviewMyHinge</p>
        </body>
        </html>`,
  };

  await sgMail.send(msg);
};
module.exports = router;