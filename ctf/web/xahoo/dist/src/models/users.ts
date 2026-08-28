import mongoose from 'mongoose'
const Schema = mongoose.Schema;
const reqString = { type: String, required: true };
const nonReqString = { type: String, required: false };

const usersModel = new Schema({
    email: reqString,
    password: reqString,
    key: reqString
})

export default mongoose.model("User", usersModel)