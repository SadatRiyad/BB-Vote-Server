const express = require("express");
const { sendVerificationEmail } = require("./Email.js");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
require("dotenv").config();
const app = express();
const port = process.env.PORT || 5000;
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.efrqq6z.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// socket.io
const http = require("http");
const socketIo = require("socket.io");
const server = http.createServer(app);
const io = socketIo(server);

io.on("connection", (socket) => {
  console.log("A user connected.");

  socket.on("disconnect", () => {
    console.log("A user disconnected.");
  });
});

// socket.io end
// Let's create a cookie options for both production and local server
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
};
//localhost:5000 and localhost:5173 are treated as same site.  so sameSite value must be strict in development server.  in production sameSite will be none
// in development server secure will false .  in production secure will be true

// middleware
app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      // "https://bb-vote-sadatriyad.surge.sh",
      // "https://bb-vote.netlify.app",
      // "https://binarybeasts-auth.web.app",
    ],
    credentials: true,
  })
);

// Routes
app.get("/", (req, res) => {
  res.send("BB-Vote server is running");
});

async function run() {
  try {
    // await client.connect();
    // Database Collections
    const db = client.db("BB-VoteDB");
    const OTPSCollection = db.collection("OTPS");
    const ElectionsCollection = db.collection("Elections");
    const VotesCollection = db.collection("Votes");
    const UsersCollection = db.collection("Users");
    const CandidatesCollection = db.collection("Candidates");
    const userReviewsCollection = db.collection("userReviews");
    const ContactUsCollection = db.collection("ContactUs");
    const ContactRequestsCollection = db.collection("ContactRequests");

    // verifyToken
    const verifyToken = (req, res, next) => {
      const token = req.cookies?.token;
      // console.log("value inside verifyToken", token);
      if (!token) {
        return res.status(401).send({ error: "Unauthorized" });
      }
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          // console.log(err);
          return res.status(401).send({ error: "Unauthorized" });
        }
        // console.log("value in the token", decoded);
        req.user = decoded;
        next();
      });
    };

    // use verify admin after verifyToken
    const verifyAdmin = async (req, res, next) => {
      const email = req.user.email;
      try {
        const query = { email: email };
        const user = await UsersCollection.findOne(query);
        if (!user || user.role !== "admin") {
          return res.status(403).json({ error: "Forbidden Access" });
        }
        next(); // Proceed to the next middleware or route handler
      } catch (error) {
        console.error("Error verifying admin status:", error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    };

    // send otp 6 digit and save in OTPSCollection if email are same then update the otp using Patch method
    app.post("/send-otp", async (req, res) => {
      const { email, otpPurpose } = req.body;

      // Check if user exists in UsersCollection
      const existingUser = await UsersCollection.findOne({ email });

      if (existingUser && otpPurpose === "register") {
        return res.status(400).send({
          success: false,
          message: "User already exists. Please login instead.",
        });
      }

      if (!existingUser && otpPurpose === "login") {
        return res.status(404).send({
          success: false,
          message: "User not found. Please register first.",
        });
      }

      const otp = Math.floor(100000 + Math.random() * 900000);
      const otpData = {
        email,
        otp,
        otpPurpose,
        otpStatus: "pending",
        otpSentAt: new Date().toLocaleString("en-US", {
          timeZone: "Asia/Dhaka",
        }),
        otpExpiredAt: new Date(Date.now() + 5 * 60000).toLocaleString("en-US", {
          timeZone: "Asia/Dhaka",
        }),
      };

      const result = await OTPSCollection.insertOne(otpData);
      await sendVerificationEmail(email, otp);
      console.log("OTP sent successfully:", otp);
      res
        .send({
          success: true,
          message:
            "OTP sent successfully. Please check your email. OTP is valid for 5 minutes.",
        })
        .status(200);
    });

    // verify otp
    app.post("/verify-otp", async (req, res) => {
      const { email, otp } = req.body;
      const query = {
        email: email,
        otpStatus: "pending",
      };
      const latestOTP = await OTPSCollection.findOne(query, {
        sort: { otpSentAt: -1 },
      });
      // console.log(latestOTP);

      if (!latestOTP) {
        return res.status(404).json({ error: "OTP not matched with email" });
      }

      if (latestOTP.otp !== parseInt(otp)) {
        return res.status(400).json({ error: "Invalid OTP" });
      }
      if (latestOTP.email !== email) {
        return res.status(400).json({ error: "Email and OTP do not match" });
      }

      const currentTime = new Date();
      const otpExpiredAt = new Date(latestOTP.otpExpiredAt);
      if (isNaN(otpExpiredAt.getTime())) {
        // If the date is invalid, parse it manually
        const [datePart, timePart] = latestOTP.otpExpiredAt.split(", ");
        const [month, day, year] = datePart.split("/");
        const [time, period] = timePart.split(" ");
        let [hours, minutes, seconds] = time.split(":");

        if (period === "PM" && hours !== "12") {
          hours = parseInt(hours) + 12;
        }
        if (period === "AM" && hours === "12") {
          hours = "00";
        }

        const formattedDate = `${year}-${month.padStart(2, "0")}-${day.padStart(
          2,
          "0"
        )}T${hours.padStart(2, "0")}:${minutes.padStart(
          2,
          "0"
        )}:${seconds.padStart(2, "0")}`;
        otpExpiredAt = new Date(formattedDate);
      }

      if (otpExpiredAt < currentTime) {
        return res.status(400).json({ error: "OTP has expired" });
      }

      // Update OTP status to used
      await OTPSCollection.updateOne(
        { _id: latestOTP._id },
        { $set: { otpStatus: "used" } }
      );

      return res
        .status(200)
        .json({ success: true, message: "OTP verified successfully" });
    });

    // userReviews related api
    app.get("/userReviews", async (req, res) => {
      const result = await userReviewsCollection.find().toArray();
      res.send(result);
    });
    // get userReviews by email
    app.get("/userReviews/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const result = await userReviewsCollection.findOne({ email });
      res.send(result);
    });
    // post userReviews
    app.post("/userReviews", verifyToken, async (req, res) => {
      const review = req.body;
      const result = await userReviewsCollection.insertOne(review);
      res.send(result);
    });
    // put userReviews by email
    app.put("/userReviews/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const updatedReview = req.body;
      // Remove the _id field from the updatedReview object
      const { _id, ...updateData } = updatedReview;

      const result = await userReviewsCollection.updateOne(
        { email },
        { $set: updateData }
      );
      res.send(result);
    });

    // delete userReviews by _id by admin
    app.delete(
      "/userReviews/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await userReviewsCollection.deleteOne(query);
        res.send(result);
      }
    );

    // users related api
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await UsersCollection.find().toArray();
      res.send(result);
    });

    app.get("/users/search", verifyToken, verifyAdmin, async (req, res) => {
      const { username } = req.query;
      const query = { name: { $regex: username, $options: "i" } };
      const users = await UsersCollection.find(query).toArray();
      res.send(users);
    });

    // get user by email
    app.get("/users/email/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      if (req.user.email !== req.params.email) {
        return res.status(403).send({ error: "Forbidden Access" });
      }
      const query = { email: email };
      const user = await UsersCollection.findOne(query);
      res.send(user);
    });

    // check role isAdmin
    app.get("/users/admin/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      try {
        const query = { email: email };
        const user = await UsersCollection.findOne(query);
        const isAdmin = user?.role === "admin";
        res.send({ isAdmin });
      } catch (error) {
        console.error("Error checking admin status:", error);
        res
          .status(500)
          .send({ isAdmin: false, error: "Internal Server Error" });
      }
    });

    // post users
    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await UsersCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "user already exists", insertedId: null });
      }
      const result = await UsersCollection.insertOne(user);
      res.send(result);
    });

    // patch isCandidate true using email
    app.patch("/users/candidate/:email", verifyToken, async (req, res) => {
      const email = req.params.email; // Ensure this retrieves the email correctly
      const filter = { email: email };
      const updatedDoc = {
        $set: {
          isCandidate: true,
        },
      };

      const result = await UsersCollection.updateOne(filter, updatedDoc);
      // console.log(`Update result:`, result); // Debugging log
      res.send(result);
    });

    // patch role admin
    app.patch(
      "/users/admin/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            role: "admin",
          },
        };
        const result = await UsersCollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );

    // patch isPremium true
    app.patch(
      "/users/premium/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            isPremium: true,
          },
        };
        const result = await UsersCollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );

    // delete user
    app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await UsersCollection.deleteOne(query);
      res.send(result);
    });

    // put favorites by email
    app.put("/users/favorites/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const { ID, CandidateID, name, party, position, partyImage } = req.body;
      const favorite = {
        id: new ObjectId(),
        ID,
        CandidateID,
        name,
        party,
        position,
        partyImage,
      };
      const query = { email: email };
      const user = await UsersCollection.findOne(query);
      if (!user) {
        return res.status(404).send({ message: "user not found" });
      }
      const filter = { email: email };
      const updatedDoc = {
        $push: { favorites: favorite },
        $inc: { favoritesCount: 1 },
      };
      const result = await UsersCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    // delete favorites by email
    app.delete("/users/favorites/:email/:id", verifyToken, async (req, res) => {
      const email = req.params.email;
      const id = req.params.id;
      const query = { email: email };
      const user = await UsersCollection.findOne(query);
      if (!user) {
        return res.status(404).send({ message: "user not found" });
      }
      const filter = { email: email };
      const updatedDoc = {
        $pull: { favorites: { id: new ObjectId(id) } },
        $inc: { favoritesCount: -1 }, // Decrement favorites count
      };
      const result = await UsersCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    // get favorites by email
    app.get("/users/favorites/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      if (req.user.email !== req.params.email) {
        return res.status(403).send({ error: "Forbidden Access" });
      }
      const query = { email: email };
      const user = await UsersCollection.findOne(query);
      // console.log(user)
      res.send(user.favorites);
    });

    // Get all the data from the collection
    app.get("/Candidates", verifyToken, async (req, res) => {
      const data = CandidatesCollection.find().sort({ CandidateID: -1 });
      const result = await data.toArray();
      res.send(result);
    });

    /////////////

    // Submit a Vote
    app.post("/elections/:id/vote", verifyToken, async (req, res) => {
      const electionId = req.params.id;
      const { candidateId } = req.body;

      try {
        const existingVote = await VotesCollection.findOne({
          userId: req.user._id,
          electionId,
        });
        if (existingVote) {
          return res
            .status(400)
            .json({ success: false, message: "You have already voted." });
        }

        const vote = {
          userId: req.user._id,
          electionId,
          candidateId,
          votedAt: new Date(),
        };
        await VotesCollection.insertOne(vote);

        res
          .status(201)
          .json({ success: true, message: "Vote submitted successfully." });
      } catch (error) {
        console.error("Error submitting vote:", error);
        res
          .status(500)
          .json({ success: false, message: "Failed to submit vote." });
      }
    });

    ///////////////////

    // Get all the candidates for a specific election
    app.get("/elections/:id/candidates", verifyToken, async (req, res) => {
      const electionId = req.params.id;

      try {
        const election = await ElectionsCollection.findOne({
          _id: new ObjectId(electionId),
        });
        if (!election) {
          return res
            .status(404)
            .json({ success: false, message: "Election not found." });
        }

        const data = CandidatesCollection.find({status: "Active"}).sort({ CandidateID: -1 });
        const result = await data.toArray();
        res.status(200).json({ success: true, result });
      } catch (error) {
        console.error("Error fetching candidates:", error);
        res
          .status(500)
          .json({ success: false, message: "Failed to fetch candidates." });
      }
    });

    // Post Vote
    app.post("/Candidate", verifyToken, async (req, res) => {
      const Candidate = req.body;
      const result = await CandidatesCollection.insertOne(Candidate);
      res.send(result);
    });

    app.post("/elections/vote/:id", verifyToken, async (req, res) => {
      try {
        const { candidateId, userId } = req.body;
        const electionId = req.params.id;

        // Ensure candidateId is an ObjectId
        const candidateObjectId = new ObjectId(candidateId);

        // Check if the user has already voted in this election before check both userId and electionId if both are same then user already voted
        const existingVote = await VotesCollection.findOne({
          userId,
          electionId: new ObjectId(electionId),
        });
        
        if (existingVote) {
          return res.status(400).json({
            success: false,
            message: "You have already voted.",
          });
        }

        // Verify the candidate exists 
        const candidate = await CandidatesCollection.findOne({
          _id: candidateObjectId,
        });
        if (!candidate) {
          return res.status(404).json({
            success: false,
            message: "Candidate not found.",
          });
        }

        const vote = {
          userId,
          candidateId: candidateObjectId,
          electionId: new ObjectId(electionId),
          // bd time zone
          votedAt: new Date().toLocaleString("en-US", {
            timeZone: "Asia/Dhaka",
          }),
        };
        await VotesCollection.insertOne(vote);

        // Emit real-time updates
        const results = await CandidatesCollection.find().toArray();
        io.emit("voteUpdate", results);

        res
          .status(200)
          .json({ success: true, message: "Vote submitted successfully!" });
      } catch (error) {
        console.error("Error submitting vote:", error);
        res.status(500).json({
          success: false,
          message: "An error occurred while submitting the vote.",
        });
      }
    });

    // check if user has already voted in a specific election
    app.get("/elections/:id/votes/:userId", verifyToken, async (req, res) => {
      const { id, userId } = req.params;
      const query = {
        electionId: new ObjectId(id),
        userId,
      };
      const vote = await VotesCollection.findOne(query);
      if (vote) {
        // if vote then find the candidate with the candidateId and return the candidate full data
        const candidate = await CandidatesCollection.findOne({
          _id: vote.candidateId,
        });
        if (candidate) {
          return res.status(200).json({ voted: true, candidate });
        }
        return res.status(404).json({ error: "Candidate not found" });
      }
      res.status(200).json({ voted: false });
      });


    // Backend API to fetch voting results
    app.get("/elections/:id/results", verifyToken, async (req, res) => {
      const electionId = new ObjectId(req.params.id);
      console.log("Election ID:", electionId);
  
      try {
          const results = await VotesCollection.aggregate([
              { $match: { electionId } },
              { $group: { _id: "$candidateId", votes: { $sum: 1 } } },
              { $sort: { votes: -1 } },
              {
                  $lookup: {
                      from: "Candidates",
                      localField: "_id",
                      foreignField: "_id",
                      as: "candidate",
                  },
              },
              { $unwind: { path: "$candidate" } },
              {
                  $project: {
                      _id: 0,
                      candidateId: "$_id",
                      votes: 1, // Keeps the calculated votes
                      name: "$candidate.name",
                      party: "$candidate.party",
                      status: "$candidate.status",
                  },
              },
          ]).toArray();
  
          console.log("Results:", results);
          res.status(200).json({ success: true, results });
      } catch (error) {
          console.error("Error fetching results:", error);
          res.status(500).json({ success: false, message: "Failed to fetch results." });
      }
  });
  
  
    // GET /Candidate/results
    // app.get("/Candidate/results", verifyToken, async (req, res) => {
    //   try {
    //     // Aggregate votes for each candidate
    //     const results = await CandidatesCollection.aggregate([
    //       {
    //         $lookup: {
    //           from: "Votes", // Replace with the name of your votes collection
    //           localField: "_id", // Match the candidate's _id field with the foreignField
    //           foreignField: "candidateId", // Match with the candidateId in the votes collection
    //           as: "votes",
    //         },
    //       },
    //       {
    //         $project: {
    //           name: 1, // Candidate name
    //           party: 1, // Candidate party
    //           votesCount: { $size: "$votes" }, // Count the number of votes for each candidate
    //         },
    //       },
    //       {
    //         $sort: { votesCount: -1 }, // Sort the results by votesCount in descending order
    //       },
    //     ]).toArray();

    //     // Return the results as JSON
    //     res.status(200).json({
    //       success: true,
    //       results: results, // Send the aggregated data
    //     });
    //   } catch (error) {
    //     console.error("Error fetching results:", error);
    //     res.status(500).json({
    //       success: false,
    //       message: "Failed to fetch results.",
    //     });
    //   }
    // });

    // get Candidate by id
    app.get("/Candidate/:id", verifyToken, async (req, res) => {
      try {
        const CandidateID = req.params.id; // Capture the parameter as a string

        const data = await CandidatesCollection.findOne({
          CandidateID: CandidateID,
        });

        if (!data) {
          return res.status(404).send({ error: "Vote not found" });
        }

        res.send(data);
      } catch (error) {
        console.error("Error fetching Vote:", error);
        res.status(500).send({ error: "Internal Server Error" });
      }
    });

    // put Candidate by id
    app.put("/Candidate/id/:id", verifyToken, async (req, res) => {
      const data = req.body;
      const { _id, ...updateData } = data;
      const result = await CandidatesCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: updateData },
        { upsert: true }
      );
      res.send(result);
    });
    // get Candidate by email
    app.get("/Candidate/email/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const data = await CandidatesCollection.findOne({ email });
      res.send(data);
    });

    // delete Candidate by id
    app.delete("/Candidate/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await CandidatesCollection.deleteOne(query);
      res.send(result);
    });

    //................................................//

    // Election Management APIs
    app.get("/elections", verifyToken, async (req, res) => {
      try {
        const elections = await ElectionsCollection.find().toArray();
        res.status(200).json({ success: true, elections });
      } catch (error) {
        console.error("Error fetching elections:", error);
        res
          .status(500)
          .json({ success: false, message: "Failed to fetch elections." });
      }
    });

    // app.post("/elections", verifyToken, verifyAdmin, async (req, res) => {
    //   const { name, startDate, endDate, status } = req.body;

    //   if (!name || !startDate || !endDate || !status) {
    //     return res
    //       .status(400)
    //       .json({ success: false, message: "All fields are required." });
    //   }

    //   try {
    //     const newElection = {
    //       name,
    //       startDate: new Date(startDate),
    //       endDate: new Date(endDate),
    //       status,
    //     };
    //     const result = await ElectionsCollection.insertOne(newElection);
    //     res.status(201).json({ success: true, election: result.ops[0] });
    //   } catch (error) {
    //     console.error("Error creating election:", error);
    //     res
    //       .status(500)
    //       .json({ success: false, message: "Failed to create election." });
    //   }
    // });

    app.post("/elections", verifyToken, verifyAdmin, async (req, res) => {
      const { name, startDate, endDate, status } = req.body;

      console.log("Received Payload:", req.body); // Debugging log

      // Validate input
      if (!name || !startDate || !endDate || !status) {
        return res
          .status(400)
          .json({ success: false, message: "All fields are required." });
      }

      try {
        const newElection = {
          name,
          startDate: new Date(startDate),
          endDate: new Date(endDate),
          status,
        };

        // Insert the new election into the database
        const result = await ElectionsCollection.insertOne(newElection);

        if (result.acknowledged) {
          res.status(201).json({
            success: true,
            election: { _id: result.insertedId, ...newElection },
          });
        } else {
          throw new Error("Failed to insert election.");
        }
      } catch (error) {
        console.error("Error creating election:", error.message);
        res
          .status(500)
          .json({ success: false, message: "Failed to create election." });
      }
    });

    app.put("/elections/:id", verifyToken, verifyAdmin, async (req, res) => {
      const { id } = req.params;
      const { name, startDate, endDate, status } = req.body;

      try {
        const updatedElection = {
          ...(name && { name }),
          ...(startDate && { startDate: new Date(startDate) }),
          ...(endDate && { endDate: new Date(endDate) }),
          ...(status && { status }),
        };

        const result = await ElectionsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedElection }
        );

        if (result.matchedCount === 0) {
          return res
            .status(404)
            .json({ success: false, message: "Election not found." });
        }

        res
          .status(200)
          .json({ success: true, message: "Election updated successfully." });
      } catch (error) {
        console.error("Error updating election:", error);
        res
          .status(500)
          .json({ success: false, message: "Failed to update election." });
      }
    });

    app.delete("/elections/:id", verifyToken, verifyAdmin, async (req, res) => {
      const { id } = req.params;

      try {
        const result = await ElectionsCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res
            .status(404)
            .json({ success: false, message: "Election not found." });
        }

        res
          .status(200)
          .json({ success: true, message: "Election deleted successfully." });
      } catch (error) {
        console.error("Error deleting election:", error);
        res
          .status(500)
          .json({ success: false, message: "Failed to delete election." });
      }
    });

    //...............................................//

    // get Premium Request by user for Candidate premium
    app.get("/premium-requests", verifyToken, async (req, res) => {
      try {
        const requests = await CandidatesCollection.find({
          isPremium: "pending",
        }).toArray();
        res.json(requests);
      } catch (error) {
        console.error("Error fetching premium requests:", error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    });

    // Make a Candidate premium
    app.patch(
      "/Candidate/:id/make-premium",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const result = await CandidatesCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { isPremium: true } },
            { upsert: true }
          );
          res.json(result);
        } catch (error) {
          console.error("Error making Candidate premium:", error);
          res.status(500).json({ error: "Internal Server Error" });
        }
      }
    );

    // count
    app.get("/counters", async (req, res) => {
      try {
        const totalCandidates = await CandidatesCollection.countDocuments();
        const girlsCandidates = await CandidatesCollection.countDocuments({
          CandidateType: "Female",
        });
        const boysCandidates = await CandidatesCollection.countDocuments({
          CandidateType: "Male",
        });
        const userReviewsCompleted =
          await userReviewsCollection.countDocuments();

        res.json({
          totalCandidates,
          girlsCandidates,
          boysCandidates,
          userReviewsCompleted,
        });
      } catch (error) {
        console.error("Error fetching counters:", error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    });

    // Get counters for the admin dashboard
    app.get("/admin/counters", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const totalCandidates = await CandidatesCollection.countDocuments();
        const maleCandidates = await CandidatesCollection.countDocuments({
          CandidateType: "Male",
        });
        const femaleCandidates = await CandidatesCollection.countDocuments({
          CandidateType: "Female",
        });
        const premiumCandidates = await CandidatesCollection.countDocuments({
          isPremium: true,
        });
        const userReviewsCompleted =
          await userReviewsCollection.countDocuments();
        const totalRevenue = await ContactRequestsCollection.aggregate([
          { $match: { status: "approved" } },
          { $group: { _id: null, total: { $sum: "$amountPaid" } } },
        ]).toArray();

        res.json({
          totalCandidates,
          maleCandidates,
          femaleCandidates,
          premiumCandidates,
          userReviewsCompleted,
          totalRevenue: totalRevenue[0]?.total || 0,
        });
      } catch (error) {
        console.error("Error fetching admin counters:", error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    });

    // post ContactUs section msg
    app.post("/contactus", async (req, res) => {
      const ContactUsMsg = req.body;
      const result = await ContactUsCollection.insertOne(ContactUsMsg);
      res.send(result);
    });

    // Payment Endpoint
    app.post("/payments", verifyToken, async (req, res) => {
      const { amount, paymentMethodId } = req.body;

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount,
          currency: "usd",
          payment_method: paymentMethodId,
          confirm: true,
          automatic_payment_methods: {
            enabled: true,
            allow_redirects: "never",
          },
        });

        res.status(200).json({ success: true, paymentIntent });
      } catch (error) {
        res.status(400).json({ success: false, error: error.message });
      }
    });

    // Contact Request post
    app.post("/contact-requests", verifyToken, async (req, res) => {
      const { CandidateID, selfName, selfEmail } = req.body;

      try {
        const newRequest = {
          CandidateID,
          selfName,
          selfEmail,
          status: "pending",
          amountPaid: 5,
          // date foe asia
          createdAt: new Date().toLocaleString("en-US", {
            timeZone: "Asia/Dhaka",
          }),
        };

        const result = await ContactRequestsCollection.insertOne(newRequest);
        res.status(201).json({ success: true, request: result });
      } catch (error) {
        res.status(400).json({ success: false, error: error.message });
      }
    });

    // Get Contact Requests for User
    app.get("/contact-requests/:email", verifyToken, async (req, res) => {
      const email = req.params.email;

      if (req.user.email !== email) {
        return res.status(403).send({ error: "Forbidden Access" });
      }

      try {
        const requests = await ContactRequestsCollection.find({
          selfEmail: email,
        }).toArray();
        res.status(200).json({ success: true, requests });
      } catch (error) {
        res.status(400).json({ success: false, error: error.message });
      }
    });

    // get contact request which is pending
    app.get("/contact-requests", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const requests = await ContactRequestsCollection.find({
          status: "pending",
        }).toArray();
        res.status(200).json({ success: true, requests });
      } catch (error) {
        res.status(400).json({ success: false, error: error.message });
      }
    });

    // delete Contact Requests for User
    app.delete(
      "/users/ContactRequest/:email/:id",
      verifyToken,
      async (req, res) => {
        const email = req.params.email;
        const id = req.params.id;
        const query = { selfEmail: email, _id: new ObjectId(id) };
        const result = await ContactRequestsCollection.deleteOne(query);
        res.send(result);
      }
    );

    // Approve Contact Request (Admin only)
    app.patch(
      "/contact-requests/approve/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;

        try {
          const result = await ContactRequestsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status: "approved" } }
          );

          res.status(200).json({ success: true, result });
        } catch (error) {
          res.status(400).json({ success: false, error: error.message });
        }
      }
    );
    // cancel Contact Request (Admin only)
    app.patch(
      "/contact-requests/cancel/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;

        try {
          const result = await ContactRequestsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status: "cancelled" } }
          );

          res.status(200).json({ success: true, result });
        } catch (error) {
          res.status(400).json({ success: false, error: error.message });
        }
      }
    );
    // Delete Contact Request (Admin only)
    app.delete(
      "/contact-requests/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        // next
        try {
          const result = await ContactRequestsCollection.deleteOne({
            _id: new ObjectId(id),
          });
          res.status(200).json({ success: true, result });
        } catch (error) {
          res.status(400).json({ success: false, error: error.message });
        }
      }
    );

    //creating Token
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      console.log("user for token", user);
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "7d",
      });
      res.cookie("token", token, cookieOptions).send({ token });
    });

    //clearing Token
    app.post("/logout", async (req, res) => {
      const user = req.body;
      // console.log("logging out", user);
      res
        .clearCookie("token", { ...cookieOptions, maxAge: 0 })
        .send({ success: true });
    });
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.log);

// Listen for incoming requests
app.listen(port, () => console.log(`Server is running on port ${port}`));
