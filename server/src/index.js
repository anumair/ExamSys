const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const multer = require("multer");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("./models/User");
const ExamPackage = require("./models/ExamPackage");
const DecryptLog = require("./models/DecryptLog");
const AnswerSubmission = require("./models/AnswerSubmission");
const AnswerKey = require("./models/AnswerKey");
const ExamResult = require("./models/ExamResult");
const ActionLog = require("./models/ActionLog");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const uploadsDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const upload = multer({ storage });

const packagesDir = path.join(__dirname, "..", "packages");
if (!fs.existsSync(packagesDir)) {
  fs.mkdirSync(packagesDir, { recursive: true });
}

const keysDir = path.join(__dirname, "..", "keys");
if (!fs.existsSync(keysDir)) {
  fs.mkdirSync(keysDir, { recursive: true });
}

const privateKeyPath = path.join(keysDir, "private.pem");
const publicKeyPath = path.join(keysDir, "public.pem");

if (!fs.existsSync(privateKeyPath) || !fs.existsSync(publicKeyPath)) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  fs.writeFileSync(privateKeyPath, privateKey.export({ type: "pkcs8", format: "pem" }));
  fs.writeFileSync(publicKeyPath, publicKey.export({ type: "spki", format: "pem" }));
}

const privateKey = crypto.createPrivateKey(
  fs.readFileSync(privateKeyPath, "utf8")
);
const publicKeyPem = fs.readFileSync(publicKeyPath, "utf8");

const epochTime = new Date(process.env.EPOCH_TIME || "2025-01-01T00:00:00Z");
const stepSizeSeconds = Number(process.env.STEP_SIZE_SECONDS || "300");
const k0Hex =
  process.env.K0_HEX ||
  "9f8c7a1e3d5b6c9a2f4e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a291817161514";
const k0 = Buffer.from(k0Hex, "hex");
if (k0.length !== 32) {
  throw new Error("K0_HEX must be 32 bytes (64 hex chars)");
}
const jwtSecret = process.env.JWT_SECRET || "change_me";

const authenticate = (req, res, next) => {
  const header = req.headers.authorization || "";
  const [type, token] = header.split(" ");
  if (type !== "Bearer" || !token) {
    return res.status(401).json({ error: "Authorization required" });
  }
  try {
    const payload = jwt.verify(token, jwtSecret);
    req.user = payload;
    return next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid token" });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  return next();
};

const logAction = async ({ action, actor, actor_role, exam_id, metadata }) => {
  try {
    await ActionLog.create({
      action,
      actor,
      actor_role,
      exam_id,
      metadata,
    });
  } catch (error) {
    console.error("Failed to write action log", error);
  }
};

const normalizeAnswers = (value) => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const keys = Object.keys(value).sort((a, b) => Number(a) - Number(b));
  const normalized = {};
  keys.forEach((key) => {
    normalized[key] = value[key];
  });
  return normalized;
};

const canonicalizePayload = (payload) => {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const { exam_id, student_id, timestamp, answers } = payload;
  if (!exam_id || !student_id || !timestamp || !answers) {
    return null;
  }
  const normalizedAnswers = normalizeAnswers(answers);
  if (!normalizedAnswers) {
    return null;
  }
  const canonical = {
    exam_id,
    student_id,
    answers: normalizedAnswers,
    timestamp,
  };
  return { canonical, message: JSON.stringify(canonical) };
};

const gradeSubmission = (answers, correctAnswers) => {
  const normalizedAnswers = normalizeAnswers(answers) || {};
  const normalizedCorrect = normalizeAnswers(correctAnswers) || {};
  const keys = Object.keys(normalizedCorrect);
  let score = 0;
  keys.forEach((key) => {
    if (normalizedAnswers[key] === normalizedCorrect[key]) {
      score += 1;
    }
  });
  return { score, total: keys.length };
};

const connectDb = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is not set");
  }
  await mongoose.connect(process.env.MONGO_URI, { dbName: "exam_system" });
};

const sha256 = (data) => crypto.createHash("sha256").update(data).digest();

const evolveKey = (k0, n) => {
  let current = Buffer.from(k0);
  for (let i = 0; i < n; i += 1) {
    current = sha256(current);
  }
  return current;
};

const deriveEncKey = (kn) =>
  crypto.hkdfSync("sha256", kn, Buffer.alloc(0), Buffer.from("exam-encryption"), 32);

app.get("/api/student/packages/:examId", (req, res) => {
  const safeExamId = req.params.examId.replace(/[^a-zA-Z0-9._-]/g, "_");
  const packageFileName = `${safeExamId}_exam_package.enc`;
  const packagePath = path.join(packagesDir, packageFileName);

  if (!fs.existsSync(packagePath)) {
    return res.status(404).json({ error: "Package not found" });
  }

  return res.sendFile(packagePath);
});

app.post("/api/student/decrypt-log", async (req, res) => {
  try {
    const { exam_id, exam_time } = req.body;
    if (!exam_id || !exam_time) {
      return res.status(400).json({ error: "exam_id and exam_time required" });
    }
    const examTimeDate = new Date(exam_time);
    if (Number.isNaN(examTimeDate.getTime())) {
      return res.status(400).json({ error: "Invalid exam_time" });
    }

    const log = await DecryptLog.create({
      exam_id,
      exam_time: examTimeDate,
      decrypted_at: new Date(),
    });
    await logAction({
      action: "exam_decrypted",
      exam_id,
      metadata: { exam_time: examTimeDate.toISOString() },
    });
    return res.status(201).json({ success: true, id: log._id });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/student/submit-answers", authenticate, async (req, res) => {
  try {
    if (req.user?.role !== "student") {
      return res.status(403).json({ error: "Student access required" });
    }
    const { payload, signature } = req.body;
    if (!payload || !signature) {
      return res.status(400).json({ error: "payload and signature required" });
    }

    const student = await User.findById(req.user.sub).select("public_key");
    if (!student || !student.public_key) {
      return res.status(400).json({ error: "Student public key not found" });
    }

    if (payload.student_id !== String(req.user.sub)) {
      return res.status(403).json({ error: "student_id mismatch" });
    }
    const parsedTimestamp = new Date(payload.timestamp);
    if (Number.isNaN(parsedTimestamp.getTime())) {
      return res.status(400).json({ error: "Invalid timestamp" });
    }

    const canonicalized = canonicalizePayload(payload);
    if (!canonicalized) {
      return res.status(400).json({ error: "Invalid payload" });
    }
    const { canonical, message } = canonicalized;

    const publicKey = crypto.createPublicKey({
      key: Buffer.from(student.public_key, "base64"),
      format: "der",
      type: "spki",
    });
    const verified = crypto.verify(
      null,
      Buffer.from(message),
      publicKey,
      Buffer.from(signature, "base64")
    );

    if (!verified) {
      return res.status(400).json({ error: "Signature verification failed" });
    }

    const submission = await AnswerSubmission.create({
      exam_id: canonical.exam_id,
      student: student._id,
      student_id: canonical.student_id,
      payload: canonical,
      answers: canonical.answers,
      signature,
      verified: true,
      submitted_at: parsedTimestamp,
    });
    await logAction({
      action: "answers_submitted",
      actor: student._id,
      actor_role: "student",
      exam_id: canonical.exam_id,
      metadata: { submission_id: submission._id },
    });

    return res.status(201).json({ success: true, verified: true, id: submission._id });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/admin/exams/history", async (req, res) => {
  try {
    const history = await ExamPackage.find()
      .sort({ createdAt: -1 })
      .select("-ciphertext");
    return res.json(history);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/admin/submissions", authenticate, requireAdmin, async (req, res) => {
  try {
    const submissions = await AnswerSubmission.find()
      .sort({ submitted_at: -1, createdAt: -1 })
      .populate("student", "name email")
      .lean();
    const response = submissions.map((item) => ({
      _id: item._id,
      exam_id: item.exam_id,
      student_id: item.student_id || item.student?._id,
      student_name: item.student?.name,
      student_email: item.student?.email,
      payload: item.payload,
      answers: item.answers,
      signature: item.signature,
      submitted_at: item.submitted_at || item.createdAt,
      verified: item.verified,
    }));
    return res.json(response);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/admin/results/announce", authenticate, requireAdmin, async (req, res) => {
  try {
    const { exam_id, correct_answers } = req.body;
    if (!exam_id || !correct_answers) {
      return res.status(400).json({ error: "exam_id and correct_answers required" });
    }
    const normalizedCorrect = normalizeAnswers(correct_answers);
    if (!normalizedCorrect || Object.keys(normalizedCorrect).length === 0) {
      return res.status(400).json({ error: "Invalid correct_answers payload" });
    }

    await AnswerKey.findOneAndUpdate(
      { exam_id },
      { correct_answers: normalizedCorrect },
      { upsert: true, new: true }
    );

    const submissions = await AnswerSubmission.find({ exam_id })
      .sort({ submitted_at: -1, createdAt: -1 })
      .populate("student", "name email public_key")
      .lean();

    const results = [];
    for (const submission of submissions) {
      let verified = false;
      let score = 0;
      let total = Object.keys(normalizedCorrect).length;
      const studentIdValue =
        submission.student?._id?.toString() || submission.student_id || "";
      if (submission.payload && submission.student?.public_key) {
        const canonicalized = canonicalizePayload(submission.payload);
        if (canonicalized) {
          const publicKey = crypto.createPublicKey({
            key: Buffer.from(submission.student.public_key, "base64"),
            format: "der",
            type: "spki",
          });
          verified = crypto.verify(
            null,
            Buffer.from(canonicalized.message),
            publicKey,
            Buffer.from(submission.signature, "base64")
          );
          if (verified) {
            const graded = gradeSubmission(
              canonicalized.canonical.answers,
              normalizedCorrect
            );
            score = graded.score;
            total = graded.total;
          }
        }
      }

      const percentage = total ? Math.round((score / total) * 100) : 0;
      if (submission.student?._id) {
        await ExamResult.findOneAndUpdate(
          { exam_id, student: submission.student._id },
          {
            exam_id,
            student: submission.student._id,
            student_id: studentIdValue,
            submission: submission._id,
            score,
            total,
            percentage,
            verified,
            evaluated_at: new Date(),
          },
          { upsert: true, new: true }
        );
      }

      results.push({
        submission_id: submission._id,
        exam_id: submission.exam_id,
        student_id: studentIdValue || submission.student?._id,
        student_name: submission.student?.name,
        student_email: submission.student?.email,
        score,
        total,
        percentage,
        verified,
        submitted_at: submission.submitted_at || submission.createdAt,
      });
    }

    await logAction({
      action: "results_announced",
      actor: req.user?.sub,
      actor_role: req.user?.role,
      exam_id,
      metadata: { submissions: submissions.length, total_questions: Object.keys(normalizedCorrect).length },
    });

    return res.json({ exam_id, total_questions: Object.keys(normalizedCorrect).length, results });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/admin/logs", authenticate, requireAdmin, async (req, res) => {
  try {
    const logs = await ActionLog.find()
      .sort({ createdAt: -1 })
      .populate("actor", "name email role")
      .lean();
    const response = logs.map((item) => ({
      _id: item._id,
      action: item.action,
      actor_id: item.actor?._id,
      actor_name: item.actor?.name,
      actor_email: item.actor?.email,
      actor_role: item.actor?.role || item.actor_role,
      exam_id: item.exam_id,
      metadata: item.metadata,
      created_at: item.createdAt,
    }));
    return res.json(response);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/auth/signup", async (req, res) => {
  try {
    const { name, email, password, role, public_key } = req.body;
    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: "name, email, password, role required" });
    }
    if (!["admin", "student"].includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }
    if (role === "student" && !public_key) {
      return res.status(400).json({ error: "public_key required for student" });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password_hash, role, public_key });
    await logAction({
      action: "signup",
      actor: user._id,
      actor_role: user.role,
      metadata: { email: user.email },
    });

    const token = jwt.sign({ sub: user._id, role: user.role }, jwtSecret, {
      expiresIn: "7d",
    });

    return res.status(201).json({
      token,
      role: user.role,
      user_id: user._id,
      name: user.name,
      email: user.email,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "email and password required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign({ sub: user._id, role: user.role }, jwtSecret, {
      expiresIn: "7d",
    });
    await logAction({
      action: "login",
      actor: user._id,
      actor_role: user.role,
      metadata: { email: user.email },
    });

    return res.json({
      token,
      role: user.role,
      user_id: user._id,
      name: user.name,
      email: user.email,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.post(
  "/api/admin/exams",
  upload.fields([
    { name: "file", maxCount: 1 },
    { name: "paper", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const { exam_id, exam_time, paper_text } = req.body;
      const uploadedFile = req.files?.file?.[0] || req.files?.paper?.[0];

      if (!exam_id || !exam_time || (!uploadedFile && !paper_text)) {
        return res.status(400).json({
          error: "exam_id, exam_time, and paper file or text are required",
        });
      }

      const examTimeDate = new Date(exam_time);
      if (Number.isNaN(examTimeDate.getTime())) {
        return res.status(400).json({ error: "Invalid exam_time" });
      }

      const examTimeUtc = examTimeDate.toISOString();
      const epochMs = epochTime.getTime();
      const examMs = examTimeDate.getTime();
      const stepMs = stepSizeSeconds * 1000;
      if (stepMs <= 0) {
        return res.status(500).json({ error: "Invalid step size configuration" });
      }

      const n = Math.floor((examMs - epochMs) / stepMs);
      if (n < 0) {
        return res.status(400).json({ error: "exam_time is before EpochTime" });
      }

      const k1 = sha256(k0);
      const kn = evolveKey(k0, n);
      const encKey = deriveEncKey(kn);

      const paperBuffer = uploadedFile
        ? await fs.promises.readFile(uploadedFile.path)
        : Buffer.from(paper_text, "utf8");
      const content_type = paper_text ? "text" : "file";
      const nonce = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", encKey, nonce);

      const aad = Buffer.from(
        JSON.stringify({ exam_id, exam_time: examTimeUtc })
      );
      cipher.setAAD(aad);

      const ciphertext = Buffer.concat([cipher.update(paperBuffer), cipher.final()]);
      const tag = cipher.getAuthTag();

      const packagePayload = {
        exam_id,
        exam_time: examTimeUtc,
        k1: k1.toString("hex"),
        ciphertext: ciphertext.toString("base64"),
        nonce: nonce.toString("base64"),
        tag: tag.toString("base64"),
        aad: aad.toString("base64"),
        version: 1,
        content_type,
      };

      const signature = crypto
        .sign(null, Buffer.from(JSON.stringify(packagePayload)), privateKey)
        .toString("base64");

      const fullPackage = {
        ...packagePayload,
        signature,
        public_key: publicKeyPem,
      };
      const safeExamId = exam_id.replace(/[^a-zA-Z0-9._-]/g, "_");
      const packageFileName = `${safeExamId}_exam_package.enc`;
      const packagePath = path.join(packagesDir, packageFileName);

      await fs.promises.writeFile(packagePath, JSON.stringify(fullPackage, null, 2));
      await ExamPackage.create({
        ...fullPackage,
        exam_time: new Date(examTimeUtc),
      });
      await logAction({
        action: "exam_created",
        actor: req.user?.sub,
        actor_role: req.user?.role,
        exam_id,
        metadata: { content_type },
      });

      return res.json({
        success: true,
        message: "Exam package created successfully",
        package_file: packageFileName,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

const port = process.env.PORT || 5000;
connectDb()
  .then(() => {
    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
