import mongoose from 'mongoose'
const Schema = mongoose.Schema;
const reqString = { type: String, required: true };
const nonReqString = { type: String, required: false };

const mailsModel = new Schema({
    from: reqString,
    to: reqString,
    date: reqString,
    subject: reqString,
    data: reqString,
    attachments: {
        type: Array,
        required: true,
        default: []
    }
})

export default mongoose.model("Mail", mailsModel)