import dotenv from 'dotenv'
dotenv.config()

import express from 'express'
import flash from 'express-flash'
import session from 'express-session'
import cookieParser from 'cookie-parser'
import mongoose from 'mongoose'
import passport from 'passport'
import passportInit from './utils/passport-config.js'
import {ensureAuthenticated, forwardAuthenticated} from './utils/authenticate.js'

import indexRouter from './routers/indexRouter.js'
import loginRouter from './routers/loginRouter.js'
import mailRouter from './routers/mailRouter.js'
import logoutRouter from './routers/logoutRouter.js'
import keyRouter from './routers/keyRouter.js'
import loginwithkeyrouter from './routers/loginWithKeyRouter.js'

const PORT = process.env.PORT || 5000
const app = express()

app.use(express.json({limit: '1mb'}))
app.use(express.urlencoded({extended: false}))
app.use(express.static('public'))
app.set('view engine', 'ejs')
app.use(flash())
app.use(session({
    secret: process.env.SESSION_SECRET || 'alternateSecret',
    saveUninitialized: true,
    resave: true
}))
app.use(cookieParser())
passportInit(passport)
app.use(passport.initialize())
app.use(passport.session())

if (process.env.MONGO_URI) {
    mongoose.connect(process.env.MONGO_URI)
    console.log('MongoDB connected')
}

app.use('/', indexRouter)
app.use('/login', forwardAuthenticated, loginRouter)
app.use('/mail', ensureAuthenticated, mailRouter)
app.use('/logout', ensureAuthenticated, logoutRouter)
app.use('/key', ensureAuthenticated, keyRouter)
app.use('/loginwithkey', forwardAuthenticated, loginwithkeyrouter)

app.listen(PORT, () => console.log(`Xahoo listening on port ${PORT}`))