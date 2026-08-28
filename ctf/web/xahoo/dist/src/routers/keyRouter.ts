import express, {Request, Response} from 'express'
import User from '../models/users.js'
const router = express.Router()

router.get('/', async (req: Request, res: Response) => {
    if (req.user && 'email' in req.user && 'key' in req.cookies) {
        const adminUser = await User.findOne({email: 'admin@xahoo.com'})
        const testUser = await User.findOne({email: 'testuser@xahoo.com'})
        if (adminUser && 'key' in adminUser && testUser && 'key' in testUser) {
            var concatenatedKeys = ''
            if (req.user.email == 'testuser@xahoo.com') {
                concatenatedKeys = testUser.key + adminUser.key
            } else {
                concatenatedKeys = adminUser.key + testUser.key
            }
            const keyIndex = concatenatedKeys.indexOf(req.cookies.key)
            if (req.cookies.key.length != 64) return res.end('Corrupt cookie!')
            if (keyIndex < 0) return res.end('Corrupt cookie!')
            return res.end(concatenatedKeys.substring(keyIndex, keyIndex + 65))
        }
    } else {
        res.redirect('/mail')
    }
})

export default router