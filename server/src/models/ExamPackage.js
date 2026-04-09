const mongoose = require("mongoose");

const examPackageSchema = new mongoose.Schema(
  {
    exam_id: { type: String, required: true, index: true },
    exam_time: { type: Date, required: true },
    k1: { type: String, required: true },
    ciphertext: { type: String, required: true },
    nonce: { type: String, required: true },
    tag: { type: String, required: true },
    aad: { type: String, required: true },
    version: { type: Number, required: true },
    content_type: { type: String, enum: ["text", "file"], required: true },
    signature: { type: String, required: true },
    public_key: { type: String, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ExamPackage", examPackageSchema);
