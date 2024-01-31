// TODO: take this out
const stripe = require("stripe")(
  process.env.STRIPE_KEY
);
const AWS = require("aws-sdk");

AWS.config.update({
  accessKeyId: process.env.AWS_ID,
  secretAccessKey: process.env.AWS_KEY,
  region: "us-east-2",
});

const s3 = new AWS.S3();
// const stripe = require("stripe")(
//   "sk_test_51Nss04GHPuCVsE3X4VQ3KMTgVUQ0dtxMBxAkqXMM3F8lqJnQVLNx11yBxsWPgRCOdlDSrMUNtwuRsQ9ZgPSxE5AS00u8nxxXan"
// );
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const sgMail = require("@sendgrid/mail");

const uri = `mongodb+srv://vincenthuusa:${process.env.MONGO_PASSWORD}@cluster0.szamis3.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const messagebird = require('messagebird').initClient('jFZtigJTqRSECCj5BOICbP0WqKV5TFbwvFYZ');

const sendSMS = async (text, recipientNum) => {
  messagebird.messages.create({
    originator : '<YOUR-MOBILE-NUMBER>',
    recipients : [ recipientNum ],
    body : text
  },
  function (err, response) {
      if (err) {
      console.log("ERROR:");
      console.log(err);
  } else {
      console.log("SUCCESS:");
      console.log(response);
          }
  });
};

const updateReviewer = async (id, accountId) => {
  const client = new MongoClient(uri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });
  await client.connect();
  const db = client.db(process.env.DATABASE_NAME);
  const collection = db.collection("reviewers");
  await collection.findOneAndUpdate(
    { _id: new ObjectId(id) },
    { $set: { stripeAccountId: accountId } },
    { returnOriginal: false }
  );
  client.close();
  return;
};

const updateReviewerBalance = async (originalUser) => {
  const client = new MongoClient(uri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });
  await client.connect();
  const db = client.db(process.env.DATABASE_NAME);
  const collection = db.collection("reviewers");
  const amountToAdd = parseFloat(
    parseFloat(originalUser.priceTier.price * 0.7).toFixed(2)
  );
  const updatedReviewer = await collection.findOneAndUpdate(
    { _id: new ObjectId(originalUser.reviewerId) },
    { $inc: { balance: amountToAdd } }, // Increment balance by 10 (or create if it doesn't exist)
    { returnOriginal: false } // Return the updated document
  );

  client.close();
  return;
};
const findAllReviewers = async () => {
  await client.connect();
  const db = client.db(process.env.DATABASE_NAME);
  const collection = db.collection("reviewers");
  const reviewers = await collection
    .find(
      { isTest: { $exists: false }, isComplete: { $exists: true } },
      {
        projection: {
          name: 1,
          bio: 1,
          instagramHandle: 1,
          _id: 1,
          profilePicture: 1,
          profilePictures: 1,
          username: 1,
          priceTiers: 1,
        },
      }
    )
    .toArray();
  if (!reviewers) {
    throw Error("Doesnt exist");
  }
  client.close();
  return reviewers;
};

const createWithdrawl = async (id) => {
  await client.connect();
  const db = client.db(process.env.DATABASE_NAME);
  const collection = db.collection("reviewers");
  let query;
  // Check if it's a valid ObjectId
  if (ObjectId.isValid(id)) {
    query = { _id: new ObjectId(id) };
  } else {
    query = { username: id.toLowerCase() };
  }
  const reviewer = await collection.findOne(query);
  if (!reviewer) {
    throw Error("Doesnt exist");
  }

  try {
    if (reviewer.balance) {
      console.log("creating transfer....")
      const transfer = await stripe.transfers.create({
        amount: Math.round(reviewer.balance * 100),
        // amount: 100,
        currency: "usd",
        destination: reviewer.stripeAccountId,
      });
      console.log("transfer done")
      await collection.updateOne(query, { $set: { balance: 0 } });
    }
  } catch (err) {
    console.log("WITHDRAWAL ERROR");
    console.log(err);
    console.log("------");
    throw Error("No balance");
  }

  client.close();
  return "OK";
};

const findReviewerById = async (id) => {
  await client.connect();
  const db = client.db(process.env.DATABASE_NAME);
  const collection = db.collection("reviewers");
  let query;
  // Check if it's a valid ObjectId
  if (ObjectId.isValid(id)) {
    query = { _id: new ObjectId(id) };
  } else {
    query = { username: id.toLowerCase() };
  }
  const reviewer = await collection.findOne(query);
  if (!reviewer) {
    throw Error("Doesnt exist");
  }
  client.close();
  return reviewer;
};
const createStripeIntent = async (reviewerId, tierId, customerId) => {
  const reviewer = await findReviewerById(reviewerId);
  if (!reviewer.priceTiers) {
    throw Error("no tiers!");
  }
  const selectedTier = reviewer.priceTiers.filter((t) => t.id === tierId)[0];
  if (!selectedTier) throw Error("tier not found");

  const paymentIntent = await stripe.paymentIntents.create({
    amount: parseInt(selectedTier.price) * 100,
    currency: "usd", // Set the currency to USD
    metadata: { integration_check: "accept_a_payment" },
    customer: customerId,
  });

  return paymentIntent.client_secret;
};

const findOrCreateCustomer = async (userNonce) => {
  try {
    const existingCustomer = await stripe.customers.search({
      query: `metadata[\'userNonce\']:\'${userNonce}\'`,
    });

    if (existingCustomer.data.length > 0) {
      return existingCustomer.data[0]; // Customer already exists, return the existing customer object
    } else {
      // Customer doesn't exist, create a new one
      const newCustomer = await stripe.customers.create({
        metadata: {
          userNonce: userNonce,
        },
        // You can add additional fields as per your requirements
      });

      return newCustomer;
    }
  } catch (error) {
    console.error("Error:", error);
    throw error; // Handle the error as per your application's requirements
  }
};

const sendReviewEmails = async (userNonce, email) => {
  const msg = {
    to: "vincenthuusa@gmail.com", // Change to your recipient
    from: "vincenthuusa@gmail.com", // Change to your verified sender
    subject: "New review made",
    html: `
            <div>
            <strong>new review sent: ${userNonce} ${email}</strong>
            <a>https://reviewmyhinge.com/review/${userNonce}</a>
            <br></br>
            </div>`,
  };

  await sgMail.send(msg);
  console.log("first sent");

  const msg2 = {
    to: email, // Change to your recipient
    from: "Hingereviewteam@gmail.com", // Change to your verified sender
    subject: "Your Hinge profile review is ready!",
    html: `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Report Ready Notification</title>
          <style>
              body {
                  font-family: Arial, sans-serif;
                  background-color: #f7f7f7;
                  text-align: center;
                  margin: 0;
                  padding: 0;
              }
              .container {
                  max-width: 600px;
                  margin: 0 auto;
                  background-color: #ffffff;
                  border-radius: 10px;
                  padding: 30px;
                  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
              }
              h1 {
                  color: #333333;
              }
              p {
                  color: #666666;
                  margin-bottom: 20px;
              }
              .button {
                  display: inline-block;
                  font-size: 16px;
                  font-weight: bold;
                  text-decoration: none;
                  background-color: #4caf50;
                  color: #ffffff;
                  padding: 10px 20px;
                  border-radius: 5px;
                  transition: background-color 0.3s ease;
              }
              .button:hover {
                  background-color: #45a049;
              }
          </style>
      </head>
      <body>
          <div class="container">
              <h1>Good news, your Hinge profile report is ready!</h1>
              <p>We are pleased to inform you that your report is now available for viewing.</p>
              <a href="https://reviewmyhinge.com/review/${userNonce}" class="button">View Report</a>
              <br />
              <a href="https://reviewmyhinge.com/review/${userNonce}">https://reviewmyhinge.com/review/${userNonce}</a
          </div>
      </body>
      </html>
      `,
  };

  try {
    await sgMail.send(msg2);
    console.log("second sent");
  } catch (err) {
    console.log(err);
  }
};

const upsertAndAddImage = async (userNonce, photoId, numTry = 0) => {
  if (numTry > 10) {
    throw Error("Cant upsert");
  }
  try {
    // Connect to the MongoDB server
    await client.connect();

    // Select the database
    const db = client.db(process.env.DATABASE_NAME);

    // Define the collection
    const collection = db.collection("users");
    // collection.createIndex({ "userNonce": 1 }, { unique: true });

    const user = await collection.findOne({ userNonce: userNonce });

    if (user) {
      await collection.updateOne(
        { userNonce: userNonce },
        { $addToSet: { photos: `${userNonce}/${photoId}` } }
      );
    } else {
      // User does not exist, create user with the photoId in the photos array
      await collection.insertOne({
        userNonce: userNonce,
        photos: [`${userNonce}/${photoId}`],
      });
    }
    client.close();
    return "OK"; // Return the found document or null if not found
  } catch (err) {
    console.log("trying again...", numTry);
    upsertAndAddImage(userNonce, photoId, numTry + 1);
    // return res.status(404).json("Not found");
  }
};

function cleanPhoneNumber(input) {
  // Remove all non-numeric characters
  const cleanedNumber = input.replace(/\D/g, "");

  // Check if the number starts with +1 and remove it
  if (cleanedNumber.startsWith("1")) {
    return cleanedNumber.slice(1);
  }

  return cleanedNumber;
}

const addImageToReviewer = async (reviewerId, file) => {
  const uid = Math.floor(100000 + Math.random() * 900000);
  const params = {
    Bucket: "rmhassets",
    Key: `${reviewerId}/${uid}`,
    Body: file.buffer,
  };
  const data = await s3.upload(params).promise();
  console.log("File uploaded successfully:", data.Location);
  // Connect to the MongoDB server
  await client.connect();
  const db = client.db(process.env.DATABASE_NAME);
  const collection = db.collection("reviewers");

  await collection.updateOne(
    { _id: new ObjectId(reviewerId) },
    { $addToSet: { profilePictures: data.Location } }
  );

  client.close();
  return data.Location; // Return the found document or null if not found
};

const removeImageFromReviewer = async (reviewerId, url) => {
  await client.connect();
  const db = client.db(process.env.DATABASE_NAME);
  const collection = db.collection("reviewers");

  const data = await collection.updateOne(
    { _id: new ObjectId(reviewerId) },
    { $pull: { profilePictures: url } }
  );

  client.close();
  return "OK"; // Return the found document or null if not found
};

module.exports = {
  findReviewerById,
  cleanPhoneNumber,
  createStripeIntent,
  findOrCreateCustomer,
  sendReviewEmails,
  upsertAndAddImage,
  findAllReviewers,
  updateReviewer,
  addImageToReviewer,
  removeImageFromReviewer,
  updateReviewerBalance,
  createWithdrawl,
  
};
