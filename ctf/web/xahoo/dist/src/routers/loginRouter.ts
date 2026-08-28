import express, {Request, Response} from 'express'
import passport from 'passport'
const router = express.Router()

router.get('/', (req: Request, res: Response) => {
    res.render('login')
})

router.post('/', passport.authenticate('local', {
    failureFlash: true,
    failureRedirect: '/login',
    successRedirect: '/mail'
}))

export default router