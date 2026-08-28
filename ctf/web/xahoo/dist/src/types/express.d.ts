declare global {
    namespace Express {
        interface User {
            email: string;
            key: string;
        }
    }
}

export {}
