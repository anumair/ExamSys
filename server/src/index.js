const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const multer = require("multer");

dotenv.config();

const app = express();
app.use(cors());

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

app.post(
  "/api/admin/exams",
  upload.fields([
    { name: "file", maxCount: 1 },
    { name: "paper", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const { exam_id, exam_time } = req.body;
      const uploadedFile = req.files?.file?.[0] || req.files?.paper?.[0];

      if (!exam_id || !exam_time || !uploadedFile) {
        return res.status(400).json({
          error: "exam_id, exam_time, and file are required",
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

      const paperBuffer = await fs.promises.readFile(uploadedFile.path);
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
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
