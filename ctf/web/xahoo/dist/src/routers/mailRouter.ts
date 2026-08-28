import express, {Request, Response} from 'express'
const router = express.Router()
import Mail from '../models/mails.js'

router.get('/', async (req: Request, res: Response) => {
    if (req.user && 'email' in req.user && 'key' in req.user) {
        if (!req.cookies.key && req.user.key) {
            res.cookie('key', req.user.key)
            return res.redirect('/mail')
        }
        const allMail = await Mail.find({to: req.user.email})
        res.render('mail', {mail: allMail})
    } else {
        res.json({success: false, message: "Something went wrong. Please try again later."})
    }
})

router.get('/:id', async(req: Request, res: Response) => {
    const {id} = req.params
    try {
        if (req.user && 'email' in req.user && req.user.email) {
            const foundMail = await Mail.findById(id)
            if (!foundMail) return res.redirect('/mail')
            if (foundMail.to != req.user.email) return res.end('Not your mail!')
            return res.render('singleMail', {mail: foundMail})
        } else {
            return res.end('Something went wrong.')
        }
    } catch (error) {
        return res.end('Something went wrong.')
    }
})

export default router