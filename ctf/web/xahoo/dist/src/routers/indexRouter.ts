import express from 'express'
const router = express.Router()

router.get('/', (req, res) => {
    if (req.user) {
        return res.redirect('/mail')
    } else {
        return res.redirect('/login')
    }
})

export default router