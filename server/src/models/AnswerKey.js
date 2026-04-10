const mongoose = require("mongoose");

const answerKeySchema = new mongoose.Schema(
  {
    exam_id: { type: String, required: true, unique: true, index: true },
    correct_answers: { type: Object, required: true },
  },
  { timestamps: true, collection: "answer_keys" }
);

module.exports = mongoose.model("AnswerKey", answerKeySchema);
