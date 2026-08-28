import express, {Request, Response} from 'express'
const router = express.Router()

router.get('/', (req: Request, res: Response) => {
    req.logout((err) => {
        res.clearCookie('key')
        return res.redirect('/login')
    })
})

export default router