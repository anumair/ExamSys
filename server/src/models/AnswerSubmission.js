const mongoose = require("mongoose");

const AnswerSubmissionSchema = new mongoose.Schema(
  {
    exam_id: { type: String, required: true, index: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    student_id: { type: String, required: true },
    payload: { type: Object, required: true },
    answers: { type: Object, required: true },
    signature: { type: String, required: true },
    verified: { type: Boolean, default: false },
    submitted_at: { type: Date, default: Date.now },
  },
  { timestamps: true, collection: "submissions" }
);

module.exports = mongoose.model("AnswerSubmission", AnswerSubmissionSchema);
