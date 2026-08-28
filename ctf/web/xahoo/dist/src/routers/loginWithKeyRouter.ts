import express, {Request, Response} from 'express'
import User from '../models/users.js'
const router = express.Router()

router.get('/', (req: Request, res: Response) => {
    res.render('loginwithkey', {error: false})
})

router.post('/', async (req: Request, res: Response) => {
    const {key} = req.body
    if (typeof key !== 'string' || key.length !== 64) return res.render('loginwithkey', {error: 'Wrong key!'})
    const foundUser = await User.findOne({key})
    if (!foundUser) return res.render('loginwithkey', {error: 'Wrong key!'})
    req.login(foundUser, (err) => {
        if (err) return res.render('loginwithkey', {error: 'Something went wrong. Please try again.'})
        return res.redirect('/mail')
    })
})

export default router