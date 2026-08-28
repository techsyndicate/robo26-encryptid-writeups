import passportLocal from 'passport-local'
const LocalStrategy = passportLocal.Strategy
import bcrypt from 'bcrypt'
import User from '../models/users.js'

function initialize(passport: any) {
    const authenticateUser = async (email: any, password: any, done: any) => {
        try {
            const user = await User.findOne({ email: email });

            if (!user) {
                return done(null, false, { message: 'No user with this email' });
            }

            if (await bcrypt.compare(password, user.password)) {
                return done(null, user);
            } else {
                return done(null, false, { message: 'Password incorrect' });
            }
        } catch (e) {
            return done(e);
        }
    }

    passport.use(new LocalStrategy({ usernameField: 'email' }, authenticateUser));
    passport.serializeUser((user: any, done: any) => done(null, user.id));
    passport.deserializeUser(async (id: any, done: any) => {
        const user = await User.findById(id);
        return done(null, user);
    });
}

export default initialize