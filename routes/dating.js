var express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const multer = require("multer");
const jwt = require("jsonwebtoken");
const { authenticateJWT } = require("../middleware/auth");

const AWS = require("aws-sdk");

const sgMail = require("@sendgrid/mail");
const {
  findOrCreateCustomer,
  sendReviewEmails,
  upsertAndAddImage,
  findReviewerById,
  updateReviewerBalance,
  createStripeIntent,
  findAllReviewers,
  cleanPhoneNumber,
  addImageToReviewer,
  removeImageFromReviewer,
  createWithdrawl,
  updateReviewer,
  getAdminFeed,
  sendSMS
} = require("../services/dating");
// const stripe = require("stripe")(process.env.STRIPE_KEY);
const stripe = require("stripe")(
  process.env.STRIPE_KEY
);
// const stripe = require("stripe")(
//   "sk_test_51Nss04GHPuCVsE3X4VQ3KMTgVUQ0dtxMBxAkqXMM3F8lqJnQVLNx11yBxsWPgRCOdlDSrMUNtwuRsQ9ZgPSxE5AS00u8nxxXan"
// );
const uri = `mongodb+srv://vincenthuusa:${process.env.MONGO_PASSWORD}@cluster0.szamis3.mongodb.net/`;

const upload = multer();

AWS.config.update({
  accessKeyId: process.env.AWS_ID,
  secretAccessKey: process.env.AWS_KEY,
  region: "us-east-2",
});

const s3 = new AWS.S3();

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

var router = express.Router();

router.post(
  "/photo_upload",
  upload.single("file"),
  async function (req, res, next) {
    const file = req.file;
    const uid = req.body.uid;
    const userNonce = req.body.userNonce.toString();

    const params = {
      Bucket: "rmhassets",
      Key: `${userNonce}/${uid}`,
      Body: file.buffer,
    };
    await findOrCreateCustomer(userNonce);

    try {
      const data = await s3.upload(params).promise();
      console.log("File uploaded successfully:", data.Location);
      await upsertAndAddImage(userNonce, uid);
      res.json({
        source: data.Location,
      });
    } catch (err) {
      res.status(500).send("Error uploading file to S3");
    }
  }
);

router.post("/submit", async function (req, res, next) {
  const userNonce = req.body.userNonce.toString();
  const { userMessage, priceTier } = req.body;
  const reviewerId = req.body.reviewerId;
  console.log(req.body);
  try {
    // Connect to the MongoDB server
    const client = new MongoClient(uri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
    });
    await client.connect();

    // Select the database
    const db = client.db(process.env.DATABASE_NAME);

    // Define the collection
    const collection = db.collection("users");

    await collection.updateOne(
      { userNonce: userNonce }, // Match the user based on userNonce
      {
        $set: {
          userMessage: userMessage,
          reviewerId: new ObjectId(reviewerId),
          priceTier,
        },
      } // Add or update the userMessage field
    );

    client.close();
    return res.json("OK"); // Return the found document or null if not found
  } catch (err) {
    console.error("Error fetching:", err);
    return res.status(404).json("Not found");
  }
});

router.post("/photo_delete", async function (req, res, next) {
  const uid = req.body.uid;
  const userNonce = req.body.userNonce.toString();

  try {
    // Connect to the MongoDB server
    const client = new MongoClient(uri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
    });
    await client.connect();

    // Select the database
    const db = client.db(process.env.DATABASE_NAME);

    // Define the collection
    const collection = db.collection("users");

    console.log(`${userNonce}/${uid}`);
    const data = await collection.updateOne(
      { userNonce: userNonce.toString() },
      { $pull: { photos: `${userNonce}/${uid}` } }
    );
    console.log(data);
    client.close();
    return res.json("OK"); // Return the found document or null if not found
  } catch (err) {
    console.error("Error fetching:", err);
    return res.status(404).json("Not found");
  }
});

router.get("/review/:userNonce", async function (req, res, next) {
  try {
    // Connect to the MongoDB server
    const client = new MongoClient(uri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
    });
    await client.connect();

    // Select the database
    const db = client.db(process.env.DATABASE_NAME);

    // Define the collection
    const collection = db.collection("users");
    const reviewerCollection = db.collection("reviewers");
    console.log(req.params.userNonce);
    const user = await collection.findOne({
      userNonce: req.params.userNonce.toString(),
    });
    const reviewer = await reviewerCollection.findOne({
      _id: new ObjectId(user.reviewerId),
    });

    user["reviewerData"] = {
      name: reviewer.name,
      profilePicture: reviewer.profilePicture,
      profilePictures: reviewer.profilePictures,
      bio: reviewer.bio,
    };
    client.close();
    return res.json(user); // Return the found document or null if not found
  } catch (err) {
    console.error("Error fetching:", err);
    return res.status(404).json("Not found");
  }
});

router.get("/get_checkout/:price_id", async function (req, res, next) {
  const price_id = req.params.price_id;
  const userNonce = req.query.userNonce.toString();
  const customer = await findOrCreateCustomer(userNonce);
  const session = await stripe.checkout.sessions.create({
    customer: customer.id,
    success_url: "https://reviewmyhinge.com/confirmation",
    line_items: [{ price: price_id, quantity: 1 }],
    mode: "payment",
  });
  res.json(session.url);
});

// BELOW HERE IS REVIEWER CODE
/*
========================
*/
router.get("/reviewer_feed/:id", async function (req, res, next) {
  try {
    const client = new MongoClient(uri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
    });

    await client.connect();
    const db = client.db(process.env.DATABASE_NAME);
    const collection = db.collection("users");

    const result = await collection
      .aggregate([
        {
          $match: {
            reviewerId: new ObjectId(req.params.id),
            paid: true,
            isReviewed: { $exists: false },
            isAdminApproved: { $exists: true },
          },
        },
        // { $match: { paid: true } },
        { $sort: { paid_at: -1 } },
      ])
      .toArray();
    client.close();
    return res.json(result); // Return the found document or null if not found
  } catch (err) {
    console.error("Error fetching:", err);
    return res.status(404).json("Not found");
  }
});

// REVIEWER DOES THIS TO RATE A POST
router.post(
  "/review/:userNonce",
  upload.single("file"),
  async function (req, res, next) {
    try {
      // Connect to the MongoDB server
      const client = new MongoClient(uri, {
        serverApi: {
          version: ServerApiVersion.v1,
          strict: true,
          deprecationErrors: true,
        },
      });
      await client.connect();
      const data = req.body;
      const file = req.file;

      // Select the database
      const db = client.db(process.env.DATABASE_NAME);
      if (req.file) {
        // upload file and add videoUrl to data
        const params = {
          Bucket: "rmhassets",
          Key: `${req.params.userNonce}/${file.originalname}`,
          Body: file.buffer,
        };
        const uploadData = await s3.upload(params).promise();
        const fileLocation = uploadData.Location;
        data["audioUrl"] = fileLocation;
      }

      // Define the collection
      console.log("DATA TO SAVE", data);
      const collection = db.collection("users");
      const reviewerCollection = db.collection("reviewers");
      const originalUser = await collection.findOneAndUpdate(
        { userNonce: req.params.userNonce },
        {
          $set: { reviewData: data, isReviewed: true, reviewedAt: new Date() },
        },
        { returnOriginal: true }
      );

      if (!originalUser.isReviewed) {
        await updateReviewerBalance(originalUser);
      }

      const user = await collection.findOne({
        userNonce: req.params.userNonce,
      });
      await sendReviewEmails(req.params.userNonce, user.email);
      client.close();
      return res.json("OK"); // Return the found document or null if not found
    } catch (err) {
      console.error("Error fetching:", err);
      return res.status(404).json("Not found");
    }
  }
);

router.get("/signup/:code", async function (req, res, next) {
  try {
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

    const reviewer = await collection.findOne({
      signupCode: req.params.code.toString(),
    });
    if (!reviewer || reviewer.phoneNumber) {
      throw Error("Doesnt exist");
    }
    client.close();
    delete reviewer.phoneNumber;
    return res.json(reviewer); // Return the found document or null if not found
  } catch (err) {
    console.error("Error fetching:", err);
    return res.status(404).json("Not found");
  }
});

router.get("/reviewer/:id", async function (req, res, next) {
  try {
    const id = req.params.id;
    const reviewer = await findReviewerById(id);
    delete reviewer.phoneNumber;
    // delete reviewer.signupCode;
    return res.json(reviewer); // Return the found document or null if not found
  } catch (err) {
    console.error("Error fetching:", err);
    return res.status(404).json("Not found");
  }
});
router.get("/reviewer_list", async function (req, res, next) {
  try {
    const reviewers = await findAllReviewers();
    return res.json(reviewers); // Return the found document or null if not found
  } catch (err) {
    console.error("Error fetching:", err);
    return res.status(404).json("Not found");
  }
});

router.post(
  "/reviewer/link_bank/:id",
  authenticateJWT,
  async function (req, res, next) {
    const account = await stripe.accounts.create({
      type: "express",
      business_type: "individual",
      metadata: {
        reviewerId: req.params.id,
      },
    });
    const accountId = account.id;
    await updateReviewer(req.params.id, accountId);

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: "https://reviewmyhinge.com",
      return_url: "https://reviewmyhinge.com/login",
      type: "account_onboarding",
    });

    res.json(accountLink.url);
  }
);

router.post(
  "/reviewer/update/:id",
  upload.single("file"),
  authenticateJWT,
  async function (req, res, next) {
    try {
      const file = req.file;
      if (req.file) {
        const params = {
          Bucket: "rmhassets",
          Key: `${req.params.id}/${Math.floor(
            100000 + Math.random() * 900000
          )}`,
          Body: file.buffer,
        };
        const data = await s3.upload(params).promise();
        const fileLocation = data.Location;
        req.body.profilePicture = fileLocation;
        req.body.isComplete = true;
      }
      const user_id = new ObjectId(req.params.id);
      // just make a new price_id for each
      if (req.body.priceTiers) {
        for (const i in req.body.priceTiers) {
          const tier = req.body.priceTiers[i];
          const price = await stripe.prices.create({
            unit_amount: parseInt(tier.price) * 100,
            currency: "usd",
            product: "prod_OhgOM3HcCW379M",
            // product: "prod_OgEUJxSxQBQpGv", // for test
          });
          req.body.priceTiers[i].price_id = price.id;
        }
      }
      if (req.body.phoneNumber) {
        req.body.phoneNumber = cleanPhoneNumber(req.body.phoneNumber);
      } else {
        delete req.body.phoneNumber;
      }

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
      if (req.body.username) {
        // check if username exists
        const doesUserExist = await collection.findOne({
          username: req.body.username,
          _id: { $ne: user_id },
        });
        if (doesUserExist) {
          return res.status(500).json("Username already exists");
        }
      }
      const reviewer = await collection.findOneAndUpdate(
        { _id: user_id },
        { $set: req.body },
        { returnOriginal: false }
      );
      console.log("DONE", reviewer);
      client.close();
      return res.json(reviewer); // Return the found document or null if not found
    } catch (err) {
      console.error("Error fetching:", err);
      return res.status(404).json("Not found");
    }
  }
);

router.post("/reviewer/reviewer_send_code", async function (req, res, next) {
  try {
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
    const loginCode = Math.floor(100000 + Math.random() * 900000);

    const cleanNumber = cleanPhoneNumber(req.body.phoneNumber);
    if (req.body.signupCode) {
      await collection.updateOne(
        { signupCode: req.body.signupCode },
        { $set: { phoneNumber: cleanNumber } }
      );
    }
    const query = req.body.signupCode
      ? { signupCode: req.body.signupCode }
      : { phoneNumber: req.body.phoneNumber };
    const reviewer = await collection.findOne(query);
    if (!reviewer) {
      throw Error("Doesnt exist");
    }

    await collection.findOneAndUpdate(
      { phoneNumber: cleanNumber },
      {
        $set: { loginCode },
      },
      { returnOriginal: false }
    );

    const sdk = new ByteFlow(process.env.SMS_KEY);

    await sdk.sendMessage({
      message_content: `Your login code for ReviewMyHinge is ${loginCode}`,
      destination_number: `+1${cleanNumber}`,
    });

    client.close();
    return res.json("OK"); // Return the found document or null if not found
  } catch (err) {
    console.error("Error fetching:", err);
    return res.status(404).json("Not found");
  }
});

router.post("/reviewer/login", async function (req, res, next) {
  try {
    const client = new MongoClient(uri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
    });
    await client.connect();
    const loginCode = req.body.loginCode.toString();
    const db = client.db(process.env.DATABASE_NAME);
    const collection = db.collection("reviewers");
    const cleanNumber = cleanPhoneNumber(req.body.phoneNumber);
    const reviewer = await collection.findOne({
      phoneNumber: cleanNumber,
    });
    if (!reviewer) {
      throw Error("Doesnt exist");
    }
    if (loginCode !== reviewer.loginCode.toString()) {
      throw Error("wrong code");
    }
    await collection.findOneAndUpdate(
      { phoneNumber: cleanNumber },
      {
        $set: { loginCode: "" },
      },
      { returnOriginal: false }
    );

    var token = jwt.sign(
      JSON.parse(JSON.stringify(reviewer)),
      process.env.JWT_KEY,
      { expiresIn: 86400 * 30 * 30 * 30 }
    );

    client.close();
    return res.json({ jwt: token, reviewer }); // Return the found document or null if not found
  } catch (err) {
    console.error("Error fetching:", err);
    return res.status(404).json("Not found");
  }
});

router.post(
  "/reviewer/photo_upload/:id",
  upload.single("file"),
  async function (req, res, next) {
    try {
      const file = req.file;
      const url = await addImageToReviewer(req.params.id, file);
      res.json(url);
    } catch (err) {
      res.status(500).json("Error");
    }
  }
);

router.post(
  "/reviewer/photo_remove/:id",
  upload.single("file"),
  async function (req, res, next) {
    try {
      await removeImageFromReviewer(req.params.id, req.body.url);
      res.json("OK");
    } catch (err) {
      res.status(500).json("Error");
    }
  }
);

router.post(
  "/reviewer/withdrawl/:id",
  authenticateJWT,
  async function (req, res, next) {
    try {
      await createWithdrawl(req.params.id);
      res.json("OK");
    } catch {
      res.status(500).json("Error");
    }
  }
);

router.get("/admin_feed", authenticateJWT, async function (req, res, next) {
  try {
    const client = new MongoClient(uri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
    });

    await client.connect();
    const db = client.db(process.env.DATABASE_NAME);
    const collection = db.collection("users");
    const query = {
      isAdminApproved: { $exists: false },
      paid: true,
      isReviewed: { $exists: false },
      isDenied: { $exists: false },
    };
    const result = await collection.find(query).toArray();
    console.log(result.length);
    client.close();
    return res.json(result); // Return the found document or null if not found
  } catch (err) {
    console.error("Error fetching:", err);
    return res.status(404).json("Not found");
  }
});

router.post("/admin_feed", authenticateJWT, async function (req, res, next) {
  const { decision, nonce } = req.body;
  try {
    const client = new MongoClient(uri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
    });

    await client.connect();
    const db = client.db(process.env.DATABASE_NAME);
    const collection = db.collection("users");
    const query = { userNonce: nonce };

    // Set isAdminApproved to true
    // const user = await collection.updateOne(
    //   query,
    // decision
    //   ? { $set: { isAdminApproved: true } }
    //   : { $set: { isDenied: true } }
    // );
    const user = await collection.findOneAndUpdate(
      { userNonce: nonce },
      decision
        ? { $set: { isAdminApproved: true } }
        : { $set: { isDenied: true } },
      { returnOriginal: false }
    );

    const reviewerCollection = db.collection("reviewers");
    const reviewer = await reviewerCollection.findOne({
      _id: user.reviewerId,
    });
    const reveiwerPhone = reviewer.phoneNumber;
    // TODO: NEED TO REPLACE
    const sdk = new ByteFlow(process.env.SMS_KEY);

    if (decision) {
      await sdk.sendMessage({
        message_content: `You have a new Hinge to review. Review and get paid $${user.priceTier.price}. Use link https://reviewmyhinge.com/reviewer/rate/${userNonce}`,
        destination_number: `+1${cleanPhoneNumber(reveiwerPhone)}`,
      });
    }
    client.close();
    return res.json("OK"); // Return the found document or null if not found
  } catch (err) {
    console.error("Error fetching:", err);
    return res.status(404).json("Not found");
  }
});

module.exports = router;